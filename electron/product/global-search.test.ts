import { describe, expect, it, vi } from "vitest";
import type { AiSession, GlobalSearchResult } from "../../shared/contracts";
import { globalSearch, type GlobalSearchContext } from "./global-search";
import type { ProductService } from "./product-service";

function makeSession(overrides: Partial<AiSession> = {}): AiSession {
  return {
    schemaVersion: 1,
    id: "sess-1",
    projectId: "p1",
    projectRoot: "/project",
    title: "会话一",
    provider: "claude",
    providerId: "claude",
    providerSessionId: null,
    cwd: "/project",
    permissionProfile: "edit",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: "2026-07-08T00:00:00Z",
    updatedAt: "2026-07-08T10:00:00Z",
    lastRunId: null,
    ...overrides
  };
}

function makeProductStub(
  content: GlobalSearchResult[] = [],
  projects: GlobalSearchResult[] = []
): ProductService {
  return {
    searchContent: vi.fn().mockReturnValue(content),
    searchCreativeProjects: vi.fn().mockReturnValue(projects)
  } as unknown as ProductService;
}

function makeCtx(overrides: Partial<GlobalSearchContext> = {}): GlobalSearchContext {
  return {
    ensureProductService: () => makeProductStub(),
    searchSessions: async () => [],
    listSkillDefinitions: async () => [],
    ...overrides
  };
}

describe("globalSearch", () => {
  it("空 query 返回 []", async () => {
    const ctx = makeCtx();
    expect(await globalSearch("", ctx)).toEqual([]);
    expect(await globalSearch(null, ctx)).toEqual([]);
    expect(await globalSearch("   ", ctx)).toEqual([]);
  });

  it("query 超过 500 字符被 zod 拒绝", async () => {
    const ctx = makeCtx();
    await expect(globalSearch("x".repeat(501), ctx)).rejects.toThrow();
  });

  it("session 结果:claude provider 字幕为 'Claude Code · <cwd>'", async () => {
    const ctx = makeCtx({
      searchSessions: async () => [makeSession({ provider: "claude", cwd: "/repo" })]
    });
    const results = await globalSearch("test", ctx);
    const session = results.find((r) => r.kind === "session")!;
    expect(session.subtitle).toBe("Claude Code · /repo");
    expect(session.id).toBe("session:sess-1");
    expect(session.targetId).toBe("sess-1");
    expect(session.status).toBe("idle");
    expect(session.date).toBe("2026-07-08T10:00:00Z");
  });

  it("session 结果:非 claude(如 codex)provider 字幕为 'Codex · <cwd>'", async () => {
    const ctx = makeCtx({
      searchSessions: async () => [makeSession({ id: "sess-2", provider: "codex", cwd: "/work" })]
    });
    const results = await globalSearch("test", ctx);
    const session = results.find((r) => r.kind === "session")!;
    expect(session.subtitle).toBe("Codex · /work");
  });

  it("session 结果截断到 16 条", async () => {
    const sessions = Array.from({ length: 20 }, (_, i) => makeSession({ id: `s${i}` }));
    const ctx = makeCtx({ searchSessions: async () => sessions });
    const results = await globalSearch("test", ctx);
    expect(results.filter((r) => r.kind === "session")).toHaveLength(16);
  });

  it("skill 结果按 title/description/id 模糊过滤(小写)", async () => {
    const ctx = makeCtx({
      listSkillDefinitions: async () => [
        { id: "rss-saver", title: "RSS Article Saver", description: "fetches feeds", cwd: "/skills/rss" },
        { id: "video-dl", title: "Video Downloader", description: "yt-dlp", cwd: "/skills/video" }
      ]
    });
    const results = await globalSearch("RSS", ctx);
    const skills = results.filter((r) => r.kind === "skill");
    expect(skills).toHaveLength(1);
    expect(skills[0].title).toBe("RSS Article Saver");
    expect(skills[0].subtitle).toBe("fetches feeds");
    expect(skills[0].path).toBe("/skills/rss");
  });

  it("skill 匹配 description 或 id", async () => {
    const ctx = makeCtx({
      listSkillDefinitions: async () => [
        { id: "x-fetch", title: "X Fetcher", description: "tweets", cwd: "/x" },
        { id: "reddit", title: "Reddit", description: "subreddits", cwd: null }
      ]
    });
    // 匹配 id
    let results = await globalSearch("reddit", ctx);
    expect(results.filter((r) => r.kind === "skill")).toHaveLength(1);

    // 匹配 description
    results = await globalSearch("tweets", ctx);
    expect(results.filter((r) => r.kind === "skill")).toHaveLength(1);
  });

  it("skill 无 cwd 时 path=null,description 缺省回退", async () => {
    const ctx = makeCtx({
      listSkillDefinitions: async () => [{ id: "solo", title: "Solo Skill" }]
    });
    const results = await globalSearch("solo", ctx);
    const skill = results.find((r) => r.kind === "skill")!;
    expect(skill.path).toBeNull();
    expect(skill.subtitle).toBe("Skill");
    expect(skill.title).toBe("Solo Skill");
  });

  it("skill 结果截断到 12 条", async () => {
    const defs = Array.from({ length: 15 }, (_, i) => ({
      id: `skill-${i}`,
      title: `Skill ${i}`,
      description: "common",
      cwd: "/s"
    }));
    const ctx = makeCtx({ listSkillDefinitions: async () => defs });
    const results = await globalSearch("common", ctx);
    expect(results.filter((r) => r.kind === "skill")).toHaveLength(12);
  });

  it("product 结果来自 searchContent + searchCreativeProjects", async () => {
    const contentItem: GlobalSearchResult = {
      id: "c1", kind: "content", title: "文章", subtitle: "s", path: "/a.md",
      date: "2026-07-08", status: null, targetId: "c1"
    };
    const projectItem: GlobalSearchResult = {
      id: "p1", kind: "project", title: "项目", subtitle: "s", path: "/p",
      date: null, status: null, targetId: "p1"
    };
    const product = makeProductStub([contentItem], [projectItem]);
    const ctx = makeCtx({ ensureProductService: () => product });
    const results = await globalSearch("test", ctx);
    expect(product.searchContent).toHaveBeenCalledWith("test", 24);
    expect(product.searchCreativeProjects).toHaveBeenCalledWith("test", 16);
    expect(results.find((r) => r.id === "c1")).toBeDefined();
    expect(results.find((r) => r.id === "p1")).toBeDefined();
  });

  it("合并后截断到 64 条", async () => {
    const content = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`, kind: "content" as const, title: `C${i}`, subtitle: "s",
      path: `/c${i}`, date: null, status: null, targetId: `c${i}`
    }));
    const projects = Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`, kind: "project" as const, title: `P${i}`, subtitle: "s",
      path: `/p${i}`, date: null, status: null, targetId: `p${i}`
    }));
    const ctx = makeCtx({
      ensureProductService: () => makeProductStub(content, projects)
    });
    const results = await globalSearch("test", ctx);
    expect(results).toHaveLength(64);
  });

  it("最终结果经 GlobalSearchResultSchema 校验(保证结构)", async () => {
    const ctx = makeCtx({
      searchSessions: async () => [makeSession({ provider: "claude" })]
    });
    const results = await globalSearch("test", ctx);
    for (const r of results) {
      expect(typeof r.id).toBe("string");
      expect(["content", "project", "session", "skill"]).toContain(r.kind);
      expect(typeof r.title).toBe("string");
      expect(typeof r.subtitle).toBe("string");
      expect(r.path === null || typeof r.path === "string").toBe(true);
      expect(typeof r.targetId).toBe("string");
    }
  });
});

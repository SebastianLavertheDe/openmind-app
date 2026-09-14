import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductService } from "./product-service";
import type { ContentServiceApi, CreativeServiceApi } from "./common";
import { UserPreferencesSchema, type UserPreferences } from "../../shared/contracts";

describe("ProductService", () => {
  let root = "";
  let entries: Array<Record<string, unknown>> = [];
  let records: Record<string, string> = {};
  let reads = 0;
  let topicReads = 0;
  let overviewReads = 0;
  let contentReads = 0;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-product-"));
    // Existing installations kept subscriptions.opml in the installed package.
    // SourceRegistry migrates that legacy copy into persistent Skill data.
    fs.mkdirSync(path.join(root, "openmind", ".agent", "skills", "rss-article-saver"), { recursive: true });
    fs.mkdirSync(path.join(root, "openmind", "daily-summary"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "openmind", ".agent", "skills", "rss-article-saver", "subscriptions.opml"),
      `<?xml version="1.0"?><opml version="2.0"><body><outline text="Example" type="rss" xmlUrl="https://example.com/feed.xml"/></body></opml>`
    );
    fs.writeFileSync(path.join(root, "openmind", "daily-summary", "20260615_daily_summary.md"), "# 每日总结\n\n## 核心信号\n\n本地 AI 工作台正在成熟。");
    entries = [{
      path: "openmind/article/20260615/example.md",
      name: "example.md",
      kind: "articles",
      size: 512,
      modifiedAt: "2026-06-15T10:00:00.000Z"
    }];
    records = {
      "openmind/article/20260615/example.md": "# Example Article\n\n- 链接: https://example.com/post\n- 作者: Say\n- 来源: Example\n\n这是正文摘要。"
    };
    reads = 0;
    topicReads = 0;
    overviewReads = 0;
    contentReads = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function createService() {
    // ADR-001: ProductService takes the openmind content dir (root/openmind), not
    // the repository. SourceRegistry derives both installed and persistent Skill
    // paths from that root.
    return new ProductService(
      path.join(root, "openmind"),
      {
        getContent: (kind) => { contentReads += 1; return kind === "all" || kind === "articles" ? entries as never : []; },
        readContent: (relativePath) => {
          reads += 1;
          return { path: relativePath, content: records[relativePath] };
        },
        getOverview: () => { overviewReads += 1; return { date: "20260615", repoRoot: root, metrics: { articles: 1, posts: 0, reddit: 0, summaries: 0, topics: 0 }, pipeline: [], recent: [] }; },
        writeContent: (relativePath, rawContent) => ({ path: relativePath, name: path.basename(relativePath), content: rawContent, truncated: false })
      } satisfies ContentServiceApi,
      {
        getCreativeTopics: () => {
          topicReads += 1;
          return { topics: [{ title: "AI 工作台", score: 9, body: "整理本地 AI 产品体验。[资料](https://example.com)" }] };
        },
        getAllCreativeTopics: () => [],
        listCreativeProjects: () => [{ dir: "creative/demo", topic: "Demo", stage: "drafting", completion: 50, date: "20260615" }]
      } as CreativeServiceApi,
      // ADR-001: keep app-private state under the legacy repo root for these
      // tests (so .openmind lands at root/.openmind as the fixtures expect);
      // production wires this to userData/state/<root-id>/ via main.ts.
      { stateRoot: root }
    );
  }

  it("builds the source list from local facts", () => {
    const service = createService();
    const sources = service.listSources();
    expect(sources.some((source) => source.kind === "rss" && source.name === "Example")).toBe(true);
    expect(fs.readFileSync(path.join(root, "openmind", ".agent", "skill-data", "rss-article-saver", "subscriptions.opml"), "utf8")).toContain("https://example.com/feed.xml");
  });

  it("keeps an existing persistent RSS list instead of reseeding package defaults", () => {
    const persistent = path.join(root, "openmind", ".agent", "skill-data", "rss-article-saver", "subscriptions.opml");
    fs.mkdirSync(path.dirname(persistent), { recursive: true });
    fs.writeFileSync(
      persistent,
      `<?xml version="1.0"?><opml version="2.0"><body><outline text="User Feed" type="rss" xmlUrl="https://user.example/feed.xml"/></body></opml>`
    );

    const sources = createService().listSources();

    expect(sources.some((source) => source.url === "https://user.example/feed.xml")).toBe(true);
    expect(sources.some((source) => source.url === "https://example.com/feed.xml")).toBe(false);
  });

  it("stores the X cURL in private Skill data and migrates the legacy editor path", () => {
    const legacyDirectory = path.join(root, "openmind", ".claude", "skills", "x-following-fetcher");
    const persistentDirectory = path.join(root, "openmind", ".agent", "skill-data", "x-following-fetcher");
    fs.mkdirSync(legacyDirectory, { recursive: true });
    fs.writeFileSync(path.join(legacyDirectory, "curl.txt"), "curl 'https://x.com/legacy'\n", "utf8");
    fs.writeFileSync(path.join(legacyDirectory, "curl_foryou.txt"), "curl 'https://x.com/for-you'\n", "utf8");
    const service = createService();

    expect(service.getXFollowingCurls()).toEqual([
      "curl 'https://x.com/legacy'",
      "curl 'https://x.com/for-you'"
    ]);
    expect(fs.readFileSync(path.join(persistentDirectory, "curl.txt"), "utf8")).toBe("curl 'https://x.com/legacy'\n");
    expect(fs.readFileSync(path.join(persistentDirectory, "curl_2.txt"), "utf8")).toBe("curl 'https://x.com/for-you'\n");

    service.saveXFollowingCurls([
      "  curl 'https://x.com/current'  ",
      "curl 'https://x.com/list'",
      "curl 'https://x.com/bookmarks'"
    ]);
    expect(service.getXFollowingCurls()).toEqual([
      "curl 'https://x.com/current'",
      "curl 'https://x.com/list'",
      "curl 'https://x.com/bookmarks'"
    ]);
    expect(fs.existsSync(path.join(persistentDirectory, "curl_3.txt"))).toBe(true);

    service.saveXFollowingCurls(["curl 'https://x.com/current'"]);
    expect(fs.existsSync(path.join(persistentDirectory, "curl_2.txt"))).toBe(false);
    expect(fs.existsSync(path.join(persistentDirectory, "curl_3.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(legacyDirectory, "curl.txt"), "utf8")).toBe("curl 'https://x.com/legacy'\n");
    expect(() => service.saveXFollowingCurls(["not a curl"])).toThrow("请确保每一项都是以 curl 开头的完整请求");
  });

  it("lists and edits persistent Reddit communities instead of one generated placeholder", () => {
    const installed = path.join(root, "openmind", ".agent", "skills", "reddit-fetcher");
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, "SKILL.md"), `---
name: reddit-fetcher
title: Reddit 内容抓取
surfacesAsSource:
  sourceId: reddit
  sourceName: Reddit 订阅
  kind: reddit
  artifactRoot: reddit
---
# Reddit Fetcher
`);
    fs.writeFileSync(path.join(installed, "config.yaml"), `fetch:
  sources:
    - https://www.reddit.com/r/LocalLLaMA/hot.json
    - https://www.reddit.com/r/artificial/hot.json
`);
    const service = createService();

    const initial = service.listSources().filter((source) => source.kind === "reddit");

    expect(initial).toHaveLength(2);
    expect(initial.map((source) => source.name)).toEqual(["r/LocalLLaMA", "r/artificial"]);
    expect(initial.every((source) => source.url?.endsWith("/hot.json"))).toBe(true);
    const persistentPath = path.join(root, "openmind", ".agent", "skill-data", "reddit-fetcher", "user-sources.yaml");
    expect(fs.readFileSync(persistentPath, "utf8")).toContain("schemaVersion: 2");

    // Existing migrations wrote schema v1 URL arrays. They remain readable and
    // are upgraded to the structured format on the first edit.
    fs.writeFileSync(persistentPath, `schemaVersion: 1
sources:
  - https://www.reddit.com/r/LocalLLaMA/hot.json
`);
    const legacy = service.listSources().filter((source) => source.kind === "reddit");
    expect(legacy).toHaveLength(1);
    const first = legacy[0];
    const updated = service.updateSource(first.id, {
      name: "Local LLM",
      url: "https://www.reddit.com/r/LocalLLaMA/new.json",
      enabled: false,
      tags: ["AI"]
    });
    expect(updated).toMatchObject({
      id: first.id,
      name: "Local LLM",
      url: "https://www.reddit.com/r/LocalLLaMA/new.json",
      enabled: false,
      status: "disabled",
      tags: ["AI"]
    });

    const added = service.addRssSource({
      name: "ClaudeAI",
      kind: "reddit",
      url: "https://www.reddit.com/r/ClaudeAI/hot.json",
      tags: ["AI"]
    });
    expect(added).toMatchObject({ name: "ClaudeAI", kind: "reddit", skillId: "reddit-fetcher", enabled: true });

    const persistent = fs.readFileSync(persistentPath, "utf8");
    expect(persistent).toContain("schemaVersion: 2");
    expect(persistent).toContain("enabled: false");
    expect(persistent).toContain("https://www.reddit.com/r/ClaudeAI/hot.json");
    expect(fs.readFileSync(path.join(installed, "config.yaml"), "utf8")).not.toContain("ClaudeAI");
  });

  it("adds, disables and imports RSS sources with persisted structured runs", () => {
    const service = createService();
    const added = service.addRssSource({ name: "Second Feed", url: "https://second.example/feed.xml" });
    expect(added.name).toBe("Second Feed");
    expect(service.listSources().some((source) => source.url === "https://second.example/feed.xml")).toBe(true);
    const installedOpml = path.join(root, "openmind", ".agent", "skills", "rss-article-saver", "subscriptions.opml");
    const persistentOpml = path.join(root, "openmind", ".agent", "skill-data", "rss-article-saver", "subscriptions.opml");
    expect(fs.readFileSync(installedOpml, "utf8")).not.toContain("https://second.example/feed.xml");
    expect(fs.readFileSync(persistentOpml, "utf8")).toContain("https://second.example/feed.xml");

    const disabled = service.updateSource(added.id, { enabled: false, frequency: "每 6 小时" });
    expect(disabled).toMatchObject({ enabled: false, frequency: "每 6 小时", status: "disabled" });
    const settings = JSON.parse(fs.readFileSync(path.join(root, ".openmind", "source-settings.json"), "utf8"));
    expect(settings.disabledUrls).toContain("https://second.example/feed.xml");

    const importedPath = path.join(root, "import.opml");
    fs.writeFileSync(importedPath, `<?xml version="1.0"?><opml version="2.0"><body><outline text="Third" type="rss" xmlUrl="https://third.example/feed.xml"/></body></opml>`);
    expect(service.importOpml(importedPath)).toBe(1);
    expect(service.importOpml(importedPath)).toBe(0);

    const folder = service.addRssSource({ name: "Local Notes", kind: "web", url: "~/openmind/notes", frequency: "每天", tags: ["notes"] });
    expect(folder).toMatchObject({ name: "Local Notes", kind: "web", url: "~/openmind/notes", skillId: null, tags: ["notes"] });

    service.recordSkillEvent({ skillId: "rss-article-saver", sourceId: added.id, invocationId: "run-1", type: "status", state: "running", timestamp: "2026-06-15T10:00:00.000Z" });
    service.recordSkillEvent({ skillId: "rss-article-saver", sourceId: added.id, invocationId: "run-1", type: "output", stream: "stdout", text: "Fetched one item\n", timestamp: "2026-06-15T10:00:01.000Z" });
    service.recordSkillEvent({ skillId: "rss-article-saver", sourceId: added.id, invocationId: "run-1", type: "status", state: "success", code: 0, durationMs: 1200, timestamp: "2026-06-15T10:00:02.000Z" });
    const persistedRuns = JSON.parse(fs.readFileSync(path.join(root, ".openmind", "source-runs.json"), "utf8"));
    expect(persistedRuns[0]).toMatchObject({ id: "run-1", status: "success", code: 0, durationMs: 1200 });
    expect(persistedRuns[0].logs[0].text).toContain("Fetched one item");
  });

  it("batches frequent skill output writes to disk", () => {
    vi.useFakeTimers();
    const service = createService();
    const runsPath = path.join(root, ".openmind", "source-runs.json");
    service.recordSkillEvent({ skillId: "reddit-fetcher", invocationId: "run-batch", type: "status", state: "running", timestamp: "2026-06-15T10:00:00.000Z" });
    for (let index = 0; index < 20; index++) {
      service.recordSkillEvent({
        skillId: "reddit-fetcher",
        invocationId: "run-batch",
        type: "output",
        stream: "stdout",
        text: `line ${index}\n`,
        timestamp: "2026-06-15T10:00:01.000Z"
      });
    }

    expect(fs.existsSync(runsPath)).toBe(false);
    vi.advanceTimersByTime(249);
    expect(fs.existsSync(runsPath)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(JSON.parse(fs.readFileSync(runsPath, "utf8"))[0].logs).toHaveLength(20);
  });

  it("caches getOverview and listContent per date and invalidates on write", () => {
    const service = createService();
    service.getOverview("20260615");
    service.getOverview("20260615");
    expect(overviewReads).toBe(1);

    service.listContent("articles", "20260615");
    service.listContent("articles", "20260615");
    expect(contentReads).toBe(1);

    service.listContent("articles", "20260616");
    expect(contentReads).toBe(2);

    service.writeContent("openmind/article/20260615/example.md", "new content");
    service.getOverview("20260615");
    expect(overviewReads).toBe(2);
  });

  it("searchContent 委托 contentIndex", async () => {
    const service = createService();
    const results = await service.searchContent("正文", 10);
    expect(Array.isArray(results)).toBe(true);
  });

  it("searchCreativeProjects 按 topic/dir 过滤并截断", () => {
    const service = createService();
    const results = service.searchCreativeProjects("demo", 16);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].kind).toBe("creative-project");
    expect(results[0].title).toBe("Demo");
    // 不匹配的 query 返回空
    expect(service.searchCreativeProjects("不存在的选题")).toEqual([]);
  });

  it("searchCreativeProjects 尊重 limit", () => {
    const service = createService();
    const results = service.searchCreativeProjects("demo", 0);
    expect(results).toHaveLength(0);
  });
});

describe("ProductService 创作委托方法", () => {
  let root = "";
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-product-creative-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  /** 构造一个带完整 creative spy 的 ProductService。 */
  function createServiceWithCreativeSpy(preferenceOverrides: Partial<UserPreferences> = {}, creativeOverrides: Record<string, unknown> = {}) {
    const creative = {
      getCreativeTopics: () => ({ topics: [] }),
      getAllCreativeTopics: () => [],
      listCreativeProjects: () => [{ dir: "creative/demo", topic: "Demo", stage: "drafting", completion: 50, date: "20260615" }],
      getCreativeProject: vi.fn(() => ({ dir: "creative/demo", topic: "Demo", stage: "drafting", files: { "draft.md": "# x" }, manifest: {} })),
      createCreativeProject: vi.fn(() => ({ dir: "creative/demo", stage: "drafting", files: {}, manifest: { topic: "Demo" } })),
      saveCreativeFile: vi.fn(() => ({ dir: "creative/demo", files: { "draft.md": "new" }, manifest: {} })),
      advanceProjectStage: vi.fn(() => ({ dir: "creative/demo", stage: "review" })),
      updateCreativeManifest: vi.fn(() => ({ dir: "creative/demo", manifest: {} })),
      listCreativeVersions: vi.fn(() => []),
      readCreativeVersion: vi.fn(() => ({ content: "old" })),
      restoreCreativeVersion: vi.fn(() => ({ dir: "creative/demo" })),
      getCreativeReleaseLog: vi.fn(() => []),
      copyCreativeProject: vi.fn(() => ({ dir: "creative/demo-copy" })),
      archiveCreativeProject: vi.fn(() => ({ dir: "creative/demo" })),
      getCreativeAnalytics: vi.fn(() => ({ total: 0, averageCompletion: 0, averageCycleHours: null, stages: [], platforms: [], stageDurations: [] })),
      ...creativeOverrides
    };
    const content = {
      getContent: () => [], readContent: () => ({ path: "x", content: "" }),
      getOverview: () => ({ date: "20260615", repoRoot: root, metrics: {}, pipeline: [], recent: [] }),
      writeContent: () => ({ path: "x", name: "x", content: "", truncated: false })
    };
    const service = new ProductService(
      path.join(root, "openmind"),
      content as ContentServiceApi,
      creative as unknown as CreativeServiceApi,
      // ADR-001: opts (4th param) — keep state under the legacy repo root for
      // these tests. preferences is now the 5th param.
      { stateRoot: root },
      () => ({ ...UserPreferencesSchema.parse({}), ...preferenceOverrides })
    );
    return { service, creative };
  }

  it("getCreativeProject 委托", () => {
    const { service, creative } = createServiceWithCreativeSpy();
    service.getCreativeProject("creative/demo");
    expect(creative.getCreativeProject).toHaveBeenCalledWith("creative/demo");
  });

  it("createCreativeProject 委托 + invalidate date", () => {
    const { service, creative } = createServiceWithCreativeSpy();
    service.createCreativeProject({ date: "2026-07-08", topic: { title: "T" } } as never);
    expect(creative.createCreativeProject).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-07-08" }));
  });

  it("saveCreativeFile 委托(不 invalidate)", () => {
    const { service, creative } = createServiceWithCreativeSpy();
    service.saveCreativeFile({ projectDir: "creative/demo", file: "draft.md", content: "x" });
    expect(creative.saveCreativeFile).toHaveBeenCalled();
  });

  it("advanceProjectStage 委托", () => {
    const { service, creative } = createServiceWithCreativeSpy();
    service.advanceProjectStage("creative/demo", "review");
    expect(creative.advanceProjectStage).toHaveBeenCalledWith("creative/demo", "review", expect.objectContaining({
      autoVersionOnStageChange: true,
      reviewRequiredForReady: true,
      publishChecklistEnabled: true
    }));
  });

  it("archives expired published projects only when the workflow rule is enabled", () => {
    const published = { dir: "creative/published", topic: "Old", stage: "published", completion: 100, date: "20260101" };
    const { service, creative } = createServiceWithCreativeSpy(
      { workflowAutoArchiveEnabled: true, archiveAfterDays: 7 },
      {
        listCreativeProjects: vi.fn(() => [published]),
        getCreativeProject: vi.fn(() => ({ ...published, files: {}, manifest: { publish: { publishedAt: "2026-01-01T00:00:00.000Z" } } }))
      }
    );
    service.listCreativeProjects();
    expect(creative.archiveCreativeProject).toHaveBeenCalledWith("creative/published");
  });

  it("updateCreativeManifest 委托", () => {
    const { service, creative } = createServiceWithCreativeSpy();
    service.updateCreativeManifest("creative/demo", { notes: "x" });
    expect(creative.updateCreativeManifest).toHaveBeenCalled();
  });

  it("listCreativeVersions / readCreativeVersion / restoreCreativeVersion 委托", () => {
    const { service, creative } = createServiceWithCreativeSpy();
    service.listCreativeVersions("creative/demo", "draft.md");
    service.readCreativeVersion("path/v1");
    service.restoreCreativeVersion("creative/demo", "draft.md", "path/v1");
    expect(creative.listCreativeVersions).toHaveBeenCalledWith("creative/demo", "draft.md");
    expect(creative.readCreativeVersion).toHaveBeenCalledWith("path/v1");
    expect(creative.restoreCreativeVersion).toHaveBeenCalledWith("creative/demo", "draft.md", "path/v1");
  });

  it("getCreativeReleaseLog 委托", () => {
    const { service, creative } = createServiceWithCreativeSpy();
    service.getCreativeReleaseLog("creative/demo");
    expect(creative.getCreativeReleaseLog).toHaveBeenCalledWith("creative/demo");
  });

  it("copy/archive 委托", () => {
    const { service, creative } = createServiceWithCreativeSpy();
    service.copyCreativeProject("creative/demo");
    service.archiveCreativeProject("creative/demo");
    expect(creative.copyCreativeProject).toHaveBeenCalledWith("creative/demo");
    expect(creative.archiveCreativeProject).toHaveBeenCalledWith("creative/demo");
  });

  it("getCreativeAnalytics 委托", () => {
    const { service, creative } = createServiceWithCreativeSpy();
    service.getCreativeAnalytics();
    expect(creative.getCreativeAnalytics).toHaveBeenCalled();
  });

  it("writeContent 带日期时刷新当天索引", () => {
    const { service } = createServiceWithCreativeSpy();
    // writeContent 委托 + 提取 date 刷新;不抛错即通过
    expect(() => service.writeContent("openmind/article/20260708/x.md", "content")).not.toThrow();
  });

  it("readContent 委托", () => {
    const { service } = createServiceWithCreativeSpy();
    const result = service.readContent("openmind/article/x.md");
    expect(result).toBeDefined();
  });

  it("listSources 委托", () => {
    const { service } = createServiceWithCreativeSpy();
    expect(Array.isArray(service.listSources())).toBe(true);
  });
});

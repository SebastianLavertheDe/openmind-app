import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductService } from "./product-service";
import type { ContentServiceApi } from "./common";

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
        readContentAsync: async (relativePath) => ({ path: relativePath, name: path.basename(relativePath), content: records[relativePath], truncated: false }),
        getOverview: () => { overviewReads += 1; return { date: "20260615", repoRoot: root, metrics: { articles: 1, posts: 0, reddit: 0, summaries: 0, topics: 0 }, pipeline: [], recent: [] }; },
        writeContent: (relativePath, rawContent) => ({ path: relativePath, name: path.basename(relativePath), content: rawContent, truncated: false })
      } satisfies ContentServiceApi,
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
    expect(fs.readFileSync(path.join(root, "openmind", ".agent", "skill-data", "rss-article-saver", "sources.json"), "utf8")).toContain("https://example.com/feed.xml");
  });

  it("keeps asynchronous file preview available independently of retired workflows", async () => {
    const service = createService();
    const file = "openmind/article/20260615/example.md";
    expect(await service.readContent(file)).toEqual({ path: file, name: "example.md", content: records[file], truncated: false });
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
    const persistentOpml = path.join(root, "openmind", ".agent", "skill-data", "rss-article-saver", "sources.json");
    expect(fs.readFileSync(installedOpml, "utf8")).not.toContain("https://second.example/feed.xml");
    expect(fs.readFileSync(persistentOpml, "utf8")).toContain("https://second.example/feed.xml");

    const disabled = service.updateSource(added.id, { enabled: false, frequency: "每 6 小时" });
    expect(disabled).toMatchObject({ enabled: false, status: "disabled" });
    expect(JSON.parse(fs.readFileSync(persistentOpml, "utf8")).sources.find((row: { id: string }) => row.id === added.id).enabled).toBe(false);

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
});

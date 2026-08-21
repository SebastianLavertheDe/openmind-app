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
    // SourceRegistry reads skill data (subscriptions.opml) from the installed
    // store under the flat content root: <root>/openmind/.agent/skills/...
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
    // the repo. The skill-source root (where .claude/skills lives) is passed
    // via opts so SourceRegistry can still find subscriptions.opml.
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

  it("lists indexed content and persists local reading state", () => {
    const service = createService();
    const page = service.listInbox({ date: "2026-06-15", kinds: [], search: "example", tags: [], sort: "newest", cursor: 0, limit: 50 });
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ title: "Example Article", source: "Example", originalUrl: "https://example.com/post" });

    const updated = service.updateContentState(page.items[0].id, page.items[0].path, { read: true, starred: true, tags: ["AI", "AI"] });
    expect(updated.state).toMatchObject({ read: true, starred: true, tags: ["AI"] });
    expect(JSON.parse(fs.readFileSync(path.join(root, ".openmind", "content-state.json"), "utf8"))[page.items[0].id].read).toBe(true);
  });

  it("keeps content state when a URL-backed file moves to a new path", () => {
    const service = createService();
    const page = service.listInbox({ date: "20260615", kinds: [], search: "", tags: [], sort: "newest", cursor: 0, limit: 50 });
    service.updateContentState(page.items[0].id, page.items[0].path, { read: true, starred: true, tags: ["moved"] });

    const movedPath = "openmind/article/20260615/moved-example.md";
    records[movedPath] = records[entries[0].path as string];
    delete records[entries[0].path as string];
    entries[0] = { ...entries[0], path: movedPath, name: "moved-example.md", modifiedAt: "2026-06-15T11:00:00.000Z" };

    const moved = service.listInbox({ date: "20260615", kinds: [], search: "", tags: [], sort: "newest", cursor: 0, limit: 50 });
    expect(moved.items[0].id).toBe(page.items[0].id);
    expect(moved.items[0].state).toMatchObject({ read: true, starred: true, tags: ["moved"] });
    expect(JSON.parse(fs.readFileSync(path.join(root, ".openmind", "content-state.json"), "utf8"))[page.items[0].path]).toBeUndefined();
  });

  it("builds source, brief and dashboard data from local facts", () => {
    entries.push(
      {
        path: "openmind/post/20260615/x-demo.md",
        name: "x-demo.md",
        kind: "posts",
        size: 256,
        modifiedAt: "2026-06-15T10:30:00.000Z"
      },
      {
        path: "openmind/reddit/20260615/reddit-demo.md",
        name: "reddit-demo.md",
        kind: "reddit",
        size: 256,
        modifiedAt: "2026-06-15T10:45:00.000Z"
      }
    );
    records["openmind/post/20260615/x-demo.md"] = "# Example X\n\n- 来源: X\n\n一条 X 动态。";
    records["openmind/reddit/20260615/reddit-demo.md"] = "# Example Reddit\n\n- 来源: Reddit\n\n一条 Reddit 动态。";

    const service = createService();
    const sources = service.listSources();
    expect(sources.some((source) => source.kind === "rss" && source.name === "Example")).toBe(true);

    const brief = service.getDailyBrief("2026-06-15");
    expect(brief.counts).toMatchObject({ content: 3, unread: 3, articles: 1, posts: 1, reddit: 1, topics: 1 });
    expect(brief.signals).toContain("核心信号");

    const dashboard = service.getDashboard("2026-06-15", 0);
    expect(dashboard.metrics.collected).toBe(3);
    expect(dashboard.metrics.articles).toBe(1);
    expect(dashboard.metrics.posts).toBe(1);
    expect(dashboard.metrics.reddit).toBe(1);
    expect(dashboard.sourceCounts).toEqual({ articles: 1, posts: 1, reddit: 1 });
    expect(dashboard.metrics.drafting).toBe(1);
    expect(dashboard.recommendedTopics[0].title).toBe("AI 工作台");
  });

  it("persists an editable daily brief watchlist across reads", () => {
    const service = createService();
    const page = service.listInbox({ date: "20260615", kinds: [], search: "", tags: [], sort: "newest", cursor: 0, limit: 50 });
    const itemPath = page.items[0].path;

    const afterAdd = service.updateBriefWatchlist("2026-06-15", itemPath, true);
    expect(afterAdd.watchlist.some((item) => item.path === itemPath)).toBe(true);

    const reloaded = createService().getDailyBrief("2026-06-15");
    expect(reloaded.watchlist.some((item) => item.path === itemPath)).toBe(true);

    const afterRemove = service.updateBriefWatchlist("2026-06-15", itemPath, false);
    expect(afterRemove.watchlist.some((item) => item.path === itemPath)).toBe(false);
  });

  it("updates only changed index entries and removes deleted files", () => {
    const service = createService();
    expect(service.listInbox({ date: "20260615", kinds: [], search: "正文摘要", tags: [], sort: "newest", cursor: 0, limit: 50 }).total).toBe(1);
    expect(reads).toBe(1);

    service.listInbox({ date: "20260615", kinds: [], search: "", tags: [], sort: "newest", cursor: 0, limit: 50 });
    expect(reads).toBe(1);

    records[entries[0].path as string] = "# Changed Title\n\n新的全文关键词";
    entries[0].modifiedAt = "2026-06-15T11:00:00.000Z";
    const changed = service.listInbox({ date: "20260615", kinds: [], search: "全文关键词", tags: [], sort: "newest", cursor: 0, limit: 50 });
    expect(reads).toBe(2);
    expect(changed.items[0].title).toBe("Changed Title");

    entries = [];
    expect(service.listInbox({ date: "20260615", kinds: [], search: "", tags: [], sort: "newest", cursor: 0, limit: 50 }).total).toBe(0);
  });

  it("quarantines a corrupt index and rebuilds it", () => {
    fs.mkdirSync(path.join(root, ".openmind"), { recursive: true });
    fs.writeFileSync(path.join(root, ".openmind", "content-index.json"), "{not-json", "utf8");
    const page = createService().listInbox({ date: "20260615", kinds: [], search: "", tags: [], sort: "newest", cursor: 0, limit: 50 });
    expect(page.total).toBe(1);
    expect(fs.readdirSync(path.join(root, ".openmind")).some((name) => name.startsWith("content-index.json.corrupt-"))).toBe(true);
  });

  it("rebuilds the content index on demand", () => {
    const report = createService().rebuildContentIndex();
    expect(report.indexedDates).toContain("20260615");
    expect(report.itemCount).toBeGreaterThan(0);
    expect(report.indexPath).toBe(".openmind/content-index.json");
  });

  it("paginates by cursor instead of a hard 500 cap and rejects invalid queries", () => {
    const service = createService();
    const multi = Array.from({ length: 3 }, (_, index) => ({
      path: `openmind/article/20260615/item-${index}.md`,
      name: `item-${index}.md`,
      kind: "articles",
      size: 256,
      modifiedAt: `2026-06-15T10:0${index}:00.000Z`
    }));
    entries.push(...multi);
    for (const entry of multi) {
      records[entry.path] = `# ${entry.name}\n\n- 来源: Test\n\n正文内容 ${entry.name}。`;
    }
    const first = service.listInbox({ date: "20260615", kinds: [], search: "", tags: [], sort: "newest", cursor: 0, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBe(2);
    const second = service.listInbox({ date: "20260615", kinds: [], search: "", tags: [], sort: "newest", cursor: 2, limit: 2 });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(() => service.listInbox({ date: "20260615", kinds: [], search: "", tags: [], sort: "newest", cursor: 0, limit: 9999 } as never))
      .toThrow();
    expect(() => service.listInbox({ date: "not-a-date", kinds: [], search: "", tags: [], sort: "newest", cursor: 0, limit: 50 } as never))
      .toThrow();
  });

  it("filters by minimum score and sorts by source", () => {
    const service = createService();
    const extra = [
      { path: "openmind/article/20260615/beta.md", name: "beta.md", kind: "articles", size: 128, modifiedAt: "2026-06-15T09:00:00.000Z" },
      { path: "openmind/article/20260615/gamma.md", name: "gamma.md", kind: "articles", size: 128, modifiedAt: "2026-06-15T12:00:00.000Z" }
    ];
    entries.push(...extra);
    records["openmind/article/20260615/beta.md"] = "# Beta\n\n- 来源: Beta\n\n正文。";
    records["openmind/article/20260615/gamma.md"] = "# Gamma\n\n- 来源: Gamma\n\n正文。";
    const seed = service.listInbox({ date: "20260615", kinds: [], search: "", tags: [], sort: "newest", cursor: 0, limit: 50 });
    const find = (title: string) => seed.items.find((item) => item.title === title)!;
    service.updateContentState(find("Example Article").id, find("Example Article").path, { score: 100 });
    service.updateContentState(find("Beta").id, find("Beta").path, { score: 40 });
    service.updateContentState(find("Gamma").id, find("Gamma").path, { score: 80 });
    const high = service.listInbox({ date: "20260615", kinds: [], search: "", tags: [], minScore: 80, sort: "newest", cursor: 0, limit: 50 });
    expect(high.items.map((item) => item.title).sort()).toEqual(["Example Article", "Gamma"]);
    const bySource = service.listInbox({ date: "20260615", kinds: [], search: "", tags: [], sort: "source", cursor: 0, limit: 50 });
    const sources = bySource.items.map((item) => item.source);
    expect(sources).toEqual([...sources].sort((left, right) => left.localeCompare(right, "zh-CN")));
  });

  it("returns inbox facet counts without returning a second full item page", () => {
    const service = createService();
    const page = service.listInbox({ date: "20260615", kinds: [], search: "", tags: [], sort: "newest", cursor: 0, limit: 100 });
    service.updateContentState(page.items[0].id, page.items[0].path, { tags: ["AI", "local"] });

    expect(service.getInboxFacets({ date: "20260615", search: "", tags: [] })).toEqual({
      total: 1,
      kindCounts: { article: 1 },
      tags: [{ tag: "AI", count: 1 }, { tag: "local", count: 1 }]
    });
    expect(service.getInboxFacets({ date: "20260615", search: "missing", tags: [] }).total).toBe(0);
  });

  it("keeps dashboard content caches across skill output and refreshes once at terminal status", () => {
    const service = createService();
    service.getDashboard("20260615", 0);
    expect(topicReads).toBe(1);

    service.recordSkillEvent({ skillId: "reddit-fetcher", invocationId: "run-dashboard", type: "status", state: "running" });
    service.recordSkillEvent({ skillId: "reddit-fetcher", invocationId: "run-dashboard", type: "output", stream: "stdout", text: "line one" });
    service.recordSkillEvent({ skillId: "reddit-fetcher", invocationId: "run-dashboard", type: "output", stream: "stdout", text: "line two" });
    service.getDashboard("20260615", 0);
    expect(topicReads).toBe(1);

    service.recordSkillEvent({ skillId: "reddit-fetcher", invocationId: "run-dashboard", type: "status", state: "success" });
    service.getDashboard("20260615", 0);
    expect(topicReads).toBe(2);
  });

  it("adds, disables and imports RSS sources with persisted structured runs", () => {
    const service = createService();
    const added = service.addRssSource({ name: "Second Feed", url: "https://second.example/feed.xml" });
    expect(added.name).toBe("Second Feed");
    expect(service.listSources().some((source) => source.url === "https://second.example/feed.xml")).toBe(true);

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
    expect(service.listSourceRuns(added.id)[0]).toMatchObject({ id: "run-1", status: "success", code: 0, durationMs: 1200 });
    expect(service.listSourceRuns(added.id)[0].logs[0].text).toContain("Fetched one item");
    expect(JSON.parse(fs.readFileSync(path.join(root, ".openmind", "source-runs.json"), "utf8"))[0].status).toBe("success");
  });

  it("batches frequent skill output writes while exposing live logs from memory", () => {
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

    expect(service.listSourceRuns("reddit-fetcher")[0].logs).toHaveLength(20);
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

  it("searchContent 委托 contentIndex", () => {
    const service = createService();
    const results = service.searchContent("正文", 10);
    expect(Array.isArray(results)).toBe(true);
  });

  it("searchCreativeProjects 按 topic/dir 过滤并截断", () => {
    const service = createService();
    const results = service.searchCreativeProjects("demo", 16);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].kind).toBe("project");
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
      reviewCreativeProject: vi.fn(() => ({ dir: "creative/demo" })),
      setCreativeReviewStatus: vi.fn(() => ({ dir: "creative/demo" })),
      listCreativeVersions: vi.fn(() => []),
      readCreativeVersion: vi.fn(() => ({ content: "old" })),
      restoreCreativeVersion: vi.fn(() => ({ dir: "creative/demo" })),
      getCreativeReleaseLog: vi.fn(() => []),
      copyCreativeProject: vi.fn(() => ({ dir: "creative/demo-copy" })),
      archiveCreativeProject: vi.fn(() => ({ dir: "creative/demo" })),
      restoreCreativeProject: vi.fn(() => ({ dir: "creative/demo" })),
      deleteCreativeProject: vi.fn(() => true),
      getCreativeAnalytics: vi.fn(() => ({ total: 0, averageCompletion: 0, averageCycleHours: null, stages: [], platforms: [], stageDurations: [] })),
      bindCreativeSession: vi.fn(() => ({ dir: "creative/demo" })),
      addManualTopic: vi.fn(() => ({})),
      updateCreativeTopicState: vi.fn(() => ({})),
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

  it("review/setReviewStatus 委托", () => {
    const { service, creative } = createServiceWithCreativeSpy();
    service.reviewCreativeProject("creative/demo");
    service.setCreativeReviewStatus("creative/demo", "approved");
    expect(creative.reviewCreativeProject).toHaveBeenCalledWith("creative/demo");
    expect(creative.setCreativeReviewStatus).toHaveBeenCalledWith("creative/demo", "approved");
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

  it("copy/archive/restore/delete 委托", () => {
    const { service, creative } = createServiceWithCreativeSpy();
    service.copyCreativeProject("creative/demo");
    service.archiveCreativeProject("creative/demo");
    service.restoreCreativeProject("creative/demo");
    service.deleteCreativeProject("creative/demo");
    expect(creative.copyCreativeProject).toHaveBeenCalledWith("creative/demo");
    expect(creative.archiveCreativeProject).toHaveBeenCalledWith("creative/demo");
    expect(creative.restoreCreativeProject).toHaveBeenCalledWith("creative/demo");
    expect(creative.deleteCreativeProject).toHaveBeenCalledWith("creative/demo");
  });

  it("getCreativeAnalytics / bindCreativeSession 委托", () => {
    const { service, creative } = createServiceWithCreativeSpy();
    service.getCreativeAnalytics();
    service.bindCreativeSession("creative/demo", "sess-1");
    expect(creative.getCreativeAnalytics).toHaveBeenCalled();
    expect(creative.bindCreativeSession).toHaveBeenCalledWith("creative/demo", "sess-1");
  });

  it("addCreativeTopic 去横杠 date", () => {
    const { service, creative } = createServiceWithCreativeSpy();
    service.addCreativeTopic({ date: "2026-07-08", title: "T" } as never);
    expect(creative.addManualTopic).toHaveBeenCalledWith("20260708", expect.objectContaining({ title: "T" }));
  });

  it("updateCreativeTopicState 委托", () => {
    const { service, creative } = createServiceWithCreativeSpy();
    service.updateCreativeTopicState("20260708", "topic-1", { score: 90 } as never);
    expect(creative.updateCreativeTopicState).toHaveBeenCalledWith("20260708", "topic-1", { score: 90 });
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

  it("listSources / listSourceRuns 委托", () => {
    const { service } = createServiceWithCreativeSpy();
    expect(Array.isArray(service.listSources())).toBe(true);
    expect(Array.isArray(service.listSourceRuns())).toBe(true);
  });
});

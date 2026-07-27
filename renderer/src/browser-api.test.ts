import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserPreviewApi } from "./browser-api";

const ELECTRON_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) cctools-desktop/1.0.0 Electron/42.4.0 Chrome/132.0.0.0 Safari/537.36";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

beforeEach(() => {
  delete (window as unknown as { cctools?: unknown }).cctools;
});

afterEach(() => {
  delete (window as unknown as { cctools?: unknown }).cctools;
});

describe("installBrowserPreviewApi", () => {
  it("returns true and installs a preview window.cctools in a non-Electron browser", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    const result = installBrowserPreviewApi();
    expect(result).toBe(true);
    expect(window.cctools).toBeTruthy();
  });

  it("returns true without re-installing when window.cctools already exists", () => {
    const existing = { existing: true };
    (window as unknown as { cctools: unknown }).cctools = existing;
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    expect(installBrowserPreviewApi()).toBe(true);
    expect(window.cctools).toBe(existing);
  });

  it("returns false and does not install in an Electron renderer", () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: ELECTRON_UA }, configurable: true });
    expect(installBrowserPreviewApi()).toBe(false);
    expect(window.cctools).toBeUndefined();
  });

  it("getBootstrap returns preview skills and AI snapshot", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const boot = await window.cctools.getBootstrap();
    expect(boot.validRepo).toBe(true);
    expect(boot.environment.mode).toBe("preview");
    expect(boot.skills.length).toBeGreaterThan(0);
    expect(boot.ai.providers.length).toBe(2);
    expect(boot.ai.sessions.length).toBe(1);
  });

  it("content API returns preview articles and supports state updates", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const list = await window.cctools.listContent("article", "20260707");
    expect(list.length).toBeGreaterThan(0);
    const read = await window.cctools.readContent("mymind/article/demo.md");
    expect(read.content).toContain("# ");
    const written = await window.cctools.writeContent("p", "content");
    expect(written.content).toBe("content");
    const updated = await window.cctools.updateContentState("id", "p", { read: true });
    expect(updated.state.read).toBe(true);
  });

  it("inbox + facets + sources return preview data", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const inbox = await window.cctools.listInbox({ date: "2026-07-07", kinds: [], search: "", tags: [], sort: "newest", cursor: 0, limit: 100 });
    expect(inbox.items.length).toBe(1);
    expect(inbox.items[0].state.starred).toBe(true);
    const facets = await window.cctools.getInboxFacets({ date: "2026-07-07", search: "", tags: [] });
    expect(facets.total).toBe(1);
    const sources = await window.cctools.listSources();
    expect(sources.length).toBeGreaterThan(0);
    const added = await window.cctools.addRssSource({ url: "https://x.com/feed", name: "X", kind: "rss" });
    expect(added.id).toContain("rss");
    expect(await window.cctools.importOpml()).toBe(2);
  });

  it("daily brief + dashboard return structured preview data", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const brief = await window.cctools.getDailyBrief("2026-07-07");
    expect(brief.date).toBe("20260707");
    expect(brief.counts.content).toBe(42);
    expect(brief.topics.length).toBe(1);
    const dash = await window.cctools.getDashboard("2026-07-07");
    expect(dash.date).toBe("20260707");
    expect(dash.metrics.collected).toBe(42);
    expect(dash.trend).toHaveLength(7);
  });

  it("searchWorkspace filters preview results by query", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const all = await window.cctools.searchWorkspace("");
    expect(all.length).toBeGreaterThan(0);
    const filtered = await window.cctools.searchWorkspace("工程");
    expect(filtered.every((r) => `${r.title} ${r.subtitle}`.includes("工程"))).toBe(true);
    const none = await window.cctools.searchWorkspace("zzzznomatch");
    expect(none).toEqual([]);
  });

  it("creative API returns preview topics, projects, and supports CRUD", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const topics = await window.cctools.getCreativeTopics("2026-07-07");
    expect(topics.topics.length).toBe(1);
    const allTopics = await window.cctools.getAllCreativeTopics();
    expect(allTopics.length).toBe(1);
    const projects = await window.cctools.getCreativeProjects();
    expect(projects.length).toBe(1);
    const project = await window.cctools.getCreativeProject("dir");
    expect(project.manifest?.topic).toBeTruthy();
    const created = await window.cctools.createCreativeProject({ date: "20260707", topic: { title: "T", body: "B" } });
    expect(created.manifest?.topic).toBe("T");
    const advanced = await window.cctools.advanceCreativeProject("dir", "review");
    expect(advanced.stage).toBe("review");
    const reviewed = await window.cctools.reviewCreativeProject("dir");
    expect(reviewed.reviewReport?.score).toBe(86);
    const versions = await window.cctools.listCreativeVersions("dir", "draft.md");
    expect(versions.length).toBe(1);
    const restored = await window.cctools.restoreCreativeVersion("dir", "draft.md", "versions/draft/v1.md");
    expect(restored.stage).toBeTruthy();
    const releaseLog = await window.cctools.getCreativeReleaseLog("dir");
    expect(releaseLog.length).toBe(1);
    const analytics = await window.cctools.getCreativeAnalytics();
    expect(analytics.total).toBe(1);
  });

  it("preferences API reads, updates, and resets", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const initial = await window.cctools.getPreferences();
    expect(initial.themeMode).toBe("light");
    const updated = await window.cctools.updatePreferences({ themeMode: "dark" });
    expect(updated.themeMode).toBe("dark");
    const reset = await window.cctools.resetPreferences();
    expect(reset.themeMode).toBe("light");
  });

  it("searchMymindFiles filters and respects the limit", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const result = await window.cctools.searchMymindFiles("wiki", 10);
    expect(result.items.every((f) => f.path.includes("wiki"))).toBe(true);
    const limited = await window.cctools.searchMymindFiles("", 1);
    expect(limited.items.length).toBeLessThanOrEqual(1);
  });

  it("AI API is read-only in preview mode (start/update throw)", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    expect(await window.cctools.aiRefresh()).toBeTruthy();
    expect(await window.cctools.aiPrewarm()).toBe(true);
    const events = await window.cctools.aiGetEvents("preview-session");
    expect(events).toHaveLength(3);
    expect(events.some((event) => event.kind === "changes")).toBe(true);
    await expect(window.cctools.aiStartRun({} as never)).rejects.toThrow(/预览/);
    await expect(window.cctools.aiUpdateSession("preview-session", {})).rejects.toThrow(/预览/);
    expect(await window.cctools.aiCancelRun("x")).toBe(true);
    expect(await window.cctools.aiResolveApproval("approval", "decline")).toBe(true);
  });

  it("onAiEvent registers a listener that can be unsubscribed", () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const cb = vi.fn();
    const unsubscribe = window.cctools.onAiEvent(cb);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });
});

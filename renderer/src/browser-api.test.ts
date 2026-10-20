import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserPreviewApi } from "./browser-api";

const ELECTRON_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) openmind-desktop/1.0.0 Electron/42.4.0 Chrome/132.0.0.0 Safari/537.36";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

beforeEach(() => {
  delete (window as unknown as { openmind?: unknown }).openmind;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { openmind?: unknown }).openmind;
  window.history.replaceState({}, "", "/");
});

describe("installBrowserPreviewApi", () => {
  it("keeps WeChat unconfigured and rejects desktop-only operations without storing a secret", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    expect(await window.openmind.getWechatAccount()).toEqual({ appId: "", author: "", configured: false });
    await expect(window.openmind.saveWechatAccount({ appId: "wx1234567890abcdef", appSecret: "0123456789abcdef0123456789abcdef", author: "" })).rejects.toThrow(/桌面版/);
    expect(await window.openmind.getWechatAccount()).toEqual({ appId: "", author: "", configured: false });
    await expect(window.openmind.chooseWechatCover()).rejects.toThrow(/桌面版/);
    await expect(window.openmind.pushWechatDraft({} as never)).rejects.toThrow(/桌面版/);
    await expect(window.openmind.copyWechatArticle({ html: "<p>正文</p>", text: "正文" })).rejects.toThrow(/不支持复制富文本/);
  });

  it("writes actual rich text in supported browsers and propagates clipboard failures", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA, clipboard: { write } }, configurable: true });
    class PreviewClipboardItem { constructor(readonly data: Record<string, Blob>) {} }
    vi.stubGlobal("ClipboardItem", PreviewClipboardItem);
    installBrowserPreviewApi();
    await window.openmind.copyWechatArticle({ html: "<p>正文</p>", text: "正文" });
    const item = write.mock.calls[0][0][0] as PreviewClipboardItem;
    expect(Object.keys(item.data)).toEqual(["text/html", "text/plain"]);
    expect(item.data["text/html"].type).toBe("text/html");
    expect(item.data["text/plain"].type).toBe("text/plain");
    write.mockRejectedValueOnce(new Error("Clipboard permission denied"));
    await expect(window.openmind.copyWechatArticle({ html: "<p>正文</p>", text: "正文" })).rejects.toThrow("Clipboard permission denied");
  });

  it("returns true and installs a preview window.openmind in a non-Electron browser", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    const result = installBrowserPreviewApi();
    expect(result).toBe(true);
    expect(window.openmind).toBeTruthy();
  });

  it("returns true without re-installing when window.openmind already exists", () => {
    const existing = { existing: true };
    (window as unknown as { openmind: unknown }).openmind = existing;
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    expect(installBrowserPreviewApi()).toBe(true);
    expect(window.openmind).toBe(existing);
  });

  it("returns false and does not install in an Electron renderer", () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: ELECTRON_UA }, configurable: true });
    expect(installBrowserPreviewApi()).toBe(false);
    expect(window.openmind).toBeUndefined();
  });

  it("getBootstrap returns preview skills and AI snapshot", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const boot = await window.openmind.getBootstrap();
    expect(boot.validRepo).toBe(true);
    expect(boot.environment.mode).toBe("preview");
    expect(boot.skills.length).toBeGreaterThan(0);
    expect(boot.ai.providers.length).toBe(2);
    expect(boot.ai.sessions.length).toBe(1);
  });

  it("supports the interactive onboarding preview fixture", async () => {
    window.history.replaceState({}, "", "/?preview=onboarding");
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();

    expect(await window.openmind.getBootstrap()).toMatchObject({ validRepo: false, skillsInstalled: false, onboardingCompleted: false });
    expect((await window.openmind.getOpenmindRoot()).health.configured).toBe(false);
    await window.openmind.setOpenmindRoot("/fixtures/openmind-data");
    expect(await window.openmind.getBootstrap()).toMatchObject({ validRepo: true, skillsInstalled: false });
    expect(await window.openmind.getDefaultSkillsEnabled()).toBe(false);
    expect(await window.openmind.listAutomationRules()).toEqual([]);
    await window.openmind.setDefaultSkillsEnabled(true);
    expect(await window.openmind.getBootstrap()).toMatchObject({ validRepo: true, skillsInstalled: true });
    expect((await window.openmind.listAutomationRules()).every((rule) => rule.enabled)).toBe(true);
    await window.openmind.setDefaultSkillsEnabled(false);
    expect(await window.openmind.listInstalledSkills()).toEqual([]);
    expect((await window.openmind.listAutomationRules()).some((rule) => rule.enabled)).toBe(false);
  });

  it("content API returns preview articles", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const list = await window.openmind.listContent("article", "20260707");
    expect(list.length).toBeGreaterThan(0);
    const read = await window.openmind.readContent("openmind/article/demo.md");
    expect(read.content).toContain("# ");
    const written = await window.openmind.writeContent("p", "content");
    expect(written.content).toBe("content");
  });

  it("sources return preview data", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const sources = await window.openmind.listSources();
    expect(sources.length).toBeGreaterThan(0);
    const added = await window.openmind.addRssSource({ url: "https://x.com/feed", name: "X", kind: "rss" });
    expect(added.id).toContain("rss");
    expect(await window.openmind.importOpml()).toBe(2);
  });

  it("searchWorkspace filters preview results by query", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const all = await window.openmind.searchWorkspace("");
    expect(all.length).toBeGreaterThan(0);
    const filtered = await window.openmind.searchWorkspace("工程");
    expect(filtered.every((r) => `${r.title} ${r.subtitle}`.includes("工程"))).toBe(true);
    const none = await window.openmind.searchWorkspace("zzzznomatch");
    expect(none).toEqual([]);
  });

  it("creative API returns preview projects and supports CRUD", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const allTopics = await window.openmind.getAllCreativeTopics();
    expect(allTopics.length).toBe(1);
    const projects = await window.openmind.getCreativeProjects();
    expect(projects.length).toBe(1);
    const project = await window.openmind.getCreativeProject("dir");
    expect(project.manifest?.topic).toBeTruthy();
    const created = await window.openmind.createCreativeProject({ date: "20260707", topic: { title: "T", body: "B" } });
    expect(created.manifest?.topic).toBe("T");
    const advanced = await window.openmind.advanceCreativeProject("dir", "review");
    expect(advanced.stage).toBe("review");
    const versions = await window.openmind.listCreativeVersions("dir", "draft.md");
    expect(versions.length).toBe(1);
    const restored = await window.openmind.restoreCreativeVersion("dir", "draft.md", "versions/draft/v1.md");
    expect(restored.stage).toBeTruthy();
    const releaseLog = await window.openmind.getCreativeReleaseLog("dir");
    expect(releaseLog.length).toBe(1);
    const analytics = await window.openmind.getCreativeAnalytics();
    expect(analytics.total).toBe(1);
  });

  it("preferences API reads, updates, and resets", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const initial = await window.openmind.getPreferences();
    expect(initial.themeMode).toBe("light");
    const updated = await window.openmind.updatePreferences({ themeMode: "dark" });
    expect(updated.themeMode).toBe("dark");
    const reset = await window.openmind.resetPreferences();
    expect(reset.themeMode).toBe("light");
  });

  it("searchOpenmindFiles filters and respects the limit", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const result = await window.openmind.searchOpenmindFiles("wiki", 10);
    expect(result.items.every((f) => f.path.includes("wiki"))).toBe(true);
    const limited = await window.openmind.searchOpenmindFiles("", 1);
    expect(limited.items.length).toBeLessThanOrEqual(1);
  });

  it("AI API is read-only in preview mode (start/update throw)", async () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    expect(await window.openmind.aiRefresh()).toBeTruthy();
    expect(await window.openmind.aiPrewarm()).toBe(true);
    const events = await window.openmind.aiGetEvents("preview-session");
    expect(events).toHaveLength(3);
    expect(events.some((event) => event.kind === "changes")).toBe(true);
    await expect(window.openmind.aiStartRun({} as never)).rejects.toThrow(/预览/);
    await expect(window.openmind.aiUpdateSession("preview-session", {})).rejects.toThrow(/预览/);
    expect(await window.openmind.aiCancelRun("x")).toBe(true);
    expect(await window.openmind.aiResolveApproval("approval", "decline")).toBe(true);
  });

  it("onAiEvent registers a listener that can be unsubscribed", () => {
    Object.defineProperty(window, "navigator", { value: { userAgent: BROWSER_UA }, configurable: true });
    installBrowserPreviewApi();
    const cb = vi.fn();
    const unsubscribe = window.openmind.onAiEvent(cb);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });
});

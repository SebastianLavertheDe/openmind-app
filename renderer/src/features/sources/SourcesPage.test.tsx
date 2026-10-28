import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { RssSourceSchema, type RssDetection, type RssDocument, type RssDocumentView, type RssSourceView } from "@shared/rss-contracts";
import { messages as m } from "@shared/messages";
import { SourcesPage } from "./SourcesPage";
import { DailyPreferences } from "./DailyPreferences";

const feedback = vi.hoisted(() => ({ confirm: vi.fn(async (_options: unknown) => true), notify: vi.fn() }));
vi.mock("../../feedback-context", () => ({ useFeedback: () => feedback }));
vi.mock("../automation", () => ({ AutomationPage: () => <div>Task editor</div> }));
let document: RssDocument;
function fixture(feedStatus: RssSourceView["localFeed"]["status"] = "missing") {
  document = { schemaVersion: 1, initialized: true, revision: 1, deletedPresetIds: [], migrationWarnings: [], sources: [RssSourceSchema.parse({ id: "design", name: "Design", inputUrl: "https://design.test/", resolvedFeedUrl: "https://design.test/rss.xml", kind: "website", enabled: true, revision: 1 }), RssSourceSchema.parse({ id: "science", name: "Science", inputUrl: "https://science.test/feed", kind: "feed", enabled: false, revision: 1 })] };
  const api = {
    getRssSources: vi.fn(async (): Promise<RssDocumentView> => ({ ...structuredClone(document), rootKey: "fixture-root", sources: document.sources.map(row => ({ ...structuredClone(row), localFeed: { path: `/fixtures/content/.agent/skill-data/rss-article-saver/feeds/${row.id}.xml`, status: feedStatus } })) })),
    getRssSourceEntries: vi.fn(async (_input: unknown) => ({ entries: [{ title: "Local index entry", url: "https://design.test/article", publishedAt: null }], total: 31, version: "v1", status: "ready" as const, nextCursor: "page2" as string | null, reset: false })),
    getRssSourceRuns: vi.fn(async (_input: unknown) => ({ runs: [], nextCursor: null })),
    getRssSourceRunEvents: vi.fn(async (_input: unknown) => ({ events: [], nextAfter: null })),
    detectRssSource: vi.fn(async ({ inputUrl }: { inputUrl: string; selectedFeedUrl?: string }): Promise<RssDetection> => ({ inputUrl, kind: "feed", adapterId: "feed", resolvedFeedUrl: inputUrl, candidates: [] })),
    createRssSource: vi.fn(async () => document),
    editRssSource: vi.fn(async (input: { id: string; enabled?: boolean }) => { document.sources = document.sources.map(row => row.id === input.id ? { ...row, ...input, revision: row.revision + 1 } : row); return document; }),
    removeRssSource: vi.fn(async ({ id }: { id: string }) => { document.sources = document.sources.filter(row => row.id !== id); return document; }),
    importRssOpml: vi.fn(async () => document), runRss: vi.fn(async () => ({})),
    getDefaultSkillsEnabled: vi.fn(async () => true), setDefaultSkillsEnabled: vi.fn(async () => true),
    getDailyBriefPreferences: vi.fn(async () => ({ schemaVersion: 1, revision: 2, text: "", updatedAt: null })),
    saveDailyBriefPreferences: vi.fn(async ({ text }: { text: string }) => ({ schemaVersion: 1, revision: 3, text, updatedAt: "2026-10-27T00:00:00Z" })),
    generateDailyBrief: vi.fn(async () => ({})), openExternal: vi.fn()
  };
  window.openmind = api as unknown as DesktopApi;
  return api;
}
beforeEach(() => { feedback.confirm.mockResolvedValue(true); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("RSS sources and daily preferences", () => {
  it.each(["ready", "missing", "outdated"] as const)("shows the actual converted RSS location read-only in the source editor (%s)", async status => {
    const api = fixture(status); render(<SourcesPage />); await screen.findByText("Design");
    fireEvent.click(screen.getByRole("button", { name: `${m.rss.edit}: Design` }));
    const feed = screen.getByLabelText(m.rss.convertedFeed) as HTMLTextAreaElement;
    expect(feed.readOnly).toBe(true);
    expect(feed.value).toBe("/fixtures/content/.agent/skill-data/rss-article-saver/feeds/design.xml");
    expect((screen.getByLabelText(m.rss.url) as HTMLInputElement).value).toBe("https://design.test/");
    expect(screen.getByText(status === "ready" ? m.rss.feedReady : status === "outdated" ? m.rss.feedOutdated : m.rss.feedMissing)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(m.rss.url), { target: { value: "https://changed.test/" } });
    expect(screen.getByText(m.rss.feedOutdated)).toBeTruthy();
    expect(api.detectRssSource).not.toHaveBeenCalled();
    expect(api.editRssSource).not.toHaveBeenCalled();
  });

  it("shows original website URLs and disabled feeds, filters and toggles their saved state", async () => {
    const api = fixture(); render(<SourcesPage />);
    expect(await screen.findByRole("link", { name: "https://design.test/" })).toBeTruthy();
    expect(screen.queryByText("https://design.test/rss.xml")).toBeNull();
    expect(screen.getByRole("link", { name: "https://science.test/feed" })).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: `Design — ${m.rss.enabled}` }));
    await waitFor(() => expect(api.editRssSource).toHaveBeenCalledWith({ id: "design", revision: 1, enabled: false }));
    fireEvent.change(screen.getByLabelText(m.rss.search), { target: { value: "science" } });
    expect(screen.queryByText("Design")).toBeNull();
    expect(screen.getByText("Science")).toBeTruthy();
  });
  it("keeps input on detection failure and saves only after successful detection", async () => {
    const api = fixture(); api.detectRssSource.mockRejectedValueOnce(new Error("[invalid-feed] Bad XML")); render(<SourcesPage />);
    fireEvent.click(screen.getByRole("button", { name: m.rss.add }));
    fireEvent.change(screen.getByLabelText(m.rss.name), { target: { value: "New source" } });
    fireEvent.change(screen.getByLabelText(m.rss.url), { target: { value: "https://new.test/feed" } });
    fireEvent.click(screen.getByRole("button", { name: m.rss.detect }));
    expect(await screen.findByText("[invalid-feed] Bad XML")).toBeTruthy();
    expect((screen.getByLabelText(m.rss.url) as HTMLInputElement).value).toBe("https://new.test/feed");
    expect((screen.getByRole("button", { name: m.rss.save }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: m.rss.detect }));
    await screen.findByText(m.rss.detected);
    fireEvent.click(screen.getByRole("button", { name: m.rss.save }));
    await waitFor(() => expect(api.createRssSource).toHaveBeenCalledWith({ name: "New source", inputUrl: "https://new.test/feed", group: "", enabled: true }));
  });
  it("shows article parsing on Detect instead of a saving spinner and clears a stale success after failure", async () => {
    const api = fixture(); render(<SourcesPage />);
    fireEvent.click(screen.getByRole("button", { name: m.rss.add }));
    fireEvent.change(screen.getByLabelText(m.rss.name), { target: { value: "Research" } });
    fireEvent.change(screen.getByLabelText(m.rss.url), { target: { value: "https://new.test/" } });
    fireEvent.click(screen.getByRole("button", { name: m.rss.detect }));
    await screen.findByText(m.rss.detected);
    let fail!: (reason: Error) => void;
    api.detectRssSource.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    fireEvent.click(screen.getByRole("button", { name: m.rss.detect }));
    expect(screen.getByRole("button", { name: m.rss.detecting }).getAttribute("aria-busy")).toBe("true");
    const save = screen.getByRole("button", { name: m.rss.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.getAttribute("aria-busy")).toBeNull();
    expect((screen.getByLabelText(m.rss.url) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText(m.rss.detected)).toBeNull();
    fail(new Error("[empty-page] No articles were found"));
    await screen.findByText("[empty-page] No articles were found");
    expect(save.disabled).toBe(true);
    expect(screen.queryByText(m.rss.detected)).toBeNull();
    expect(api.createRssSource).not.toHaveBeenCalled();
  });
  it("requires the selected channel to parse articles before enabling Save", async () => {
    const api = fixture();
    const candidates = [{ title: "Design feed", url: "https://new.test/design.xml" }, { title: "Science feed", url: "https://new.test/science.xml" }];
    api.detectRssSource.mockResolvedValueOnce({ inputUrl: "https://new.test/", kind: "website", adapterId: "feed", resolvedFeedUrl: null, candidates });
    render(<SourcesPage />);
    fireEvent.click(screen.getByRole("button", { name: m.rss.add }));
    fireEvent.change(screen.getByLabelText(m.rss.name), { target: { value: "Research" } });
    fireEvent.change(screen.getByLabelText(m.rss.url), { target: { value: "https://new.test/" } });
    fireEvent.click(screen.getByRole("button", { name: m.rss.detect }));
    await screen.findByText(m.rss.candidateHint);
    expect(screen.queryByText(m.rss.detected)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: m.rss.candidate }));
    fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Design feed" }));
    expect((screen.getByRole("button", { name: m.rss.save }) as HTMLButtonElement).disabled).toBe(true);
    api.detectRssSource.mockResolvedValueOnce({ inputUrl: "https://new.test/", kind: "website", adapterId: "feed", resolvedFeedUrl: candidates[0].url, candidates });
    fireEvent.click(screen.getByRole("button", { name: m.rss.detect }));
    await screen.findByText(m.rss.detected);
    expect(api.detectRssSource).toHaveBeenLastCalledWith({ inputUrl: "https://new.test/", selectedFeedUrl: candidates[0].url });
    fireEvent.click(screen.getByRole("button", { name: m.rss.save }));
    await waitFor(() => expect(api.createRssSource).toHaveBeenCalledWith({ name: "Research", inputUrl: "https://new.test/", group: "", selectedFeedUrl: candidates[0].url, enabled: true }));
  });
  it("keeps saved articles when deleting a source and respects cancellation", async () => {
    const api = fixture(); render(<SourcesPage />); await screen.findByText("Design");
    feedback.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: `${m.rss.more}: Design` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: m.rss.remove }));
    await waitFor(() => expect(feedback.confirm).toHaveBeenCalled());
    expect(api.removeRssSource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `${m.rss.more}: Design` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: m.rss.remove }));
    await waitFor(() => expect(api.removeRssSource).toHaveBeenCalledWith({ id: "design", revision: 1 }));
    expect(feedback.confirm.mock.calls[0][0]).toMatchObject({ body: m.rss.removeBody });
  });
  it("opens existing schedules without enabling unrelated disabled skills", async () => {
    const api = fixture(); render(<SourcesPage />);
    fireEvent.click(screen.getByRole("button", { name: m.rss.tasks }));
    expect(await screen.findByText("Task editor")).toBeTruthy();
    expect(api.setDefaultSkillsEnabled).not.toHaveBeenCalled();
  });
  it.each(["page", "settings", "embedded"] as const)("supports %s with real category counts and all-enabled global execution", async presentation => {
    const api = fixture(); document.sources[0].group = "blog"; document.sources[1].group = "WeChat";
    render(<SourcesPage presentation={presentation} />); await screen.findByText("Design");
    expect(screen.queryByRole("heading", { name: m.rss.title }) !== null).toBe(presentation !== "settings");
    fireEvent.click(screen.getByRole("tab", { name: `${m.rss.blog} 1` }));
    expect(screen.queryByText("Science")).toBeNull(); expect(screen.getByText(m.rss.results(1, 2))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: m.rss.pipeline }));
    await waitFor(() => expect(api.runRss).toHaveBeenCalledWith({ mode: "pipeline" }));
    fireEvent.click(screen.getByRole("button", { name: `${m.rss.pipeline}: Design` }));
    await waitFor(() => expect(api.runRss).toHaveBeenCalledWith({ mode: "pipeline", sourceId: "design" }));
    expect(screen.getByText(m.rss.globalScope)).toBeTruthy();
  });
  it("opens details without fetching and keeps links and actions separate from the subject button", async () => {
    const api = fixture("ready"); document.sources[0].lastError = { stage: "collect", code: "access-denied", message: "403 evidence", retryable: false };
    render(<SourcesPage />); await screen.findByText("Design");
    const article = screen.getByRole("article", { name: "Design" });
    expect(within(article).getByText(m.rss.rssReady)).toBeTruthy(); expect(within(article).getByText(new RegExp(m.rss.collectFailed))).toBeTruthy();
    fireEvent.click(within(article).getByRole("link")); expect(api.openExternal).toHaveBeenCalledWith("https://design.test/"); expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `${m.rss.details}: Design` }));
    const dialog = await screen.findByRole("dialog"); expect(within(dialog).getByText(m.rss.localFile)).toBeTruthy();
    expect(api.detectRssSource).not.toHaveBeenCalled(); expect(api.runRss).not.toHaveBeenCalled(); expect(api.getRssSourceEntries).not.toHaveBeenCalled(); expect(api.getRssSourceRuns).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: m.rss.detect })); await within(dialog).findByText(m.rss.detected);
    expect(api.editRssSource).not.toHaveBeenCalled(); expect(api.runRss).not.toHaveBeenCalled();
  });
  it("paginates only the active tab, retries locally and discards entries after closing", async () => {
    const api = fixture("ready"); api.getRssSourceEntries.mockRejectedValueOnce(new Error("XML unavailable"));
    render(<SourcesPage />); await screen.findByText("Design"); fireEvent.click(screen.getByRole("button", { name: `${m.rss.details}: Design` }));
    fireEvent.click(screen.getByRole("tab", { name: m.rss.entries })); await screen.findByText("XML unavailable");
    fireEvent.click(screen.getByRole("button", { name: m.common.retry })); await screen.findByText("Local index entry");
    fireEvent.click(screen.getByRole("button", { name: m.rss.next }));
    await waitFor(() => expect(api.getRssSourceEntries).toHaveBeenLastCalledWith({ sourceId: "design", rootKey: "fixture-root", cursor: "page2", limit: 30 }));
    await screen.findByText(m.rss.page(2, 31));
    api.getRssSourceEntries.mockResolvedValueOnce({ entries: [{ title: "Refreshed entry", url: "https://design.test/new", publishedAt: null }], total: 1, version: "v2", status: "ready", nextCursor: null, reset: true });
    document.sources[0].revision++; fireEvent.click(screen.getByLabelText(m.rss.refresh));
    await screen.findByText("Refreshed entry"); expect(screen.getByText(m.rss.page(1, 1))).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: m.rss.runs })); await screen.findByText(m.rss.noRuns);
    let resolve!: (value: Awaited<ReturnType<typeof api.getRssSourceEntries>>) => void;
    api.getRssSourceEntries.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.click(screen.getByRole("tab", { name: m.rss.entries }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: m.common.close }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () => resolve({ entries: [{ title: "Stale entry", url: "https://design.test/stale", publishedAt: null }], total: 1, version: "old", status: "ready", nextCursor: null, reset: false }));
    fireEvent.click(screen.getByRole("button", { name: `${m.rss.details}: Science` }));
    expect(screen.queryByText("Stale entry")).toBeNull();
  });
  it("keeps one dialog through edit, preserves the draft on polling and retains optimistic conflicts", async () => {
    const api = fixture("ready"); document.sources[0].group = "blog"; document.sources[1].group = "WeChat";
    render(<SourcesPage />); await screen.findByText("Design"); fireEvent.click(screen.getByRole("button", { name: `${m.rss.details}: Design` }));
    const shell = screen.getByRole("dialog"); fireEvent.click(within(shell).getByRole("button", { name: m.rss.edit }));
    fireEvent.change(screen.getByLabelText(m.rss.name), { target: { value: "Draft" } });
    document.sources[0].revision = 2; fireEvent.click(screen.getByLabelText(m.rss.refresh));
    await waitFor(() => expect(api.getRssSources).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText(m.rss.name) as HTMLInputElement).value).toBe("Draft");
    api.editRssSource.mockRejectedValueOnce(new Error("Revision conflict"));
    fireEvent.click(screen.getByRole("button", { name: m.rss.save })); await screen.findByText("Revision conflict");
    expect(api.editRssSource).toHaveBeenLastCalledWith({ id: "design", revision: 1, name: "Draft", group: "blog" });
    feedback.confirm.mockResolvedValueOnce(false); fireEvent.click(screen.getByRole("button", { name: m.rss.cancel }));
    await waitFor(() => expect(feedback.confirm).toHaveBeenCalled()); expect(screen.getByRole("dialog")).toBe(shell);
    fireEvent.click(screen.getByRole("button", { name: m.rss.cancel })); await screen.findByRole("tab", { name: m.rss.overview }); expect(screen.getByRole("dialog")).toBe(shell);
    fireEvent.click(within(shell).getByRole("button", { name: m.rss.edit }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(m.rss.category) })); fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: m.rss.wechat }));
    fireEvent.click(screen.getByRole("button", { name: m.rss.save }));
    await screen.findByRole("tab", { name: m.rss.overview }); expect(api.detectRssSource).not.toHaveBeenCalled(); expect(screen.getByRole("dialog")).toBe(shell);
    expect(api.editRssSource).toHaveBeenLastCalledWith({ id: "design", revision: 2, name: "Design", group: "WeChat" });
  });
  it("shows external deletion and drops an open detail when the content root changes", async () => {
    const api = fixture(); render(<SourcesPage />); await screen.findByText("Design");
    fireEvent.click(screen.getByRole("button", { name: `${m.rss.details}: Design` })); document.sources = document.sources.filter(row => row.id !== "design");
    fireEvent.click(screen.getByLabelText(m.rss.refresh)); await screen.findByText(m.rss.deleted);
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: m.rss.pipeline })).toBeNull();
    const other = await api.getRssSources(); api.getRssSources.mockResolvedValue({ ...other, rootKey: "other-root" });
    fireEvent.click(screen.getByLabelText(m.rss.refresh)); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("saves preference revisions separately from generation and works in StrictMode", async () => {
    const api = fixture(); render(<StrictMode><DailyPreferences /></StrictMode>);
    fireEvent.click(screen.getByRole("button", { name: m.rss.preferences }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: m.rss.preferences }) as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(screen.getByRole("textbox", { name: m.rss.preferences }), { target: { value: "Design, exclude funding, English, one recommendation" } });
    expect((screen.getByRole("button", { name: m.rss.generate }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: m.rss.save }));
    await screen.findByText(m.rss.saved);
    expect(api.saveDailyBriefPreferences).toHaveBeenCalledWith({ revision: 2, text: "Design, exclude funding, English, one recommendation" });
    expect(api.generateDailyBrief).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(m.rss.date), { target: { value: "2026-10-27" } });
    fireEvent.click(screen.getByRole("button", { name: m.rss.topics }));
    await waitFor(() => expect(api.generateDailyBrief).toHaveBeenCalledWith({ date: "20261027", topics: true }));
  });
});

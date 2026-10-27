import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { RssSourceSchema, type RssDocument } from "@shared/rss-contracts";
import { messages as m } from "@shared/messages";
import { SourcesPage } from "./SourcesPage";
import { DailyPreferences } from "./DailyPreferences";

const feedback = vi.hoisted(() => ({ confirm: vi.fn(async (_options: unknown) => true), notify: vi.fn() }));
vi.mock("../../feedback-context", () => ({ useFeedback: () => feedback }));
vi.mock("../automation", () => ({ AutomationPage: () => <div>Task editor</div> }));
let document: RssDocument;
function fixture() {
  document = { schemaVersion: 1, initialized: true, revision: 1, deletedPresetIds: [], migrationWarnings: [], sources: [RssSourceSchema.parse({ id: "design", name: "Design", inputUrl: "https://design.test/", resolvedFeedUrl: "https://design.test/rss.xml", kind: "website", enabled: true, revision: 1 }), RssSourceSchema.parse({ id: "science", name: "Science", inputUrl: "https://science.test/feed", kind: "feed", enabled: false, revision: 1 })] };
  const api = {
    getRssSources: vi.fn(async () => structuredClone(document)),
    detectRssSource: vi.fn(async ({ inputUrl }: { inputUrl: string }) => ({ inputUrl, kind: "feed", adapterId: "feed", resolvedFeedUrl: inputUrl, candidates: [] })),
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
  it("shows original website URLs and disabled feeds, filters and toggles their saved state", async () => {
    const api = fixture(); render(<SourcesPage />);
    expect(await screen.findByText("https://design.test/")).toBeTruthy();
    expect(screen.queryByText("https://design.test/rss.xml")).toBeNull();
    expect(screen.getByText("https://science.test/feed")).toBeTruthy();
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
    await waitFor(() => expect(api.createRssSource).toHaveBeenCalledWith({ name: "New source", inputUrl: "https://new.test/feed", enabled: true }));
  });
  it("keeps saved articles when deleting a source and respects cancellation", async () => {
    const api = fixture(); render(<SourcesPage />); await screen.findByText("Design");
    feedback.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: `${m.rss.remove}: Design` }));
    await waitFor(() => expect(feedback.confirm).toHaveBeenCalled());
    expect(api.removeRssSource).not.toHaveBeenCalled();
    await waitFor(() => expect((screen.getByRole("button", { name: `${m.rss.remove}: Design` }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: `${m.rss.remove}: Design` }));
    await waitFor(() => expect(api.removeRssSource).toHaveBeenCalledWith({ id: "design", revision: 1 }));
    expect(feedback.confirm.mock.calls[0][0]).toMatchObject({ body: m.rss.removeBody });
  });
  it("opens existing schedules without enabling unrelated disabled skills", async () => {
    const api = fixture(); render(<SourcesPage />);
    fireEvent.click(screen.getByRole("button", { name: m.rss.tasks }));
    expect(await screen.findByText("Task editor")).toBeTruthy();
    expect(api.setDefaultSkillsEnabled).not.toHaveBeenCalled();
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

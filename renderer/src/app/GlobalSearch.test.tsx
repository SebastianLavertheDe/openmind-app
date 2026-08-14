import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, DesktopApi, GlobalSearchResult } from "@shared/contracts";
import { AiProvider } from "../ai-context";
import { GlobalSearch } from "./GlobalSearch";
import type { Navigate } from "./routes";

const INPUT_LABEL = "说一句话或搜索资料、创作、会话和自动化";

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [{ id: "codex-native", provider: "codex", label: "Codex", runtime: "native", available: true, version: "1", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, detectedModel: null, contextWindow: null, installable: false, oneMillion: false }],
  sessions: [],
  runs: [],
  pendingApprovals: []
};

const navigate = vi.fn<Navigate>();
let searchWorkspace: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  searchWorkspace = vi.fn(async () => [] as GlobalSearchResult[]);
  window.cctools = {
    searchWorkspace,
    aiRefresh: async () => snapshot,
    aiGetEvents: async () => [],
    aiCancelRun: async () => true,
    aiResolveApproval: async () => true,
    runSkill: vi.fn(async () => true),
    selectFiles: async () => [],
    selectMymindFiles: async () => [],
    searchMymindFiles: async () => ({ items: [], indexedCount: 0, truncated: false }),
    openPath: vi.fn(async (p: string) => p),
    revealPath: async () => true,
    onAiEvent: () => () => {}
  } as unknown as DesktopApi;
  navigate.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

function renderPalette(open = true) {
  return render(
    <AiProvider initial={snapshot}>
      <GlobalSearch open={open} onClose={vi.fn()} navigate={navigate} />
    </AiProvider>
  );
}

describe("GlobalSearch", () => {
  it("renders nothing when closed", () => {
    renderPalette(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("portals above the app and keeps its background inert through the exit animation", () => {
    const onClose = vi.fn();
    const view = render(
      <AiProvider initial={snapshot}>
        <GlobalSearch open onClose={onClose} navigate={navigate} />
      </AiProvider>
    );
    const scrim = document.querySelector<HTMLElement>(".global-search-scrim");
    expect(scrim).toBeTruthy();
    expect(scrim?.parentElement).toBe(document.body);
    expect(view.container.contains(scrim)).toBe(false);
    expect(view.container.inert).toBe(true);
    expect(view.container.getAttribute("aria-hidden")).toBe("true");

    view.rerender(
      <AiProvider initial={snapshot}>
        <GlobalSearch open={false} onClose={onClose} navigate={navigate} />
      </AiProvider>
    );
    expect(document.querySelector(".global-search-scrim")).toBeTruthy();
    expect(view.container.inert).toBe(true);

    act(() => { vi.advanceTimersByTime(200); });
    expect(document.querySelector(".global-search-scrim")).toBeNull();
    expect(view.container.inert).toBe(false);
    expect(view.container.hasAttribute("aria-hidden")).toBe(false);
  });

  it("focuses the input when opened and shows the hint before any query", () => {
    renderPalette(true);
    expect(screen.getByLabelText(INPUT_LABEL)).toBeTruthy();
    // short-query hint is shown
    expect(screen.getByText(/说一句话|关键字|搜索/)).toBeTruthy();
  });

  it("debounces searchWorkspace calls and renders grouped results", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    searchWorkspace.mockResolvedValue([
      { id: "c1", kind: "content", title: "Alpha", subtitle: "s", path: "a.md", date: "20260707", status: null, targetId: "c1" },
      { id: "p1", kind: "project", title: "Beta", subtitle: "s", path: "p", date: "20260707", status: "drafting", targetId: "p1" }
    ]);
    renderPalette();
    const input = screen.getByLabelText(INPUT_LABEL);
    await user.type(input, "alpha");
    await act(async () => { vi.advanceTimersByTime(300); });
    await waitFor(() => expect(searchWorkspace).toHaveBeenCalledWith("alpha"));
    await screen.findByText("Alpha");
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("navigates by content kind when a result is chosen", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    searchWorkspace.mockResolvedValue([
      { id: "c1", kind: "content", title: "Alpha", subtitle: "s", path: "a.md", date: "20260707", status: null, targetId: "c1" }
    ]);
    renderPalette();
    await user.type(screen.getByLabelText(INPUT_LABEL), "alpha");
    await act(async () => { vi.advanceTimersByTime(300); });
    const result = await screen.findByText("Alpha");
    await user.click(result);
    expect(navigate).toHaveBeenCalledWith("sources", expect.objectContaining({ date: "20260707", contentPath: "a.md" }));
  });

  it("navigates by project kind", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    searchWorkspace.mockResolvedValue([
      { id: "p1", kind: "project", title: "Beta", subtitle: "s", path: "p", date: "20260707", status: "drafting", targetId: "proj-1" }
    ]);
    renderPalette();
    await user.type(screen.getByLabelText(INPUT_LABEL), "beta");
    await act(async () => { vi.advanceTimersByTime(300); });
    await user.click(await screen.findByText("Beta"));
    expect(navigate).toHaveBeenCalledWith("creative", { projectDir: "proj-1" });
  });

  it("navigates to automation for skill results", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    searchWorkspace.mockResolvedValue([
      { id: "s1", kind: "skill", title: "Skill", subtitle: "s", path: "p", date: null, status: null, targetId: "skill-1" }
    ]);
    renderPalette();
    await user.type(screen.getByLabelText(INPUT_LABEL), "skill");
    await act(async () => { vi.advanceTimersByTime(300); });
    await user.click(await screen.findByText("Skill"));
    expect(navigate).toHaveBeenCalledWith("automation", { skillId: "skill-1" });
  });

  it("offers a summary action suggestion for summary-style queries", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPalette();
    await user.type(screen.getByLabelText(INPUT_LABEL), "总结今天的资料");
    expect(await screen.findByText("总结今天的资料", { selector: "strong" })).toBeTruthy();
  });

  it("offers a draft action suggestion for writing-style queries", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPalette();
    await user.type(screen.getByLabelText(INPUT_LABEL), "写一篇小红书开头");
    expect(await screen.findByText("写一段内容草稿")).toBeTruthy();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<AiProvider initial={snapshot}><GlobalSearch open onClose={onClose} navigate={navigate} /></AiProvider>);
    fireEvent.keyDown(screen.getByLabelText(INPUT_LABEL), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

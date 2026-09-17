import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSession, AiSnapshot, ApprovalRequest, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../ai-context";
import { SidebarRecent } from "./SidebarRecent";

const session: AiSession = {
  schemaVersion: 1,
  id: "session-1",
  projectId: "project",
  scope: { type: "workspace" },
  projectRoot: "/project",
  provider: "codex",
  providerId: "codex-native",
  providerSessionId: null,
  cwd: "/project",
  title: "读取下载目录文件",
  permissionProfile: "edit",
  status: "idle",
  pinned: false,
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastRunId: null
};

const approval: ApprovalRequest = {
  id: "approval-1",
  runId: "run-1",
  sessionId: session.id,
  providerRequestId: "provider-1",
  category: "outside-workspace",
  title: "读取下载目录",
  detail: "需要读取项目外目录",
  paths: ["/home/user/Downloads"],
  cwd: "/project",
  createdAt: "2026-01-01T00:00:01.000Z",
  status: "pending"
};

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [],
  sessions: [session],
  runs: [],
  pendingApprovals: [approval]
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty("--dur-normal");
  document.documentElement.style.removeProperty("--ease-standard");
});

describe("SidebarRecent", () => {
  it("preserves native Tab navigation for fully rendered short histories", () => {
    const sessions = Array.from({ length: 20 }, (_, i) => ({ ...session, id: `task-${i}`, title: `合成任务 ${i}` }));
    window.openmind = { onAiEvent: () => () => undefined } as unknown as DesktopApi;
    const { container } = render(<AiProvider initial={{ ...snapshot, sessions, pendingApprovals: [] }}><SidebarRecent activeSessionId={null} onOpen={() => {}} /></AiProvider>);
    const rows = container.querySelectorAll(".nav-recent-row");
    expect(rows.length).toBe(20);
    const controls = rows[0].querySelectorAll("button");
    expect(fireEvent.keyDown(controls[controls.length - 1], { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(rows[1].querySelector("button")!, { key: "Tab", shiftKey: true })).toBe(true);
  });

  it("bounds long-history mounting and keeps the last task reachable by keyboard", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("nav-recent-list") ? 260 : 30;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(240);
    const scrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {
      this.scrollTop = typeof options === "number" ? y || 0 : options?.top || 0;
      this.dispatchEvent(new Event("scroll"));
    };
    try {
      const sessions = Array.from({ length: 400 }, (_, i) => ({ ...session, id: `task-${i}`, title: `合成任务 ${i}` }));
      window.openmind = { onAiEvent: () => () => undefined } as unknown as DesktopApi;
      const onOpen = vi.fn();
      const { container } = render(<AiProvider initial={{ ...snapshot, sessions, pendingApprovals: [] }}><SidebarRecent activeSessionId={null} onOpen={onOpen} /></AiProvider>);
      const list = container.querySelector<HTMLElement>(".nav-recent-list")!;
      expect(container.querySelectorAll(".nav-recent-row").length).toBeLessThan(25);
      fireEvent.keyDown(list, { key: "End" });
      await waitFor(() => expect(document.activeElement?.textContent).toContain("合成任务 399"));
      fireEvent.click(document.activeElement!);
      expect(onOpen).toHaveBeenCalledWith(sessions[399]);
      fireEvent.keyDown(document.activeElement!, { key: "Home" });
      await waitFor(() => expect(document.activeElement?.textContent).toContain("合成任务 0"));
      expect(container.querySelectorAll(".nav-recent-row").length).toBeLessThan(25);
    } finally { HTMLElement.prototype.scrollTo = scrollTo; }
  });

  it("restores virtual row positions and focus after an archive rollback crosses the threshold", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("nav-recent-list") ? 260 : 30;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(240);
    let rejectUpdate!: (error: Error) => void;
    window.openmind = {
      onAiEvent: () => () => undefined,
      aiUpdateSession: () => new Promise<AiSession>((_resolve, reject) => { rejectUpdate = reject; })
    } as unknown as DesktopApi;
    const sessions = Array.from({ length: 21 }, (_, i) => ({ ...session, id: `task-${i}`, title: `合成任务 ${i}` }));
    const { container } = render(<AiProvider initial={{ ...snapshot, sessions, pendingApprovals: [] }}><SidebarRecent activeSessionId={null} onOpen={() => {}} /></AiProvider>);
    const survivor = container.querySelector<HTMLElement>('[data-recent-index="1"]')!;
    const button = survivor.querySelector<HTMLButtonElement>(".nav-recent-item")!;
    const position = survivor.style.transform;
    expect(position).toBe("translate3d(0, 31px, 0)");
    act(() => button.focus());

    fireEvent.click(screen.getByRole("button", { name: "归档会话：合成任务 0" }));
    expect(container.querySelector(".nav-recent-list.is-virtual")).toBeNull();
    expect(container.querySelectorAll("[data-recent-index]")).toHaveLength(20);
    expect(document.activeElement).toBe(button);

    await act(async () => rejectUpdate(new Error("synthetic write failure")));
    expect(container.querySelector(".nav-recent-list.is-virtual")).toBeTruthy();
    expect(container.querySelector('[data-recent-index="1"]')).toBe(survivor);
    expect(document.activeElement).toBe(button);
    expect(survivor.style.transform).toBe(position);
    expect(container.querySelectorAll("[data-recent-index]").length).toBeLessThan(21);
  });

  function renderDisclosure() {
    document.documentElement.style.setProperty("--dur-normal", "200ms");
    document.documentElement.style.setProperty("--ease-standard", "cubic-bezier(.2, 0, 0, 1)");
    window.openmind = { onAiEvent: () => () => undefined } as unknown as DesktopApi;
    const view = render(<AiProvider initial={snapshot}><SidebarRecent activeSessionId={null} onOpen={() => undefined} /></AiProvider>);
    const trigger = view.container.querySelector<HTMLButtonElement>(".nav-recent-toggle")!;
    const content = () => document.getElementById(trigger.getAttribute("aria-controls")!);
    return { ...view, trigger, content };
  }

  it("makes closing content inert immediately, then unmounts at the CSS token duration", () => {
    vi.useFakeTimers();
    const { trigger, content } = renderDisclosure();
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(content()?.getAttribute("aria-hidden")).toBe("true");
    expect(content()?.querySelector("[inert] .nav-recent-list")).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
    act(() => vi.advanceTimersByTime(199));
    expect(screen.queryByText(session.title)).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText(session.title)).toBeNull();
    expect(localStorage.getItem("openmind.nav.recentCollapsed.v2")).toBe("true");
  });

  it("cancels pending unmount when reopened and keeps the latest stored state", () => {
    vi.useFakeTimers();
    const { trigger, content } = renderDisclosure();
    fireEvent.click(trigger);
    act(() => vi.advanceTimersByTime(80));
    fireEvent.click(trigger);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText(session.title)).toBeTruthy();
    expect(content()?.querySelector("[inert]")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(localStorage.getItem("openmind.nav.recentCollapsed.v2")).toBe("false");
  });

  it("keeps initially collapsed rows unmounted and skips exit retention with reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    localStorage.setItem("openmind.nav.recentCollapsed.v2", "true");
    const { trigger } = renderDisclosure();
    expect(screen.queryByText(session.title)).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByText(session.title)).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByText(session.title)).toBeNull();
  });

  it("shows workspace and Project Task sessions in one recent list", () => {
    const projectSession: AiSession = {
      ...session,
      id: "project-session",
      title: "项目内部会话",
      scope: { type: "project-task", projectId: "5a111111-1111-4111-8111-111111111111", projectName: "AI 安全", taskId: "task-1" }
    };
    const onOpen = vi.fn();
    window.openmind = {
      aiRefresh: async () => ({ ...snapshot, sessions: [session, projectSession], pendingApprovals: [] }),
      aiGetEvents: async () => [],
      onAiEvent: () => () => undefined
    } as unknown as DesktopApi;

    render(
      <AiProvider initial={{ ...snapshot, sessions: [session, projectSession], pendingApprovals: [] }}>
        <SidebarRecent activeSessionId={null} onOpen={onOpen} />
      </AiProvider>
    );

    expect(screen.getByText("读取下载目录文件")).toBeTruthy();
    expect(screen.getByText("项目内部会话")).toBeTruthy();
    expect(screen.getByText(/AI 安全 ·/)).toBeTruthy();
    const idleItem = screen.getByText("项目内部会话").closest("button")!;
    expect(idleItem.classList.contains("has-status")).toBe(false);
    expect(idleItem.firstElementChild?.classList.contains("nav-recent-item-main")).toBe(true);

    fireEvent.click(idleItem);
    expect(onOpen).toHaveBeenCalledWith(projectSession);
  });

  it("keeps the visible session time anchored to creation after later replies", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
    const repliedSession = { ...session, updatedAt: "2026-01-03T00:00:00.000Z" };
    const repliedSnapshot = { ...snapshot, sessions: [repliedSession], pendingApprovals: [] };
    window.openmind = {
      aiRefresh: async () => repliedSnapshot,
      aiGetEvents: async () => [],
      onAiEvent: () => () => undefined
    } as unknown as DesktopApi;

    render(
      <AiProvider initial={repliedSnapshot}>
        <SidebarRecent activeSessionId={repliedSession.id} onOpen={() => undefined} />
      </AiProvider>
    );

    expect(screen.getByText("2 天前")).toBeTruthy();
    expect(screen.queryByText("刚刚")).toBeNull();
  });

  it("shows 等待批准 for a session with a pending approval", () => {
    window.openmind = {
      aiRefresh: async () => snapshot,
      aiGetEvents: async () => [],
      onAiEvent: () => () => undefined
    } as unknown as DesktopApi;

    render(
      <AiProvider initial={snapshot}>
        <SidebarRecent activeSessionId={session.id} onOpen={() => undefined} />
      </AiProvider>
    );

    const status = screen.getByText("等待批准");
    expect(status.classList.contains("waiting-approval")).toBe(true);
    expect(status.closest(".nav-recent-item")?.getAttribute("aria-current")).toBe("true");
  });

  it("optimistically archives a session and ignores an older worker snapshot", async () => {
    const archivedSession = { ...session, archived: true, updatedAt: "2026-07-21T12:00:00.000Z" };
    let resolveUpdate: ((value: AiSession) => void) | null = null;
    let eventListener: Parameters<DesktopApi["onAiEvent"]>[0] | null = null;
    const aiUpdateSession = vi.fn(() => new Promise<AiSession>((resolve) => { resolveUpdate = resolve; }));
    window.openmind = {
      aiUpdateSession,
      aiRefresh: async () => snapshot,
      aiGetEvents: async () => [],
      onAiEvent: (listener: Parameters<DesktopApi["onAiEvent"]>[0]) => {
        eventListener = listener;
        return () => { eventListener = null; };
      }
    } as unknown as DesktopApi;

    render(
      <AiProvider initial={{ ...snapshot, pendingApprovals: [] }}>
        <SidebarRecent activeSessionId={null} onOpen={() => undefined} />
      </AiProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "归档会话：读取下载目录文件" }));

    await waitFor(() => expect(screen.queryByText("读取下载目录文件")).toBeNull());
    act(() => {
      eventListener?.({ kind: "snapshot", snapshot: { ...snapshot, pendingApprovals: [] } } as never);
    });
    expect(screen.queryByText("读取下载目录文件")).toBeNull();
    act(() => { resolveUpdate?.(archivedSession); });
    await waitFor(() => expect(aiUpdateSession).toHaveBeenCalledWith(session.id, { archived: true }));
  });

  it("rolls an optimistic archive back when persistence fails", async () => {
    let rejectUpdate: ((cause: Error) => void) | null = null;
    const aiUpdateSession = vi.fn(() => new Promise<AiSession>((_resolve, reject) => { rejectUpdate = reject; }));
    window.openmind = {
      aiUpdateSession,
      aiRefresh: async () => snapshot,
      aiGetEvents: async () => [],
      onAiEvent: () => () => undefined
    } as unknown as DesktopApi;

    render(
      <AiProvider initial={{ ...snapshot, pendingApprovals: [] }}>
        <SidebarRecent activeSessionId={null} onOpen={() => undefined} />
      </AiProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "归档会话：读取下载目录文件" }));
    await waitFor(() => expect(screen.queryByText("读取下载目录文件")).toBeNull());
    act(() => { rejectUpdate?.(new Error("write failed")); });
    expect(await screen.findByText("读取下载目录文件")).toBeTruthy();
  });

  it("pins a recent session from the same row action group", async () => {
    const pinnedSession = { ...session, pinned: true, updatedAt: "2026-07-21T12:00:00.000Z" };
    const aiUpdateSession = vi.fn().mockResolvedValue(pinnedSession);
    window.openmind = {
      aiUpdateSession,
      aiRefresh: async () => snapshot,
      aiGetEvents: async () => [],
      onAiEvent: () => () => undefined
    } as unknown as DesktopApi;

    render(
      <AiProvider initial={{ ...snapshot, pendingApprovals: [] }}>
        <SidebarRecent activeSessionId={null} onOpen={() => undefined} />
      </AiProvider>
    );

    const pinButton = screen.getByRole("button", { name: "置顶：读取下载目录文件" });
    pinButton.focus();
    fireEvent.click(pinButton, { detail: 1 });

    await waitFor(() => expect(aiUpdateSession).toHaveBeenCalledWith(session.id, { pinned: true }));
    expect(screen.getByRole("button", { name: "取消置顶：读取下载目录文件" })).toBeTruthy();
    expect(document.activeElement).not.toBe(pinButton);
  });
});

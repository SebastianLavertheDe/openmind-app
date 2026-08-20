import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSession, AiSnapshot, ApprovalRequest, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../ai-context";
import { SidebarRecent } from "./SidebarRecent";

const session: AiSession = {
  schemaVersion: 1,
  id: "session-1",
  projectId: "project",
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
});

describe("SidebarRecent", () => {
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

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});

describe("SidebarRecent", () => {
  it("shows 等待批准 for a session with a pending approval", () => {
    window.cctools = {
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
});

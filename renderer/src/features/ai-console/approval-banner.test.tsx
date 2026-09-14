import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, ApprovalRequest, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { ApprovalBanner } from "./approval-banner";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
  };
  Element.prototype.scrollIntoView = () => undefined;
  window.matchMedia = (() => ({
    matches: false,
    media: "",
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true
  })) as typeof window.matchMedia;
});

function makeApproval(id = "appr-1", command = "npm test"): ApprovalRequest {
  return {
    id,
    runId: `run-${id}`,
    sessionId: "session",
    providerRequestId: `provider-${id}`,
    category: "command",
    title: `运行 ${command}`,
    detail: "",
    command,
    paths: [],
    cwd: "/project",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "pending"
  } as ApprovalRequest;
}

function makeSnapshot(approvals: ApprovalRequest[], sessionId?: string): AiSnapshot {
  return {
    projectRoot: "/project",
    providers: [],
    sessions: sessionId ? [{
      schemaVersion: 1,
      id: sessionId,
      projectId: "project",
      scope: { type: "workspace" },
      projectRoot: "/project",
      provider: "codex",
      providerId: "codex-native",
      providerSessionId: null,
      cwd: "/project",
      title: "Test Session",
      permissionProfile: "edit",
      status: "waiting-approval",
      pinned: false,
      archived: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastRunId: null
    }] : [],
    runs: [],
    pendingApprovals: approvals
  } as AiSnapshot;
}

describe("ApprovalBanner", () => {
  it("renders nothing when no pending approvals", () => {
    window.openmind = {
      aiRefresh: async () => makeSnapshot([]),
      aiGetEvents: async () => [],
      aiPrewarm: async () => undefined,
      onAiEvent: () => () => undefined
    } as unknown as DesktopApi;
    const { container } = render(
      <AiProvider initial={makeSnapshot([])}><ApprovalBanner /></AiProvider>
    );
    expect(container.querySelector(".approval-banner")).toBeNull();
  });

  it("renders banner with approval command", async () => {
    window.openmind = {
      aiRefresh: async () => makeSnapshot([makeApproval()]),
      aiGetEvents: async () => [],
      aiPrewarm: async () => undefined,
      onAiEvent: () => () => undefined
    } as unknown as DesktopApi;
    render(
      <AiProvider initial={makeSnapshot([makeApproval()])}><ApprovalBanner /></AiProvider>
    );
    expect(await screen.findByText("npm test")).toBeTruthy();
    expect(screen.getByRole("button", { name: "允许" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeTruthy();
  });

  it("shows a native CLI tool approval for the active AI session", async () => {
    const approval = {
      ...makeApproval("cli-tool-1", ""),
      runId: "cli-run-1",
      sessionId: "active-session",
      category: "tool" as const,
      title: "Codex · browser",
      detail: "{\"action\":\"navigate\",\"url\":\"https://example.com\"}",
      command: undefined
    };
    window.openmind = {
      aiRefresh: async () => makeSnapshot([]),
      aiGetEvents: async () => [],
      aiPrewarm: async () => undefined,
      onAiEvent: () => () => undefined
    } as unknown as DesktopApi;
    render(
      <AiProvider initial={makeSnapshot([approval], "active-session")}><ApprovalBanner /></AiProvider>
    );
    expect(await screen.findByText(/navigate/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "允许" })).toBeTruthy();
  });

  it("keeps single-approval actions usable with a very long WSL command", async () => {
    const command = String.raw`wsl.exe -d Ubuntu -- bash -lc "cd /home/test-user/work/openmind-data && python .agent/skills/cctools/daily-topic-selector/scripts/generate_daily_topics.py --summary \\wsl.localhost\Ubuntu\home\test-user\work\openmind-data\daily-summary\20260715_daily_summary.md --posts \\wsl.localhost\Ubuntu\home\test-user\work\openmind-data\post\20260715\posts.json"`;
    const approval = makeApproval("long-command", command);
    const resolveApproval = vi.fn().mockResolvedValue(true);
    window.openmind = {
      aiRefresh: async () => makeSnapshot([]),
      aiGetEvents: async () => [],
      aiPrewarm: async () => undefined,
      onAiEvent: () => () => undefined,
      aiResolveApproval: resolveApproval
    } as unknown as DesktopApi;
    render(
      <AiProvider initial={makeSnapshot([approval])}><ApprovalBanner /></AiProvider>
    );

    const commandNode = await screen.findByTitle(command);
    const card = commandNode.closest<HTMLElement>(".approval-card")!;
    expect(commandNode.textContent).toBe(command);
    expect((screen.getByRole("button", { name: "允许" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "拒绝" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(within(card).getByRole("button", { name: "允许" }));
    await waitFor(() => expect(resolveApproval).toHaveBeenCalledWith("long-command", "accept"));
    expect(screen.queryByText(/已允许/)).toBeNull();
    await waitFor(() => expect(document.querySelector(".approval-banner-list > .ui-overlay")?.getAttribute("data-leaving")).toBe("true"));
    expect(document.querySelector(".approval-banner-list > .ui-overlay")?.hasAttribute("inert")).toBe(true);
    expect(screen.getByText(command)).toBeTruthy();
    await waitFor(() => expect(document.querySelector(".approval-banner-list > .ui-overlay")).toBeNull());
  });

  it("allows declining a single approval", async () => {
    const approval = makeApproval("decline-one", "npm run unsafe-task");
    const resolveApproval = vi.fn().mockResolvedValue(true);
    window.openmind = {
      aiRefresh: async () => makeSnapshot([]),
      aiGetEvents: async () => [],
      aiPrewarm: async () => undefined,
      onAiEvent: () => () => undefined,
      aiResolveApproval: resolveApproval
    } as unknown as DesktopApi;
    render(
      <AiProvider initial={makeSnapshot([approval])}><ApprovalBanner /></AiProvider>
    );
    await screen.findByText("npm run unsafe-task");

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(resolveApproval).toHaveBeenCalledWith("decline-one", "decline");
  });

  it("shows batch bar when multiple approvals", async () => {
    const approvals = [makeApproval("a1", "npm test"), makeApproval("a2", "npm build")];
    window.openmind = {
      aiRefresh: async () => makeSnapshot(approvals),
      aiGetEvents: async () => [],
      aiPrewarm: async () => undefined,
      onAiEvent: () => () => undefined
    } as unknown as DesktopApi;
    render(
      <AiProvider initial={makeSnapshot(approvals)}><ApprovalBanner /></AiProvider>
    );
    expect(await screen.findByText(/2 项待审批/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "全部允许" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "全部拒绝" })).toBeTruthy();
  });

  it("does not show batch bar for single approval", async () => {
    window.openmind = {
      aiRefresh: async () => makeSnapshot([makeApproval()]),
      aiGetEvents: async () => [],
      aiPrewarm: async () => undefined,
      onAiEvent: () => () => undefined
    } as unknown as DesktopApi;
    render(
      <AiProvider initial={makeSnapshot([makeApproval()])}><ApprovalBanner /></AiProvider>
    );
    await screen.findByText("npm test");
    expect(screen.queryByText(/待审批/)).toBeNull();
    expect(screen.queryByRole("button", { name: "全部允许" })).toBeNull();
  });

  it("filters approvals by active session", async () => {
    const otherApproval = makeApproval("other", "rm -rf");
    otherApproval.sessionId = "other-session";
    window.openmind = {
      aiRefresh: async () => makeSnapshot([otherApproval], "active-session"),
      aiGetEvents: async () => [],
      aiPrewarm: async () => undefined,
      onAiEvent: () => () => undefined
    } as unknown as DesktopApi;
    const { container } = render(
      <AiProvider initial={makeSnapshot([otherApproval], "active-session")}>
        <ApprovalBanner />
      </AiProvider>
    );
    // other-session approval should not render for active-session
    await waitFor(() => {
      expect(container.querySelector(".approval-banner")).toBeNull();
    });
  });

  it("resolves all approvals on 全部允许", async () => {
    const approvals = [makeApproval("a1", "cmd1"), makeApproval("a2", "cmd2")];
    const resolveApproval = vi.fn().mockResolvedValue(true);
    window.openmind = {
      aiRefresh: async () => makeSnapshot([]),
      aiGetEvents: async () => [],
      aiPrewarm: async () => undefined,
      onAiEvent: () => () => undefined,
      aiResolveApproval: resolveApproval
    } as unknown as DesktopApi;
    render(
      <AiProvider initial={makeSnapshot(approvals)}><ApprovalBanner /></AiProvider>
    );
    await screen.findByText(/2 项待审批/);
    fireEvent.click(screen.getByRole("button", { name: "全部允许" }));
    await waitFor(() => expect(resolveApproval).toHaveBeenCalledTimes(2));
    expect(resolveApproval).toHaveBeenCalledWith("a1", "accept");
    expect(resolveApproval).toHaveBeenCalledWith("a2", "accept");
  });

  it("resolves all approvals on 全部拒绝", async () => {
    const approvals = [makeApproval("a1"), makeApproval("a2")];
    const resolveApproval = vi.fn().mockResolvedValue(true);
    window.openmind = {
      aiRefresh: async () => makeSnapshot([]),
      aiGetEvents: async () => [],
      aiPrewarm: async () => undefined,
      onAiEvent: () => () => undefined,
      aiResolveApproval: resolveApproval
    } as unknown as DesktopApi;
    render(
      <AiProvider initial={makeSnapshot(approvals)}><ApprovalBanner /></AiProvider>
    );
    await screen.findByText(/2 项待审批/);
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "全部拒绝" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(resolveApproval).toHaveBeenCalledTimes(2);
    expect(resolveApproval).toHaveBeenCalledWith("a1", "decline");
    expect(resolveApproval).toHaveBeenCalledWith("a2", "decline");
  });

  it("has polite aria-live region", async () => {
    window.openmind = {
      aiRefresh: async () => makeSnapshot([makeApproval()]),
      aiGetEvents: async () => [],
      aiPrewarm: async () => undefined,
      onAiEvent: () => () => undefined
    } as unknown as DesktopApi;
    render(
      <AiProvider initial={makeSnapshot([makeApproval()])}><ApprovalBanner /></AiProvider>
    );
    const banner = await screen.findByRole("region");
    expect(banner.getAttribute("aria-live")).toBe("polite");
  });

  it("shows both approval cards when 2 pending", async () => {
    const approvals = [makeApproval("a1", "first cmd"), makeApproval("a2", "second cmd")];
    window.openmind = {
      aiRefresh: async () => makeSnapshot(approvals),
      aiGetEvents: async () => [],
      aiPrewarm: async () => undefined,
      onAiEvent: () => () => undefined
    } as unknown as DesktopApi;
    render(
      <AiProvider initial={makeSnapshot(approvals)}><ApprovalBanner /></AiProvider>
    );
    expect(await screen.findByText("first cmd")).toBeTruthy();
    expect(screen.getByText("second cmd")).toBeTruthy();
  });
});

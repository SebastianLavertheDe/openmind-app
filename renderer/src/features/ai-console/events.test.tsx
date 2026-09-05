import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiEvent, AiRun, AiSnapshot, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { ErrorEvent, ProcessSystemEvent, SubtaskTrace, SystemEvent } from "./events";

afterEach(() => cleanup());

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
  window.openmind = {
    aiRefresh: async () => snapshot,
    aiGetEvents: async () => [],
    aiPrewarm: async () => undefined,
    aiStartRun: vi.fn(async () => "new-run-id"),
    aiCancelRun: async () => true,
    onAiEvent: () => () => undefined,
    openPath: vi.fn(),
    revealPath: vi.fn()
  } as unknown as DesktopApi;
});

function makeRun(): AiRun {
  return {
    schemaVersion: 1,
    id: "run",
    sessionId: "session",
    projectId: "project",
    scope: { type: "workspace" },
    provider: "codex",
    providerId: "codex-native",
    permissionProfile: "edit",
    status: "completed",
    prompt: "original prompt",
    contexts: [],
    turnContext: null,
    workspacePath: null,
    baseCommit: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:10.000Z",
    error: null,
    changeSet: null,
    risks: []
  };
}

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [{
    id: "codex-native",
    provider: "codex",
    label: "Codex",
    runtime: "native",
    available: true,
    version: "1",
    supportsApprovals: true,
    supportsResume: true,
    supportsImages: true,
    diagnostic: null,
    detectedModel: null,
    contextWindow: null,
    installable: false, oneMillion: false
  }],
  sessions: [],
  runs: [makeRun()],
  pendingApprovals: []
};

function makeEvent(id: string, kind: AiEvent["kind"], payload: Record<string, unknown>): AiEvent {
  return {
    schemaVersion: 1,
    id,
    seq: id.length,
    timestamp: "2026-01-01T00:00:00.000Z",
    projectId: "project",
    sessionId: "session",
    runId: "run",
    provider: "codex",
    kind,
    payload,
    risks: []
  };
}

describe("SystemEvent", () => {
  it("renders system event with title and subtitle", () => {
    render(<SystemEvent text="初始化完成" icon={<span>🔧</span>} />);
    expect(screen.getByText("系统事件")).toBeTruthy();
    expect(screen.getByText("初始化完成")).toBeTruthy();
  });

  it("renders danger variant with risk title", () => {
    render(<SystemEvent text="检测到危险操作" icon={<span>⚠</span>} danger />);
    expect(screen.getByText("风险提示")).toBeTruthy();
    expect(screen.getByText("检测到危险操作")).toBeTruthy();
  });
});

describe("process system semantics", () => {
  it("renders context compaction as a quiet milestone", () => {
    const event = makeEvent("compact", "system", {
      semanticType: "context_compaction",
      subtype: "context_compacted",
      text: "Codex compacted the conversation context."
    });
    const { container } = render(<ProcessSystemEvent event={event} />);
    const milestone = container.querySelector(".process-system-event.compacted");
    expect(milestone).toBeTruthy();
    expect(milestone?.textContent).not.toContain("Codex compacted");
  });

  it("preserves a provider warning in the process trace", () => {
    const event = makeEvent("warning", "system", { text: "Configuration needs attention" });
    const { container } = render(<ProcessSystemEvent event={event} />);
    expect(container.querySelector(".process-system-event.warning")).toBeTruthy();
    expect(screen.getByText("Configuration needs attention")).toBeTruthy();
  });

  it("folds Claude background task lifecycle events into one completed row", () => {
    const events = [
      makeEvent("task-started", "system", { semanticType: "subtask", subtype: "task_started", taskId: "task-1", description: "Run background check" }),
      makeEvent("task-finished", "system", { semanticType: "subtask", subtype: "task_notification", taskId: "task-1", status: "completed", summary: "Background check complete" })
    ];
    const { container } = render(<SubtaskTrace events={events} />);
    expect(container.querySelector(".subtask-trace.completed")).toBeTruthy();
    expect(screen.getByText("Background check complete")).toBeTruthy();
  });

  it("supports Codex collaboration agent state without treating it as Todo", () => {
    const event = makeEvent("agents", "system", {
      semanticType: "subtask",
      subtype: "subtask_updated",
      prompt: "Review final reply semantics",
      agentsStates: {
        one: { status: "completed" },
        two: { status: "running" }
      }
    });
    const { container } = render(<SubtaskTrace events={[event]} />);
    expect(container.querySelector(".subtask-trace.updated")).toBeTruthy();
    expect(screen.getByText("Review final reply semantics")).toBeTruthy();
    expect(container.querySelector(".subtask-trace small")?.textContent).toContain("2");
  });

  it("maps Codex errored and interrupted agents to terminal failure states", () => {
    const errored = makeEvent("agents-error", "system", {
      semanticType: "subtask",
      subtype: "subtask_completed",
      prompt: "Review provider output",
      agentsStates: { one: { status: "errored" } }
    });
    const interrupted = makeEvent("agents-interrupted", "system", {
      semanticType: "subtask",
      subtype: "subtask_completed",
      prompt: "Run verification",
      agentsStates: { two: { status: "interrupted" } }
    });
    const { container } = render(<><SubtaskTrace events={[errored]} /><SubtaskTrace events={[interrupted]} /></>);
    expect(container.querySelectorAll(".subtask-trace.failed")).toHaveLength(1);
    expect(container.querySelectorAll(".subtask-trace.cancelled")).toHaveLength(1);
  });

  it.each([
    ["cancelled", "cancelled"],
    ["failed", "failed"],
    ["conflicted", "failed"],
    ["completed", "completed"]
  ] as const)("stops an unfinished subtask when its parent run is %s", (runStatus, className) => {
    const event = makeEvent("task-started", "system", {
      semanticType: "subtask",
      subtype: "task_started",
      taskId: "task-1",
      description: "Open bilibili via agent-browser and screenshot homepage"
    });
    const { container } = render(<SubtaskTrace events={[event]} runStatus={runStatus} />);

    expect(container.querySelector(`.subtask-trace.${className}`)).toBeTruthy();
    expect(container.querySelector(".spin")).toBeNull();
  });
});

describe("ErrorEvent", () => {
  it("renders error title once with the full text only in the expandable body", () => {
    const event = makeEvent("err1", "error", { text: "Something went wrong\nDetailed stack trace" });
    render(
      <AiProvider initial={snapshot}>
        <ErrorEvent event={event} />
      </AiProvider>
    );
    expect(screen.getByText("运行失败")).toBeTruthy();
    // 错误全文只在展开区出现一次，头部不再重复摘要。
    expect(screen.getAllByText(/Something went wrong/)).toHaveLength(1);
  });

  it("falls back to default message when text is empty", () => {
    const event = makeEvent("err2", "error", {});
    render(
      <AiProvider initial={snapshot}>
        <ErrorEvent event={event} />
      </AiProvider>
    );
    // 运行失败 appears as both title and subtitle (firstLine of fallback text)
    expect(screen.getAllByText("运行失败").length).toBeGreaterThan(0);
  });

  it("shows the error text plainly without action buttons, search or stripe", () => {
    const event = makeEvent("err3", "error", { text: "Not logged in · Please run /login" });
    const { container } = render(
      <AiProvider initial={snapshot}>
        <ErrorEvent event={event} />
      </AiProvider>
    );
    expect(screen.getByText("Not logged in · Please run /login")).toBeTruthy();
    expect(container.querySelector(".overflow-box")).toBeNull();
    expect(container.querySelector(".has-stripe")).toBeNull();
    expect(container.querySelector("footer")).toBeNull();
    expect(screen.queryByText("去终端登录")).toBeNull();
    expect(screen.queryByText("打开运行记录")).toBeNull();
    expect(screen.queryByText("按原上下文重试")).toBeNull();
  });
});

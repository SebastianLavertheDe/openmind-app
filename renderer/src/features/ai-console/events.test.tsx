import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiEvent, AiRun, AiSnapshot, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { ErrorEvent, ProcessSystemEvent, SubtaskTrace, SystemEvent, TechnicalEventGroup } from "./events";

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
  it("renders error title and first line of error text", () => {
    const event = makeEvent("err1", "error", { text: "Something went wrong\nDetailed stack trace" });
    render(
      <AiProvider initial={snapshot}>
        <ErrorEvent event={event} />
      </AiProvider>
    );
    expect(screen.getByText("运行失败")).toBeTruthy();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
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

  it("renders full error text in OverflowBox", () => {
    const event = makeEvent("err3", "error", { text: "Error line 1\nError line 2" });
    const { container } = render(
      <AiProvider initial={snapshot}>
        <ErrorEvent event={event} />
      </AiProvider>
    );
    const overflowBox = container.querySelector(".overflow-box");
    expect(overflowBox).toBeTruthy();
  });

  it("has-stripe class for red stripe styling", () => {
    const event = makeEvent("err4", "error", { text: "fail" });
    const { container } = render(
      <AiProvider initial={snapshot}>
        <ErrorEvent event={event} />
      </AiProvider>
    );
    const cell = container.querySelector(".error-event.has-stripe");
    expect(cell).toBeTruthy();
  });

  it("searches within error text and highlights matches", async () => {
    const longText = Array.from({ length: 20 }, (_, i) => `error line ${i}`).join("\n");
    const event = makeEvent("err5", "error", { text: longText });
    render(
      <AiProvider initial={snapshot}>
        <ErrorEvent event={event} />
      </AiProvider>
    );
    // 打开搜索 → 输入 → 验证匹配计数
    fireEvent.click(screen.getByRole("button", { name: /⌘F/ }));
    const input = screen.getByPlaceholderText("搜索…");
    fireEvent.change(input, { target: { value: "line 5" } });
    await waitFor(() => {
      expect(screen.getByText(/1 \/ 1/)).toBeTruthy();
    });
  });

  it("calls ai.rerun → aiStartRun with original prompt when retry clicked", async () => {
    const startRun = vi.fn(async () => "new-run-id");
    window.openmind = { ...window.openmind, aiStartRun: startRun } as unknown as DesktopApi;
    const event = makeEvent("err6", "error", { text: "fail" });
    render(
      <AiProvider initial={snapshot}>
        <ErrorEvent event={event} />
      </AiProvider>
    );
    const retryBtn = screen.getByText("按原上下文重试");
    fireEvent.click(retryBtn);
    // rerun(runId) → send(run.prompt) → aiStartRun({ prompt })
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1));
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "original prompt"
    }));
  });

  it("disables retry button while busy", async () => {
    // 让 aiStartRun 挂起,模拟进行中
    let resolveStart!: (value: string) => void;
    const startRun = vi.fn(() => new Promise<string>((resolve) => { resolveStart = resolve; }));
    window.openmind = { ...window.openmind, aiStartRun: startRun } as unknown as DesktopApi;
    const event = makeEvent("err6b", "error", { text: "fail" });
    render(
      <AiProvider initial={snapshot}>
        <ErrorEvent event={event} />
      </AiProvider>
    );
    const retryBtn = screen.getByText("按原上下文重试");
    fireEvent.click(retryBtn);
    // busy 期间按钮应 disabled
    await waitFor(() => expect(retryBtn).toHaveProperty("disabled", true));
    resolveStart("new-run-id");
    await waitFor(() => expect(retryBtn).toHaveProperty("disabled", false));
  });

  it("recovers gracefully when rerun throws (catch branch)", async () => {
    // rerun 内部调 send → aiStartRun; 让它 reject,走 retry 的 catch
    const startRun = vi.fn(async () => { throw new Error("provider down"); });
    window.openmind = { ...window.openmind, aiStartRun: startRun } as unknown as DesktopApi;
    const event = makeEvent("err6c", "error", { text: "fail" });
    render(
      <AiProvider initial={snapshot}>
        <ErrorEvent event={event} />
      </AiProvider>
    );
    const retryBtn = screen.getByText("按原上下文重试");
    fireEvent.click(retryBtn);
    // catch 后 finally 会 setBusy(false),按钮恢复可点
    await waitFor(() => expect(retryBtn).toHaveProperty("disabled", false));
    // startRun 确实被调了(说明 rerun 真的执行了)
    expect(startRun).toHaveBeenCalled();
  });

  it("opens run record path when button clicked", () => {
    const openPath = vi.fn();
    window.openmind = { ...window.openmind, openPath } as unknown as DesktopApi;
    const event = makeEvent("err7", "error", { text: "fail" });
    render(
      <AiProvider initial={snapshot}>
        <ErrorEvent event={event} />
      </AiProvider>
    );
    const openBtn = screen.getByText("打开运行记录");
    fireEvent.click(openBtn);
    expect(openPath).toHaveBeenCalled();
    const calledPath = openPath.mock.calls[0][0] as string;
    expect(calledPath).toContain("runs");
    expect(calledPath).toContain("run");
  });

  it("uses backslash separator when projectRoot has backslash", () => {
    const openPath = vi.fn();
    window.openmind = { ...window.openmind, openPath } as unknown as DesktopApi;
    const backslashSnapshot = { ...snapshot, projectRoot: "C:\\project" };
    const event = makeEvent("err8", "error", { text: "fail" });
    render(
      <AiProvider initial={backslashSnapshot}>
        <ErrorEvent event={event} />
      </AiProvider>
    );
    fireEvent.click(screen.getByText("打开运行记录"));
    const calledPath = openPath.mock.calls[0][0] as string;
    expect(calledPath).toContain("\\");
  });
});

describe("TechnicalEventGroup", () => {
  it("renders technical events group with count", () => {
    const events = [
      makeEvent("sys1", "system", { text: "system event 1" }),
      makeEvent("stat1", "status", { state: "running" })
    ];
    render(<TechnicalEventGroup events={events} />);
    expect(screen.getByText("运行详情")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("is collapsible and shows events when expanded", async () => {
    const events = [
      makeEvent("sys2", "system", { text: "started up" }),
      makeEvent("stat2", "status", { state: "completed" })
    ];
    render(<TechnicalEventGroup events={events} />);
    // Should be collapsible (has a trigger button)
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    expect(screen.getByText("started up")).toBeTruthy();
    expect(screen.getByText("运行完成")).toBeTruthy();
  });

  it("shows system and status labels for each event", async () => {
    const events = [
      makeEvent("sys3", "system", { text: "init" }),
      makeEvent("stat3", "status", { state: "running" })
    ];
    const { container } = render(<TechnicalEventGroup events={events} />);
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    expect(screen.getByText("系统")).toBeTruthy();
    expect(screen.getByText("状态")).toBeTruthy();
  });
});

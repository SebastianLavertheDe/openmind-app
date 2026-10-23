import { useFeedback, useFeedbackState } from "./feedback-context";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { memo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiEvent, AiSnapshot, DesktopApi, SkillDefinition } from "@shared/contracts";
import { messages as m, setLocale } from "@shared/messages";
import { AiProvider, useAi, useAiDraft, useAiStreaming, type AiController } from "./ai-context";
import { useTopicFileEditor } from "./features/creative/use-topic-file-editor";

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
  runs: [],
  pendingApprovals: []
};

const skills: SkillDefinition[] = [];

let aiListener: ((event: unknown) => void) | null;
let refreshVisibleSkills: (() => Promise<SkillDefinition[] | null>) | null;
let openBlankDraft: (() => Promise<void>) | null;

function StreamingText({ runId }: { runId: string }) {
  const state = useAiStreaming(runId);
  return (
    <>
      <div data-testid="streaming">{state.streaming}</div>
      <div data-testid="reasoning">{state.reasoningStreaming}</div>
    </>
  );
}

function DurableAssistantTexts() {
  const ai = useAi();
  const texts = ai.events
    .filter((event) => event.kind === "assistant-message")
    .map((event) => String(event.payload.text || ""));
  return <output data-testid="durable-assistant-texts">{JSON.stringify(texts)}</output>;
}

function VisibleSkillIds() {
  const ai = useAi();
  refreshVisibleSkills = ai.refreshSkills;
  openBlankDraft = () => ai.setActiveSession(null);
  return <output data-testid="visible-skill-ids">{ai.skills.map((skill) => skill.id).join(",")}</output>;
}

function DraftContextState() {
  const ai = useAi();
  const { draft } = useAiDraft();
  return <output data-testid="draft-context-state">{JSON.stringify({
    draft,
    contexts: ai.pendingContexts.map((context) => context.path)
  })}</output>;
}

const activeSnapshot: AiSnapshot = {
  ...snapshot,
  sessions: [{
    schemaVersion: 1,
    id: "session-1",
    projectId: "project",
    scope: { type: "workspace" },
    projectRoot: "/project",
    provider: "codex",
    providerId: "codex-native",
    providerSessionId: null,
    cwd: "/project",
    title: "Streaming",
    permissionProfile: "edit",
    status: "running",
    pinned: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastRunId: "run-sequence"
  }],
  runs: [{
    schemaVersion: 1,
    id: "run-sequence",
    sessionId: "session-1",
    projectId: "project",
    scope: { type: "workspace" },
    provider: "codex",
    providerId: "codex-native",
    permissionProfile: "edit",
    status: "running",
    prompt: "test",
    contexts: [],
    turnContext: null,
    workspacePath: null,
    baseCommit: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    error: null,
    changeSet: null,
    risks: []
  }]
};

function assistantEvent(id: string, seq: number, text: string, phase: string): AiEvent {
  return {
    schemaVersion: 1,
    id,
    seq,
    timestamp: `2026-01-01T00:00:0${seq}.000Z`,
    projectId: "project",
    sessionId: "session-1",
    runId: "run-sequence",
    provider: "codex",
    kind: "assistant-message",
    payload: { text, phase },
    risks: []
  };
}

beforeEach(() => {
  aiListener = null;
  refreshVisibleSkills = null;
  openBlankDraft = null;
  vi.useFakeTimers();
  window.openmind = {
    aiRefresh: async () => snapshot,
    aiGetEvents: async () => [],
    aiCancelRun: async () => true,
    aiResolveApproval: async () => true,
    runSkill: vi.fn(async () => true),
    selectFiles: async () => [],
    selectOpenmindFiles: async () => [],
    searchOpenmindFiles: async () => ({ items: [], indexedCount: 0, truncated: false }),
    openPath: vi.fn(async (p: string) => p),
    revealPath: async () => true,
    onAiEvent: (callback: Parameters<DesktopApi["onAiEvent"]>[0]) => {
      aiListener = callback as (event: unknown) => void;
      return () => { aiListener = null; };
    }
  } as unknown as DesktopApi;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  setLocale("zh-CN");
  window.localStorage.clear();
});

/** Emit an AI event through the registered onAiEvent callback. */
function emit(message: unknown): void {
  act(() => {
    aiListener?.(message);
  });
}

describe("AiProvider confirmation lifecycle", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => <AiProvider initial={snapshot}>{children}</AiProvider>;

  it("cancels the replaced confirmation and settles the current one independently", async () => {
    const { result } = renderHook(() => ({ ...useFeedback(), ...useFeedbackState() }), { wrapper });
    const first = vi.fn();
    const second = vi.fn();
    await act(async () => {
      void result.current.confirm({ title: "first" }).then(first);
      void result.current.confirm({ title: "second" }).then(second);
    });
    expect(first).toHaveBeenCalledExactlyOnceWith(false);
    expect(second).not.toHaveBeenCalled();
    expect(result.current.confirmState?.title).toBe("second");
    await act(async () => result.current.resolveConfirm(true));
    expect(second).toHaveBeenCalledExactlyOnceWith(true);
    expect(result.current.confirmState).toBeNull();
  });

  it("cancels a pending confirmation when the provider unmounts", async () => {
    const { result, unmount } = renderHook(() => ({ ...useFeedback(), ...useFeedbackState() }), { wrapper });
    const settled = vi.fn();
    act(() => { void result.current.confirm({ title: "pending" }).then(settled); });
    await act(async () => unmount());
    expect(settled).toHaveBeenCalledExactlyOnceWith(false);
  });
});

function flushTimers(): void {
  // The event pump batches via requestAnimationFrame + setTimeout(STREAM_PUMP_INTERVAL_MS).
  // Advance well past both.
  act(() => {
    vi.advanceTimersByTime(1000);
  });
}

describe("AiProvider streaming store via event pump", () => {
  it("preserves queued streaming, reasoning and final messages across interface language changes", () => {
    const subscribe = vi.spyOn(window.openmind, "onAiEvent");
    render(
      <AiProvider initial={activeSnapshot} skills={skills}>
        <StreamingText runId="run-sequence" />
        <DurableAssistantTexts />
      </AiProvider>
    );

    emit({ kind: "transient", event: { kind: "assistant-delta", runId: "run-sequence", payload: { text: "Hello" } } });
    emit({ kind: "transient", event: { kind: "reasoning-delta", runId: "run-sequence", payload: { text: "Thinking" } } });
    act(() => setLocale("en"));
    expect(subscribe).toHaveBeenCalledTimes(1);
    flushTimers();
    expect(screen.getByTestId("streaming").textContent).toBe("Hello");
    expect(screen.getByTestId("reasoning").textContent).toBe("Thinking");

    emit({ kind: "transient", event: { kind: "assistant-delta", runId: "run-sequence", payload: { text: " world" } } });
    emit({ kind: "event", event: assistantEvent("final-locale", 1, "Hello world", "final") });
    act(() => setLocale("zh-CN"));
    expect(subscribe).toHaveBeenCalledTimes(1);
    flushTimers();
    expect(screen.getByTestId("streaming").textContent).toBe("");
    expect(JSON.parse(screen.getByTestId("durable-assistant-texts").textContent || "[]")).toEqual(["Hello world"]);
  });

  it("keeps the main controller stable while draft subscribers update and persistence is debounced", () => {
    let controller: AiController | null = null;
    let setDraft: ((value: string) => void) | null = null;
    let controllerRenders = 0;
    let draftRenders = 0;
    const storageWrites = vi.spyOn(Storage.prototype, "setItem");
    const ControllerProbe = memo(function ControllerProbe() {
      controller = useAi();
      controllerRenders++;
      return null;
    });
    const DraftProbe = memo(function DraftProbe() {
      const state = useAiDraft();
      setDraft = state.setDraft;
      draftRenders++;
      return <output data-testid="isolated-draft">{state.draft}</output>;
    });
    const tree = () => (
      <AiProvider initial={snapshot} skills={skills} storageScope="render-isolation">
        <ControllerProbe />
        <DraftProbe />
      </AiProvider>
    );
    const view = render(tree());
    const initialController = controller;
    expect(controllerRenders).toBe(1);
    expect(draftRenders).toBe(1);

    view.rerender(tree());
    expect(controllerRenders).toBe(1);

    act(() => {
      setDraft?.("a");
      setDraft?.("ab");
    });
    expect(screen.getByTestId("isolated-draft").textContent).toBe("ab");
    expect(controller).toBe(initialController);
    expect(controllerRenders).toBe(1);
    expect(draftRenders).toBe(2);

    const draftWrites = () => storageWrites.mock.calls.filter(([key]) => key === "openmind.ai.drafts.v1:render-isolation");
    expect(draftWrites()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(119));
    expect(draftWrites()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(draftWrites()).toHaveLength(1);
    expect(draftWrites()[0][1]).toContain('"__new-session__":"ab"');

    act(() => setDraft?.("flush-on-unmount"));
    view.unmount();
    expect(draftWrites()).toHaveLength(2);
    expect(draftWrites()[1][1]).toContain("flush-on-unmount");
  });

  it("isolates blank drafts and file contexts by openmind/workspace scope", () => {
    const draftKey = "__new-session__";
    window.localStorage.setItem("openmind.ai.drafts.v1:scope-a", JSON.stringify({ [draftKey]: "draft from A" }));
    window.localStorage.setItem("openmind.ai.contexts.v1:scope-a", JSON.stringify({
      [draftKey]: [{ id: "a-file", kind: "file", label: "A", path: "workspace-a/file.md" }]
    }));
    window.localStorage.setItem("openmind.ai.drafts.v1:scope-b", JSON.stringify({ [draftKey]: "draft from B" }));
    window.localStorage.setItem("openmind.ai.contexts.v1:scope-b", JSON.stringify({
      [draftKey]: [{ id: "b-file", kind: "file", label: "B", path: "workspace-b/file.md" }]
    }));

    const first = render(<AiProvider initial={snapshot} storageScope="scope-a"><DraftContextState /></AiProvider>);
    expect(screen.getByTestId("draft-context-state").textContent).toBe(JSON.stringify({
      draft: "draft from A",
      contexts: ["workspace-a/file.md"]
    }));
    first.unmount();

    render(<AiProvider initial={snapshot} storageScope="scope-b"><DraftContextState /></AiProvider>);
    expect(screen.getByTestId("draft-context-state").textContent).toBe(JSON.stringify({
      draft: "draft from B",
      contexts: ["workspace-b/file.md"]
    }));
  });

  it("moves the legacy global draft into only the first active scope", () => {
    const draftKey = "__new-session__";
    window.localStorage.setItem("openmind.ai.drafts.v1", JSON.stringify({ [draftKey]: "legacy draft" }));
    window.localStorage.setItem("openmind.ai.contexts.v1", JSON.stringify({
      [draftKey]: [{ id: "legacy-file", kind: "file", label: "Legacy", path: "legacy/file.md" }]
    }));

    const first = render(<AiProvider initial={snapshot} storageScope="scope-a"><DraftContextState /></AiProvider>);
    expect(screen.getByTestId("draft-context-state").textContent).toBe(JSON.stringify({
      draft: "legacy draft",
      contexts: ["legacy/file.md"]
    }));
    expect(window.localStorage.getItem("openmind.ai.drafts.v1")).toBeNull();
    expect(window.localStorage.getItem("openmind.ai.contexts.v1")).toBeNull();
    expect(window.localStorage.getItem("openmind.ai.drafts.v1:scope-a")).toContain("legacy draft");
    first.unmount();

    render(<AiProvider initial={snapshot} storageScope="scope-b"><DraftContextState /></AiProvider>);
    expect(screen.getByTestId("draft-context-state").textContent).toBe(JSON.stringify({ draft: "", contexts: [] }));
  });

  it("cleans a legacy slot left behind after a scoped migration crash", () => {
    const draftKey = "__new-session__";
    window.localStorage.setItem("openmind.ai.drafts.v1:scope-a", JSON.stringify({ [draftKey]: "safe A" }));
    window.localStorage.setItem("openmind.ai.contexts.v1:scope-a", JSON.stringify({
      [draftKey]: [{ id: "safe-a-file", kind: "file", label: "Safe A", path: "safe-a/file.md" }]
    }));
    window.localStorage.setItem("openmind.ai.drafts.v1", JSON.stringify({ [draftKey]: "stale global" }));
    window.localStorage.setItem("openmind.ai.contexts.v1", JSON.stringify({
      [draftKey]: [{ id: "stale-file", kind: "file", label: "Stale", path: "stale/file.md" }]
    }));

    const first = render(<AiProvider initial={snapshot} storageScope="scope-a"><DraftContextState /></AiProvider>);
    expect(screen.getByTestId("draft-context-state").textContent).toBe(JSON.stringify({
      draft: "safe A",
      contexts: ["safe-a/file.md"]
    }));
    expect(window.localStorage.getItem("openmind.ai.drafts.v1")).toBeNull();
    expect(window.localStorage.getItem("openmind.ai.contexts.v1")).toBeNull();
    first.unmount();

    render(<AiProvider initial={snapshot} storageScope="scope-b"><DraftContextState /></AiProvider>);
    expect(screen.getByTestId("draft-context-state").textContent).toBe(JSON.stringify({ draft: "", contexts: [] }));
  });

  it("keeps an existing conversation frozen while a blank draft follows refreshed defaults", async () => {
    const frozenSkill: SkillDefinition = {
      id: "frozen-skill",
      title: "Frozen",
      description: "Frozen with the session",
      cwd: "installed/local/frozen-skill/1.0.0",
      command: "managed-runtime"
    };
    const currentDefault: SkillDefinition = {
      id: "current-default",
      title: "Current",
      description: "Only for a new conversation",
      cwd: "installed/local/current-default/1.0.0",
      command: "managed-runtime"
    };
    const frozenSnapshot: AiSnapshot = {
      ...activeSnapshot,
      sessions: activeSnapshot.sessions.map((session) => ({
        ...session,
        skillSnapshot: [{
          definition: frozenSkill,
          installed: { key: "local/frozen-skill", version: "1.0.0", digest: "a".repeat(64) }
        }]
      }))
    };
    window.openmind = {
      ...window.openmind,
      aiRefreshSkills: async () => [currentDefault]
    } as unknown as DesktopApi;

    render(
      <AiProvider initial={frozenSnapshot} skills={[currentDefault]}>
        <VisibleSkillIds />
      </AiProvider>
    );

    expect(screen.getByTestId("visible-skill-ids").textContent).toBe("frozen-skill");

    await act(async () => { await refreshVisibleSkills?.(); });
    expect(screen.getByTestId("visible-skill-ids").textContent).toBe("frozen-skill");

    await act(async () => { await openBlankDraft?.(); });
    expect(screen.getByTestId("visible-skill-ids").textContent).toBe("current-default");
  });

  it("accumulates assistant-delta transient chunks into the streaming text", () => {
    render(
      <AiProvider initial={snapshot} skills={skills}>
        <StreamingText runId="run-1" />
      </AiProvider>
    );
    expect(screen.getByTestId("streaming").textContent).toBe("");

    emit({ kind: "transient", event: { kind: "assistant-delta", runId: "run-1", payload: { text: "Hello " } } });
    emit({ kind: "transient", event: { kind: "assistant-delta", runId: "run-1", payload: { text: "world" } } });
    flushTimers();

    expect(screen.getByTestId("streaming").textContent).toBe("Hello world");
  });

  it("does not rerender main-context consumers for transient stream batches", () => {
    let controllerRenders = 0;
    const ControllerProbe = memo(function ControllerProbe() {
      useAi();
      controllerRenders++;
      return null;
    });
    render(
      <AiProvider initial={snapshot} skills={skills}>
        <ControllerProbe />
        <StreamingText runId="run-isolated" />
      </AiProvider>
    );

    emit({ kind: "transient", event: { kind: "assistant-delta", runId: "run-isolated", payload: { text: "one" } } });
    emit({ kind: "transient", event: { kind: "assistant-delta", runId: "run-isolated", payload: { text: " two" } } });
    flushTimers();

    expect(screen.getByTestId("streaming").textContent).toBe("one two");
    expect(controllerRenders).toBe(1);
  });

  it("keeps the topic editor isolated from AI events/snapshots and preserves action references while typing", async () => {
    let renders = 0;
    let editor!: ReturnType<typeof useTopicFileEditor>;
    const Probe = memo(function Probe() {
      editor = useTopicFileEditor();
      renders++;
      return null;
    });
    window.openmind.readContent = vi.fn(async (filePath) => ({ path: filePath, name: "topic.md", content: "original", truncated: false }));
    render(<AiProvider initial={activeSnapshot} skills={skills}><Probe /></AiProvider>);
    await act(async () => {});
    const initialRenders = renders;
    emit({ kind: "event", event: assistantEvent("isolated-editor", 1, "AI update", "commentary") });
    flushTimers();
    emit({ kind: "snapshot", snapshot: { ...activeSnapshot, projectRoot: "/updated" } });
    flushTimers();
    expect(renders).toBe(initialRenders);

    await act(async () => { await editor.openTopicFile("openmind/topic.md"); });
    const beforeTyping = { ...editor };
    act(() => editor.setTopicFileDraft("edited"));
    expect(editor.topicFileDraft).toBe("edited");
    expect(editor.topicFileDirty).toBe(true);
    expect(editor.openTopicFile).toBe(beforeTyping.openTopicFile);
    expect(editor.resetTopicFile).toBe(beforeTyping.resetTopicFile);
    expect(editor.setTopicFileDraft).toBe(beforeTyping.setTopicFileDraft);
  });

  it("keeps reasoning-delta chunks separate from streaming text", () => {
    render(
      <AiProvider initial={snapshot} skills={skills}>
        <StreamingText runId="run-2" />
      </AiProvider>
    );

    emit({ kind: "transient", event: { kind: "assistant-delta", runId: "run-2", payload: { text: "answer" } } });
    emit({ kind: "transient", event: { kind: "reasoning-delta", runId: "run-2", payload: { text: "thinking" } } });
    flushTimers();

    expect(screen.getByTestId("streaming").textContent).toBe("answer");
    expect(screen.getByTestId("reasoning").textContent).toBe("thinking");
  });

  it("clears the run's streaming state when a status:failed event arrives", () => {
    render(
      <AiProvider initial={snapshot} skills={skills}>
        <StreamingText runId="run-3" />
      </AiProvider>
    );

    emit({ kind: "transient", event: { kind: "assistant-delta", runId: "run-3", payload: { text: "partial" } } });
    flushTimers();
    expect(screen.getByTestId("streaming").textContent).toBe("partial");

    emit({ kind: "event", event: { kind: "status", runId: "run-3", payload: { state: "failed" } } });
    flushTimers();
    expect(screen.getByTestId("streaming").textContent).toBe("");
  });

  it("clears all streaming state on a worker-exit message", () => {
    render(
      <AiProvider initial={snapshot} skills={skills}>
        <StreamingText runId="run-4" />
      </AiProvider>
    );

    emit({ kind: "transient", event: { kind: "assistant-delta", runId: "run-4", payload: { text: "abc" } } });
    flushTimers();
    expect(screen.getByTestId("streaming").textContent).toBe("abc");

    emit({ kind: "worker-exit", code: 1 });
    flushTimers();
    expect(screen.getByTestId("streaming").textContent).toBe("");
  });

  it("isolates streaming state across different runs", () => {
    render(
      <AiProvider initial={snapshot} skills={skills}>
        <StreamingText runId="run-A" />
        <StreamingText runId="run-B" />
      </AiProvider>
    );

    emit({ kind: "transient", event: { kind: "assistant-delta", runId: "run-A", payload: { text: "A" } } });
    emit({ kind: "transient", event: { kind: "assistant-delta", runId: "run-B", payload: { text: "B" } } });
    flushTimers();

    const blocks = screen.getAllByTestId("streaming");
    // first StreamingText is run-A, second is run-B (render order)
    expect(blocks[0].textContent).toBe("A");
    expect(blocks[1].textContent).toBe("B");
  });

  it("preserves every durable assistant message while transient deltas drain", () => {
    render(
      <AiProvider initial={activeSnapshot} skills={skills}>
        <StreamingText runId="run-sequence" />
        <DurableAssistantTexts />
      </AiProvider>
    );

    emit({ kind: "transient", event: { kind: "assistant-delta", runId: "run-sequence", payload: { text: "checking" } } });
    emit({ kind: "event", event: assistantEvent("commentary-1", 1, "Checking files.", "commentary") });
    emit({ kind: "transient", event: { kind: "assistant-delta", runId: "run-sequence", payload: { text: "continuing" } } });
    emit({ kind: "event", event: assistantEvent("commentary-2", 2, "Continuing after the tool.", "commentary") });
    emit({ kind: "event", event: assistantEvent("final", 3, "Done.", "final") });
    flushTimers();

    expect(screen.getByTestId("streaming").textContent).toBe("");
    expect(JSON.parse(screen.getByTestId("durable-assistant-texts").textContent || "[]")).toEqual([
      "Checking files.",
      "Continuing after the tool.",
      "Done."
    ]);
  });

  it("replaces snapshot when a snapshot message arrives", async () => {
    window.openmind = {
      ...window.openmind,
      aiRefresh: async () => snapshot
    } as unknown as DesktopApi;

    render(
      <AiProvider initial={snapshot} skills={skills}>
        <StreamingText runId="run-5" />
      </AiProvider>
    );

    const newSnapshot = { ...snapshot, projectRoot: "/elsewhere" };
    emit({ kind: "snapshot", snapshot: newSnapshot });
    // snapshot replacement does not throw; streaming stays empty
    expect(screen.getByTestId("streaming").textContent).toBe("");
  });
});

describe("AiProvider document rewrite runs", () => {
  it("starts an independent run and preserves the user's conversation draft and attachments", async () => {
    const session = { ...activeSnapshot.sessions[0], id: "rewrite-session" };
    const run = { ...activeSnapshot.runs[0], id: "rewrite-run", sessionId: session.id };
    const start = vi.fn(async () => ({ session, run }));
    window.openmind = { ...window.openmind, aiStartRun: start };
    const { result } = renderHook(() => ({ ai: useAi(), draft: useAiDraft() }), {
      wrapper: ({ children }) => <AiProvider initial={activeSnapshot} skills={skills}>{children}</AiProvider>
    });
    await act(async () => { await result.current.ai.setActiveSession(null); });
    act(() => {
      result.current.draft.setDraft("尚未发送的聊天草稿");
      result.current.ai.addContext({ id: "draft-file", kind: "file", label: "资料", path: "materials/example.md" });
    });
    await act(async () => { await result.current.ai.setActiveSession("session-1"); });
    await act(async () => {
      const started = await result.current.ai.send("改写选中文字", { sessionId: null, contexts: [], preserveDraft: true, permissionProfile: "read-only" });
      expect(started.id).toBe("rewrite-run");
    });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ sessionId: undefined, contexts: [], permissionProfile: "read-only" }));
    await act(async () => { await result.current.ai.setActiveSession(null); });
    expect(result.current.draft.draft).toBe("尚未发送的聊天草稿");
    expect(result.current.ai.pendingContexts.map(context => context.id)).toEqual(["draft-file"]);
  });
});

describe("AiProvider provider-change confirmation on send", () => {
  let controller: AiController | null;
  let sendResult: Promise<string> | null;
  const startCalls: Array<Record<string, unknown>> = [];

  function SendTrigger() {
    const ai = useAi();
    controller = ai;
    return (
      <button
        type="button"
        onClick={() => {
          sendResult = ai.send("继续", { sessionId: "session-1", providerId: "codex-native" }).then(
            () => "ok",
            (cause: unknown) => `failed:${cause instanceof Error ? cause.message : String(cause)}`
          );
        }}
      >send</button>
    );
  }

  beforeEach(() => {
    controller = null;
    sendResult = null;
    startCalls.length = 0;
    vi.useFakeTimers();
    window.openmind = {
      aiRefresh: async () => activeSnapshot,
      aiGetEvents: async () => [],
      aiStartRun: vi.fn(async (input: Record<string, unknown>) => {
        startCalls.push(input);
        if (!input.acknowledgeProviderChange) {
          throw new Error(`Error invoking remote method 'ai:start': Error: OPENMIND_PROVIDER_CHANGE_PENDING:${JSON.stringify({
            kind: "codex",
            id: "glm",
            message: "codex 会话绑定的 Provider 配置已变更：glm。为避免把旧会话发送到不同服务，请新建会话。"
          })}`);
        }
        return { session: activeSnapshot.sessions[0], run: activeSnapshot.runs[0] };
      }),
      aiCancelRun: async () => true,
      aiResolveApproval: async () => true,
      selectFiles: async () => [],
      onAiEvent: () => () => undefined
    } as unknown as DesktopApi;
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    window.localStorage.clear();
  });

  it("opens the confirm dialog and retries with the acknowledged rebind after consent", async () => {
    render(
      <AiProvider initial={activeSnapshot} skills={skills}>
        <SendTrigger />
      </AiProvider>
    );

    await act(async () => {
      screen.getByRole("button").click();
    });
    expect(controller?.confirmState?.title).toBe(m.ai.providerChange.title);

    await act(async () => {
      controller?.resolveConfirm(true);
      await sendResult;
    });

    expect(sendResult && await sendResult).toBe("ok");
    expect(startCalls).toHaveLength(2);
    expect(startCalls[1]).toMatchObject({
      sessionId: "session-1",
      providerId: "codex-native",
      prompt: "继续",
      acknowledgeProviderChange: true
    });
    expect(controller?.confirmState).toBeNull();
  });

  it("surfaces the plain backend error without the marker when the user declines", async () => {
    render(
      <AiProvider initial={activeSnapshot} skills={skills}>
        <SendTrigger />
      </AiProvider>
    );

    await act(async () => {
      screen.getByRole("button").click();
    });
    await act(async () => {
      controller?.resolveConfirm(false);
      await sendResult;
    });

    const outcome = sendResult ? await sendResult : "";
    expect(outcome).toContain("codex 会话绑定的 Provider 配置已变更：glm");
    expect(outcome).not.toContain("OPENMIND_PROVIDER_CHANGE_PENDING");
    expect(startCalls).toHaveLength(1);
  });
});

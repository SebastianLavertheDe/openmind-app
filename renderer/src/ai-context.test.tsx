import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiEvent, AiSnapshot, DesktopApi, SkillDefinition } from "@shared/contracts";
import { AiProvider, useAi, useAiStreaming } from "./ai-context";

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

const activeSnapshot: AiSnapshot = {
  ...snapshot,
  sessions: [{
    schemaVersion: 1,
    id: "session-1",
    projectId: "project",
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
  vi.useFakeTimers();
  window.cctools = {
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
    onAiEvent: (callback: Parameters<DesktopApi["onAiEvent"]>[0]) => {
      aiListener = callback as (event: unknown) => void;
      return () => { aiListener = null; };
    }
  } as unknown as DesktopApi;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.localStorage.clear();
});

/** Emit an AI event through the registered onAiEvent callback. */
function emit(message: unknown): void {
  act(() => {
    aiListener?.(message);
  });
}

function flushTimers(): void {
  // The event pump batches via requestAnimationFrame + setTimeout(STREAM_PUMP_INTERVAL_MS).
  // Advance well past both.
  act(() => {
    vi.advanceTimersByTime(1000);
  });
}

describe("AiProvider streaming store via event pump", () => {
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
    let refreshed = false;
    window.cctools = {
      ...window.cctools,
      aiRefresh: async () => { refreshed = true; return snapshot; }
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

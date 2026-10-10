import { describe, expect, it } from "vitest";
import type {
  AiEvent,
  AiRolloutResponseItem,
  AiRun,
  AiSession
} from "../../shared/contracts";
import {
  makeRolloutLine,
  paginateTurns,
  reconstructRollout,
  rollbackItem,
  rolloutItemsForEvent,
  sessionMetaItem,
  turnCompleteItem,
  turnStartedItem
} from "./rollout";

describe("Codex-aligned rollout reconstruction", () => {
  it("keeps saved image references in recovered history even without a final tool result", () => {
    const run = makeRun("image-turn", "2026-10-10T00:00:00.000Z");
    const image = { source: "openmind/assets/generated-images/session/image.png", title: "leaf" };
    const event = makeEvent(run, "image", "image-artifact", { image, itemId: "call" }, 1);
    const items = rolloutItemsForEvent(event);
    expect(items[0]).toMatchObject({ type: "response_item", payload: { name: "openmind_generate_image", content: expect.stringContaining(image.source) } });
    expect(items[1]).toMatchObject({ type: "event_msg", payload: { event: { kind: "image-artifact", payload: { image } } } });
  });
  it("persists the managed provider id and revision without persisting its API key", () => {
    const session = {
      ...makeSession(),
      serviceProviderId: "managed-codex",
      serviceProviderRevision: "a".repeat(64)
    };

    const item = sessionMetaItem(session);

    expect(item.payload).toMatchObject({
      serviceProviderId: "managed-codex",
      serviceProviderRevision: "a".repeat(64)
    });
    expect(JSON.stringify(item)).not.toContain("apiKey");
  });

  it("rebuilds complete turns and model-visible context from canonical items", () => {
    const session = makeSession();
    const run = makeRun("turn-1", "2026-07-01T00:00:00.000Z");
    const user = makeEvent(run, "user", "user-message", { text: "hello" }, 1);
    const assistant = makeEvent(run, "assistant", "assistant-message", { text: "hi" }, 2);
    const lines = [
      makeRolloutLine(sessionMetaItem(session), session.createdAt),
      makeRolloutLine(turnStartedItem(run), run.startedAt),
      ...rolloutItemsForEvent(user).map((item) => makeRolloutLine(item, user.timestamp)),
      makeRolloutLine({
        type: "turn_context",
        payload: makeTurnContext(run.id)
      }, "2026-07-01T00:00:00.100Z"),
      makeRolloutLine({
        type: "world_state",
        payload: { turnId: run.id, full: true, state: { contexts: ["a.md"] } }
      }, "2026-07-01T00:00:00.200Z"),
      ...rolloutItemsForEvent(assistant).map((item) => makeRolloutLine(item, assistant.timestamp)),
      makeRolloutLine(turnCompleteItem({ ...run, status: "completed", completedAt: "2026-07-01T00:00:02.000Z" }))
    ];

    const result = reconstructRollout(session.id, lines);

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toMatchObject({
      id: run.id,
      status: "completed",
      context: { currentDate: "2026-07-01", timezone: "Asia/Shanghai" }
    });
    expect(result.turns[0].events.map((event) => event.kind)).toEqual(["user-message", "assistant-message"]);
    expect(result.context.history.map((item) => [item.kind, item.role, item.content])).toEqual([
      ["message", "user", "hello"],
      ["message", "assistant", "hi"]
    ]);
    expect(result.context.referenceContext?.turnId).toBe(run.id);
    expect(result.context.worldState).toEqual({ contexts: ["a.md"] });
    expect(result.context.estimatedTokens).toBeGreaterThan(0);
  });

  it("uses compaction as a replacement-history checkpoint", () => {
    const run1 = makeRun("turn-1", "2026-07-01T00:00:00.000Z");
    const run2 = makeRun("turn-2", "2026-07-01T01:00:00.000Z");
    const compacted: AiRolloutResponseItem = {
      id: "summary",
      turnId: run1.id,
      kind: "message",
      role: "assistant",
      name: null,
      callId: null,
      content: "compact summary",
      payload: {}
    };
    const lines = [
      makeRolloutLine(turnStartedItem(run1), run1.startedAt),
      ...rolloutItemsForEvent(makeEvent(run1, "u1", "user-message", { text: "old" }, 1)).map((item) => makeRolloutLine(item)),
      makeRolloutLine({
        type: "compacted",
        payload: {
          turnId: run1.id,
          message: "compact summary",
          replacementHistory: [compacted],
          windowNumber: 1,
          previousWindowId: null,
          windowId: "window-1"
        }
      }),
      makeRolloutLine(turnStartedItem(run2), run2.startedAt),
      ...rolloutItemsForEvent(makeEvent(run2, "u2", "user-message", { text: "new" }, 1)).map((item) => makeRolloutLine(item))
    ];

    const context = reconstructRollout("session", lines).context;

    expect(context.history.map((item) => item.content)).toEqual(["compact summary", "new"]);
    expect(context.historyVersion).toBe(1);
    expect(context.windowNumber).toBe(1);
    expect(context.windowId).toBe("window-1");
  });

  it("applies append-only rollback markers to turns and context history", () => {
    const run1 = makeRun("turn-1", "2026-07-01T00:00:00.000Z");
    const run2 = makeRun("turn-2", "2026-07-01T01:00:00.000Z");
    const lines = [
      ...turnWithMessage(run1, "first"),
      ...turnWithMessage(run2, "second"),
      makeRolloutLine(rollbackItem(1))
    ];

    const result = reconstructRollout("session", lines);

    expect(result.turns.map((turn) => turn.id)).toEqual(["turn-1"]);
    expect(result.context.history.map((item) => item.content)).toEqual(["first"]);
    expect(result.context.historyVersion).toBe(1);
  });

  it("normalizes tool call/output pairs and bounds persisted tool output for prompts", () => {
    const run = makeRun("turn-1", "2026-07-01T00:00:00.000Z");
    const call = makeEvent(run, "call", "tool-start", { itemId: "call-1", tool: "Read", input: {} }, 1);
    const orphan = makeEvent(run, "orphan", "tool-complete", { itemId: "missing", output: "ignore" }, 2);
    const longOutput = makeEvent(run, "output", "tool-complete", { itemId: "call-1", output: "x".repeat(120_000) }, 3);
    const missingCall = makeEvent(run, "call-2", "tool-start", { itemId: "call-2", tool: "Bash", input: {} }, 4);
    const lines = [
      makeRolloutLine(turnStartedItem(run)),
      ...[call, orphan, longOutput, missingCall].flatMap((event) =>
        rolloutItemsForEvent(event).map((item) => makeRolloutLine(item))
      )
    ];

    const history = reconstructRollout("session", lines).context.history;

    expect(history.some((item) => item.callId === "missing")).toBe(false);
    expect(history.find((item) => item.id === "output")?.content).toContain("chars truncated");
    expect(history.find((item) => item.id === "synthetic-output:call-2")?.content).toBe("aborted");
  });

  it("paginates complete turns with opaque cursors", () => {
    const runs = Array.from({ length: 5 }, (_, index) =>
      makeRun(`turn-${index + 1}`, `2026-07-01T0${index}:00:00.000Z`)
    );
    const reconstruction = reconstructRollout("session", runs.flatMap((run, index) => turnWithMessage(run, `m${index + 1}`)));

    const first = paginateTurns(reconstruction, { limit: 2, sortDirection: "desc" });
    const second = paginateTurns(reconstruction, { cursor: first.nextCursor, limit: 2, sortDirection: "desc" });
    const third = paginateTurns(reconstruction, { cursor: second.nextCursor, limit: 2, sortDirection: "desc" });

    expect(first.data.map((turn) => turn.id)).toEqual(["turn-5", "turn-4"]);
    expect(second.data.map((turn) => turn.id)).toEqual(["turn-3", "turn-2"]);
    expect(third.data.map((turn) => turn.id)).toEqual(["turn-1"]);
    expect(third.nextCursor).toBeNull();
  });
});

function turnWithMessage(run: AiRun, text: string) {
  const event = makeEvent(run, `${run.id}:user`, "user-message", { text }, 1);
  const completed = { ...run, status: "completed" as const, completedAt: event.timestamp };
  return [
    makeRolloutLine(turnStartedItem(run), run.startedAt),
    ...rolloutItemsForEvent(event).map((item) => makeRolloutLine(item, event.timestamp)),
    makeRolloutLine(turnCompleteItem(completed), event.timestamp)
  ];
}

function makeSession(): AiSession {
  return {
    schemaVersion: 1,
    id: "session",
    projectId: "project",
    projectRoot: "/project",
    title: "Session",
    provider: "codex",
    providerId: "codex-native",
    providerSessionId: null,
    cwd: "/project",
    permissionProfile: "edit",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    lastRunId: null
  };
}

function makeRun(id: string, startedAt: string): AiRun {
  return {
    schemaVersion: 1,
    id,
    sessionId: "session",
    projectId: "project",
    provider: "codex",
    providerId: "codex-native",
    permissionProfile: "edit",
    status: "running",
    prompt: id,
    contexts: [],
    turnContext: null,
    workspacePath: null,
    baseCommit: null,
    startedAt,
    completedAt: null,
    error: null,
    changeSet: null,
    risks: []
  };
}

function makeEvent(
  run: AiRun,
  id: string,
  kind: AiEvent["kind"],
  payload: Record<string, unknown>,
  seq: number
): AiEvent {
  return {
    schemaVersion: 1,
    id,
    seq,
    timestamp: new Date(new Date(run.startedAt).getTime() + seq * 1_000).toISOString(),
    projectId: run.projectId,
    sessionId: run.sessionId,
    runId: run.id,
    provider: run.provider,
    kind,
    payload,
    risks: []
  };
}

function makeTurnContext(turnId: string) {
  return {
    turnId,
    cwd: "/project",
    workspaceRoots: ["/project"],
    currentDate: "2026-07-01",
    timezone: "Asia/Shanghai",
    capturedAt: "2026-07-01T00:00:00.100Z",
    approvalPolicy: "on-request" as const,
    sandboxPolicy: "workspace-write" as const,
    permissionProfile: "edit" as const,
    provider: "codex" as const,
    providerId: "codex-native",
    model: "codex-native",
    contextHash: "hash"
  };
}

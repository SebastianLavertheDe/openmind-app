import { describe, expect, it } from "vitest";
import type { AiEvent, AiRun, AiSession, RiskFinding } from "../../shared/contracts";
import {
  makeRolloutLine,
  paginateTurns,
  reconstructRollout,
  rolloutItemsForEvent,
  turnCompleteItem,
  turnStartedItem,
  type RolloutReconstruction
} from "./rollout";
import { RolloutProjector } from "./rollout-projector";

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

function makeRun(id: string, startedAt = "2026-07-01T00:00:00.000Z"): AiRun {
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
  seq: number,
  risks: RiskFinding[] = []
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
    risks
  };
}

function buildReconstruction(runs: AiRun[], eventsPerRun: Map<AiRun, AiEvent[]>): RolloutReconstruction {
  const lines = [
    makeRolloutLine({ type: "session_meta", payload: { sessionId: "session", threadId: "session", forkedFromId: null, timestamp: makeSession().createdAt, cwd: "/project", originator: "openmind-desktop", appVersion: "1.0.17", provider: "codex", providerId: "codex-native", baseInstructions: "", dynamicTools: [], selectedCapabilityRoots: ["/project"], historyMode: "save-all" } }, "2026-07-01T00:00:00.000Z")
  ];
  for (const run of runs) {
    lines.push(makeRolloutLine(turnStartedItem(run), run.startedAt));
    const events = eventsPerRun.get(run) || [];
    for (const event of events) {
      lines.push(...rolloutItemsForEvent(event).map((item) => makeRolloutLine(item, event.timestamp)));
    }
    const completed = { ...run, status: "completed" as const, completedAt: run.startedAt };
    lines.push(makeRolloutLine(turnCompleteItem(completed), run.startedAt));
  }
  return reconstructRollout("session", lines);
}

describe("RolloutProjector", () => {
  describe("readEvents", () => {
    it("flattens turn events and drops provider-private deltas", () => {
      const run = makeRun("turn-1");
      const events = [
        makeEvent(run, "e1", "assistant-message", { text: "hi" }, 1),
        makeEvent(run, "e2", "system", { message: { subtype: "thinking_tokens" } }, 2) // dropped
      ];
      const reconstruction = buildReconstruction([run], new Map([[run, events]]));
      const projector = new RolloutProjector(() => reconstruction, () => run);
      const out = projector.readEvents("session");
      expect(out.map((e) => e.id)).toEqual(["e1"]);
    });
  });

  describe("listTurns", () => {
    it("delegates to paginateTurns", () => {
      const run = makeRun("turn-1");
      const events = [makeEvent(run, "e1", "user-message", { text: "hi" }, 1)];
      const reconstruction = buildReconstruction([run], new Map([[run, events]]));
      const projector = new RolloutProjector(() => reconstruction, () => run);
      const page = projector.listTurns("session", { limit: 10 });
      expect(page.data).toHaveLength(1);
      expect(page.total).toBe(1);
    });
  });

  describe("getContextState", () => {
    it("returns the reconstructed context state", () => {
      const run = makeRun("turn-1");
      const reconstruction = buildReconstruction([run], new Map([[run, []]]));
      const projector = new RolloutProjector(() => reconstruction, () => run);
      const ctx = projector.getContextState("session");
      expect(ctx.sessionId).toBe("session");
      expect(ctx.estimatedTokens).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getRisks", () => {
    it("dedupes risks by kind:summary, scoped to the requested run", () => {
      const run1 = makeRun("turn-1");
      const run2 = makeRun("turn-2");
      const r1: RiskFinding[] = [
        { id: "rk1", kind: "token", severity: "high", summary: "leak" },
        { id: "rk2", kind: "token", severity: "high", summary: "leak" }, // dup
        { id: "rk3", kind: "private-key", severity: "warning", summary: "pk" }
      ];
      const events1 = [makeEvent(run1, "e1", "user-message", { text: "a" }, 1, [r1[0], r1[1]])];
      const events1b = [makeEvent(run1, "e1b", "user-message", { text: "a2" }, 2, [r1[2]])];
      const events2 = [makeEvent(run2, "e2", "user-message", { text: "b" }, 1, [{ id: "rk4", kind: "cookie", severity: "warning", summary: "c" }])];
      const reconstruction = buildReconstruction([run1, run2], new Map([[run1, [...events1, ...events1b]], [run2, events2]]));
      const projector = new RolloutProjector(() => reconstruction, (id) => (id === run1.id ? run1 : run2));
      const out = projector.getRisks(run1.id);
      expect(out).toHaveLength(2);
      expect(out.map((r) => r.kind).sort()).toEqual(["private-key", "token"]);
    });
  });
});

import { describe, expect, it } from "vitest";
import type { AiEvent, AiRun } from "@shared/contracts";
import {
  activeRunForSession,
  formatDateInput,
  formatDuration,
  latestRunForSession,
  mergeEvents,
  selectRecentTurnEvents
} from "./ai-utils";

function event(id: string, timestamp: string, seq: number, runId = "run", kind: AiEvent["kind"] = "status"): AiEvent {
  return {
    schemaVersion: 1,
    id,
    seq,
    timestamp,
    projectId: "project",
    sessionId: "session",
    runId,
    provider: "codex",
    kind,
    payload: {},
    risks: []
  };
}

function run(id: string, sessionId: string, status: AiRun["status"], startedAt: string): AiRun {
  return {
    schemaVersion: 1,
    id,
    sessionId,
    projectId: "project",
    scope: { type: "workspace" },
    provider: "codex",
    providerId: "codex",
    permissionProfile: "edit",
    status,
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

describe("AI renderer state helpers", () => {
  it("deduplicates and orders events received during a history reload", () => {
    const merged = mergeEvents(
      [event("b", "2026-01-01T00:00:02.000Z", 2)],
      [event("a", "2026-01-01T00:00:01.000Z", 1), event("b", "2026-01-01T00:00:02.000Z", 2)]
    );
    expect(merged.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("keeps provider sequence order even when timestamps arrive out of order", () => {
    const merged = mergeEvents(
      [],
      [
        event("tool", "2026-01-01T00:00:01.000Z", 3),
        event("thought", "2026-01-01T00:00:03.000Z", 2),
        event("answer", "2026-01-01T00:00:02.000Z", 4)
      ]
    );
    expect(merged.map((item) => item.id)).toEqual(["thought", "tool", "answer"]);
  });

  it("orders complete runs chronologically when each run restarts sequence numbers", () => {
    const merged = mergeEvents([], [
      event("new-answer", "2026-01-01T01:00:02.000Z", 2, "new-run"),
      event("old-answer", "2026-01-01T00:00:02.000Z", 2, "old-run"),
      event("new-user", "2026-01-01T01:00:01.000Z", 1, "new-run", "user-message"),
      event("old-user", "2026-01-01T00:00:01.000Z", 1, "old-run", "user-message")
    ]);
    expect(merged.map((item) => item.id)).toEqual([
      "old-user",
      "old-answer",
      "new-user",
      "new-answer"
    ]);
  });

  it("replaces an optimistic event with its durable event identity", () => {
    const optimistic = event("optimistic", "2026-01-01T00:00:01.000Z", 1, "run", "user-message");
    const durable = event("durable", "2026-01-01T00:00:01.100Z", 1, "run", "user-message");

    const merged = mergeEvents([optimistic], [durable]);

    expect(merged).toEqual([durable]);
  });

  it("inserts delayed lower-sequence events without reordering the rest of the run", () => {
    const first = event("first", "2026-01-01T00:00:01.000Z", 1);
    const fourth = event("fourth", "2026-01-01T00:00:04.000Z", 4);
    const current = mergeEvents([], [first, fourth]);

    const merged = mergeEvents(current, [event("third", "2026-01-01T00:00:03.000Z", 3)]);

    expect(merged.map((item) => item.id)).toEqual(["first", "third", "fourth"]);
  });

  it("prepends an older history run while retaining chronological run order", () => {
    const current = mergeEvents([], [
      event("new-user", "2026-01-01T01:00:01.000Z", 1, "new-run", "user-message"),
      event("new-answer", "2026-01-01T01:00:02.000Z", 2, "new-run")
    ]);

    const merged = mergeEvents(current, [
      event("old-answer", "2026-01-01T00:00:02.000Z", 2, "old-run"),
      event("old-user", "2026-01-01T00:00:01.000Z", 1, "old-run", "user-message")
    ]);

    expect(merged.map((item) => item.id)).toEqual(["old-user", "old-answer", "new-user", "new-answer"]);
  });

  it("preserves the event array for a duplicate streaming flush", () => {
    const current = mergeEvents([], [event("status", "2026-01-01T00:00:01.000Z", 1)]);

    expect(mergeEvents(current, [current[0]])).toBe(current);
  });

  it("keeps the newest prompt by selecting complete turns instead of the last event count", () => {
    const oldRun = Array.from({ length: 301 }, (_, index) =>
      event(`old-${index}`, `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`, index + 1, "old-run",
        index === 0 ? "user-message" : "status")
    );
    const newRun = Array.from({ length: 21 }, (_, index) =>
      event(`new-${index}`, `2026-01-01T01:00:${String(index).padStart(2, "0")}.000Z`, index + 1, "new-run",
        index === 0 ? "user-message" : "status")
    );

    const selected = selectRecentTurnEvents([...oldRun, ...newRun], 300);

    expect(selected).toHaveLength(21);
    expect(selected[0]).toMatchObject({ id: "new-0", kind: "user-message" });
    expect(new Set(selected.map((item) => item.runId))).toEqual(new Set(["new-run"]));
  });

  it("never selects a run from a different session", () => {
    const runs = [
      run("other", "other-session", "running", "2026-01-01T00:00:03.000Z"),
      run("old", "session", "completed", "2026-01-01T00:00:01.000Z"),
      run("current", "session", "queued", "2026-01-01T00:00:02.000Z")
    ];
    expect(latestRunForSession(runs, "session")?.id).toBe("current");
    expect(activeRunForSession(runs, "session")?.id).toBe("current");
  });

  it.each(["running", "waiting-approval", "applying"] as const)("keeps the %s run selected when a newer follow-up is queued", status => {
    const runs = [
      run("executing", "session", status, "2026-01-01T00:00:01.000Z"),
      run("follow-up", "session", "queued", "2026-01-01T00:00:02.000Z")
    ];
    expect(activeRunForSession(runs, "session")?.id).toBe("executing");
    expect(latestRunForSession(runs, "session")?.id).toBe("follow-up");
  });

  it("matches date filters using the user's local calendar date", () => {
    expect(formatDateInput("2026-06-13T12:34:56")).toBe("2026-06-13");
  });

  it("does not render NaN for malformed provider timestamps", () => {
    expect(formatDuration("not-a-date", "2026-01-01T00:00:01.000Z")).toBe("耗时未知");
  });
});

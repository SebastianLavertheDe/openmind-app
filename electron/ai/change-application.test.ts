import { describe, expect, it, vi } from "vitest";
import type { AiEvent, AiRun, ChangeSet } from "../../shared/contracts";
import { ChangeApplicationService, type SchedulerEventSink } from "./change-application";
import { filePatchSegments, patchFingerprint } from "./change-patches";

// ---- shared patch fixtures -------------------------------------------------

const PATCH_A = `--- a/foo.txt
+++ b/foo.txt
@@ -1,1 +1,1 @@
-old
+new
`;

// ---- test doubles ----------------------------------------------------------

type ApplyResult = { applied: boolean; conflict?: string };

/** In-memory SessionStore double: only the methods ChangeApplicationService uses. */
class FakeStore {
  runs = new Map<string, AiRun>();
  updates: Array<{ id: string; patch: Partial<AiRun> }> = [];
  writtenPatches: Array<{ runId: string; patch: string }> = [];

  getRun(id: string): AiRun {
    const run = this.runs.get(id);
    if (!run) throw new Error(`run not found: ${id}`);
    return run;
  }
  updateRun(id: string, patch: Partial<AiRun>): AiRun {
    this.updates.push({ id, patch });
    const current = this.runs.get(id);
    if (!current) throw new Error(`run not found: ${id}`);
    const next = { ...current, ...patch, changeSet: patch.changeSet ?? current.changeSet };
    this.runs.set(id, next);
    return next;
  }
  writePatch(run: AiRun, patchText: string): void {
    this.writtenPatches.push({ runId: run.id, patch: patchText });
  }
}

/** LegacyChangeManager double: controllable apply/revert/discard/discardChange. */
class FakeChangeManager {
  applyResult: ApplyResult = { applied: true };
  revertResult: ApplyResult = { applied: true };
  discardResult = true;
  discardChangeResult: ChangeSet | null = null;
  applyCalls: Array<{ changeSet: ChangeSet; patch?: string }> = [];
  revertCalls: Array<{ changeSet: ChangeSet; patch: string }> = [];

  async apply(changeSet: ChangeSet, selectedPatch?: string): Promise<ApplyResult> {
    this.applyCalls.push({ changeSet, patch: selectedPatch });
    return this.applyResult;
  }
  async revert(changeSet: ChangeSet, selectedPatch: string): Promise<ApplyResult> {
    this.revertCalls.push({ changeSet, patch: selectedPatch });
    return this.revertResult;
  }
  async discardChange(run: AiRun, selectedPatch: string): Promise<ChangeSet> {
    return this.discardChangeResult || this.cloneEmpty(run);
  }
  async discard(run: AiRun): Promise<boolean> {
    return this.discardResult;
  }
  private cloneEmpty(run: AiRun): ChangeSet {
    return { ...(run.changeSet as ChangeSet), files: [], patch: "" };
  }
}

function makeSink(): SchedulerEventSink & { events: Array<{ run: AiRun; kind: string; payload: Record<string, unknown> }>; snapshots: number } {
  const events: Array<{ run: AiRun; kind: string; payload: Record<string, unknown> }> = [];
  let snapshots = 0;
  return {
    events,
    snapshots,
    async append(run: AiRun, kind: AiEvent["kind"], payload: Record<string, unknown>) {
      events.push({ run, kind: String(kind), payload });
    },
    publishSnapshot() {
      // increment via closure: snapshots is captured by reference on the returned object only at construct time,
      // so expose a counter accessor instead.
      (this as unknown as { snapshots: number }).snapshots++;
    }
  } as SchedulerEventSink & { events: typeof events; snapshots: number };
}

function makeChangeSet(overrides: Partial<ChangeSet> = {}): ChangeSet {
  return {
    id: "cs-1",
    runId: "run-1",
    baseCommit: "abc",
    files: [{ path: "foo.txt", status: "modified", additions: 1, deletions: 1, patch: PATCH_A }],
    patch: PATCH_A,
    createdAt: "2026-07-07T00:00:00.000Z",
    status: "pending",
    appliedPatches: [],
    appliedFiles: [],
    ...overrides
  };
}

function makeRun(overrides: Partial<AiRun> = {}): AiRun {
  return {
    schemaVersion: 1,
    id: "run-1",
    sessionId: "s1",
    projectId: "p1",
    provider: "claude",
    providerId: "legacy",
    permissionProfile: "edit",
    status: "completed",
    prompt: "p",
    contexts: [],
    turnContext: null,
    workspacePath: "/tmp/ws",
    baseCommit: "abc",
    startedAt: "2026-07-07T00:00:00.000Z",
    completedAt: "2026-07-07T00:00:01.000Z",
    error: null,
    changeSet: makeChangeSet(),
    risks: [],
    ...overrides
  } as AiRun;
}

function makeService(store: FakeStore, changes: FakeChangeManager, sink: SchedulerEventSink) {
  // Cast through unknown: ChangeApplicationService only uses the duck-typed methods we provide.
  return new ChangeApplicationService(store as unknown as never, changes as unknown as never, sink);
}

// ---- tests -----------------------------------------------------------------

describe("ChangeApplicationService.applyChange", () => {
  it("throws when the run has no changeSet", async () => {
    const store = new FakeStore();
    store.runs.set("run-1", makeRun({ changeSet: null }));
    const svc = makeService(store, new FakeChangeManager(), {} as SchedulerEventSink);
    await expect(svc.applyChange("run-1")).rejects.toThrow(/没有可应用/);
  });

  it("throws when already applying, fully applied, or discarded", async () => {
    const store = new FakeStore();
    store.runs.set("r-applying", makeRun({ id: "r-applying", status: "applying" }));
    store.runs.set("r-applied", makeRun({ id: "r-applied", changeSet: makeChangeSet({ status: "applied" }) }));
    store.runs.set("r-discarded", makeRun({ id: "r-discarded", changeSet: makeChangeSet({ status: "discarded" }) }));
    const svc = makeService(store, new FakeChangeManager(), {} as SchedulerEventSink);
    await expect(svc.applyChange("r-applying")).rejects.toThrow(/正在应用/);
    await expect(svc.applyChange("r-applied")).rejects.toThrow(/已经全部应用/);
    await expect(svc.applyChange("r-discarded")).rejects.toThrow(/已经丢弃/);
  });

  it("full apply marks the changeSet applied, records all patch+file ids, and emits a changes-applied status", async () => {
    const store = new FakeStore();
    const run = makeRun();
    store.runs.set(run.id, run);
    const changes = new FakeChangeManager();
    const sink = makeSink();
    const svc = makeService(store, changes, sink);

    const result = await svc.applyChange(run.id);

    expect(result.applied).toBe(true);
    const finalRun = store.getRun(run.id);
    expect(finalRun.status).toBe("completed");
    expect(finalRun.changeSet?.status).toBe("applied");
    // appliedPatches now contains the fingerprint of every segment
    const segIds = filePatchSegments(run.changeSet!.files[0]).map(patchFingerprint);
    expect(finalRun.changeSet?.appliedPatches).toEqual(expect.arrayContaining(segIds));
    expect(finalRun.changeSet?.appliedFiles).toEqual(["foo.txt"]);
    expect(finalRun.workspacePath).toBeNull();
    expect(sink.events.some((e) => e.payload.state === "changes-applied")).toBe(true);
  });

  it("marks conflicted + emits an error event when the manager rejects", async () => {
    const store = new FakeStore();
    const run = makeRun();
    store.runs.set(run.id, run);
    const changes = new FakeChangeManager();
    changes.applyResult = { applied: false, conflict: "hunk failed" };
    const sink = makeSink();
    const svc = makeService(store, changes, sink);

    const result = await svc.applyChange(run.id);

    expect(result.applied).toBe(false);
    expect(result.conflict).toBe("hunk failed");
    const finalRun = store.getRun(run.id);
    expect(finalRun.status).toBe("conflicted");
    expect(finalRun.changeSet?.status).toBe("conflicted");
    expect(finalRun.error).toBe("hunk failed");
    expect(sink.events.some((e) => e.kind === "error")).toBe(true);
  });
});

describe("ChangeApplicationService.revertChange", () => {
  it("throws when the patch was never applied", async () => {
    const store = new FakeStore();
    store.runs.set("r", makeRun({ id: "r", changeSet: makeChangeSet({ runId: "r", appliedPatches: [], appliedFiles: [] }) }));
    const svc = makeService(store, new FakeChangeManager(), {} as SchedulerEventSink);
    await expect(svc.revertChange("r", PATCH_A)).rejects.toThrow(/尚未应用/);
  });

  it("reverts and demotes the changeSet back to pending when nothing remains", async () => {
    const store = new FakeStore();
    const segId = patchFingerprint(filePatchSegments({ path: "foo.txt", status: "modified", additions: 1, deletions: 1, patch: PATCH_A })[0]);
    const run = makeRun({
      id: "r",
      changeSet: makeChangeSet({ runId: "r", status: "applied", appliedPatches: [segId], appliedFiles: ["foo.txt"] })
    });
    store.runs.set("r", run);
    const changes = new FakeChangeManager();
    const sink = makeSink();
    const svc = makeService(store, changes, sink);

    await svc.revertChange("r", PATCH_A);

    const final = store.getRun("r");
    expect(final.status).toBe("completed");
    expect(final.changeSet?.appliedPatches).toHaveLength(0);
    expect(final.changeSet?.appliedFiles).toHaveLength(0);
    expect(final.changeSet?.status).toBe("pending");
    expect(sink.events.some((e) => e.payload.state === "changes-reverted")).toBe(true);
  });
});

describe("ChangeApplicationService.discardRun", () => {
  it("is a no-op (returns true) when already discarded", async () => {
    const store = new FakeStore();
    store.runs.set("r", makeRun({ id: "r", changeSet: makeChangeSet({ runId: "r", status: "discarded" }) }));
    const changes = new FakeChangeManager();
    const sink = makeSink();
    const svc = makeService(store, changes, sink);
    const out = await svc.discardRun("r");
    expect(out).toBe(true);
    expect(changes.applyCalls).toHaveLength(0);
  });

  it("throws while the run is still active", async () => {
    const store = new FakeStore();
    store.runs.set("r", makeRun({ id: "r", status: "running" }));
    const svc = makeService(store, new FakeChangeManager(), {} as SchedulerEventSink);
    await expect(svc.discardRun("r")).rejects.toThrow(/尚未结束/);
  });

  it("discards the workspace and marks the changeSet discarded", async () => {
    const store = new FakeStore();
    store.runs.set("r", makeRun({ id: "r", status: "completed" }));
    const changes = new FakeChangeManager();
    changes.discardResult = true;
    const sink = makeSink();
    const svc = makeService(store, changes, sink);
    const out = await svc.discardRun("r");
    expect(out).toBe(true);
    const final = store.getRun("r");
    expect(final.workspacePath).toBeNull();
    expect(final.changeSet?.status).toBe("discarded");
    expect(final.changeSet?.discardedAt).toBeTruthy();
    expect(sink.events.some((e) => e.payload.state === "workspace-discarded")).toBe(true);
  });
});

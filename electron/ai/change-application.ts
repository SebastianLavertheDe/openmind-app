import type { AiEvent, AiRun, ChangeSet } from "../../shared/contracts";
import { SessionStore } from "./session-store";
import { LegacyChangeManager } from "./workspace-manager";
import {
  filePatchSegments,
  patchFingerprint,
  patchPath,
  patchSegments,
  remainingPatch
} from "./change-patches";

/** ChangeApplicationService 的外部副作用端口：发事件 + 推快照。由 scheduler 实现，
 * service 依赖此接口而非 scheduler 的私有方法——注入 mock sink 即可单测 applyChange 等。 */
export interface SchedulerEventSink {
  append(run: AiRun, kind: AiEvent["kind"], payload: Record<string, unknown>): Promise<void>;
  publishSnapshot(): void;
}

export class ChangeApplicationService {
  constructor(
    private readonly store: SessionStore,
    private readonly legacyChanges: LegacyChangeManager,
    private readonly events: SchedulerEventSink
  ) {}

  async applyChange(runId: string, patch?: string): Promise<{ applied: boolean; conflict?: string }> {
    const run = this.store.getRun(runId);
    if (!run.changeSet) throw new Error("本轮没有可应用的变更。");
    if (run.status === "applying") throw new Error("该变更正在应用，请勿重复提交。");
    if (run.changeSet.status === "applied") throw new Error("该变更已经全部应用。");
    if (run.changeSet.status === "discarded") throw new Error("该变更工作区已经丢弃。");
    this.store.updateRun(runId, { status: "applying" });
    const patchText = patch || remainingPatch(run.changeSet);
    const result = await this.legacyChanges.apply(run.changeSet, patchText);
    if (result.applied) {
      const fullApply = !patch;
      const patchId = patch ? patchFingerprint(patch) : null;
      const appliedFile = patch ? run.changeSet.files.find((file) => patchFingerprint(file.patch) === patchId)?.path : null;
      const selectedPatchIds = appliedFile
        ? filePatchSegments(run.changeSet.files.find((file) => file.path === appliedFile)!).map(patchFingerprint)
        : patchId ? [patchId] : [];
      const changeSet: ChangeSet = fullApply
        ? {
          ...run.changeSet,
          status: "applied",
          appliedAt: new Date().toISOString(),
          appliedPatches: [...new Set([...run.changeSet.appliedPatches, ...patchSegments(run.changeSet).map(patchFingerprint)])],
          appliedFiles: [...new Set([...run.changeSet.appliedFiles, ...run.changeSet.files.map((file) => file.path)])]
        }
        : {
          ...run.changeSet,
          status: "partially-applied",
          appliedPatches: [...new Set([...run.changeSet.appliedPatches, ...selectedPatchIds])],
          appliedFiles: appliedFile && !run.changeSet.appliedFiles.includes(appliedFile)
            ? [...run.changeSet.appliedFiles, appliedFile]
            : run.changeSet.appliedFiles
        };
      if (fullApply) await this.legacyChanges.discard(run);
      this.store.updateRun(runId, { status: "completed", changeSet, workspacePath: fullApply ? null : run.workspacePath });
      await this.events.append(run, "status", {
        state: fullApply ? "changes-applied" : "changes-partially-applied",
        patchId
      });
    } else {
      this.store.updateRun(runId, {
        status: "conflicted",
        error: result.conflict || "应用变更时发生冲突。",
        changeSet: { ...run.changeSet, status: "conflicted" }
      });
      await this.events.append(run, "error", { text: result.conflict || "应用变更时发生冲突。" });
    }
    this.events.publishSnapshot();
    return result;
  }

  async revertChange(runId: string, patch: string): Promise<{ applied: boolean; conflict?: string }> {
    const run = this.store.getRun(runId);
    if (!run.changeSet) throw new Error("本轮没有可撤销的变更。");
    if (run.status === "applying") throw new Error("该变更正在应用，请稍候。");
    const patchId = patchFingerprint(patch);
    const file = patchPath(patch);
    if (!run.changeSet.appliedPatches.includes(patchId) && (!file || !run.changeSet.appliedFiles.includes(file))) {
      throw new Error("该变更尚未应用，不能撤销。");
    }
    this.store.updateRun(runId, { status: "applying" });
    const result = await this.legacyChanges.revert(run.changeSet, patch);
    if (result.applied) {
      const fileRecord = file ? run.changeSet.files.find((item) => item.path === file) : null;
      const filePatchId = fileRecord ? patchFingerprint(fileRecord.patch) : null;
      const fileSegmentIds = fileRecord ? filePatchSegments(fileRecord).map(patchFingerprint) : [];
      let appliedPatches = run.changeSet.appliedPatches.filter((id) => id !== patchId && id !== filePatchId);
      if (fileRecord && filePatchId !== patchId && run.changeSet.appliedFiles.includes(fileRecord.path)) {
        appliedPatches = [...new Set([...appliedPatches, ...fileSegmentIds.filter((id) => id !== patchId)])];
      } else if (filePatchId === patchId) {
        appliedPatches = appliedPatches.filter((id) => !fileSegmentIds.includes(id));
      }
      const appliedFiles = file ? run.changeSet.appliedFiles.filter((pathValue) => pathValue !== file) : run.changeSet.appliedFiles;
      const status = appliedPatches.length || appliedFiles.length ? "partially-applied" : "pending";
      const changeSet: ChangeSet = { ...run.changeSet, status, appliedPatches, appliedFiles, appliedAt: undefined };
      this.store.updateRun(runId, { status: "completed", changeSet, error: null });
      await this.events.append(run, "status", { state: "changes-reverted", patchId, file });
    } else {
      this.store.updateRun(runId, { status: "conflicted", error: result.conflict || "撤销变更时发生冲突。" });
      await this.events.append(run, "error", { text: result.conflict || "撤销变更时发生冲突。" });
    }
    this.events.publishSnapshot();
    return result;
  }

  async discardChange(runId: string, patch: string): Promise<ChangeSet | null> {
    const run = this.store.getRun(runId);
    if (!run.changeSet || !run.workspacePath) throw new Error("该历史运行没有可丢弃的待审变更。");
    if (["queued", "running", "waiting-approval", "applying"].includes(run.status)) throw new Error("运行尚未结束，不能丢弃部分变更。");
    const patchId = patchFingerprint(patch);
    if (run.changeSet.appliedPatches.includes(patchId)) throw new Error("该变更已经应用，请先撤销应用。");
    this.store.updateRun(runId, { status: "applying" });
    const collected = await this.legacyChanges.discardChange(run, patch);
    const empty = !collected.files.length;
    const changeSet: ChangeSet = {
      ...collected,
      id: run.changeSet.id,
      status: empty ? (run.changeSet.appliedPatches.length ? "partially-applied" : "discarded") : run.changeSet.status,
      appliedPatches: run.changeSet.appliedPatches,
      appliedFiles: run.changeSet.appliedFiles,
      discardedAt: empty ? new Date().toISOString() : undefined
    };
    if (empty) await this.legacyChanges.discard(run);
    this.store.writePatch(run, changeSet.patch);
    this.store.updateRun(runId, { status: "completed", changeSet, workspacePath: empty ? null : run.workspacePath });
    await this.events.append(run, "status", { state: "changes-discarded", patchId });
    this.events.publishSnapshot();
    return changeSet;
  }

  async discardRun(runId: string): Promise<boolean> {
    const run = this.store.getRun(runId);
    if (["queued", "running", "waiting-approval", "applying"].includes(run.status)) throw new Error("运行尚未结束，不能丢弃工作区。");
    if (run.changeSet?.status === "applied") throw new Error("变更已经应用，不能再丢弃工作区。");
    if (run.changeSet?.status === "discarded") return true;
    const result = await this.legacyChanges.discard(run);
    const changeSet = run.changeSet
      ? { ...run.changeSet, status: "discarded" as const, discardedAt: new Date().toISOString() }
      : null;
    this.store.updateRun(run.id, { workspacePath: null, changeSet, status: run.status === "conflicted" ? "completed" : run.status });
    await this.events.append(run, "status", { state: "workspace-discarded", discardedAt: changeSet?.discardedAt });
    this.events.publishSnapshot();
    return result;
  }
}

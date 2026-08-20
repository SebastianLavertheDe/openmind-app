import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AiRun, ChangeFile, ChangeSet } from "../../shared/contracts";
import { execInProject, execInProjectToFile } from "./process-utils";

// Handles review actions for historical runs created before direct-directory execution.
// New runs never create or collect isolated workspaces.
export class LegacyChangeManager {
  readonly runtimeRoot: string;

  constructor(private projectRoot: string, stateRoot?: string) {
    this.runtimeRoot = path.join(stateRoot ?? projectRoot, ".openmind", "ai", ".runtime", "worktrees");
  }

  async collect(run: AiRun): Promise<ChangeSet> {
    if (!run.workspacePath || !run.baseCommit) throw new Error("历史运行没有可读取的工作区。");
    await execInProject(run.workspacePath, "git", ["add", "-N", "--", "."]);
    const patchFile = path.join(this.runtimeRoot, `${run.id}.changes.patch`);
    let patch = "";
    try {
      await execInProjectToFile(run.workspacePath, "git", ["diff", "--binary", "--no-ext-diff", run.baseCommit], patchFile);
      patch = fs.readFileSync(patchFile, "utf8");
    } finally {
      fs.rmSync(patchFile, { force: true });
    }
    const { stdout: status } = await execInProject(run.workspacePath, "git", ["diff", "--name-status", run.baseCommit]);
    const { stdout: numstat } = await execInProject(run.workspacePath, "git", ["diff", "--numstat", run.baseCommit]);
    const stats = new Map(numstat.trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const [additions, deletions, file] = line.split("\t");
      return [file, { additions: Number(additions) || 0, deletions: Number(deletions) || 0 }];
    }));
    const files: ChangeFile[] = status.trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const [flag, ...parts] = line.split("\t");
      const file = parts.at(-1) || "";
      const stat = stats.get(file) || { additions: 0, deletions: 0 };
      return {
        path: file,
        status: flag.startsWith("A") ? "created" : flag.startsWith("D") ? "deleted" : flag.startsWith("R") ? "renamed" : "modified",
        additions: stat.additions,
        deletions: stat.deletions,
        patch: extractFilePatch(patch, file)
      };
    });
    return {
      id: crypto.randomUUID(),
      runId: run.id,
      baseCommit: run.baseCommit,
      files,
      patch,
      createdAt: new Date().toISOString(),
      status: "pending",
      appliedPatches: [],
      appliedFiles: []
    };
  }

  async apply(changeSet: ChangeSet, selectedPatch?: string): Promise<{ applied: boolean; conflict?: string }> {
    const patchText = selectedPatch || changeSet.patch;
    if (!patchText.trim()) return { applied: true };
    try {
      await execInProject(this.projectRoot, "git", ["apply", "--binary", "--whitespace=nowarn", "-"], { input: patchText } as never);
      return { applied: true };
    } catch (error) {
      return { applied: false, conflict: error instanceof Error ? error.message : String(error) };
    }
  }

  async revert(changeSet: ChangeSet, selectedPatch: string): Promise<{ applied: boolean; conflict?: string }> {
    if (!selectedPatch.trim()) return { applied: true };
    try {
      await execInProject(this.projectRoot, "git", ["apply", "--reverse", "--binary", "--whitespace=nowarn", "-"], { input: selectedPatch } as never);
      return { applied: true };
    } catch (error) {
      return { applied: false, conflict: error instanceof Error ? error.message : String(error) };
    }
  }

  async discardChange(run: AiRun, selectedPatch: string): Promise<ChangeSet> {
    if (!run.workspacePath || !run.baseCommit) throw new Error("历史运行没有可编辑的工作区。");
    await execInProject(run.workspacePath, "git", ["apply", "--reverse", "--binary", "--whitespace=nowarn", "-"], { input: selectedPatch } as never);
    return this.collect(run);
  }

  async discard(run: AiRun): Promise<boolean> {
    if (!run.workspacePath || !fs.existsSync(run.workspacePath)) return true;
    await execInProject(this.projectRoot, "git", ["worktree", "remove", "--force", run.workspacePath]).catch(() => undefined);
    return !fs.existsSync(run.workspacePath);
  }

}

function extractFilePatch(patch: string, file: string): string {
  const marker = `diff --git a/${file} b/${file}`;
  const start = patch.indexOf(marker);
  if (start < 0) return "";
  const next = patch.indexOf("\ndiff --git ", start + marker.length);
  return patch.slice(start, next < 0 ? undefined : next);
}

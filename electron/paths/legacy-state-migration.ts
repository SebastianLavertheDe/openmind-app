import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../lib/fs-utils";

type LegacyTreeEntry = {
  relativePath: string;
  kind: "file" | "directory";
  size?: number;
  sha256?: string;
};

export type LegacyStateMigrationReport = {
  schemaVersion: 1;
  status: "skipped" | "committed";
  sourceDirectory: string;
  targetDirectory: string;
  copiedFiles: string[];
  preservedSource: true;
  completedAt: string;
};

export type LegacyStateMigrationPreview = {
  sourceDirectory: string;
  targetDirectory: string;
  sourceExists: boolean;
  sourceFileCount: number;
  sourceBytes: number;
  targetState: "absent" | "empty" | "non-empty" | "invalid";
  canCommit: boolean;
  blockingReasons: string[];
};

type LegacyStateMigrationPending = {
  schemaVersion: 1;
  status: "pending";
  sourceDirectory: string;
  targetDirectory: string;
  stagingDirectory: string;
  tree: LegacyTreeEntry[];
  preparedAt: string;
};

export type LegacyStateMigrationInput = {
  legacyRepoRoot: string;
  targetStateRoot: string;
  stagingRoot: string;
  rootId: string;
};

/**
 * Read-only preflight for legacy state migration. It never creates the target,
 * writes a marker, or changes either source or staging.
 */
export function previewLegacyStateMigration(input: LegacyStateMigrationInput): LegacyStateMigrationPreview {
  const sourceDirectory = path.join(path.resolve(input.legacyRepoRoot), ".cctools");
  const targetDirectory = path.join(path.resolve(input.targetStateRoot), ".cctools");
  const blockingReasons: string[] = [];
  let sourceExists = false;
  let sourceFileCount = 0;
  let sourceBytes = 0;

  if (isDirectory(sourceDirectory)) {
    sourceExists = true;
    try {
      for (const entry of snapshotTree(sourceDirectory)) {
        if (entry.kind !== "file") continue;
        sourceFileCount += 1;
        sourceBytes += entry.size || 0;
      }
    } catch (error) {
      blockingReasons.push(error instanceof Error ? error.message : String(error));
    }
  }

  const targetState = inspectTargetState(targetDirectory);
  if (targetState === "non-empty") {
    blockingReasons.push("旧状态迁移目标不是空目录，拒绝 merge/overwrite。");
  } else if (targetState === "invalid") {
    blockingReasons.push("旧状态迁移目标不是可用目录。");
  }

  return {
    sourceDirectory,
    targetDirectory,
    sourceExists,
    sourceFileCount,
    sourceBytes,
    targetState,
    canCommit: blockingReasons.length === 0,
    blockingReasons
  };
}

/**
 * Copy legacy `.cctools` state into userData without touching the source.
 * The pending marker is written after staging and before the directory rename;
 * the completed report is the commit marker. A crash before either commit
 * step is recoverable without merging into an existing target.
 */
export function migrateLegacyState(input: LegacyStateMigrationInput): LegacyStateMigrationReport {
  const sourceDirectory = path.join(path.resolve(input.legacyRepoRoot), ".cctools");
  const targetDirectory = path.join(path.resolve(input.targetStateRoot), ".cctools");
  const targetStateRoot = path.resolve(input.targetStateRoot);
  const marker = path.join(targetStateRoot, "legacy-state-migration.json");
  const pendingMarker = path.join(targetStateRoot, "legacy-state-migration.pending.json");
  const existing = readLegacyStateMigrationReport(marker);
  if (existing) {
    if (fs.existsSync(pendingMarker)) fs.rmSync(pendingMarker, { force: true });
    return existing;
  }

  fs.mkdirSync(targetStateRoot, { recursive: true });

  const pending = readPendingMigration(pendingMarker);
  if (pending && pending.sourceDirectory === sourceDirectory && pending.targetDirectory === targetDirectory) {
    const recovered = recoverPendingMigration(pending, marker, pendingMarker);
    if (recovered) return recovered;
  }

  const preview = previewLegacyStateMigration(input);
  if (!preview.canCommit) throw new Error(preview.blockingReasons.join(" "));
  if (!isDirectory(sourceDirectory)) {
    const skipped: LegacyStateMigrationReport = {
      schemaVersion: 1,
      status: "skipped",
      sourceDirectory,
      targetDirectory,
      copiedFiles: [],
      preservedSource: true,
      completedAt: new Date().toISOString()
    };
    writeJsonAtomic(marker, skipped);
    return skipped;
  }

  const safeRootId = input.rootId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const stagingDirectory = path.join(path.resolve(input.stagingRoot), `legacy-state-${safeRootId}`);
  fs.mkdirSync(path.dirname(stagingDirectory), { recursive: true });
  fs.rmSync(stagingDirectory, { recursive: true, force: true });
  fs.cpSync(sourceDirectory, stagingDirectory, { recursive: true, force: true });
  const tree = snapshotTree(stagingDirectory);
  const prepared: LegacyStateMigrationPending = {
    schemaVersion: 1,
    status: "pending",
    sourceDirectory,
    targetDirectory,
    stagingDirectory,
    tree,
    preparedAt: new Date().toISOString()
  };
  writeJsonAtomic(pendingMarker, prepared);

  try {
    const targetState = inspectTargetState(targetDirectory);
    if (targetState === "empty") fs.rmSync(targetDirectory, { recursive: true, force: false });
    if (inspectTargetState(targetDirectory) !== "absent") {
      throw new Error("旧状态迁移目标不是空目录，拒绝 merge/overwrite。");
    }
    fs.renameSync(stagingDirectory, targetDirectory);
    return commitMigrationReport(prepared, marker, pendingMarker);
  } catch (error) {
    // Keep a valid pending marker + staging tree for the next startup to
    // recover. If preparation itself failed, no marker is left behind.
    throw error;
  } finally {
    if (!fs.existsSync(pendingMarker) && fs.existsSync(stagingDirectory)) {
      fs.rmSync(stagingDirectory, { recursive: true, force: true });
    }
  }
}

/** Read a valid migration marker without exposing its path to the Renderer. */
export function readLegacyStateMigrationReport(filePath: string): LegacyStateMigrationReport | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<LegacyStateMigrationReport>;
    if (parsed.schemaVersion !== 1 || !["skipped", "committed"].includes(parsed.status || "")) return null;
    if (typeof parsed.sourceDirectory !== "string" || typeof parsed.targetDirectory !== "string"
      || !Array.isArray(parsed.copiedFiles) || parsed.preservedSource !== true
      || typeof parsed.completedAt !== "string") return null;
    return parsed as LegacyStateMigrationReport;
  } catch { return null; }
}

function recoverPendingMigration(
  pending: LegacyStateMigrationPending,
  marker: string,
  pendingMarker: string
): LegacyStateMigrationReport | null {
  const targetState = inspectTargetState(pending.targetDirectory);
  if (targetState === "non-empty") {
    if (!treeMatches(pending.targetDirectory, pending.tree)) {
      throw new Error("旧状态迁移目标不是空目录，且与 pending 事务不一致；拒绝 merge/overwrite。");
    }
    return commitMigrationReport(pending, marker, pendingMarker);
  }
  if (targetState === "invalid") throw new Error("旧状态迁移目标不是可用目录。");
  if (targetState === "empty") fs.rmSync(pending.targetDirectory, { recursive: true, force: false });
  if (!fs.existsSync(pending.stagingDirectory)) return null;
  if (!treeMatches(pending.stagingDirectory, pending.tree)) return null;
  fs.mkdirSync(path.dirname(pending.targetDirectory), { recursive: true });
  fs.renameSync(pending.stagingDirectory, pending.targetDirectory);
  return commitMigrationReport(pending, marker, pendingMarker);
}

function commitMigrationReport(
  pending: LegacyStateMigrationPending,
  marker: string,
  pendingMarker: string
): LegacyStateMigrationReport {
  const report: LegacyStateMigrationReport = {
    schemaVersion: 1,
    status: "committed",
    sourceDirectory: pending.sourceDirectory,
    targetDirectory: pending.targetDirectory,
    copiedFiles: pending.tree.filter((entry) => entry.kind === "file").map((entry) => entry.relativePath).sort(),
    preservedSource: true,
    completedAt: new Date().toISOString()
  };
  writeJsonAtomic(marker, report);
  fs.rmSync(pendingMarker, { force: true });
  return report;
}

function isDirectory(filePath: string): boolean {
  try { return fs.statSync(filePath).isDirectory(); }
  catch { return false; }
}

function readPendingMigration(filePath: string): LegacyStateMigrationPending | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<LegacyStateMigrationPending>;
    if (parsed.schemaVersion !== 1 || parsed.status !== "pending" || typeof parsed.sourceDirectory !== "string"
      || typeof parsed.targetDirectory !== "string" || typeof parsed.stagingDirectory !== "string"
      || !Array.isArray(parsed.tree) || typeof parsed.preparedAt !== "string") return null;
    if (!parsed.tree.every((entry) => entry && typeof entry.relativePath === "string"
      && (entry.kind === "file" || entry.kind === "directory"))) return null;
    return parsed as LegacyStateMigrationPending;
  } catch { return null; }
}

function inspectTargetState(target: string): LegacyStateMigrationPreview["targetState"] {
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory()) return "invalid";
    return fs.readdirSync(target).length === 0 ? "empty" : "non-empty";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    return "invalid";
  }
}

function snapshotTree(root: string): LegacyTreeEntry[] {
  const entries: LegacyTreeEntry[] = [];
  function walk(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const full = path.join(directory, entry.name);
      const relativePath = path.relative(root, full).split(path.sep).join("/");
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`旧状态包含不支持的 symlink：${relativePath}`);
      if (stat.isDirectory()) {
        entries.push({ relativePath, kind: "directory" });
        walk(full);
      } else if (stat.isFile()) {
        entries.push({ relativePath, kind: "file", size: stat.size, sha256: sha256File(full) });
      } else {
        throw new Error(`旧状态包含不支持的文件类型：${relativePath}`);
      }
    }
  }
  walk(root);
  return entries;
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function treeMatches(root: string, expected: LegacyTreeEntry[]): boolean {
  try {
    return JSON.stringify(snapshotTree(root)) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

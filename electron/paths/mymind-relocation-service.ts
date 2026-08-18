import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MymindRelocationPreview, MymindRelocationReport } from "../../shared/contracts";
import { writeJsonAtomic } from "../lib/fs-utils";
import { detectPathConflicts, type AppPaths } from "./app-paths-service";
import { computeRootId } from "./mymind-path-resolver";

const SCHEMA_VERSION = 1;
const TRANSACTION_DIRECTORY = "mymind-relocation";
const TRANSACTION_PREFIX = ".cctools-mymind-relocation-";

type TreeEntry = {
  relativePath: string;
  kind: "file" | "directory";
  size?: number;
  sha256?: string;
};

type TreeSummary = {
  entries: TreeEntry[];
  fileCount: number;
  directoryCount: number;
  bytes: number;
  digest: string;
};

type PendingRelocation = {
  schemaVersion: typeof SCHEMA_VERSION;
  status: "pending";
  id: string;
  sourceDirectory: string;
  targetDirectory: string;
  stagingDirectory: string;
  backupDirectory: string;
  tree: TreeSummary;
  phase: "prepared" | "target-moved" | "installed";
  preparedAt: string;
};

export type MymindRelocationInput = {
  sourceDirectory: string;
  targetDirectory: string;
  paths: AppPaths;
  activeRunCount?: number;
};

/**
 * User-initiated content relocation is deliberately separate from root
 * binding and legacy settings migration. It copies the complete source tree
 * into a strictly empty target, keeps the source, and uses a sibling swap so
 * an interrupted commit can be recovered without merging or overwriting.
 */
export function previewMymindRelocation(input: MymindRelocationInput): MymindRelocationPreview {
  const sourceCandidate = path.resolve(String(input.sourceDirectory || "").trim());
  const targetCandidate = path.resolve(String(input.targetDirectory || "").trim());
  const sourceDirectory = canonicalDirectory(sourceCandidate) || sourceCandidate;
  const targetDirectory = canonicalDirectory(targetCandidate) || targetCandidate;
  const blockingReasons: string[] = [];
  let sourceSummary: TreeSummary | null = null;
  let targetSummary: TreeSummary | null = null;
  const sourceRootId = canonicalDirectory(sourceCandidate) ? computeRootId(sourceDirectory) : null;

  if (!sourceRootId) {
    blockingReasons.push("当前 mymind 根目录不存在、不可访问或不是目录。");
  } else {
    try {
      sourceSummary = snapshotTree(sourceDirectory);
    } catch (error) {
      blockingReasons.push(errorMessage(error));
    }
    if (!canAccess(sourceDirectory, fs.constants.R_OK)) {
      blockingReasons.push("当前 mymind 根目录不可读。");
    }
  }

  const targetState = inspectTargetState(targetCandidate);
  if (targetState === "absent") {
    blockingReasons.push("搬迁目标必须是已存在且为空的目录。");
  } else if (targetState === "invalid") {
    blockingReasons.push("搬迁目标不是可用目录。");
  } else if (targetState === "non-empty") {
    blockingReasons.push("搬迁目标不是空目录，拒绝 merge/overwrite。");
  } else {
    try {
      targetSummary = snapshotTree(targetDirectory);
    } catch (error) {
      blockingReasons.push(errorMessage(error));
    }
    if (!canAccess(targetDirectory, fs.constants.W_OK)) {
      blockingReasons.push("搬迁目标目录不可写。");
    }
    if (!canAccess(path.dirname(targetDirectory), fs.constants.W_OK)) {
      blockingReasons.push("搬迁目标的父目录不可写，无法执行可恢复的目录切换。");
    }
  }

  if (sourceRootId && targetState !== "absent" && targetState !== "invalid") {
    if (sameOrNested(sourceDirectory, targetDirectory)) {
      blockingReasons.push("搬迁源目录和目标目录不能相同，也不能互相嵌套。");
    }
  }
  for (const root of [sourceDirectory, targetDirectory]) {
    if (detectPathConflicts(input.paths, root).length) {
      blockingReasons.push("搬迁路径不能位于 App 私有 userData 目录，也不能与其重叠。");
      break;
    }
  }
  if ((input.activeRunCount || 0) > 0) {
    blockingReasons.push("有运行中的任务，暂时不能搬迁 mymind 内容。");
  }

  const pendingTransaction = hasPendingTransaction(input.paths, targetDirectory);
  if (pendingTransaction) {
    blockingReasons.push("检测到未完成的搬迁事务，请先完成恢复后再开始新的搬迁。");
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    sourceDirectory,
    targetDirectory,
    sourceRootId,
    sourceFileCount: sourceSummary?.fileCount || 0,
    sourceDirectoryCount: sourceSummary?.directoryCount || 0,
    sourceBytes: sourceSummary?.bytes || 0,
    sourceDigest: sourceSummary?.digest || null,
    targetState,
    targetFileCount: targetSummary?.fileCount || 0,
    targetDirectoryCount: targetSummary?.directoryCount || 0,
    targetBytes: targetSummary?.bytes || 0,
    pendingTransaction,
    canCommit: Boolean(
      sourceSummary
      && targetSummary
      && targetState === "empty"
      && blockingReasons.length === 0
    ),
    blockingReasons: [...new Set(blockingReasons)]
  };
}

/**
 * Copy and verify the tree, then atomically replace the pre-confirmed empty
 * target directory with the staged tree. The old source is never removed.
 */
export function relocateMymind(input: MymindRelocationInput): MymindRelocationReport {
  const preview = previewMymindRelocation(input);
  if (!preview.canCommit || !preview.sourceRootId || !preview.sourceDigest) {
    throw new Error(preview.blockingReasons.join("；") || "mymind 搬迁预检未通过。");
  }

  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const parent = path.dirname(preview.targetDirectory);
  const base = safeName(path.basename(preview.targetDirectory) || "mymind");
  const stagingDirectory = path.join(parent, `${TRANSACTION_PREFIX}${base}-${id}-staging`);
  const backupDirectory = path.join(parent, `${TRANSACTION_PREFIX}${base}-${id}-backup`);
  const markerDirectory = path.join(input.paths.migrations, TRANSACTION_DIRECTORY);
  const pendingMarker = path.join(markerDirectory, `${id}.pending.json`);

  if (fs.existsSync(stagingDirectory) || fs.existsSync(backupDirectory)) {
    throw new Error("搬迁事务临时目录已存在，拒绝覆盖。");
  }

  fs.mkdirSync(stagingDirectory, { recursive: false });
  try {
    copyTree(preview.sourceDirectory, stagingDirectory);
    const staged = snapshotTree(stagingDirectory);
    assertSameTree(preview.sourceDigest, staged, "搬迁 staging 校验失败。");

    const pending: PendingRelocation = {
      schemaVersion: SCHEMA_VERSION,
      status: "pending",
      id,
      sourceDirectory: preview.sourceDirectory,
      targetDirectory: preview.targetDirectory,
      stagingDirectory,
      backupDirectory,
      tree: staged,
      phase: "prepared",
      preparedAt: new Date().toISOString()
    };
    writeJsonAtomic(pendingMarker, pending);

    // The source must not change between the read-only preview and the swap.
    const sourceBeforeSwap = snapshotTree(preview.sourceDirectory);
    assertSameTree(preview.sourceDigest, sourceBeforeSwap, "源 mymind 在搬迁前发生变化，请重新预览。");
    if (inspectTargetState(preview.targetDirectory) !== "empty") {
      throw new Error("搬迁目标在提交前已发生变化，拒绝 merge/overwrite。");
    }

    // Both temporary directories are siblings of the target, so rename does
    // not cross filesystems. The original target is empty by contract.
    fs.renameSync(preview.targetDirectory, backupDirectory);
    pending.phase = "target-moved";
    writeJsonAtomic(pendingMarker, pending);
    fs.renameSync(stagingDirectory, preview.targetDirectory);
    pending.phase = "installed";
    writeJsonAtomic(pendingMarker, pending);

    const targetAfterSwap = snapshotTree(preview.targetDirectory);
    assertSameTree(preview.sourceDigest, targetAfterSwap, "搬迁目标校验失败，保留事务以便恢复。");
    const sourceAfterSwap = snapshotTree(preview.sourceDirectory);
    assertSameTree(preview.sourceDigest, sourceAfterSwap, "搬迁源目录发生变化，保留事务以便恢复。");

    return finalizePendingRelocation(pending, pendingMarker);
  } catch (error) {
    // A pending marker is intentionally retained once it is written. Startup
    // recovery can finish or restore the sibling swap without guessing what
    // belongs to the user. Preparation-only failures clean their own staging.
    if (!fs.existsSync(pendingMarker)) safeRemove(stagingDirectory);
    throw error;
  }
}

function finalizePendingRelocation(pending: PendingRelocation, marker: string): MymindRelocationReport {
  const source = snapshotTree(pending.sourceDirectory);
  assertSameTree(pending.tree.digest, source, "mymind 源目录已变化，不能确认无损搬迁。");
  const target = snapshotTree(pending.targetDirectory);
  assertSameTree(pending.tree.digest, target, "mymind 目标目录未通过无损校验。");
  const report: MymindRelocationReport = {
    schemaVersion: SCHEMA_VERSION,
    status: "committed",
    sourceDirectory: pending.sourceDirectory,
    targetDirectory: pending.targetDirectory,
    sourceRootId: computeRootId(pending.sourceDirectory),
    targetRootId: computeRootId(pending.targetDirectory),
    copiedFileCount: pending.tree.fileCount,
    copiedDirectoryCount: pending.tree.directoryCount,
    copiedBytes: pending.tree.bytes,
    treeDigest: pending.tree.digest,
    sourcePreserved: true,
    verified: true,
    completedAt: new Date().toISOString()
  };
  const backupState = inspectTargetState(pending.backupDirectory);
  if (backupState !== "absent" && backupState !== "empty") {
    throw new Error("mymind 搬迁 backup 不是原先确认的空目录，拒绝完成事务。");
  }
  writeJsonAtomic(marker.replace(/\.pending\.json$/, ".json"), report);
  safeRemove(marker);
  if (isDirectory(pending.stagingDirectory)) safeRemove(pending.stagingDirectory);
  if (inspectTargetState(pending.backupDirectory) === "empty") safeRemove(pending.backupDirectory);
  return report;
}

function snapshotTree(root: string): TreeSummary {
  const entries: TreeEntry[] = [];
  walkTree(root, root, entries);
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const fileCount = entries.filter((entry) => entry.kind === "file").length;
  const directoryCount = entries.filter((entry) => entry.kind === "directory").length;
  const bytes = entries.reduce((total, entry) => total + (entry.size || 0), 0);
  const digest = crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  return { entries, fileCount, directoryCount, bytes, digest };
}

function walkTree(root: string, current: string, entries: TreeEntry[]): void {
  for (const name of fs.readdirSync(current).sort()) {
    const absolute = path.join(current, name);
    const relativePath = path.relative(root, absolute).split(path.sep).join("/");
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`mymind 搬迁拒绝 symlink：${relativePath}`);
    if (stat.isDirectory()) {
      entries.push({ relativePath, kind: "directory" });
      walkTree(root, absolute, entries);
      continue;
    }
    if (!stat.isFile()) throw new Error(`mymind 搬迁拒绝特殊文件：${relativePath}`);
    entries.push({ relativePath, kind: "file", size: stat.size, sha256: hashFile(absolute) });
  }
}

function copyTree(source: string, target: string): void {
  const sourceStat = fs.statSync(source);
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length > 0) {
      throw new Error(`搬迁 staging 目标不是空目录：${target}`);
    }
  } else {
    fs.mkdirSync(target, { recursive: false, mode: sourceStat.mode & 0o7777 });
  }
  for (const name of fs.readdirSync(source).sort()) {
    const from = path.join(source, name);
    const to = path.join(target, name);
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error(`mymind 搬迁拒绝不可复制的文件：${path.relative(source, from)}`);
    }
    if (stat.isDirectory()) {
      copyTree(from, to);
    } else {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      try { fs.chmodSync(to, stat.mode & 0o7777); } catch { /* best effort on Windows */ }
    }
  }
}

function assertSameTree(expectedDigest: string, actual: TreeSummary, message: string): void {
  if (!sameTreeDigest(actual, { digest: expectedDigest } as TreeSummary)) throw new Error(message);
}

function sameTreeDigest(left: TreeSummary, right: Pick<TreeSummary, "digest">): boolean {
  return left.digest === right.digest;
}

function hashFile(filePath: string): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function inspectTargetState(target: string): MymindRelocationPreview["targetState"] {
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return "invalid";
    return fs.readdirSync(target).length === 0 ? "empty" : "non-empty";
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "absent" : "invalid";
  }
}

function canonicalDirectory(candidate: string): string | null {
  try {
    const real = fs.realpathSync(candidate);
    return fs.statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

function canAccess(directory: string, mode: number): boolean {
  try { fs.accessSync(directory, mode); return true; }
  catch { return false; }
}

function sameOrNested(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  const compare = process.platform === "win32" ? (value: string) => value.toLowerCase() : (value: string) => value;
  const aa = compare(a);
  const bb = compare(b);
  return aa === bb || aa.startsWith(`${bb}${path.sep}`) || bb.startsWith(`${aa}${path.sep}`);
}

function hasPendingTransaction(paths: AppPaths, targetDirectory: string): boolean {
  const directory = path.join(paths.migrations, TRANSACTION_DIRECTORY);
  if (!isDirectory(directory)) return false;
  return fs.readdirSync(directory).some((name) => {
    if (!name.endsWith(".pending.json")) return false;
    const pending = readPending(path.join(directory, name));
    return pending?.targetDirectory === targetDirectory;
  });
}

function readPending(filePath: string): PendingRelocation | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<PendingRelocation>;
    if (parsed.schemaVersion !== SCHEMA_VERSION || parsed.status !== "pending"
      || typeof parsed.id !== "string" || typeof parsed.sourceDirectory !== "string"
      || typeof parsed.targetDirectory !== "string" || typeof parsed.stagingDirectory !== "string"
      || typeof parsed.backupDirectory !== "string" || !parsed.tree
      || typeof parsed.tree.digest !== "string" || !["prepared", "target-moved", "installed"].includes(parsed.phase || "")
      || typeof parsed.preparedAt !== "string") return null;
    return parsed as PendingRelocation;
  } catch {
    return null;
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "mymind";
}

function safeRemove(filePath: string): void {
  fs.rmSync(filePath, { recursive: true, force: true });
}

function isDirectory(filePath: string): boolean {
  try { return fs.statSync(filePath).isDirectory(); }
  catch { return false; }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
import type { AppStateBackupManifest, AppStateBackupReport } from "../../shared/state-backup";
import {
  APP_STATE_BACKUP_EXCLUDED_AREAS,
  APP_STATE_BACKUP_KIND,
  APP_STATE_BACKUP_SCHEMA_VERSION,
  AppStateBackupManifestSchema,
  AppStateBackupReportSchema
} from "../../shared/state-backup";
import type { AppPaths } from "../paths/app-paths-service";
import { extractZipArchive, inspectZipArchive } from "../skills/zip-source";
import { replaceFileAtomicallySync, writeJsonAtomic } from "../lib/fs-utils";

const MAX_BACKUP_FILES = 20_000;
const MAX_BACKUP_BYTES = 250 * 1024 * 1024;
const TRANSACTION_PREFIX = "state-backup-restore-";
const MANIFEST_FILE = "manifest.json";
const PAYLOAD_PREFIX = "payload/";

type BackupScopeName = "settings" | "state" | "automation" | "runs";
type BackupScope = { name: BackupScopeName; root: string };
type BackupFile = { logicalPath: string; absolutePath: string };
type RestoreFile = { logicalPath: string; stagedPath: string; targetPath: string };
type RestoreMarker = {
  kind: typeof APP_STATE_BACKUP_KIND;
  schemaVersion: typeof APP_STATE_BACKUP_SCHEMA_VERSION;
  phase: "prepared" | "committing" | "committed";
};

/**
 * Portable application-state backup boundary.
 *
 * The service deliberately does not serialize the whole userData tree:
 * credentials, browser tokens, package/runtime bytes and transient work are
 * either secret, platform-bound or not a recoverable application state.
 */
export class AppStateBackupService {
  private readonly scopes: readonly BackupScope[];

  constructor(
    private readonly paths: AppPaths,
    private readonly now: () => Date = () => new Date()
  ) {
    this.scopes = [
      { name: "settings", root: paths.settings },
      { name: "state", root: paths.state },
      { name: "automation", root: paths.automation },
      { name: "runs", root: paths.runs }
    ];
    fs.mkdirSync(paths.staging, { recursive: true });
    this.recoverPendingRestoreTransactions();
  }

  exportToFile(destinationPath: string): AppStateBackupReport {
    const output = this.assertExternalFilePath(destinationPath, "备份文件");
    const files = this.collectFiles();
    if (files.length > MAX_BACKUP_FILES) throw new Error(`应用状态文件数量超过 ${MAX_BACKUP_FILES}。`);

    const manifestFiles: AppStateBackupManifest["files"] = [];
    const archiveEntries: Record<string, Uint8Array> = {};
    let byteCount = 0;
    for (const file of files) {
      const bytes = new Uint8Array(fs.readFileSync(file.absolutePath));
      byteCount += bytes.byteLength;
      if (byteCount > MAX_BACKUP_BYTES) throw new Error(`应用状态超过 ${MAX_BACKUP_BYTES} 字节。`);
      manifestFiles.push({
        path: file.logicalPath,
        bytes: bytes.byteLength,
        sha256: sha256(bytes)
      });
      archiveEntries[`${PAYLOAD_PREFIX}${file.logicalPath}`] = bytes;
    }

    const createdAt = this.now().toISOString();
    const manifest = AppStateBackupManifestSchema.parse({
      schemaVersion: APP_STATE_BACKUP_SCHEMA_VERSION,
      kind: APP_STATE_BACKUP_KIND,
      createdAt,
      files: manifestFiles
    });
    archiveEntries[MANIFEST_FILE] = new Uint8Array(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"));
    const archive = zipSync(archiveEntries, { level: 6 });
    if (archive.byteLength > MAX_BACKUP_BYTES) throw new Error(`应用状态备份压缩包超过 ${MAX_BACKUP_BYTES} 字节。`);
    this.writeArchiveAtomically(output, archive);
    return this.report("export", createdAt, files.length, byteCount);
  }

  importFromFile(sourcePath: string): AppStateBackupReport {
    const source = this.assertExternalFilePath(sourcePath, "备份文件", { mustExist: true });
    const transaction = fs.mkdtempSync(path.join(this.paths.staging, TRANSACTION_PREFIX));
    let committed = false;
    let rolledBack = false;
    try {
      const archive = inspectZipArchive(source);
      this.validateArchiveEntries(archive.entries);
      const payloadRoot = path.join(transaction, "payload");
      extractZipArchive(archive, transaction);
      const manifest = this.readManifest(path.join(transaction, MANIFEST_FILE));
      const restoreFiles = this.validateManifest(manifest, payloadRoot, archive.entries.map((entry) => entry.logicalPath));
      const byteCount = restoreFiles.reduce((sum, file) => sum + fs.statSync(file.stagedPath).size, 0);

      const previousRoot = path.join(transaction, "previous");
      this.writeMarker(transaction, { phase: "prepared" });
      this.snapshotCurrentState(previousRoot);
      this.writeMarker(transaction, { phase: "committing" });
      try {
        this.applyRestore(restoreFiles);
        this.writeMarker(transaction, { phase: "committed" });
        committed = true;
      } catch (error) {
        try {
          this.restoreSnapshot(previousRoot);
          rolledBack = true;
        } catch (rollbackError) {
          throw new Error(`应用状态恢复失败，且回滚也失败：${formatError(rollbackError)}；原始错误：${formatError(error)}`);
        }
        throw error;
      }

      const report = this.report("import", manifest.createdAt, restoreFiles.length, byteCount);
      return AppStateBackupReportSchema.parse(report);
    } finally {
      if (committed || rolledBack || fs.existsSync(transaction) && !fs.existsSync(path.join(transaction, "marker.json"))) {
        fs.rmSync(transaction, { recursive: true, force: true });
      }
    }
  }

  private report(operation: "export" | "import", createdAt: string, fileCount: number, byteCount: number): AppStateBackupReport {
    return AppStateBackupReportSchema.parse({
      schemaVersion: APP_STATE_BACKUP_SCHEMA_VERSION,
      kind: APP_STATE_BACKUP_KIND,
      operation,
      createdAt,
      fileCount,
      byteCount,
      excludedAreas: [...APP_STATE_BACKUP_EXCLUDED_AREAS]
    });
  }

  private collectFiles(): BackupFile[] {
    return this.scopes
      .flatMap((scope) => this.collectScopeFiles(scope))
      .sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
  }

  private collectScopeFiles(scope: BackupScope): BackupFile[] {
    if (!fs.existsSync(scope.root)) return [];
    this.assertDirectory(scope.root, `${scope.name} 状态目录`);
    const output: BackupFile[] = [];
    this.walkFiles(scope.root, (absolutePath, relativeParts) => {
      if (this.isExcluded(scope.name, relativeParts)) return;
      output.push({
        logicalPath: `${scope.name}/${relativeParts.join("/")}`,
        absolutePath
      });
    }, (relativeParts) => this.isExcluded(scope.name, relativeParts));
    return output;
  }

  private walkFiles(root: string, visit: (absolutePath: string, relativeParts: string[]) => void, skip?: (relativeParts: string[]) => boolean): void {
    const walk = (current: string, relativeParts: string[]) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const next = path.join(current, entry.name);
        const nextParts = [...relativeParts, entry.name];
        if (this.isTemporaryPath(nextParts) || skip?.(nextParts)) continue;
        const stat = fs.lstatSync(next);
        if (stat.isSymbolicLink()) throw new Error(`状态备份拒绝符号链接：${nextParts.join("/")}`);
        if (stat.isDirectory()) {
          walk(next, nextParts);
        } else if (stat.isFile()) {
          visit(next, nextParts);
        } else {
          throw new Error(`状态备份拒绝特殊文件：${nextParts.join("/")}`);
        }
      }
    };
    walk(root, []);
  }

  private isExcluded(scope: BackupScopeName, relativeParts: string[]): boolean {
    if (scope === "runs" && relativeParts.includes("work")) return true;
    if (scope === "state" && relativeParts.some((part) => part === ".runtime" || part === "tmp-images")) return true;
    return false;
  }

  private isTemporaryPath(relativeParts: string[]): boolean {
    return relativeParts.some((part) => /^\.tmp-|^\.bak-|\.lock(?:$|\.)/.test(part));
  }

  private validateArchiveEntries(entries: readonly { logicalPath: string; directory: boolean }[]): void {
    if (entries.length > MAX_BACKUP_FILES + 1) throw new Error(`备份条目数量超过 ${MAX_BACKUP_FILES}。`);
    if (entries.filter((entry) => entry.logicalPath === MANIFEST_FILE).length !== 1) throw new Error("备份缺少唯一 manifest.json。 ");
    for (const entry of entries) {
      if (entry.directory || (entry.logicalPath !== MANIFEST_FILE && (!entry.logicalPath.startsWith(PAYLOAD_PREFIX) || entry.logicalPath.length === PAYLOAD_PREFIX.length))) {
        throw new Error(`备份包含未授权条目：${entry.logicalPath}`);
      }
    }
  }

  private readManifest(filePath: string): AppStateBackupManifest {
    try {
      return AppStateBackupManifestSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    } catch (error) {
      throw new Error(`备份 manifest 无效：${formatError(error)}`);
    }
  }

  private validateManifest(manifest: AppStateBackupManifest, payloadRoot: string, archiveEntries: readonly string[]): RestoreFile[] {
    if (manifest.files.length > MAX_BACKUP_FILES) throw new Error(`备份文件数量超过 ${MAX_BACKUP_FILES}。`);
    const seen = new Set<string>();
    let byteCount = 0;
    const restoreFiles: RestoreFile[] = [];
    for (const item of manifest.files) {
      const targetPath = this.resolveLogicalPath(item.path);
      if (seen.has(item.path)) throw new Error(`备份包含重复状态文件：${item.path}`);
      seen.add(item.path);
      byteCount += item.bytes;
      if (byteCount > MAX_BACKUP_BYTES) throw new Error(`备份状态超过 ${MAX_BACKUP_BYTES} 字节。`);
      const stagedPath = path.join(payloadRoot, ...item.path.split("/"));
      if (!fs.existsSync(stagedPath) || !fs.statSync(stagedPath).isFile()) throw new Error(`备份文件缺失：${item.path}`);
      const bytes = fs.readFileSync(stagedPath);
      if (bytes.byteLength !== item.bytes || sha256(bytes) !== item.sha256.toLowerCase()) {
        throw new Error(`备份文件校验失败：${item.path}`);
      }
      restoreFiles.push({ logicalPath: item.path, stagedPath, targetPath });
    }
    const expectedEntries = new Set([MANIFEST_FILE, ...manifest.files.map((item) => `${PAYLOAD_PREFIX}${item.path}`)]);
    for (const entry of archiveEntries) {
      if (!expectedEntries.has(entry)) throw new Error(`备份包含未声明条目：${entry}`);
    }
    return restoreFiles;
  }

  private resolveLogicalPath(logicalPath: string): string {
    if (!logicalPath || logicalPath.includes("\\") || logicalPath.startsWith("/") || logicalPath.includes("\0")) {
      throw new Error(`备份状态路径无效：${logicalPath}`);
    }
    const parts = logicalPath.split("/");
    if (parts.length < 2 || parts.some((part) => !part || part === "." || part === "..")) {
      throw new Error(`备份状态路径无效：${logicalPath}`);
    }
    const scope = this.scopes.find((candidate) => candidate.name === parts[0]);
    if (!scope) throw new Error(`备份状态目录未授权：${logicalPath}`);
    const relativeParts = parts.slice(1);
    if (this.isTemporaryPath(relativeParts) || this.isExcluded(scope.name, relativeParts)) {
      throw new Error(`备份状态路径位于排除范围：${logicalPath}`);
    }
    const targetPath = path.join(scope.root, ...relativeParts);
    const relative = path.relative(scope.root, targetPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`备份状态路径越界：${logicalPath}`);
    }
    return targetPath;
  }

  private snapshotCurrentState(previousRoot: string): void {
    fs.mkdirSync(previousRoot, { recursive: true });
    for (const scope of this.scopes) {
      for (const file of this.collectScopeFiles(scope)) {
        const relativeParts = file.logicalPath.split("/").slice(1);
        const target = path.join(previousRoot, scope.name, ...relativeParts);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(file.absolutePath, target);
      }
    }
  }

  private applyRestore(files: RestoreFile[]): void {
    this.clearRestoreScope();
    for (const file of files) {
      const bytes = fs.readFileSync(file.stagedPath);
      fs.mkdirSync(path.dirname(file.targetPath), { recursive: true });
      const temporary = `${file.targetPath}.tmp-restore-${process.pid}-${crypto.randomUUID()}`;
      try {
        fs.writeFileSync(temporary, bytes, { flag: "wx" });
        replaceFileAtomicallySync(temporary, file.targetPath);
      } finally {
        if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
      }
    }
  }

  private clearRestoreScope(): void {
    for (const scope of this.scopes) {
      for (const file of this.collectScopeFiles(scope)) fs.rmSync(file.absolutePath, { force: true });
    }
  }

  private restoreSnapshot(previousRoot: string): void {
    this.clearRestoreScope();
    for (const scope of this.scopes) {
      const sourceRoot = path.join(previousRoot, scope.name);
      if (!fs.existsSync(sourceRoot)) continue;
      this.walkFiles(sourceRoot, (sourcePath, relativeParts) => {
        const targetPath = path.join(scope.root, ...relativeParts);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(sourcePath, targetPath);
      });
    }
  }

  private writeArchiveAtomically(destinationPath: string, archive: Uint8Array): void {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    const temporary = `${destinationPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
      fs.writeFileSync(temporary, archive, { flag: "wx" });
      replaceFileAtomicallySync(temporary, destinationPath);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
  }

  private writeMarker(transaction: string, patch: Pick<RestoreMarker, "phase">): void {
    writeJsonAtomic(path.join(transaction, "marker.json"), {
      kind: APP_STATE_BACKUP_KIND,
      schemaVersion: APP_STATE_BACKUP_SCHEMA_VERSION,
      ...patch
    } satisfies RestoreMarker);
  }

  private recoverPendingRestoreTransactions(): void {
    if (!fs.existsSync(this.paths.staging)) return;
    for (const entry of fs.readdirSync(this.paths.staging, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(TRANSACTION_PREFIX)) continue;
      const transaction = path.join(this.paths.staging, entry.name);
      const markerPath = path.join(transaction, "marker.json");
      if (!fs.existsSync(markerPath)) {
        fs.rmSync(transaction, { recursive: true, force: true });
        continue;
      }
      let marker: RestoreMarker;
      try {
        marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as RestoreMarker;
      } catch (error) {
        throw new Error(`发现无法读取的状态恢复事务：${formatError(error)}`);
      }
      if (marker.kind !== APP_STATE_BACKUP_KIND || marker.schemaVersion !== APP_STATE_BACKUP_SCHEMA_VERSION) {
        throw new Error("发现未知的状态恢复事务，拒绝覆盖现有状态。 ");
      }
      if (marker.phase === "committing") {
        this.restoreSnapshot(path.join(transaction, "previous"));
      }
      fs.rmSync(transaction, { recursive: true, force: true });
    }
  }

  private assertDirectory(filePath: string, label: string): void {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} 不是普通目录，拒绝备份。`);
  }

  private assertExternalFilePath(filePath: string, label: string, options: { mustExist?: boolean } = {}): string {
    if (!path.isAbsolute(filePath)) throw new Error(`${label}必须是绝对路径。`);
    const absolute = path.resolve(filePath);
    if (isInside(absolute, this.paths.userData)) throw new Error(`${label}不能位于 App 私有目录内。`);
    const stat = (() => {
      try { return fs.lstatSync(absolute); } catch { return null; }
    })();
    if (stat?.isSymbolicLink()) throw new Error(`${label}不能是符号链接。`);
    if (stat && !stat.isFile()) throw new Error(`${label}不是普通文件。`);
    if (options.mustExist && !stat) throw new Error(`${label}不存在。`);
    const parent = path.dirname(absolute);
    if (fs.existsSync(parent) && isInside(fs.realpathSync(parent), this.paths.userData)) {
      throw new Error(`${label}不能通过符号链接指向 App 私有目录。`);
    }
    return absolute;
  }
}

function sha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function isInside(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

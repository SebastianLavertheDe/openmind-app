import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface WslPath {
  distro: string;
  linuxPath: string;
}

export function parseWslPath(value: string): WslPath | null {
  const normalized = value.replaceAll("/", "\\");
  const match = normalized.match(/^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\(.*)$/i);
  if (!match) return null;
  return { distro: match[1], linuxPath: `/${match[2].replaceAll("\\", "/")}` };
}

function isReplaceUnsupported(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EXDEV" || code === "ENOTSUP";
}

function replaceWithBackupSync(temporary: string, target: string): void {
  const backup = `${target}.bak-${process.pid}-${crypto.randomUUID()}`;
  let hasBackup = false;
  let completed = false;
  try {
    fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
    hasBackup = true;
    fs.copyFileSync(temporary, target);
    fs.rmSync(temporary, { force: true });
    completed = true;
  } catch (error) {
    if (hasBackup && fs.existsSync(backup)) {
      try {
        fs.copyFileSync(backup, target);
        fs.rmSync(backup, { force: true });
      } catch {
        // Keep the backup for manual recovery if restoring the original also fails.
      }
    }
    throw error;
  } finally {
    if (completed && fs.existsSync(backup)) fs.rmSync(backup, { force: true });
  }
}

/** 原子替换目标文件（含 WSL 路径与 EPERM/EXDEV 回退）。product 与 ai 层共用。 */
export function replaceFileAtomicallySync(temporary: string, target: string): void {
  const sourceWsl = parseWslPath(temporary);
  const targetWsl = parseWslPath(target);
  if (process.platform === "win32" && sourceWsl && targetWsl && sourceWsl.distro.toLocaleLowerCase() === targetWsl.distro.toLocaleLowerCase()) {
    try {
      execFileSync("wsl.exe", ["-d", sourceWsl.distro, "--", "mv", "-f", "--", sourceWsl.linuxPath, targetWsl.linuxPath], {
        windowsHide: true,
        timeout: 15_000,
        stdio: ["ignore", "ignore", "pipe"]
      });
      return;
    } catch {
      // Fall through to the guarded compatibility path if WSL command execution is unavailable.
    }
  }
  try {
    fs.renameSync(temporary, target);
    return;
  } catch (error) {
    if (!isReplaceUnsupported(error) || !fs.existsSync(target)) throw error;
  }
  replaceWithBackupSync(temporary, target);
}

/** JSON 原子写（product 与 ai session 层共用，替代各处的 private atomicJson）。 */
export function writeJsonAtomic(filePath: string, value: unknown, options?: { onlyIfMissing?: boolean }): void {
  if (options?.onlyIfMissing && fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    replaceFileAtomicallySync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

/** 文本原子写（creative 文稿保存等）；可在落盘前收紧临时文件权限。 */
export function writeTextAtomic(filePath: string, value: string, options: { mode?: number } = {}): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporary, value, { encoding: "utf8", ...(options.mode === undefined ? {} : { mode: options.mode }) });
    if (options.mode !== undefined) {
      try { fs.chmodSync(temporary, options.mode); } catch { /* Windows may not expose POSIX modes. */ }
    }
    replaceFileAtomicallySync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

export type CopyDirectoryOptions = {
  force?: boolean;
  errorOnExist?: boolean;
  preserveTimestamps?: boolean;
};

/**
 * Copy a directory tree without relying on fs.cpSync.
 *
 * Node's Windows fs.cpSync path currently terminates the host process for
 * some non-ASCII directory names. Desktop content paths are user-controlled
 * and commonly contain Chinese names, so the app-owned copy boundary uses
 * the smaller, explicit fs primitives instead.
 */
export function copyDirectoryRecursively(source: string, target: string, options: CopyDirectoryOptions = {}): void {
  const sourceStat = fs.lstatSync(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error(`复制源不是目录：${source}`);
  const targetStat = lstatIfExists(target);
  if (targetStat) {
    if (options.errorOnExist) {
      const error = Object.assign(new Error(`目标已存在：${target}`), { code: "EEXIST" });
      throw error;
    }
    if (!options.force) throw Object.assign(new Error(`目标已存在：${target}`), { code: "EEXIST" });
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) fs.rmSync(target, { recursive: true, force: true });
  }
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    copyDirectoryEntry(path.join(source, entry.name), path.join(target, entry.name), options);
  }
  if (options.preserveTimestamps) preserveDirectoryTimestamps(target, sourceStat);
}

function copyDirectoryEntry(source: string, target: string, options: CopyDirectoryOptions): void {
  const sourceStat = fs.lstatSync(source);
  const targetStat = lstatIfExists(target);
  if (sourceStat.isSymbolicLink()) {
    if (targetStat) {
      if (options.errorOnExist) throw Object.assign(new Error(`目标已存在：${target}`), { code: "EEXIST" });
      if (!options.force) throw Object.assign(new Error(`目标已存在：${target}`), { code: "EEXIST" });
      fs.rmSync(target, { recursive: true, force: true });
    }
    let windowsLinkType: "junction" | "file" = "file";
    if (process.platform === "win32") {
      try { windowsLinkType = fs.statSync(source).isDirectory() ? "junction" : "file"; } catch { /* Preserve dangling links as file links. */ }
    }
    fs.symlinkSync(fs.readlinkSync(source), target, process.platform === "win32" ? windowsLinkType : undefined);
    return;
  }
  if (sourceStat.isDirectory()) {
    if (targetStat && (!targetStat.isDirectory() || targetStat.isSymbolicLink())) {
      if (options.errorOnExist || !options.force) throw Object.assign(new Error(`目标已存在：${target}`), { code: "EEXIST" });
      fs.rmSync(target, { recursive: true, force: true });
    }
    copyDirectoryRecursively(source, target, options);
    return;
  }
  if (targetStat && options.errorOnExist) throw Object.assign(new Error(`目标已存在：${target}`), { code: "EEXIST" });
  if (targetStat && !options.force) throw Object.assign(new Error(`目标已存在：${target}`), { code: "EEXIST" });
  fs.copyFileSync(source, target);
  if (options.preserveTimestamps) {
    try { fs.utimesSync(target, sourceStat.atime, sourceStat.mtime); } catch { /* Timestamp preservation is best effort on Windows. */ }
  }
}

function lstatIfExists(filePath: string): fs.Stats | null {
  try { return fs.lstatSync(filePath); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function preserveDirectoryTimestamps(target: string, sourceStat: fs.Stats): void {
  try { fs.utimesSync(target, sourceStat.atime, sourceStat.mtime); } catch { /* Timestamp preservation is best effort on Windows. */ }
}

/** 目录移动（rename 失败时 copy+rm，跨设备/权限回退）。 */
export function moveDirectoryWithFallback(source: string, target: string): void {
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if (!isReplaceUnsupported(error)) throw error;
    copyDirectoryRecursively(source, target, { errorOnExist: true });
    fs.rmSync(source, { recursive: true, force: false });
  }
}

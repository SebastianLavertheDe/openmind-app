import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";

export const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 20_000;
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
export const MAX_ARCHIVE_COMPRESSION_RATIO = 1_000;

export type SkillArchiveErrorCode =
  | "archive-invalid"
  | "archive-too-large"
  | "archive-too-many-files"
  | "archive-compression-ratio"
  | "archive-entry-forbidden";

export class SkillArchiveError extends Error {
  constructor(readonly code: SkillArchiveErrorCode, message: string, readonly entryPath?: string) {
    super(message);
    this.name = "SkillArchiveError";
  }
}

export type SkillArchiveEntry = {
  name: string;
  logicalPath: string;
  compressedSize: number;
  uncompressedSize: number;
  directory: boolean;
};

export type SkillArchive = {
  sourcePath: string;
  entries: SkillArchiveEntry[];
  totalCompressedBytes: number;
  totalUncompressedBytes: number;
};

/** Parse and validate ZIP metadata before fflate is allowed to decompress it. */
export function inspectZipArchive(sourcePath: string): SkillArchive {
  const absolutePath = path.resolve(sourcePath);
  let bytes: Buffer;
  try { bytes = fs.readFileSync(absolutePath); }
  catch (error) { throw new SkillArchiveError("archive-invalid", error instanceof Error ? error.message : String(error)); }
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new SkillArchiveError("archive-too-large", `ZIP 压缩包超过 ${MAX_ARCHIVE_BYTES} 字节。`);

  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) throw new SkillArchiveError("archive-invalid", "ZIP 缺少 End of Central Directory。");
  if (readUInt16(bytes, eocd + 4) !== 0 || readUInt16(bytes, eocd + 6) !== 0) {
    throw new SkillArchiveError("archive-invalid", "不支持多磁盘 ZIP。");
  }
  const entryCount = readUInt16(bytes, eocd + 10);
  const centralSize = readUInt32(bytes, eocd + 12);
  const centralOffset = readUInt32(bytes, eocd + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new SkillArchiveError("archive-invalid", "不支持 ZIP64 压缩包。");
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES || centralOffset + centralSize > bytes.length) {
    throw new SkillArchiveError("archive-too-many-files", `ZIP 条目数量超过 ${MAX_ARCHIVE_ENTRIES} 或目录边界无效。`);
  }

  const entries: SkillArchiveEntry[] = [];
  const names = new Set<string>();
  let cursor = centralOffset;
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > bytes.length || readUInt32(bytes, cursor) !== 0x02014b50) {
      throw new SkillArchiveError("archive-invalid", `ZIP central directory 在第 ${index + 1} 项损坏。`);
    }
    const flags = readUInt16(bytes, cursor + 8);
    const method = readUInt16(bytes, cursor + 10);
    const compressedSize = readUInt32(bytes, cursor + 20);
    const uncompressedSize = readUInt32(bytes, cursor + 24);
    const nameLength = readUInt16(bytes, cursor + 28);
    const extraLength = readUInt16(bytes, cursor + 30);
    const commentLength = readUInt16(bytes, cursor + 32);
    const externalAttributes = readUInt32(bytes, cursor + 38);
    const localHeaderOffset = readUInt32(bytes, cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length || localHeaderOffset >= bytes.length) throw new SkillArchiveError("archive-invalid", "ZIP central directory 边界无效。");

    const name = decodeZipName(bytes.subarray(cursor + 46, cursor + 46 + nameLength), flags);
    const logicalPath = normaliseArchivePath(name);
    if (!logicalPath || !isSafeArchivePath(logicalPath) || names.has(logicalPath)) {
      throw new SkillArchiveError("archive-entry-forbidden", `ZIP 条目路径不安全或重复：${name}`, name);
    }
    if ((flags & 0x1) !== 0) throw new SkillArchiveError("archive-entry-forbidden", `不支持加密 ZIP 条目：${name}`, name);
    if (method !== 0 && method !== 8) throw new SkillArchiveError("archive-invalid", `不支持 ZIP 压缩方法 ${method}：${name}`, name);
    const unixMode = externalAttributes >>> 16;
    const unixType = unixMode & 0xf000;
    if (unixType === 0xa000 || (unixType !== 0 && unixType !== 0x4000)) {
      throw new SkillArchiveError("archive-entry-forbidden", `ZIP 不允许符号链接或特殊文件：${name}`, name);
    }

    const directory = name.endsWith("/") || unixType === 0x4000 || (externalAttributes & 0x10) !== 0;
    names.add(logicalPath);
    totalCompressedBytes += compressedSize;
    totalUncompressedBytes += uncompressedSize;
    entries.push({ name, logicalPath, compressedSize, uncompressedSize, directory });
    cursor = end;
  }
  if (totalUncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
    throw new SkillArchiveError("archive-too-large", `ZIP 解压后超过 ${MAX_ARCHIVE_UNCOMPRESSED_BYTES} 字节。`);
  }
  if (totalCompressedBytes > 0 && totalUncompressedBytes / totalCompressedBytes > MAX_ARCHIVE_COMPRESSION_RATIO) {
    throw new SkillArchiveError("archive-compression-ratio", `ZIP 压缩比超过 ${MAX_ARCHIVE_COMPRESSION_RATIO}，疑似压缩炸弹。`);
  }
  return { sourcePath: absolutePath, entries, totalCompressedBytes, totalUncompressedBytes };
}

/** Extract only after metadata validation; all entries become ordinary files. */
export function extractZipArchive(archive: SkillArchive, destination: string): void {
  let bytes: Buffer;
  try { bytes = fs.readFileSync(archive.sourcePath); }
  catch (error) { throw new SkillArchiveError("archive-invalid", error instanceof Error ? error.message : String(error)); }
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes) as Record<string, Uint8Array>; }
  catch (error) { throw new SkillArchiveError("archive-invalid", error instanceof Error ? error.message : String(error)); }
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of archive.entries) {
    if (entry.directory) continue;
    const content = files[entry.name] || files[entry.logicalPath];
    if (!content) throw new SkillArchiveError("archive-invalid", `ZIP 条目无法读取：${entry.name}`, entry.name);
    const target = path.join(destination, ...entry.logicalPath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  const start = Math.max(0, bytes.length - 65_557);
  for (let index = bytes.length - 22; index >= start; index--) {
    if (readUInt32(bytes, index) === 0x06054b50) return index;
  }
  return -1;
}

function readUInt16(bytes: Buffer, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32(bytes: Buffer, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function decodeZipName(bytes: Uint8Array, flags: number): string {
  if ((flags & 0x800) !== 0) return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return Buffer.from(bytes).toString("latin1");
}

function normaliseArchivePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function isSafeArchivePath(value: string): boolean {
  return !value.includes("\0") && !value.startsWith("/") && !value.startsWith("//")
    && !/^[A-Za-z]:\//.test(value)
    && value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

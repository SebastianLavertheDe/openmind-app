import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { messages } from "../../shared/messages";
import { CONTENT_PREVIEW_MAX_BYTES } from "../../shared/content-kinds";

export const CONTENT_PREVIEW_BYTES = CONTENT_PREVIEW_MAX_BYTES;

function assertFile(stat: fs.Stats): void {
  if (!stat.isFile()) throw new Error(messages.errors.file.notAFile);
}

function bufferFor(stat: fs.Stats): Buffer {
  assertFile(stat);
  // One lookahead byte distinguishes a complete file from a truncated prefix.
  return Buffer.allocUnsafe(Math.min(stat.size, CONTENT_PREVIEW_BYTES) + 1);
}

function decode(buffer: Buffer, bytesRead: number) {
  const truncated = bytesRead === buffer.length;
  const decoder = new StringDecoder("utf8");
  const content = decoder.write(buffer.subarray(0, truncated ? bytesRead - 1 : bytesRead));
  // Do not turn a multibyte character split at the limit into a replacement glyph.
  return { content: content + (truncated ? "" : decoder.end()), truncated };
}

/** Bounded synchronous variant for the index worker and synchronous save results. */
export function readTextPrefixSync(filePath: string) {
  // Reject FIFOs/devices before opening: opening a FIFO itself can block.
  assertFile(fs.statSync(filePath));
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = bufferFor(fs.fstatSync(fd));
    let total = 0;
    while (total < buffer.length) {
      const count = fs.readSync(fd, buffer, total, buffer.length - total, total);
      if (!count) break;
      total += count;
    }
    return decode(buffer, total);
  } finally {
    fs.closeSync(fd);
  }
}

/** Main-process preview I/O must yield rather than read the complete file. */
export async function readTextPrefix(filePath: string) {
  assertFile(await fs.promises.stat(filePath));
  const file = await fs.promises.open(filePath, "r");
  try {
    const buffer = bufferFor(await file.stat());
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    return decode(buffer, total);
  } finally {
    await file.close();
  }
}

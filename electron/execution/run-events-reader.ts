import fs from "node:fs";
import path from "node:path";
import { BrokerRunEventSchema, type BrokerRunEvent } from "../../shared/execution-contracts";

const MAX_FILE_BYTES = 8 * 1024 * 1024 + 128 * 1024;
const MAX_CACHED_BYTES = 64 * 1024 * 1024;
type Position = { sequence: number; offset: number; length: number };
type FileIndex = { identity: string; stamp: string; size: number; tail: number; positions: Position[] };
type EventPosition = Position & { file: string };
type RunIndex = { files: Map<string, FileIndex>; order: EventPosition[]; bytes: number };
const caches = new Map<string, RunIndex>();

export type RunEventsPage = { events: BrokerRunEvent[]; nextAfter: number | null };

/**
 * A derived, bounded sequence/byte-offset index for the append-only broker log.
 * No file handles or log text are retained. Unchanged polls only stat the files;
 * appends index the new suffix, and pagination reads just the requested rows.
 * Replacement, truncation and same-size edits rebuild the affected file index.
 */
export function readRunEventsPage(runsRoot: string, runId: string, after = -1, limit = 200): RunEventsPage {
  if (!/^[a-zA-Z0-9-]{1,120}$/.test(runId) || !Number.isSafeInteger(after) || after < -1
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid run event page.");
  const root = fs.realpathSync(runsRoot);
  const key = `${root}\0${runId}`;
  const cached = caches.get(key);
  const index: RunIndex = cached ?? { files: new Map(), order: [], bytes: 0 };
  const opened = new Map<string, number>();
  let changed = false;
  try {
    const present = new Set<string>();
    for (const suffix of [".3", ".2", ".1", ""]) {
      const file = path.join(root, runId, `events.jsonl${suffix}`);
      let actual: string;
      try { actual = fs.realpathSync(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      if (!actual.startsWith(`${root}${path.sep}`)) throw new Error("Run log path escapes its data root.");
      const descriptor = fs.openSync(actual, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      opened.set(file, descriptor);
      const stat = fs.fstatSync(descriptor, { bigint: true });
      if (!stat.isFile() || stat.size > BigInt(MAX_FILE_BYTES)) throw new Error("Run log is invalid or exceeds its size limit.");
      present.add(file);
      const stamp = fileStamp(stat);
      const previous = index.files.get(file);
      if (previous?.stamp === stamp) continue;
      const identity = `${stat.dev}:${stat.ino}`;
      const size = Number(stat.size);
      // The broker only appends within one file identity. A partial final line
      // is retried together with the appended bytes, never silently discarded.
      const append = previous?.identity === identity && size > previous.size;
      const start = append ? previous.tail : 0;
      const positions = append ? previous.positions.filter(row => row.offset < start) : [];
      const bytes = Buffer.alloc(size - start);
      readExactly(descriptor, bytes, start);
      let offset = 0;
      let tail = start;
      while (offset < bytes.length) {
        const newline = bytes.indexOf(10, offset);
        const end = newline < 0 ? bytes.length : newline;
        if (end > offset) {
          try {
            const event = BrokerRunEventSchema.parse(JSON.parse(bytes.toString("utf8", offset, end)));
            if (event.runId === runId) positions.push({ sequence: event.sequence, offset: start + offset, length: end - offset });
          } catch { /* Malformed lines remain on disk; an incomplete tail is retried on append. */ }
        }
        if (newline < 0) break;
        offset = newline + 1;
        tail = start + offset;
      }
      if (fileStamp(fs.fstatSync(descriptor, { bigint: true })) !== stamp) throw new Error("Run log changed while reading; retry.");
      index.files.set(file, { identity, stamp, size, tail, positions });
      changed = true;
    }
    for (const file of index.files.keys()) {
      if (!present.has(file)) { index.files.delete(file); changed = true; }
    }
    if (changed) {
      index.order = [...index.files].flatMap(([file, value]) => value.positions.map(row => ({ ...row, file })))
        .sort((left, right) => left.sequence - right.sequence);
      index.bytes = [...index.files.values()].reduce((total, value) => total + value.size, 0);
    }
    let low = 0, high = index.order.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (index.order[middle].sequence <= after) low = middle + 1;
      else high = middle;
    }
    const positions = index.order.slice(low, low + limit);
    const events = positions.map(row => {
      const bytes = Buffer.alloc(row.length);
      readExactly(opened.get(row.file)!, bytes, row.offset);
      return BrokerRunEventSchema.parse(JSON.parse(bytes.toString("utf8")));
    });
    // Cached offsets are derived data, never an authority for a changed file.
    for (const [file, descriptor] of opened) {
      if (fileStamp(fs.fstatSync(descriptor, { bigint: true })) !== index.files.get(file)!.stamp) throw new Error("Run log changed while reading; retry.");
    }
    caches.delete(key); caches.set(key, index);
    let total = [...caches.values()].reduce((sum, value) => sum + value.bytes, 0);
    while (caches.size > 8 || total > MAX_CACHED_BYTES) {
      const oldest = caches.keys().next().value!;
      total -= caches.get(oldest)!.bytes;
      caches.delete(oldest);
    }
    return { events, nextAfter: low + limit < index.order.length ? events.at(-1)!.sequence : null };
  } catch (error) {
    caches.delete(key);
    throw error;
  } finally {
    for (const descriptor of opened.values()) fs.closeSync(descriptor);
  }
}

function fileStamp(stat: fs.BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

function readExactly(descriptor: number, bytes: Buffer, position: number): void {
  let offset = 0;
  while (offset < bytes.length) {
    const length = fs.readSync(descriptor, bytes, offset, bytes.length - offset, position + offset);
    if (!length) throw new Error("Run log changed while reading; retry.");
    offset += length;
  }
}

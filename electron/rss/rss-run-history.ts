import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { BrokerRunRecordSchema, type BrokerRunRecord } from "../../shared/execution-contracts";
import { RssErrorSchema, type RssSourceRun } from "../../shared/rss-contracts";

const ResultSchema = z.object({ results: z.array(z.object({
  sourceId: z.string(), status: z.enum(["succeeded", "failed", "skipped"]),
  updated: z.number().int().nonnegative().optional(), collected: z.number().int().nonnegative().optional(),
  error: RssErrorSchema.optional(), reason: z.string().optional()
})) });
type RunSummary = Pick<BrokerRunRecord, "id" | "rssContext" | "createdAt" | "completedAt" | "state">;
type Outcome = z.infer<typeof ResultSchema>["results"][number];
type CachedFile = { stamp: string; bytes: number; value: RunSummary | Map<string, Outcome> | null };
const histories = new Map<string, RssRunHistory>();

/** Readers are recreated by IPC, while this derived index belongs to a root. */
export function rssRunHistory(contentRoot: string, runsRoot: string): RssRunHistory {
  const content = fs.realpathSync(contentRoot);
  const runs = fs.existsSync(runsRoot) ? fs.realpathSync(runsRoot) : path.resolve(runsRoot);
  const key = `${content}\0${runs}`;
  let history = histories.get(key);
  if (!history) history = new RssRunHistory(content, runs);
  histories.delete(key); histories.set(key, history);
  while (histories.size > 2) histories.delete(histories.keys().next().value!);
  return history;
}

class RssRunHistory {
  private readonly files = new Map<string, CachedFile>();
  private readonly results = new Map<string, CachedFile>();
  private records: RunSummary[] = [];
  private refreshedAt = 0;
  private directoryStamp = "";

  constructor(private readonly contentRoot: string, private readonly runsRoot: string) {}

  page(sourceId: string, before: string | undefined, limit: number): RssSourceRun[] {
    if (!fs.existsSync(this.runsRoot)) { this.files.clear(); this.results.clear(); this.records = []; this.refreshedAt = 0; return []; }
    const stamp = fingerprint(fs.statSync(this.runsRoot, { bigint: true }));
    // A continuation reuses the recent ordered snapshot. The visible first-page
    // poll refreshes file identities, so changed statuses/results are picked up
    // without re-parsing immutable terminal history on every page.
    if (!before || !this.refreshedAt || Date.now() - this.refreshedAt >= 5000 || stamp !== this.directoryStamp) {
      this.refresh(stamp);
    }
    let low = 0, high = this.records.length;
    if (before) {
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (runKey(this.records[middle]).localeCompare(before) >= 0) low = middle + 1;
        else high = middle;
      }
    }
    const rows: RssSourceRun[] = [];
    for (let index = low; index < this.records.length && rows.length < limit; index++) {
      // The order snapshot is reusable; source/root authority and displayed
      // state are checked again for the handful of rows actually returned.
      const run = this.readRun(this.records[index].id);
      if (!run) continue;
      const row = this.row(run, this.readResults(run.id), sourceId);
      if (row) rows.push(row);
    }
    return rows;
  }

  get(runId: string, sourceId: string): RssSourceRun | null {
    const run = this.readRun(runId);
    if (!run) return null;
    const results = this.readResults(runId);
    return this.row(run, results, sourceId);
  }

  private refresh(stamp: string): void {
    const activeFiles = new Set<string>();
    const records: RunSummary[] = [];
    for (const entry of fs.readdirSync(this.runsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9-]{1,120}$/.test(entry.name)) continue;
      const run = this.readRun(entry.name);
      activeFiles.add(path.join(this.runsRoot, entry.name, "run.json"));
      if (!run) continue;
      activeFiles.add(path.join(this.runsRoot, entry.name, "work", "result.json"));
      records.push(run);
    }
    for (const file of this.files.keys()) if (!activeFiles.has(file)) this.files.delete(file);
    for (const file of this.results.keys()) if (!activeFiles.has(file)) this.results.delete(file);
    this.records = records.sort((left, right) => runKey(right).localeCompare(runKey(left)));
    this.directoryStamp = stamp;
    this.refreshedAt = Date.now();
  }

  private readRun(runId: string): RunSummary | null {
    return this.readFile(path.join(this.runsRoot, runId, "run.json"), 1024 * 1024, raw => {
      const parsed = BrokerRunRecordSchema.safeParse(raw);
      if (!parsed.success || parsed.data.id !== runId || parsed.data.request.skillId !== "rss-article-saver"
        || parsed.data.rssContext?.root !== this.contentRoot) return null;
      const { id, rssContext, createdAt, completedAt, state } = parsed.data;
      return { id, rssContext, createdAt, completedAt, state };
    }) as RunSummary | null;
  }

  private readResults(runId: string): Map<string, Outcome> {
    const results = this.readFile(path.join(this.runsRoot, runId, "work", "result.json"), 8 * 1024 * 1024, raw => {
      const parsed = ResultSchema.safeParse(raw);
      // Match the former Array.find semantics if a malformed producer repeats
      // a source ID. Never infer per-source success from the batch state.
      const results = new Map<string, Outcome>();
      if (parsed.success) for (const result of parsed.data.results) if (!results.has(result.sourceId)) results.set(result.sourceId, result);
      return results;
    }, this.results) as Map<string, Outcome> ?? new Map();
    let bytes = [...this.results.values()].reduce((total, value) => total + value.bytes, 0);
    while (this.results.size > 128 || bytes > 16 * 1024 * 1024) {
      const oldest = this.results.keys().next().value!;
      bytes -= this.results.get(oldest)!.bytes; this.results.delete(oldest);
    }
    return results;
  }

  private row(run: RunSummary, results: Map<string, Outcome>, sourceId: string): RssSourceRun | null {
    const result = results.get(sourceId);
    if (!result && !run.rssContext!.sourceIds.includes(sourceId)) return null;
    return { id: run.id, mode: run.rssContext!.mode, createdAt: run.createdAt, completedAt: run.completedAt, state: run.state,
      outcome: result?.status || null, updated: result?.updated ?? null, collected: result?.collected ?? null,
      error: result?.error || null, reason: result?.reason || null };
  }

  private readFile(file: string, maxBytes: number, parse: (value: unknown) => CachedFile["value"], cache = this.files): CachedFile["value"] {
    if (!fs.existsSync(file)) { cache.delete(file); return null; }
    const actual = fs.realpathSync(file);
    if (!actual.startsWith(`${this.runsRoot}${path.sep}`)) throw new Error("RSS query path escapes its data root.");
    const stat = fs.statSync(actual, { bigint: true });
    if (!stat.isFile() || stat.size > BigInt(maxBytes)) throw new Error("RSS query file is invalid or exceeds its size limit.");
    const stamp = `${actual}:${fingerprint(stat)}`;
    const cached = cache.get(file);
    if (cached?.stamp === stamp) { cache.delete(file); cache.set(file, cached); return cached.value; }
    const descriptor = fs.openSync(actual, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const buffer = Buffer.alloc(Number(stat.size));
      let length = 0;
      while (length < buffer.length) {
        const bytes = fs.readSync(descriptor, buffer, length, buffer.length - length, length);
        if (!bytes) throw new Error("RSS query file changed; retry.");
        length += bytes;
      }
      if (fingerprint(fs.fstatSync(descriptor, { bigint: true })) !== fingerprint(stat)) throw new Error("RSS query file changed; retry.");
      let value: CachedFile["value"];
      try { value = parse(JSON.parse(buffer.toString("utf8", 0, length))); }
      catch { value = null; } // Preserve corrupt history on disk.
      cache.set(file, { stamp, bytes: Number(stat.size), value });
      return value;
    } finally { fs.closeSync(descriptor); }
  }
}

function fingerprint(stat: fs.BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.nlink}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}
function runKey(run: Pick<RssSourceRun, "createdAt" | "id">): string { return `${run.createdAt}|${run.id}`; }

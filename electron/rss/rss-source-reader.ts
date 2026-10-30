import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { BrokerRunEventSchema, BrokerRunRecordSchema, type BrokerRunRecord } from "../../shared/execution-contracts";
import { RssEntriesQuerySchema, RssErrorSchema, RssRunEventsQuerySchema, RssRunsQuerySchema, RssUrlSchema,
  type RssEntriesQuery, type RssEntriesPage, type RssEntry, type RssRunEventsQuery, type RssRunEventsPage,
  type RssRunsQuery, type RssRunsPage, type RssSourceRun } from "../../shared/rss-contracts";
import { rssPrivateDirectory } from "./file-lock";
import type { RssRepository } from "./rss-repository";

const MAX_FEED = 8 * 1024 * 1024;
const ResultSchema = z.object({ results: z.array(z.object({
  sourceId: z.string(), status: z.enum(["succeeded", "failed", "skipped"]),
  updated: z.number().int().nonnegative().optional(), collected: z.number().int().nonnegative().optional(),
  error: RssErrorSchema.optional(), reason: z.string().optional()
})) });
const CursorSchema = z.object({ scope: z.string(), version: z.string().optional(), offset: z.number().int().nonnegative().optional(), before: z.string().optional() }).strict();
const hash = (text: string | Buffer) => crypto.createHash("sha256").update(text).digest("hex");
const encode = (value: z.infer<typeof CursorSchema>) => Buffer.from(JSON.stringify(value)).toString("base64url");

type ParsedFeed = { stamp: string; version: string; entries: RssEntry[]; bytes: number };
// The IPC reader is recreated per request. Cache by canonical file AND base URL,
// with a bounded LRU shared by readers in this process (the entries worker).
const feedCache = new Map<string, ParsedFeed>();
function parsedFeed(root: string, file: string, baseUrl: string): ParsedFeed | null {
  if (!fs.existsSync(file)) return null;
  const actual = fs.realpathSync(file);
  if (!actual.startsWith(fs.realpathSync(root) + path.sep)) throw new Error("RSS query path escapes its data root.");
  const stat = fs.statSync(actual);
  if (!stat.isFile() || stat.size > MAX_FEED) throw new Error("RSS query file is invalid or exceeds its size limit.");
  const stamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`;
  const key = `${actual}\0${baseUrl}`;
  const cached = feedCache.get(key);
  if (cached?.stamp === stamp) { feedCache.delete(key); feedCache.set(key, cached); return cached; }
  feedCache.delete(key);
  const content = readBounded(root, file, MAX_FEED);
  if (!content) return null;
  const entries = parseEntries(content.toString("utf8"), baseUrl);
  const result = { stamp, version: hash(content), entries, bytes: content.length + Buffer.byteLength(JSON.stringify(entries)) };
  feedCache.set(key, result);
  let bytes = [...feedCache.values()].reduce((total, value) => total + value.bytes, 0);
  while (feedCache.size > 8 || bytes > 24 * 1024 * 1024) {
    const oldest = feedCache.keys().next().value!;
    bytes -= feedCache.get(oldest)!.bytes; feedCache.delete(oldest);
  }
  return result;
}

/** Read-only queries. No converter, provider, installed package or network access. */
export class RssSourceReader {
  constructor(private repository: RssRepository, private runsRoot: string) {}

  entries(raw: RssEntriesQuery): RssEntriesPage {
    const input = RssEntriesQuerySchema.parse(raw);
    this.assertRoot(input.rootKey);
    const source = this.source(input.sourceId);
    const scope = this.scope(source.id, "entries");
    const cursor = this.cursor(input.cursor, scope);
    const file = rssPrivateDirectory(this.repository.root, ".agent", "skill-data", "rss-article-saver", "feeds", `${source.id}.xml`);
    const feed = parsedFeed(this.repository.root, file, source.inputUrl);
    if (feed === null) return { entries: [], total: 0, status: "missing", version: null, nextCursor: null, reset: Boolean(cursor) };
    const { version, entries } = feed;
    const reset = Boolean(cursor && cursor.version !== version);
    const offset = !reset ? cursor?.offset || 0 : 0;
    if (offset > entries.length) throw new Error("Invalid RSS page cursor.");
    const end = offset + input.limit;
    return { entries: entries.slice(offset, end), total: entries.length, version, reset,
      status: source.feedRevision === source.revision ? "ready" : "outdated",
      nextCursor: end < entries.length ? encode({ scope, version, offset: end }) : null };
  }

  runs(raw: RssRunsQuery): RssRunsPage {
    const input = RssRunsQuerySchema.parse(raw);
    this.assertRoot(input.rootKey);
    this.source(input.sourceId);
    const scope = this.scope(input.sourceId, "runs");
    const cursor = this.cursor(input.cursor, scope);
    const records = this.records().filter(run => !cursor?.before || runKey(run) < cursor.before);
    const rows: RssSourceRun[] = [];
    for (const record of records) {
      const row = this.sourceRun(record, input.sourceId);
      if (row) rows.push(row);
      if (rows.length > input.limit) break;
    }
    const runs = rows.slice(0, input.limit);
    const last = runs.at(-1);
    return { runs, nextCursor: rows.length > input.limit && last ? encode({ scope, before: `${last.createdAt}|${last.id}` }) : null };
  }

  events(raw: RssRunEventsQuery): RssRunEventsPage {
    const input = RssRunEventsQuerySchema.parse(raw);
    this.assertRoot(input.rootKey);
    this.source(input.sourceId);
    const file = path.join(this.runsRoot, input.runId, "run.json");
    const bytes = readBounded(this.runsRoot, file, 1024 * 1024);
    const record = bytes && BrokerRunRecordSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (!record || !this.belongsToRoot(record) || !this.sourceRun(record, input.sourceId)) throw new Error("RSS run is unavailable for this source.");
    const events = [3, 2, 1, 0].flatMap(index => {
      const content = readBounded(this.runsRoot, path.join(this.runsRoot, input.runId, index ? `events.jsonl.${index}` : "events.jsonl"), MAX_FEED + 128 * 1024);
      return content ? content.toString("utf8").split("\n").filter(Boolean).flatMap(line => {
        try { const event = BrokerRunEventSchema.parse(JSON.parse(line)); return event.runId === input.runId && event.sequence > input.after ? [event] : []; }
        catch { return []; } // A live append may end in an incomplete line; the next query retries it.
      }) : [];
    }).sort((a, b) => a.sequence - b.sequence);
    const page = events.slice(0, input.limit);
    return { events: page, nextAfter: events.length > input.limit ? page.at(-1)!.sequence : null };
  }

  private assertRoot(key?: string) { if (key && key !== this.repository.rootKey()) throw new Error("Content folder changed; refresh the source list."); }
  private source(id: string) {
    const source = this.repository.read().sources.find(row => row.id === id);
    if (!source) throw new Error("RSS source was deleted; refresh the source list.");
    return source;
  }
  private scope(id: string, kind: string) { return hash(`${fs.realpathSync(this.repository.root)}\0${id}\0${kind}`); }
  private cursor(value: string | undefined, scope: string) {
    if (!value) return null;
    try {
      const cursor = CursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
      if (cursor.scope !== scope) throw new Error();
      return cursor;
    } catch { throw new Error("Invalid RSS page cursor."); }
  }
  private belongsToRoot(run: BrokerRunRecord) {
    return run.request.skillId === "rss-article-saver" && run.rssContext?.root === fs.realpathSync(this.repository.root);
  }
  private records(): BrokerRunRecord[] {
    if (!fs.existsSync(this.runsRoot)) return [];
    return fs.readdirSync(this.runsRoot, { withFileTypes: true }).flatMap(entry => {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9-]{1,120}$/.test(entry.name)) return [];
      const bytes = readBounded(this.runsRoot, path.join(this.runsRoot, entry.name, "run.json"), 1024 * 1024);
      if (!bytes) return [];
      try {
        const run = BrokerRunRecordSchema.parse(JSON.parse(bytes.toString("utf8")));
        return run.id === entry.name && this.belongsToRoot(run) ? [run] : [];
      } catch { return []; } // Preserve malformed and pre-binding history without guessing its root.
    }).sort((a, b) => runKey(b).localeCompare(runKey(a)));
  }
  private sourceRun(run: BrokerRunRecord, sourceId: string): RssSourceRun | null {
    const bytes = readBounded(this.runsRoot, path.join(this.runsRoot, run.id, "work", "result.json"), MAX_FEED);
    let result: z.infer<typeof ResultSchema>["results"][number] | undefined;
    if (bytes) {
      try { result = ResultSchema.parse(JSON.parse(bytes.toString("utf8"))).results.find(row => row.sourceId === sourceId); }
      catch { /* Never infer a source outcome from the batch terminal status. */ }
    }
    if (!result && !run.rssContext?.sourceIds.includes(sourceId)) return null;
    return { id: run.id, mode: run.rssContext!.mode, createdAt: run.createdAt, completedAt: run.completedAt, state: run.state,
      outcome: result?.status || null, updated: result?.updated ?? null, collected: result?.collected ?? null,
      error: result?.error || null, reason: result?.reason || null };
  }
}

function runKey(run: BrokerRunRecord) { return `${run.createdAt}|${run.id}`; }

function readBounded(root: string, file: string, max: number): Buffer | null {
  if (!fs.existsSync(file)) return null;
  const canonical = fs.realpathSync(root);
  const actual = fs.realpathSync(file);
  if (!actual.startsWith(canonical + path.sep)) throw new Error("RSS query path escapes its data root.");
  const descriptor = fs.openSync(actual, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > max) throw new Error("RSS query file is invalid or exceeds its size limit.");
    const buffer = Buffer.alloc(Math.min(stat.size + 1, max + 1));
    const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    if (length > max || length > stat.size) throw new Error("RSS query file changed; retry.");
    return buffer.subarray(0, length);
  } finally { fs.closeSync(descriptor); }
}

export function parseEntries(xml: string, baseUrl: string): RssEntry[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Invalid RSS XML.");
  // Markup-looking text in CDATA/comments is not XML nesting. Respect quoted
  // attribute values as well, so '>' inside an attribute cannot bypass the cap.
  const structure = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, "");
  let depth = 0;
  for (const tag of structure.matchAll(/<\/?[A-Za-z](?:"[^"]*"|'[^']*'|[^'">])*>/g)) {
    if (tag[0].startsWith("</")) depth--;
    else if (!tag[0].endsWith("/>")) depth++;
    if (depth > 128) throw new Error("RSS XML nesting exceeds its limit.");
  }
  const doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, isArray: name => ["item", "entry", "link"].includes(name) }).parse(xml);
  const rows = doc.rss?.channel?.item || doc.feed?.entry || doc.RDF?.item;
  if (!doc.rss && !doc.feed && !doc.RDF) throw new Error("Expected RSS or Atom XML.");
  const text = (value: unknown): string => typeof value === "string" ? value : value && typeof value === "object" ? text((value as Record<string, unknown>)["#text"]) : "";
  return (Array.isArray(rows) ? rows : []).flatMap((row): RssEntry[] => {
    const title = text(row.title).trim().slice(0, 2000);
    const links = Array.isArray(row.link) ? row.link : [];
    const link = links.find((item: Record<string, unknown>) => typeof item === "string" || !item["@_rel"] || item["@_rel"] === "alternate");
    const rawUrl = typeof link === "object" ? String(link?.["@_href"] || text(link)) : text(link);
    if (!title || !rawUrl) return [];
    let url: string;
    try { url = RssUrlSchema.parse(new URL(rawUrl, baseUrl).href); } catch { return []; }
    const date = Date.parse(text(row.pubDate || row.published || row.updated || row.date));
    return [{ title, url, publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null }];
  }).sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RssRepository } from "./rss-repository";
import { RssSourceReader, parseEntries } from "./rss-source-reader";
import { RunStore } from "../execution/run-store";
import { SkillRunRequestSchema } from "../../shared/execution-contracts";
import type { RssCatalog } from "../../shared/rss-contracts";

const roots: string[] = [];
const temp = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "rss-source-query-")); roots.push(root); return root; };
const catalog: RssCatalog = { schemaVersion: 1, adapters: [], sources: [{ id: "one", name: "One", inputUrl: "https://one.test/", kind: "feed", adapterId: "feed", enabled: true, group: "blog", tags: [], legacyAliases: [] }, { id: "two", name: "Two", inputUrl: "https://two.test/", kind: "feed", adapterId: "feed", enabled: true, group: "", tags: [], legacyAliases: [] }] };
function fixture() { const root = temp(), runs = temp(), repository = new RssRepository(root, catalog); repository.read(); return { root, runs, repository, reader: new RssSourceReader(repository, runs) }; }
function write(file: string, content: string) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
function feed(repository: RssRepository, xml: string) { const file = repository.view().sources[0].localFeed.path; write(file, xml); return file; }
const xml = (count = 65) => `<rss><channel>${Array.from({ length: count }, (_, i) => `<item><title>Article ${i}</title><link>https://one.test/${i}</link>${i ? `<pubDate>${new Date(Date.UTC(2026, 0, i)).toUTCString()}</pubDate>` : ""}</item>`).join("")}</channel></rss>`;
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

describe("bounded local RSS entries", () => {
  it("paginates real XML, sorts dates, puts unknown last and invalidates old versions", () => {
    const { repository, reader } = fixture(); feed(repository, xml());
    const first = reader.entries({ sourceId: "one" });
    expect(first).toMatchObject({ total: 65, status: "outdated", reset: false });
    expect(first.entries).toHaveLength(30); expect(first.entries[0].title).toBe("Article 64");
    const second = reader.entries({ sourceId: "one", cursor: first.nextCursor! });
    expect(second.entries[0].title).toBe("Article 34");
    const last = reader.entries({ sourceId: "one", cursor: second.nextCursor! });
    expect(last.entries.at(-1)).toMatchObject({ title: "Article 0", publishedAt: null });
    expect(last.nextCursor).toBeNull();
    repository.mutate(doc => { doc.sources[0].feedRevision = doc.sources[0].revision; });
    feed(repository, xml(2));
    expect(reader.entries({ sourceId: "one", cursor: first.nextCursor! })).toMatchObject({ reset: true, total: 2, status: "ready" });
  });
  it("reports missing files and rejects cross-source, cross-root and arbitrary-path queries", () => {
    const { repository, reader } = fixture(); const other = fixture();
    expect(reader.entries({ sourceId: "one" }).status).toBe("missing"); feed(repository, xml());
    const page = reader.entries({ sourceId: "one", rootKey: repository.rootKey() });
    expect(() => reader.entries({ sourceId: "two", cursor: page.nextCursor! })).toThrow(/cursor/);
    expect(() => other.reader.entries({ sourceId: "one", cursor: page.nextCursor! })).toThrow(/cursor/);
    expect(() => other.reader.entries({ sourceId: "one", rootKey: repository.rootKey() })).toThrow(/folder changed/);
    expect(() => reader.entries({ sourceId: "../one" })).toThrow();
    expect(() => reader.entries({ sourceId: "one", path: "/etc/passwd" } as never)).toThrow();
    expect(() => reader.entries({ sourceId: "one", limit: 101 })).toThrow();
    repository.remove("one", 1); expect(() => reader.entries({ sourceId: "one" })).toThrow(/deleted/);
  });
  it("validates XML, file size and real paths without fetching external resources", () => {
    const { repository, reader } = fixture();
    const file = feed(repository, "<!DOCTYPE rss [<!ENTITY ext SYSTEM 'https://bad.test/'>]><rss/>");
    expect(() => reader.entries({ sourceId: "one" })).toThrow(/XML/);
    write(file, "<rss>"); expect(() => reader.entries({ sourceId: "one" })).toThrow(/XML/);
    write(file, "x".repeat(8 * 1024 * 1024 + 1)); expect(() => reader.entries({ sourceId: "one" })).toThrow(/size limit/);
    fs.unlinkSync(file); const outside = path.join(temp(), "feed.xml"); write(outside, xml()); fs.symlinkSync(outside, file);
    expect(() => reader.entries({ sourceId: "one" })).toThrow(/escapes/);
  });
  it("reuses a parsed feed across readers, but invalidates replacements and rejects new escaping symlinks", () => {
    const { root, runs, repository, reader } = fixture(); const file = feed(repository, xml());
    const read = vi.spyOn(fs, "openSync");
    try {
      const first = reader.entries({ sourceId: "one" });
      const count = () => read.mock.calls.filter(args => args[0] === fs.realpathSync(file)).length;
      const before = count();
      new RssSourceReader(repository, runs).entries({ sourceId: "one", cursor: first.nextCursor! });
      expect(count()).toBe(before);
      const replacement = path.join(root, "replacement.xml"); write(replacement, xml(3)); fs.renameSync(replacement, file);
      expect(reader.entries({ sourceId: "one", cursor: first.nextCursor! })).toMatchObject({ total: 3, reset: true });
      fs.unlinkSync(file); const outside = path.join(temp(), "outside.xml"); write(outside, xml()); fs.symlinkSync(outside, file);
      expect(() => reader.entries({ sourceId: "one" })).toThrow(/escapes/);
    } finally { read.mockRestore(); }
  });
  it("accepts Atom and RDF dates, resolves links and rejects executable URLs", () => {
    const entries = parseEntries('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A &amp; B</title><link rel="self" href="https://one.test/feed"/><link rel="alternate" href="/article"/><updated>2026-10-28</updated></entry><entry><title>Bad</title><link href="javascript:alert(1)"/></entry></feed>', "https://one.test/");
    expect(entries).toEqual([{ title: "A & B", url: "https://one.test/article", publishedAt: "2026-10-28T00:00:00.000Z" }]);
    expect(parseEntries(`<rss><channel><item><title>CDATA</title><link>/article</link><description><![CDATA[${"<b>".repeat(150)}]]></description></item></channel></rss>`, "https://one.test/")).toHaveLength(1);
    expect(() => parseEntries(`<rss>${'<nested attribute="/> ">'.repeat(130)}${"</nested>".repeat(130)}</rss>`, "https://one.test/")).toThrow(/nesting/);
    expect(parseEntries('<rdf:RDF xmlns:rdf="urn:rdf"><item><title>RDF</title><link>https://one.test/rdf</link><dc:date xmlns:dc="urn:dc">2026-10-27</dc:date></item></rdf:RDF>', "https://one.test/")[0].publishedAt).toBe("2026-10-27T00:00:00.000Z");
  });
});

describe("source-scoped run history", () => {
  function run(runs: string, root: string, id: string, sourceIds = ["one", "two"], bound = true) {
    const store = new RunStore(runs);
    store.create(SkillRunRequestSchema.parse({ skillId: "rss-article-saver", inputs: {}, providerBindings: {}, trigger: { type: "manual" }, rootGeneration: 1 }), id);
    if (bound) store.bindRssContext(id, { root: fs.realpathSync(root), mode: "pipeline", sourceIds });
    return store;
  }
  it("uses the current source result, never the batch state, and excludes other roots and unbound legacy history", () => {
    const { root, runs, reader } = fixture();
    const store = run(runs, root, "partial"); store.transition("partial", "inspecting"); store.transition("partial", "failed");
    write(path.join(runs, "partial/work/result.json"), JSON.stringify({ results: [{ sourceId: "one", status: "succeeded", updated: 9, collected: 4 }, { sourceId: "two", status: "failed", updated: 8, collected: 0, error: { stage: "collect", code: "access-denied", message: "403", retryable: false } }] }));
    run(runs, temp(), "another-root"); run(runs, root, "legacy", ["one"], false); run(runs, root, "other-source", ["two"]); run(runs, root, "pending", ["one"]);
    const rows = reader.runs({ sourceId: "one" }).runs;
    expect(rows.map(row => row.id).sort()).toEqual(["partial", "pending"]);
    expect(rows.find(row => row.id === "partial")).toMatchObject({ state: "failed", outcome: "succeeded", updated: 9, collected: 4 });
    expect(rows.find(row => row.id === "pending")).toMatchObject({ state: "queued", outcome: null, updated: null, collected: null });
    expect(reader.runs({ sourceId: "two" }).runs.find(row => row.id === "partial")).toMatchObject({ outcome: "failed", error: { stage: "collect" } });
    expect(() => reader.events({ sourceId: "one", runId: "another-root" })).toThrow(/unavailable/);
    expect(() => reader.events({ sourceId: "one", runId: "other-source" })).toThrow(/unavailable/);
    expect(() => reader.events({ sourceId: "one", runId: "../partial" })).toThrow();
    const logs = reader.events({ sourceId: "one", runId: "partial", limit: 1 });
    expect(logs.events).toHaveLength(1); expect(logs.nextAfter).not.toBeNull();
    expect(reader.events({ sourceId: "one", runId: "partial", after: logs.nextAfter! }).events.every(event => event.sequence > logs.nextAfter!)).toBe(true);
  });
  it("pages by stable run keys and binds context only once", () => {
    const { root, runs, reader } = fixture();
    for (let i = 0; i < 23; i++) run(runs, root, `run-${String(i).padStart(2, "0")}`);
    const first = reader.runs({ sourceId: "one" }); expect(first.runs).toHaveLength(20);
    const next = reader.runs({ sourceId: "one", cursor: first.nextCursor! }); expect(next.runs).toHaveLength(3);
    expect(new Set([...first.runs, ...next.runs].map(row => row.id)).size).toBe(23);
    expect(() => reader.runs({ sourceId: "two", cursor: first.nextCursor! })).toThrow(/cursor/);
    expect(() => new RunStore(runs).bindRssContext("run-00", { root: temp(), mode: "sync", sourceIds: [] })).toThrow();
  });
});

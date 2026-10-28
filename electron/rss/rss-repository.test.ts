import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { RssRepository } from "./rss-repository";
import { withRssLock, waitForRssMutation } from "./file-lock";
import type { RssCatalog } from "../../shared/rss-contracts";
import { RSS_TOPIC_IDS } from "../../shared/rss-categories";

const roots: string[] = [];
const catalog: RssCatalog = { schemaVersion: 1, adapters: [], sources: [{ id: "preset-one", name: "Design", inputUrl: "https://example.org/feed?Language=EN", kind: "feed", adapterId: "feed", enabled: true, group: "Research", tags: [], legacyAliases: ["https://raw.githubusercontent.com/SebastianLavertheDe/blog-rss-feed/main/rss/design.xml"] }] };
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "rss-contract-")); roots.push(root); return { root, repository: new RssRepository(root, catalog) }; }
function file(root: string, relative: string, value: string) { const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); return target; }
function opml(outlines: string) { return `<opml version="2.0"><body>${outlines}</body></opml>`; }
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

describe("RSS persistent registry", () => {
  it("assigns every bundled source a reviewed topic while retaining channel tags", () => {
    const bundled: RssCatalog = JSON.parse(fs.readFileSync(path.resolve("config/rss-sources/catalog.json"), "utf8"));
    expect(bundled.sources).toHaveLength(227);
    expect(new Set(bundled.sources.map(source => source.id)).size).toBe(227);
    expect(new Set(bundled.sources.map(source => source.group))).toEqual(new Set(RSS_TOPIC_IDS));
    for (const source of bundled.sources) expect(source.tags.some(tag => tag === "blog" || tag === "WeChat")).toBe(true);
    for (const [name, group] of [["OpenAI Blog", "ai"], ["LangChain Blog", "agents"], ["向阳乔木推荐看", "prompts"], ["L先生说", "life"]]) {
      expect(bundled.sources.find(source => source.name === name)?.group).toBe(group);
    }
  });
  it.each([true, false])("migrates channel groups once without losing source state (current=%s)", current => {
    const { root, repository } = fixture(); const old = repository.read(); delete old.categoryVersion;
    const first = old.sources[0]; first.group = "blog"; first.feedRevision = current ? first.revision : 0;
    first.lastError = { stage: "collect", code: "access-denied", message: "403", retryable: false };
    first.lastSyncAt = "2026-10-27T08:00:00Z"; first.tags = ["reading"];
    old.sources.push({ ...first, id: "custom", presetId: null, inputUrl: "https://custom.test/feed", group: "My reading" },
      { ...first, id: "changed", inputUrl: "https://changed.test/feed", group: "WeChat" },
      { ...first, id: "empty", inputUrl: "https://empty.test/feed", group: "" });
    old.deletedPresetIds = ["removed-preset"];
    fs.writeFileSync(repository.file, JSON.stringify(old));
    const feed = file(root, `.agent/skill-data/rss-article-saver/feeds/${first.id}.xml`, "<rss/>");
    const migrated = repository.read();
    expect(migrated).toMatchObject({ categoryVersion: 1, revision: old.revision + 1, deletedPresetIds: old.deletedPresetIds });
    expect(migrated.sources[0]).toEqual({ ...first, group: "Research", tags: ["reading", "blog"], revision: first.revision + 1, feedRevision: current ? first.revision + 1 : 0 });
    expect(migrated.sources[1]).toEqual(old.sources[1]); expect(migrated.sources[3]).toEqual(old.sources[3]);
    expect(migrated.sources[2]).toMatchObject({ id: "changed", inputUrl: "https://changed.test/feed", group: "", tags: ["reading", "WeChat"] });
    expect(fs.readFileSync(feed, "utf8")).toBe("<rss/>");
    const bytes = fs.readFileSync(repository.file, "utf8");
    expect(new RssRepository(root, catalog).read()).toEqual(migrated);
    expect(fs.readFileSync(repository.file, "utf8")).toBe(bytes);
    repository.update({ id: first.id, revision: migrated.sources[0].revision, group: "WeChat" });
    expect(new RssRepository(root, catalog).read().sources[0].group).toBe("WeChat");
  });
  it("maps legacy OPML channels to topics and keeps custom OPML groups", () => {
    const { root, repository } = fixture();
    file(root, ".agent/skill-data/rss-article-saver/subscriptions.opml", opml(`<outline text="blog"><outline text="Original" xmlUrl="${catalog.sources[0].legacyAliases[0]}"/></outline><outline text="My topics"><outline text="Personal" xmlUrl="https://personal.test/feed"/></outline>`));
    const document = repository.read();
    expect(document.sources[0]).toMatchObject({ group: "Research", tags: ["blog"] });
    expect(document.sources[1]).toMatchObject({ group: "My topics" });
  });
  it("reuses category names across case, whitespace and full-width input", () => {
    const { repository } = fixture();
    const input = { name: "Second", inputUrl: "https://second.test/feed", group: " research ", enabled: true };
    const document = repository.add(input, { ...input, kind: "feed", resolvedFeedUrl: input.inputUrl, adapterId: "feed", candidates: [] });
    expect(document.sources[1].group).toBe("Research");
    const updated = repository.update({ id: document.sources[1].id, revision: 1, group: "ＡＩ" });
    expect(updated.sources[1].group).toBe("ai");
  });
  it.each([true, false])("persists group-only edits without clearing errors or reviving stale feeds (current=%s)", current => {
    const { root, repository } = fixture(); const original = repository.read().sources[0];
    repository.mutate(doc => { doc.sources[0].feedRevision = current ? original.revision : 0; doc.sources[0].lastError = { stage: "collect", code: "access-denied", message: "403", retryable: false }; });
    const saved = repository.update({ id: original.id, revision: original.revision, group: "My OPML group" }).sources[0];
    expect(saved).toMatchObject({ group: "My OPML group", revision: 2, feedRevision: current ? 2 : 0, lastError: { stage: "collect", code: "access-denied" } });
    expect(new RssRepository(root, catalog).read().sources[0]).toEqual(saved);
    expect(() => repository.update({ id: original.id, revision: original.revision, group: "" })).toThrow(/changed/);
  });
  it("exposes the local RSS location and current file status without persisting display metadata", () => {
    const { root, repository } = fixture();
    const initial = repository.view().sources[0];
    const feed = path.join(fs.realpathSync(root), ".agent", "skill-data", "rss-article-saver", "feeds", `${initial.id}.xml`);
    expect(initial.localFeed).toEqual({ path: feed, status: "missing" });
    file(root, path.relative(root, feed), "<rss/>");
    expect(repository.view().sources[0].localFeed.status).toBe("outdated");
    repository.mutate(doc => { doc.sources[0].feedRevision = doc.sources[0].revision; });
    expect(repository.view().sources[0].localFeed.status).toBe("ready");
    expect(JSON.parse(fs.readFileSync(repository.file, "utf8")).sources[0].localFeed).toBeUndefined();
    fs.unlinkSync(feed);
    expect(repository.view().sources[0].localFeed.status).toBe("missing");
  });
  it("rejects RSS locations redirected outside the selected content root", () => {
    const { root, repository } = fixture(); repository.read();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "rss-feed-outside-")); roots.push(outside);
    fs.symlinkSync(outside, path.join(repository.directory, "feeds"), process.platform === "win32" ? "junction" : "dir");
    expect(() => repository.view()).toThrow(/escapes/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
  it("starts with visible disabled presets and preserves deletion, empty lists and content across restarts", () => {
    const { root, repository } = fixture(); const initial = repository.read();
    expect(initial.sources[0].enabled).toBe(false);
    file(root, "article/old.md", "user content");
    repository.remove(initial.sources[0].id, initial.sources[0].revision);
    const next = new RssRepository(root, catalog).read();
    expect(next.sources).toEqual([]); expect(next.deletedPresetIds).toEqual(["preset-one"]);
    expect(fs.readFileSync(path.join(root, "article/old.md"), "utf8")).toBe("user content");
  });
  it("expands nested legacy OPML, restores original URLs, and merges old disabling settings", () => {
    const { root, repository } = fixture(); const base = ".agent/skill-data/rss-article-saver";
    file(root, base + "/subscriptions.opml", opml('<outline text="Group" type="include" url="child.opml"/>'));
    const alias = catalog.sources[0].legacyAliases[0];
    file(root, ".agent/skills/rss-article-saver/child.opml", opml(`<outline text="Original" xmlUrl="${alias}"/><outline text="Private" xmlUrl="https://example.net/feed?user=mine"/>`));
    const oldId = crypto.createHash("sha1").update(`rss:${alias}`).digest("hex");
    file(root, ".openmind/source-settings.json", JSON.stringify({ sources: { [oldId]: { name: "My design", enabled: false, tags: ["ux"] } }, disabledUrls: ["https://example.net/feed?user=mine"] }));
    const doc = repository.read();
    expect(doc.sources).toHaveLength(2);
    expect(doc.sources[0]).toMatchObject({ name: "My design", enabled: false, tags: ["ux"], inputUrl: catalog.sources[0].inputUrl, group: "Group" });
    expect(doc.sources[1]).toMatchObject({ inputUrl: "https://example.net/feed?user=mine", enabled: false });
    expect(new RssRepository(root, catalog).read()).toEqual(doc);
    expect(fs.existsSync(path.join(root, base, "migration-backup.opml"))).toBe(true);
  });
  it.each([['missing child', '<outline type="include" url="absent.opml"/>'], ['cycle', '<outline type="include" url="subscriptions.opml"/>'], ['invalid XML', '<outline>']])("fails atomically on %s", (_name, outline) => {
    const { root, repository } = fixture(); file(root, ".agent/skill-data/rss-article-saver/subscriptions.opml", opml(outline));
    expect(() => repository.read()).toThrow(); expect(fs.existsSync(repository.file)).toBe(false);
  });
  it("keeps unknown old repository URLs pending without rewriting other GitHub feeds", () => {
    const { root, repository } = fixture(); file(root, ".agent/skill-data/rss-article-saver/subscriptions.opml", opml('<outline text="Unknown" xmlUrl="https://raw.githubusercontent.com/SebastianLavertheDe/blog-rss-feed/main/rss/missing.xml"/><outline text="Other" xmlUrl="https://raw.githubusercontent.com/other/feeds/main/rss.xml"/>'));
    const rows = repository.read().sources; expect(rows[0]).toMatchObject({ inputUrl: "", enabled: false, lastError: { code: "unmapped-source" } }); expect(rows[1].inputUrl).toContain("/other/");
  });
  it("checks revisions and preserves semantically distinct URLs", () => {
    const { repository } = fixture(); const first = repository.read().sources[0];
    repository.update({ id: first.id, revision: first.revision, enabled: true });
    expect(() => repository.update({ id: first.id, revision: first.revision, enabled: false })).toThrow(/changed/);
    const input = { name: "Second", inputUrl: "https://example.org/feed?Language=en", enabled: true };
    repository.add(input, { ...input, kind: "feed", resolvedFeedUrl: input.inputUrl, adapterId: "feed", candidates: [] });
    expect(repository.read().sources).toHaveLength(2);
    expect(() => repository.add(input, { ...input, kind: "feed", resolvedFeedUrl: input.inputUrl, adapterId: "feed", candidates: [] })).toThrow(/exists/);
  });
  it.each([catalog.sources[0].inputUrl, catalog.sources[0].legacyAliases[0]])("imports %s with a distinct identity after its preset URL was edited", (originalUrl) => {
    const { root, repository } = fixture();
    const initial = repository.read().sources[0];
    const changedUrl = "https://example.net/custom-feed";
    repository.update({ id: initial.id, revision: initial.revision, inputUrl: changedUrl }, {
      inputUrl: changedUrl, kind: "feed", adapterId: "feed", resolvedFeedUrl: changedUrl, candidates: []
    });
    const imported = file(root, "import.opml", opml(`<outline text="Original" xmlUrl="${originalUrl}"/>`));
    const rows = repository.importOpml(imported).sources;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(row => row.id)).size).toBe(2);
    expect(rows[0]).toMatchObject({ id: initial.id, inputUrl: changedUrl, enabled: false });
    expect(rows[1]).toMatchObject({ inputUrl: catalog.sources[0].inputUrl, presetId: initial.presetId, enabled: true, feedRevision: 0 });
    expect(repository.importOpml(imported).sources).toEqual(rows);
    const restarted = new RssRepository(root, catalog);
    restarted.update({ id: rows[1].id, revision: rows[1].revision, enabled: false });
    expect(restarted.read().sources[0]).toEqual(rows[0]);
    restarted.remove(rows[1].id, rows[1].revision + 1);
    expect(restarted.read().sources).toEqual([rows[0]]);
  });
  it("freezes preferences with optimistic saving and rejects escaping state symlinks", () => {
    const { root, repository } = fixture(); const saved = repository.savePreferences({ revision: 0, text: "Design research, English, at most 2 items" });
    expect(repository.preferences()).toEqual(saved);
    expect(() => repository.savePreferences({ revision: 0, text: "stale" })).toThrow(/changed/);
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "rss-outside-")); roots.push(external);
    fs.rmSync(path.join(root, ".agent/preferences"), { recursive: true }); fs.symlinkSync(external, path.join(root, ".agent/preferences"), process.platform === "win32" ? "junction" : "dir");
    expect(() => repository.preferences()).toThrow(/escapes/);
  });
  it("shares exclusive lock ownership and reclaims dead owners", () => {
    const { repository } = fixture();
    withRssLock(repository.directory, "registry", () => expect(() => repository.read()).toThrow(/busy/));
    file(repository.directory, "registry.lock", JSON.stringify({ pid: 2147483647, token: "dead" }));
    expect(repository.read().sources).toHaveLength(1);
  });
  it("waits for a live startup lock, but surfaces configuration failures without retry", async () => {
    const { repository } = fixture();
    const lockFile = file(repository.directory, "registry.lock", JSON.stringify({ pid: process.pid, token: "other-command" }));
    const pending = waitForRssMutation(() => repository.read());
    setTimeout(() => fs.unlinkSync(lockFile), 70);
    expect((await pending).sources).toHaveLength(1);
    await expect(waitForRssMutation(() => { throw new Error("invalid configuration"); })).rejects.toThrow("invalid configuration");
  });
});

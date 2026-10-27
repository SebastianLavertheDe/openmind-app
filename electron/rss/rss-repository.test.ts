import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { RssRepository } from "./rss-repository";
import { withRssLock, waitForRssMutation } from "./file-lock";
import type { RssCatalog } from "../../shared/rss-contracts";

const roots: string[] = [];
const catalog: RssCatalog = { schemaVersion: 1, adapters: [], sources: [{ id: "preset-one", name: "Design", inputUrl: "https://example.org/feed?Language=EN", kind: "feed", adapterId: "feed", enabled: true, group: "Research", tags: [], legacyAliases: ["https://raw.githubusercontent.com/SebastianLavertheDe/blog-rss-feed/main/rss/design.xml"] }] };
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "rss-contract-")); roots.push(root); return { root, repository: new RssRepository(root, catalog) }; }
function file(root: string, relative: string, value: string) { const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); return target; }
function opml(outlines: string) { return `<opml version="2.0"><body>${outlines}</body></opml>`; }
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

describe("RSS persistent registry", () => {
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
  it("freezes preferences with optimistic saving and rejects escaping state symlinks", () => {
    const { root, repository } = fixture(); const saved = repository.savePreferences({ revision: 0, text: "Design research, English, at most 2 items" });
    expect(repository.preferences()).toEqual(saved);
    expect(() => repository.savePreferences({ revision: 0, text: "stale" })).toThrow(/changed/);
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "rss-outside-")); roots.push(external);
    fs.rmSync(path.join(root, ".agent/preferences"), { recursive: true }); fs.symlinkSync(external, path.join(root, ".agent/preferences"), "dir");
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

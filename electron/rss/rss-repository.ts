import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { RssDocumentSchema, RssSourceSchema, rssUrlIdentity, type RssCatalog, type RssDocument, type RssDocumentView, type RssSource, type RssDetection, type RssSourceInput, type RssSourcePatch } from "../../shared/rss-contracts";
import { DailyBriefPreferencesSchema, SaveDailyBriefPreferencesSchema, type DailyBriefPreferences } from "../../shared/daily-brief-preferences";
import { writeJsonAtomic } from "../lib/fs-utils";
import { rssPrivateDirectory, withRssLock } from "./file-lock";

export class RssRepository {
  readonly directory: string;
  readonly file: string;
  constructor(readonly root: string, readonly catalog: RssCatalog, private readonly legacyStateRoots: string[] = []) {
    this.directory = rssPrivateDirectory(root, ".agent", "skill-data", "rss-article-saver");
    this.file = rssPrivateDirectory(root, ".agent", "skill-data", "rss-article-saver", "sources.json");
  }
  read(): RssDocument {
    if (!fs.existsSync(this.file)) return withRssLock(this.directory, "registry", () => {
      if (fs.existsSync(this.file)) return this.load();
      const persistent = path.join(this.directory, "subscriptions.opml");
      const legacy = fs.existsSync(persistent) ? persistent : path.join(this.root, ".agent", "skills", "rss-article-saver", "subscriptions.opml");
      const document: RssDocument = { schemaVersion: 1, initialized: true, revision: 1, sources: [], deletedPresetIds: [], migrationWarnings: [] };
      if (fs.existsSync(legacy)) {
        const sources = this.parseOpml(legacy, path.join(this.root, ".agent", "skills", "rss-article-saver"));
        const settings = this.legacySettings();
        document.sources = sources.map(source => {
          const oldId = crypto.createHash("sha1").update(`rss:${source.originalUrl}`).digest("hex");
          const patch = settings.sources[oldId] || {};
          return this.fromUrl(patch.name || source.name, source.originalUrl, patch.enabled !== false && !settings.disabledUrls.includes(source.originalUrl), source.group, patch.tags);
        });
        fs.mkdirSync(this.directory, { recursive: true });
        if (!fs.existsSync(path.join(this.directory, "migration-backup.opml"))) fs.copyFileSync(legacy, path.join(this.directory, "migration-backup.opml"));
      } else {
        document.sources = this.catalog.sources.map(preset => RssSourceSchema.parse({ ...preset, presetId: preset.id, enabled: false, revision: 1 }));
      }
      document.sources = this.deduplicate(document.sources);
      writeJsonAtomic(this.file, document);
      return document;
    });
    return this.load();
  }
  private load(): RssDocument { return RssDocumentSchema.parse(JSON.parse(fs.readFileSync(this.file, "utf8"))); }
  rootKey(): string { return crypto.createHash("sha256").update(fs.realpathSync(this.root)).digest("hex"); }
  view(): RssDocumentView {
    const document = this.read();
    return { ...document, rootKey: this.rootKey(), sources: document.sources.map(source => {
      const file = rssPrivateDirectory(this.root, ".agent", "skill-data", "rss-article-saver", "feeds", `${source.id}.xml`);
      const status = !fs.existsSync(file) ? "missing" : source.feedRevision === source.revision ? "ready" : "outdated";
      const stat = status === "missing" ? null : fs.statSync(file);
      return { ...source, localFeed: { path: file, status, ...(stat ? { version: `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}` } : {}) } };
    }) };
  }
  mutate(work: (document: RssDocument) => void): RssDocument {
    this.read();
    return withRssLock(this.directory, "registry", () => { const doc = this.load(); work(doc); doc.revision++; writeJsonAtomic(this.file, RssDocumentSchema.parse(doc)); return doc; });
  }
  add(input: RssSourceInput, detected: RssDetection): RssDocument {
    return this.mutate(doc => {
      this.assertUnique(doc, input.inputUrl);
      const preset = this.catalog.sources.find(row => row.inputUrl && rssUrlIdentity(row.inputUrl) === rssUrlIdentity(input.inputUrl));
      doc.sources.push(RssSourceSchema.parse({ ...detected, ...input, id: crypto.randomUUID(), presetId: preset?.id || null, revision: 1 }));
      if (preset) doc.deletedPresetIds = doc.deletedPresetIds.filter(id => id !== preset.id);
    });
  }
  update(input: RssSourcePatch, detected?: RssDetection): RssDocument {
    return this.mutate(doc => {
      const row = doc.sources.find(source => source.id === input.id);
      if (!row || row.revision !== input.revision) throw new Error("RSS source changed; refresh and retry.");
      if (input.inputUrl) this.assertUnique(doc, input.inputUrl, row.id);
      const feedWasCurrent = row.feedRevision === row.revision;
      Object.assign(row, detected || {}, { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.group !== undefined ? { group: input.group } : {}), ...(input.enabled !== undefined ? { enabled: input.enabled } : {}) });
      row.revision++;
      if (detected) row.lastError = null;
      // A renamed/toggled source can still use its current XML, but changing
      // its URL must never collect entries from the preceding subscription.
      if (detected) row.feedRevision = 0;
      else if (feedWasCurrent) row.feedRevision = row.revision;
    });
  }
  remove(id: string, revision: number): RssDocument {
    return this.mutate(doc => { const row = doc.sources.find(source => source.id === id); if (!row || row.revision !== revision) throw new Error("RSS source changed; refresh and retry."); doc.sources = doc.sources.filter(source => source.id !== id); if (row.presetId) doc.deletedPresetIds = [...new Set([...doc.deletedPresetIds, row.presetId])]; });
  }
  importOpml(file: string): RssDocument {
    const entries = this.parseOpml(file); // Validate the complete import before mutation.
    return this.mutate(doc => {
      const ids = new Set(doc.sources.map(source => source.id));
      for (const item of entries) {
        const row = this.fromUrl(item.name, item.originalUrl, true, item.group);
        if (doc.sources.some(source => source.inputUrl && row.inputUrl && rssUrlIdentity(source.inputUrl) === rssUrlIdentity(row.inputUrl))) continue;
        // Editing a preset URL keeps its subscription identity. Importing the
        // original address creates another subscription, not another owner of
        // the edited source's feed, revision and execution lock.
        while (ids.has(row.id)) row.id = crypto.randomUUID();
        ids.add(row.id);
        doc.sources.push(row);
        doc.deletedPresetIds = doc.deletedPresetIds.filter(id => id !== row.presetId);
      }
    });
  }
  preferences(): DailyBriefPreferences {
    const file = rssPrivateDirectory(this.root, ".agent", "preferences", "daily-brief.json");
    return fs.existsSync(file) ? DailyBriefPreferencesSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))) : { schemaVersion: 1, revision: 0, text: "", updatedAt: null };
  }
  savePreferences(raw: { text: string; revision: number }): DailyBriefPreferences {
    const input = SaveDailyBriefPreferencesSchema.parse(raw);
    const directory = rssPrivateDirectory(this.root, ".agent", "preferences");
    return withRssLock(directory, "daily-brief", () => { const previous = this.preferences(); if (previous.revision !== input.revision) throw new Error("Preferences changed; refresh and retry."); const next = { schemaVersion: 1 as const, revision: previous.revision + 1, text: input.text, updatedAt: new Date().toISOString() }; writeJsonAtomic(path.join(directory, "daily-brief.json"), next); return next; });
  }
  private fromUrl(name: string, originalUrl: string, enabled: boolean, group = "", tags: string[] = []): RssSource {
    const preset = this.catalog.sources.find(row => row.legacyAliases.includes(originalUrl) || row.inputUrl && rssUrlIdentity(row.inputUrl) === rssUrlIdentity(originalUrl));
    const unresolved = !preset && /^https:\/\/(?:raw\.githubusercontent\.com\/SebastianLavertheDe\/blog-rss-feed\/|github\.com\/SebastianLavertheDe\/blog-rss-feed\/)/i.test(originalUrl);
    return RssSourceSchema.parse({ id: preset?.id || crypto.randomUUID(), name, inputUrl: preset?.inputUrl ?? (unresolved ? "" : originalUrl), kind: preset?.kind || "feed", adapterId: preset?.adapterId || "feed", presetId: preset?.id || null, enabled: enabled && !unresolved, revision: 1, group, tags, lastError: unresolved ? { stage: "configuration", code: "unmapped-source", message: "Original source address is missing; enter the original website or RSS URL.", retryable: false } : null });
  }
  private assertUnique(doc: RssDocument, url: string, except?: string): void { if (doc.sources.some(row => row.id !== except && row.inputUrl && rssUrlIdentity(row.inputUrl) === rssUrlIdentity(url))) throw new Error("This RSS source already exists."); }
  private deduplicate(rows: RssSource[]): RssSource[] { const seen = new Map<string, RssSource>(); for (const row of rows) { const key = row.inputUrl ? rssUrlIdentity(row.inputUrl) : row.id; const previous = seen.get(key); if (previous) previous.enabled = previous.enabled && row.enabled; else seen.set(key, row); } return [...seen.values()]; }
  private legacySettings(): { sources: Record<string, { name?: string; enabled?: boolean; tags?: string[] }>; disabledUrls: string[] } {
    let result = {}; const disabled = new Set<string>();
    for (const dir of [path.join(this.root, ".cctools"), path.join(this.root, ".openmind"), ...this.legacyStateRoots]) {
      const file = path.join(dir, "source-settings.json");
      if (fs.existsSync(file)) { const parsed = JSON.parse(fs.readFileSync(file, "utf8")); result = { ...result, ...(parsed.sources || parsed) }; for (const url of parsed.disabledUrls || []) disabled.add(url); }
    }
    return { sources: result, disabledUrls: [...disabled] };
  }
  private parseOpml(file: string, legacyFallback?: string): { name: string; originalUrl: string; group: string }[] {
    const root = fs.realpathSync(path.dirname(file)), active = new Set<string>();
    const rows: { name: string; originalUrl: string; group: string }[] = [];
    const read = (name: string, group: string, depth = 0) => {
      if (!fs.existsSync(name) && legacyFallback && depth > 0 && path.dirname(name) === root) {
        const fallback = path.join(legacyFallback, path.basename(name));
        if (fs.existsSync(fallback)) { const expected = fs.realpathSync(legacyFallback); if (fs.realpathSync(fallback).startsWith(expected + path.sep)) name = fallback; }
      }
      const actual = fs.realpathSync(name);
      const fallbackInside = legacyFallback && fs.existsSync(legacyFallback) && actual.startsWith(fs.realpathSync(legacyFallback) + path.sep);
      if ((!actual.startsWith(`${root}${path.sep}`) && !fallbackInside) || depth > 16 || active.has(actual)) throw new Error("Invalid, cyclic or escaping OPML reference.");
      if (fs.statSync(actual).size > 4 * 1024 * 1024) throw new Error("OPML file is too large.");
      const xml = fs.readFileSync(actual, "utf8");
      if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Invalid OPML XML.");
      const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", processEntities: false }).parse(xml);
      if (!doc.opml) throw new Error("Expected an OPML document.");
      active.add(actual);
      const visit = (outline: any, parent: string) => { for (const row of Array.isArray(outline) ? outline : outline ? [outline] : []) { const title = String(row.title || row.text || "RSS"); const url = row.xmlUrl || (row.type === "include" ? row.url : null); if (url) { if (/^https?:\/\//i.test(url)) rows.push({ name: title, originalUrl: url, group: parent }); else read(path.resolve(path.dirname(actual), url), parent || title, depth + 1); } if (row.outline) visit(row.outline, title); } };
      visit(doc.opml.body?.outline, group); active.delete(actual);
    };
    read(file, "");
    return rows;
  }
}

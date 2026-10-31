import { RssRepository } from "../rss/rss-repository";
import { readRssCatalog } from "../rss/rss-service";
import fs from "node:fs";
import crypto from "node:crypto";
import { RedditSourceStatusSchema } from "../../shared/reddit-source-status";
import { rssPrivateDirectory } from "../rss/file-lock";
import path from "node:path";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import {
  AddRssSourceInputSchema,
  SourceDefinitionSchema,
  SourcePatchSchema,
  SourceRunSchema,
  SourceQuerySchema,
  RemoveRedditSourceInputSchema,
  type SourceQuery,
  type AddRssSourceInput,
  type SourceDefinition,
  type SourcePatch,
  type SourceRun
} from "../../shared/contracts";
import { parseSkillFrontmatter } from "../../shared/skill-frontmatter";
import type { SkillSourceBinding } from "../../shared/skill-sources";
import { messages } from "../../shared/messages";
import { writeTextAtomic as writePrivateTextAtomic } from "../lib/fs-utils";
import { readStateJson, readStateJsonArray, STATE_DIRECTORY } from "./state-directory";
import {
  collectOutlines,
  collectPrefixedOutlines,
  compactDate,
  CustomSourceSchema,
  lastMeaningfulLine,
  newestMtime,
  parseArray,
  readText,
  stableId,
  visitObjects,
  writeJsonAtomic,
  writeTextAtomic,
  type ContentApi,
  type SourceSettings
} from "./common";

type YamlCodec = {
  load(input: string, options?: Record<string, unknown>): unknown;
  dump(value: unknown, options?: Record<string, unknown>): string;
};

// Keep YAML parsing in Electron; renderer source management stays behind IPC.
const yaml = require("js-yaml") as YamlCodec;

type RedditSourceEntry = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  frequency: string;
  tags: string[];
};

export class SourceRegistry {
  private readonly sourceSettingsPath: string;
  private readonly sourceRunsPath: string;
  private sourceRunsCache: SourceRun[] | null = null;
  private readonly runLogSizes = new Map<string, number>();
  private sourceRunsDirty = false;
  private sourceRunsFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private skillSourcesCache: SkillSourceBinding[] | null = null;

  /**
   * @param openmindRoot the selected private data repository and content root.
   *   Content paths join onto it directly; Skill descriptors are read from
   *   `<openmindRoot>/.agent/skills`, while user-owned source configuration is
   *   persisted below `<openmindRoot>/.agent/skill-data`.
   * @param content content API.
   * @param stateRoot ADR-001 §1.3: app-private state dir under userData. When
   *   supplied, `.openmind` state lives there instead of inside openmindRoot.
   */
  constructor(
    private readonly openmindRoot: string,
    private readonly content: ContentApi,
    stateRoot?: string
  ) {
    // stateRoot is the *parent* of `.openmind` (e.g. userData/state/<root-id>
    // or, for back-compat, the content root). The `.openmind` segment is always
    // appended so on-disk layout matches existing fixtures and migration.
    const stateDirectory = path.join(stateRoot ?? openmindRoot, STATE_DIRECTORY);
    this.sourceSettingsPath = path.join(stateDirectory, "source-settings.json");
    this.sourceRunsPath = path.join(stateDirectory, "source-runs.json");
  }

  /** Resolve a content-relative path against the selected flat data root. */
  private contentPath(...segments: string[]): string {
    return path.join(this.openmindRoot, ...segments);
  }

  /** Resolve a path inside the immutable installed Agent Skills store. */
  private installedSkillPath(...segments: string[]): string {
    return path.join(this.openmindRoot, ".agent", "skills", ...segments);
  }

  /** Resolve a path inside persistent per-Skill runtime data. */
  private skillDataPath(...segments: string[]): string {
    return path.join(this.openmindRoot, ".agent", "skill-data", ...segments);
  }

  /**
   * The X request contains login cookies, so it belongs to persistent private
   * Skill data rather than the installed package or the general content API.
   */
  readXFollowingCurls(): string[] {
    const persistentDirectory = this.skillDataPath("x-following-fetcher");
    let curls = this.readXFollowingCurlsFrom(persistentDirectory);
    if (!curls.length) {
      const legacyDirectories = [
        path.join(this.openmindRoot, ".claude", "skills", "x-following-fetcher"),
        path.join(this.openmindRoot, ".agent", "legacy-claude", "skills", "x-following-fetcher"),
        this.installedSkillPath("x-following-fetcher")
      ];
      curls = legacyDirectories
        .map((directory) => this.readXFollowingCurlsFrom(directory))
        .find((values) => values.length > 0) || [];
      if (curls.length) this.saveXFollowingCurls(curls);
    }
    return curls;
  }

  saveXFollowingCurls(rawContents: string[]): void {
    const normalized = rawContents.map((content) => content.trim());
    if (!normalized.length || normalized.some((content) => !/^curl(?:\s|')/i.test(content))) {
      throw new Error(messages.skillCenter.xCurl.invalid);
    }
    if (normalized.length > 20) throw new Error(messages.skillCenter.xCurl.tooMany);
    const contents = [...new Set(normalized)];

    const directory = this.skillDataPath("x-following-fetcher");
    const desiredNames = new Set(contents.map((_, index) => index === 0 ? "curl.txt" : `curl_${index + 1}.txt`));
    contents.forEach((content, index) => {
      const name = index === 0 ? "curl.txt" : `curl_${index + 1}.txt`;
      writePrivateTextAtomic(path.join(directory, name), `${content}\n`, { mode: 0o600 });
    });
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || desiredNames.has(entry.name)) continue;
      if (entry.name === "curl_foryou.txt" || /^curl_\d+\.txt$/i.test(entry.name)) {
        fs.rmSync(path.join(directory, entry.name), { force: true });
      }
    }
  }

  private readXFollowingCurlsFrom(directory: string): string[] {
    let names: string[];
    try {
      names = fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && (
          entry.name === "curl.txt"
          || entry.name === "curl_foryou.txt"
          || /^curl_\d+\.txt$/i.test(entry.name)
        ))
        .map((entry) => entry.name);
    } catch {
      return [];
    }
    names.sort((left, right) => this.xFollowingCurlOrder(left) - this.xFollowingCurlOrder(right));
    const seen = new Set<string>();
    return names
      .map((name) => readText(path.join(directory, name)).trim())
      .filter((content) => {
        if (!/^curl(?:\s|')/i.test(content) || seen.has(content)) return false;
        seen.add(content);
        return true;
      });
  }

  private xFollowingCurlOrder(name: string): number {
    if (name === "curl.txt") return 0;
    const numbered = name.match(/^curl_(\d+)\.txt$/i);
    if (numbered) return Number(numbered[1]);
    return Number.MAX_SAFE_INTEGER;
  }

  /**
   * Seed the persistent RSS subscription file once from the installed package.
   * Existing installations historically edited the package copy in place, so
   * that copy must win during migration. Once seeded, package updates never
   * overwrite the persistent file.
   */
  private rssSubscriptionsPath(): string {
    const persistent = this.skillDataPath("rss-article-saver", "subscriptions.opml");
    if (fs.existsSync(persistent)) return persistent;
    const legacy = this.installedSkillPath("rss-article-saver", "subscriptions.opml");
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(legacy);
    } catch {
      // The Skill may not be installed yet. addRssSource() will create an empty
      // persistent OPML document when the user adds the first subscription.
      return persistent;
    }
    if (stat.isFile() && !stat.isSymbolicLink()) writeTextAtomic(persistent, fs.readFileSync(legacy, "utf8"));
    return persistent;
  }

  /** Seed persistent Reddit communities once from the installed package. */
  private redditSourcesPath(): string {
    const persistent = this.skillDataPath("reddit-fetcher", "user-sources.yaml");
    if (fs.existsSync(persistent)) return persistent;
    const packageConfig = readText(this.installedSkillPath("reddit-fetcher", "config.yaml"));
    if (!packageConfig) return persistent;
    try {
      const document = yaml.load(packageConfig, { json: true });
      const fetch = isRecord(document) && isRecord(document.fetch) ? document.fetch : null;
      const sources = Array.isArray(fetch?.sources)
        ? fetch.sources.filter((value): value is string => typeof value === "string" && isHttpUrl(value.trim()))
        : [];
      if (sources.length) this.writeRedditSourceEntries(sources.map((url) => defaultRedditSourceEntry(url)));
    } catch {
      // Invalid package defaults should not hide unrelated source types. The
      // Skill runner will report its package configuration error when invoked.
    }
    return persistent;
  }

  /** 从已安装商店的 SKILL.md frontmatter 里挑出带 surfacesAsSource 的,生成 skill→source 绑定。 */
  private skillSources(): SkillSourceBinding[] {
    if (this.skillSourcesCache) return this.skillSourcesCache;
    const storeRoot = path.join(this.openmindRoot, ".agent", "skills");
    const bySkill = new Map<string, SkillSourceBinding>();
    try {
      for (const entry of fs.readdirSync(storeRoot, { withFileTypes: true })) {
        // Alias links for publisher-nested historical installs resolve to the
        // same package; dedupe by skill id below.
        if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith("_")) continue;
        const skillPath = path.join(storeRoot, entry.name, "SKILL.md");
        if (!fs.existsSync(skillPath)) continue;
        const frontmatter = parseSkillFrontmatter(fs.readFileSync(skillPath, "utf8"));
        const source = frontmatter.surfacesAsSource;
        if (!source) continue;
        if (source.kind !== "x" && source.kind !== "reddit") continue;
        const skillId = frontmatter.id || frontmatter.name || entry.name;
        bySkill.set(skillId, { skillId, ...source, kind: source.kind });
      }
    } catch {
      // Store absent (root unbound or not initialised): no skill-backed sources.
    }
    const bindings = [...bySkill.values()];
    this.skillSourcesCache = bindings;
    return bindings;
  }

  listSources(rawQuery: SourceQuery = {}): SourceDefinition[] {
    const query = SourceQuerySchema.parse(rawQuery);
    const accepts = (kind: SourceDefinition["kind"], skillId: string | null) => (!query.kind || query.kind === kind) && (!query.skillId || query.skillId === skillId);
    const date = compactDate(new Date().toISOString().slice(0, 10));
    const rss = accepts("rss", "rss-article-saver") ? this.readRssSources(date) : [];
    const skillSources = this.skillSources().filter(source => accepts(source.kind, source.skillId));
    const redditBinding = skillSources.find((source) => source.kind === "reddit");
    const reddit = redditBinding ? this.readRedditSources(redditBinding, query.kind === "reddit" || query.skillId === "reddit-fetcher") : [];
    if (query.kind === "reddit" || query.skillId === "reddit-fetcher") return reddit;
    const generated: SourceDefinition[] = skillSources
      .filter((source) => source.kind !== "reddit")
      .map((source) => this.skillBackedSource(source.sourceId, source.sourceName, source.kind, source.skillId, date, source.artifactRoot));
    const settings = this.readSourceSettings();
    const runs = this.listSourceRuns();
    const custom = settings.customSources.filter(source => accepts(source.kind, null)).map((source) => this.customSource(source));
    return [...rss, ...reddit, ...generated, ...custom].map((source) => {
      // Reddit entries are fully owned by user-sources.yaml so their enabled
      // state is also consumed by the Skill runner. Legacy app-only overrides
      // must not win over that persistent per-Skill configuration.
      // Reddit status comes from source-specific collector output, never the batch.
      if (source.kind === "reddit") return source;
      const override = source.kind === "rss" ? {} : settings.sources[source.id] || {};
      const enabled = override.enabled ?? source.enabled;
      const recentRuns = runs.filter((run) => run.sourceId === source.id || run.skillId === source.skillId).slice(0, 20);
      const latest = recentRuns[0];
      const completed = recentRuns.filter((run) => run.status !== "running");
      const successRate = completed.length
        ? Math.round(completed.filter((run) => run.status === "success").length / completed.length * 100)
        : source.successRate;
      return SourceDefinitionSchema.parse({
        ...source,
        name: override.name || source.name,
        frequency: override.frequency || source.frequency,
        tags: override.tags || source.tags,
        enabled,
        lastRunAt: latest?.startedAt || source.lastRunAt,
        lastSuccessAt: recentRuns.find((run) => run.status === "success")?.completedAt || source.lastSuccessAt,
        successRate,
        status: !enabled ? "disabled" : latest?.status === "running" ? "running" : latest?.status === "failed" || latest?.status === "timed-out" ? "failed" : latest?.status === "success" ? "success" : source.status,
        recentError: latest?.error || source.recentError
      });
    });
  }

  updateSource(id: string, rawPatch: SourcePatch): SourceDefinition {
    const patch = SourcePatchSchema.parse(rawPatch);
    const isReddit = this.loadRedditSourceEntries(false).some(source => source.id === id);
    const existing = this.listSources(isReddit ? { kind: "reddit" } : {}).find(source => source.id === id);
    if (!existing) throw new Error(messages.errors.source.updateNotFound);
    if (existing.kind === "reddit") return this.updateRedditSource(existing, patch);
    if (existing.kind === "rss") {
      const repository = this.rssRepository();
      const row = repository.read().sources.find(item => item.id === id)!;
      if (patch.url && patch.url !== row.inputUrl) throw new Error("Use RSS Sources to detect and change the URL.");
      repository.update({ id, revision: row.revision, name: patch.name, enabled: patch.enabled });
      return this.listSources().find(item => item.id === id)!;
    }
    const targetId = id;
    const targetUrl = existing.url;
    const settings = this.readSourceSettings();
    const current = settings.sources[id] || {};
    if (targetId !== id) delete settings.sources[id];
    const custom = settings.customSources.find((source) => source.id === id);
    if (custom) {
      if (patch.name) custom.name = patch.name;
      if (patch.frequency) custom.frequency = patch.frequency;
      if (patch.tags) custom.tags = patch.tags;
      if (patch.enabled !== undefined) custom.enabled = patch.enabled;
    }
    settings.sources[targetId] = {
      ...current,
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.frequency ? { frequency: patch.frequency } : {}),
      ...(patch.tags ? { tags: patch.tags } : {})
    };
    if (targetUrl) {
      settings.disabledUrls = settings.disabledUrls.filter((url) => url !== existing.url && url !== targetUrl);
      if (patch.enabled === false || (patch.enabled === undefined && current.enabled === false)) settings.disabledUrls.push(targetUrl);
    }
    writeJsonAtomic(this.sourceSettingsPath, settings);
    const updated = this.listSources().find((source) => source.id === targetId);
    if (!updated) throw new Error(messages.errors.source.refreshFailed);
    return updated;
  }


  removeRedditSource(id: string): void {
    RemoveRedditSourceInputSchema.parse({ id });
    const sources = this.loadRedditSourceEntries(true);
    const remaining = sources.filter(source => source.id !== id);
    if (remaining.length === sources.length) throw new Error(messages.errors.source.updateNotFound);
    this.writeRedditSourceEntries(remaining);
  }

  addRssSource(rawInput: AddRssSourceInput): SourceDefinition {
    const input = AddRssSourceInputSchema.parse(rawInput);
    if (input.kind === "reddit") return this.addRedditSource(input);
    if (input.kind !== "rss") return this.addCustomSource(input);
    const repository = this.rssRepository();
    const duplicate = repository.read().sources.find(row => row.inputUrl === input.url);
    if (!duplicate) repository.add({ name: input.name, inputUrl: input.url, enabled: true }, { kind: "feed", inputUrl: input.url, resolvedFeedUrl: input.url, adapterId: "feed", candidates: [] });
    return this.listSources().find(row => row.url === input.url)!;
  }

  importOpml(filePath: string): number {
    const repository = this.rssRepository();
    const before = repository.read().sources.length;
    return repository.importOpml(filePath).sources.length - before;
  }

  listSourceRuns(sourceId?: string): SourceRun[] {
    return this.readSourceRuns()
      .filter((run) => !sourceId || run.sourceId === sourceId || run.skillId === sourceId)
      .slice()
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  recordSkillEvent(rawEvent: Record<string, unknown>): void {
    const skillId = String(rawEvent.skillId || "");
    const invocationId = String(rawEvent.invocationId || "");
    if (!skillId || !invocationId) return;
    const sourceId = String(rawEvent.sourceId || `skill:${skillId}`);
    const runs = this.readSourceRuns();
    let run = runs.find((candidate) => candidate.id === invocationId);
    if (!run) {
      run = SourceRunSchema.parse({
        schemaVersion: 1,
        id: invocationId,
        sourceId,
        skillId,
        status: "running",
        startedAt: String(rawEvent.timestamp || new Date().toISOString()),
        completedAt: null,
        durationMs: null,
        code: null,
        error: null,
        itemCount: 0,
        logs: []
      });
      runs.unshift(run);
    }
    if (rawEvent.type === "output" && rawEvent.text) {
      const stream = ["system", "stdout", "stderr"].includes(String(rawEvent.stream)) ? rawEvent.stream as "system" | "stdout" | "stderr" : "system";
      const text = String(rawEvent.text).slice(0, 64_000);
      run.logs.push({ timestamp: String(rawEvent.timestamp || new Date().toISOString()), stream, text });
      let logSize = (this.runLogSizes.get(run.id) ?? run.logs.slice(0, -1).reduce((sum, item) => sum + item.text.length, 0)) + text.length;
      while (run.logs.length > 500 || logSize > 512_000) logSize -= run.logs.shift()?.text.length || 0;
      this.runLogSizes.set(run.id, logSize);
      if (stream === "stderr") run.error = lastMeaningfulLine(String(rawEvent.text)) || run.error;
    }
    let terminal = false;
    if (rawEvent.type === "status" && rawEvent.state) {
      const state = String(rawEvent.state);
      if (["running", "success", "failed", "stopped", "timed-out"].includes(state)) run.status = state as SourceRun["status"];
      terminal = state !== "running";
      if (terminal) run.completedAt = String(rawEvent.timestamp || new Date().toISOString());
      if (typeof rawEvent.durationMs === "number") run.durationMs = rawEvent.durationMs;
      if (typeof rawEvent.code === "number" || rawEvent.code === null) run.code = rawEvent.code as number | null;
    }
    this.scheduleSourceRunsFlush(terminal);
  }

  private readSourceRuns(): SourceRun[] {
    if (this.sourceRunsCache) return this.sourceRunsCache;
    this.sourceRunsCache = readStateJsonArray(this.sourceRunsPath, SourceRunSchema);
    return this.sourceRunsCache;
  }

  private scheduleSourceRunsFlush(immediate: boolean): void {
    this.sourceRunsDirty = true;
    if (immediate) {
      if (this.sourceRunsFlushTimer) clearTimeout(this.sourceRunsFlushTimer);
      this.sourceRunsFlushTimer = null;
      this.flushSourceRuns();
      return;
    }
    if (this.sourceRunsFlushTimer) return;
    this.sourceRunsFlushTimer = setTimeout(() => {
      this.sourceRunsFlushTimer = null;
      try { this.flushSourceRuns(); } catch { /* keep dirty; the next event retries */ }
    }, 250);
    this.sourceRunsFlushTimer.unref?.();
  }

  private flushSourceRuns(): void {
    if (!this.sourceRunsDirty || !this.sourceRunsCache) return;
    if (this.sourceRunsCache.length > 100) this.sourceRunsCache.length = 100;
    writeJsonAtomic(this.sourceRunsPath, this.sourceRunsCache);
    this.sourceRunsDirty = false;
  }

  private rssRepository(): RssRepository {
    return new RssRepository(this.openmindRoot, readRssCatalog(), [path.dirname(this.sourceSettingsPath)]);
  }

  private readRssSources(_date: string): SourceDefinition[] {
    if (!fs.existsSync(this.openmindRoot)) return [];
    return this.rssRepository().read().sources.map(row => SourceDefinitionSchema.parse({
      schemaVersion: 1, id: row.id, name: row.name, kind: "rss", url: row.inputUrl || null,
      skillId: "rss-article-saver", enabled: row.enabled, tags: row.tags,
      frequency: messages.source.frequencyPipeline, lastRunAt: row.lastAttemptAt, lastSuccessAt: row.lastSuccessAt,
      successRate: null, status: !row.enabled ? "disabled" : row.lastError ? "failed" : row.lastSuccessAt ? "success" : "idle",
      recentError: row.lastError?.message || null, itemCount: row.itemCount
    }));
  }

  private readRedditSources(binding: SkillSourceBinding, strict: boolean): SourceDefinition[] {
    const sources = this.loadRedditSourceEntries(strict);
    const directory = rssPrivateDirectory(this.openmindRoot, ".agent", "skill-data", "reddit-fetcher", "source-status");
    const hasResults = fs.existsSync(directory);
    const root = fs.realpathSync(this.openmindRoot);
    return sources.map(source => {
      const state = hasResults ? this.readRedditStatus(source.url, directory, root) : null;
      return SourceDefinitionSchema.parse({
        ...source, kind: "reddit", skillId: binding.skillId,
        status: !source.enabled ? "disabled" : state?.status || "idle",
        lastRunAt: state?.startedAt || null, lastSuccessAt: state?.lastSuccessAt || null,
        recentError: state?.error || null, itemCount: state?.itemCount || 0
      });
    });
  }

  private readRedditStatus(url: string, directory: string, root: string) {
    const name = crypto.createHash("sha256").update(url).digest("hex") + ".json";
    const file = path.join(directory, name);
    try {
      const actual = fs.realpathSync(file);
      if (!actual.startsWith(root + path.sep)) return null;
      if (fs.statSync(actual).size > 32 * 1024) return null;
      const state = RedditSourceStatusSchema.parse(JSON.parse(fs.readFileSync(actual, "utf8")));
      if (state.url !== url) return null;
      if (state.status === "running") {
        try { process.kill(state.pid, 0); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") return { ...state, status: "failed" as const, error: messages.source.collectorInterrupted };
        }
      }
      return state;
    } catch { return null; } // Old installations have no source-scoped results yet.
  }

  private loadRedditSourceEntries(strict: boolean): RedditSourceEntry[] {
    const sourcePath = this.redditSourcesPath();
    const raw = readText(sourcePath);
    if (!raw) return [];
    try {
      const document = yaml.load(raw, { json: true });
      if (!isRecord(document)) throw new Error("document must be an object");
      const version = document.schemaVersion ?? 1;
      if (version === 1) {
        if (!Array.isArray(document.sources) || !document.sources.every((value) => typeof value === "string" && isHttpUrl(value.trim()))) {
          throw new Error("schema v1 sources must be HTTP URLs");
        }
        return document.sources.map((url) => defaultRedditSourceEntry(String(url).trim()));
      }
      if (version !== 2 || !Array.isArray(document.sources)) throw new Error(`unsupported schema version ${String(version)}`);
      const entries = document.sources.map(parseRedditSourceEntry);
      if (entries.some((entry) => !entry)) throw new Error("schema v2 contains an invalid source");
      return entries as RedditSourceEntry[];
    } catch (cause) {
      if (!strict) return [];
      throw new Error(`Reddit 社区配置无效：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  private writeRedditSourceEntries(sources: RedditSourceEntry[]): void {
    writeTextAtomic(this.skillDataPath("reddit-fetcher", "user-sources.yaml"), yaml.dump(
      { schemaVersion: 2, sources },
      { noRefs: true, lineWidth: -1, sortKeys: false }
    ));
  }

  private addRedditSource(input: ReturnType<typeof AddRssSourceInputSchema.parse>): SourceDefinition {
    if (!isHttpUrl(input.url)) throw new Error("Reddit 社区地址必须是有效的 HTTP(S) URL。");
    const sources = this.loadRedditSourceEntries(true);
    const duplicate = sources.find((source) => source.url === input.url);
    if (duplicate) {
      const existing = this.listSources({ kind: "reddit" }).find((source) => source.id === duplicate.id);
      if (existing) return existing;
    }
    const entry: RedditSourceEntry = {
      id: stableId(`reddit:${input.url}`),
      name: input.name.trim(),
      url: input.url.trim(),
      enabled: true,
      frequency: input.frequency,
      tags: input.tags
    };
    this.writeRedditSourceEntries([...sources, entry]);
    const created = this.listSources({ kind: "reddit" }).find((source) => source.id === entry.id);
    if (!created) throw new Error(messages.errors.source.refreshFailed);
    return created;
  }

  private updateRedditSource(existing: SourceDefinition, patch: SourcePatch): SourceDefinition {
    const sources = this.loadRedditSourceEntries(true);
    const index = sources.findIndex((source) => source.id === existing.id);
    if (index < 0) throw new Error(messages.errors.source.updateNotFound);
    const nextUrl = patch.url?.trim() || sources[index].url;
    if (!isHttpUrl(nextUrl)) throw new Error("Reddit 社区地址必须是有效的 HTTP(S) URL。");
    if (sources.some((source, sourceIndex) => sourceIndex !== index && source.url === nextUrl)) {
      throw new Error("这个 Reddit 社区地址已经存在。");
    }
    sources[index] = {
      ...sources[index],
      ...(patch.name ? { name: patch.name.trim() } : {}),
      url: nextUrl,
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.frequency ? { frequency: patch.frequency } : {}),
      ...(patch.tags ? { tags: patch.tags } : {})
    };
    this.writeRedditSourceEntries(sources);
    const updated = this.listSources({ kind: "reddit" }).find((source) => source.id === existing.id);
    if (!updated) throw new Error(messages.errors.source.refreshFailed);
    return updated;
  }

  private readSourceSettings(): SourceSettings {
    const raw = readStateJson(this.sourceSettingsPath, {}) as Partial<SourceSettings>;
    return {
      schemaVersion: 1,
      sources: raw.sources && typeof raw.sources === "object" && !Array.isArray(raw.sources) ? raw.sources : {},
      customSources: parseArray(raw.customSources, CustomSourceSchema),
      disabledUrls: Array.isArray(raw.disabledUrls) ? raw.disabledUrls.filter((url): url is string => typeof url === "string") : []
    };
  }

  private addCustomSource(input: ReturnType<typeof AddRssSourceInputSchema.parse>): SourceDefinition {
    if (!["web", "api", "manual"].includes(input.kind)) throw new Error(messages.errors.source.systemManagedKind);
    const settings = this.readSourceSettings();
    const id = stableId(`${input.kind}:${input.url}`);
    const duplicate = this.listSources().find((source) => source.kind === input.kind && source.url === input.url);
    if (duplicate) return duplicate;
    settings.customSources.push({
      id,
      name: input.name,
      kind: input.kind as "web" | "api" | "manual",
      url: input.url,
      frequency: input.frequency,
      tags: input.tags,
      enabled: true
    });
    writeJsonAtomic(this.sourceSettingsPath, settings);
    const source = this.listSources().find((item) => item.id === id);
    if (!source) throw new Error(messages.errors.source.refreshFailed);
    return source;
  }

  private appendRssOutlines(outlines: Array<{ name: string; url: string }>): void {
    const opmlPath = this.rssSubscriptionsPath();
    const parser = new XMLParser({ ignoreAttributes: false });
    const builder = new XMLBuilder({ ignoreAttributes: false, format: true, indentBy: "  " });
    const parsed = parser.parse(readText(opmlPath) || "<opml version=\"2.0\"><head><title>OpenMind</title></head><body></body></opml>") as {
      opml?: { body?: { outline?: unknown } };
    };
    parsed.opml ||= {};
    parsed.opml.body ||= {};
    const current = parsed.opml.body.outline;
    const list = current == null ? [] : Array.isArray(current) ? current : [current];
    parsed.opml.body.outline = list.concat(outlines.map((outline) => ({
      "@_text": outline.name,
      "@_title": outline.name,
      "@_type": "rss",
      "@_xmlUrl": outline.url
    })));
    writeTextAtomic(opmlPath, `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(parsed)}\n`);
  }

  private replaceRssOutline(previousUrl: string, replacement: { name: string; url: string }): void {
    const opmlPath = this.rssSubscriptionsPath();
    const parser = new XMLParser({ ignoreAttributes: false });
    const builder = new XMLBuilder({ ignoreAttributes: false, format: true, indentBy: "  " });
    const parsed = parser.parse(readText(opmlPath)) as Record<string, unknown>;
    let found = false;
    visitObjects(parsed, (record) => {
      if (record["@_xmlUrl"] !== previousUrl) return;
      record["@_text"] = replacement.name;
      record["@_title"] = replacement.name;
      record["@_xmlUrl"] = replacement.url;
      found = true;
    });
    if (!found) throw new Error(messages.errors.source.opmlEntryMissing);
    writeTextAtomic(opmlPath, `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(parsed)}\n`);
  }

  private skillBackedSource(
    id: string,
    name: string,
    kind: "x" | "reddit",
    skillId: string,
    date: string,
    artifactRoot: string
  ): SourceDefinition {
    // artifactRoot is a logical path like "openmind/post" or "openmind/reddit".
    // Strip that namespace before joining it directly onto the flat data root.
    const artifactPath = path.join(this.openmindRoot, artifactRoot.replace(/^openmind\/+/, ""), date);
    const lastRunAt = newestMtime([artifactPath]);
    const itemCount = this.content.getContent(kind === "x" ? "posts" : "reddit", date).length;
    return SourceDefinitionSchema.parse({
      schemaVersion: 1,
      id,
      name,
      kind,
      url: null,
      skillId,
      enabled: true,
      frequency: messages.source.frequencyPipeline,
      lastRunAt,
      lastSuccessAt: itemCount ? lastRunAt : null,
      successRate: lastRunAt ? (itemCount ? 100 : 0) : null,
      status: lastRunAt ? (itemCount ? "success" : "warning") : "idle",
      recentError: lastRunAt && !itemCount ? messages.errors.source.noNewContent : null,
      itemCount
    });
  }

  private customSource(source: SourceSettings["customSources"][number]): SourceDefinition {
    return SourceDefinitionSchema.parse({
      schemaVersion: 1,
      id: source.id,
      name: source.name,
      kind: source.kind,
      url: source.url,
      skillId: null,
      enabled: source.enabled,
      frequency: source.frequency,
      tags: source.tags,
      lastRunAt: null,
      lastSuccessAt: null,
      successRate: null,
      status: source.enabled ? "idle" : "disabled",
      recentError: null,
      itemCount: 0
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function redditSourceName(url: string): string {
  try {
    const parsed = new URL(url);
    const community = parsed.pathname.match(/\/r\/([^/]+)/i)?.[1];
    if (community) return `r/${decodeURIComponent(community)}`;
    return parsed.hostname.replace(/^www\./, "") || "Reddit 社区";
  } catch {
    return "Reddit 社区";
  }
}

function defaultRedditSourceEntry(url: string): RedditSourceEntry {
  return {
    id: stableId(`reddit:${url}`),
    name: redditSourceName(url),
    url,
    enabled: true,
    frequency: messages.source.frequencyPipeline,
    tags: ["社区"]
  };
}

function parseRedditSourceEntry(value: unknown): RedditSourceEntry | null {
  if (!isRecord(value)) return null;
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!isHttpUrl(url)) return null;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : stableId(`reddit:${url}`);
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : redditSourceName(url);
  const frequency = typeof value.frequency === "string" && value.frequency.trim()
    ? value.frequency.trim()
    : messages.source.frequencyPipeline;
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim())).map((tag) => tag.trim())
    : ["社区"];
  return {
    id,
    name,
    url,
    enabled: value.enabled !== false,
    frequency,
    tags
  };
}

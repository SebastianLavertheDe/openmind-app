import path from "node:path";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import {
  AddRssSourceInputSchema,
  SourceDefinitionSchema,
  SourcePatchSchema,
  SourceRunSchema,
  type AddRssSourceInput,
  type SourceDefinition,
  type SourcePatch,
  type SourceRun
} from "../../shared/contracts";
import { discoverSkills } from "../ai/skill-discovery";
import type { SkillSourceBinding } from "../../shared/skill-sources";
import { messages } from "../../shared/messages";
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

export class SourceRegistry {
  private readonly sourceSettingsPath: string;
  private readonly sourceRunsPath: string;
  private sourceRunsCache: SourceRun[] | null = null;
  private readonly runLogSizes = new Map<string, number>();
  private sourceRunsDirty = false;
  private sourceRunsFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private skillSourcesCache: SkillSourceBinding[] | null = null;

  /**
   * @param repoRoot legacy: the openmind repo root (parent of openmind), kept for
   *   back-compat. Used for `.claude/skills/...` skill-source discovery and as
   *   the fallback for content/state paths.
   * @param content content API.
   * @param openmindRoot ADR-001: the actual openmind content dir. When supplied,
   *   content paths (`openmind/article/<date>`) join onto this directly instead
   *   of `repoRoot/openmind`.
   * @param skillSourcesRoot ADR-001: where to discover skills (`.claude/skills`
   *   under the workspace, or `userData/skills` in future). Defaults to
   *   `repoRoot` for back-compat.
   * @param stateRoot ADR-001 §1.3: app-private state dir under userData. When
   *   supplied, `.openmind` state lives there instead of inside repoRoot.
   */
  constructor(
    private readonly repoRoot: string,
    private readonly content: ContentApi,
    private readonly openmindRoot?: string,
    private readonly skillSourcesRoot?: string,
    stateRoot?: string
  ) {
    // stateRoot is the *parent* of `.openmind` (e.g. userData/state/<root-id>
    // or, for back-compat, the repo root). The `.openmind` segment is always
    // appended so on-disk layout matches existing fixtures and migration.
    const stateDirectory = path.join(stateRoot ?? repoRoot, STATE_DIRECTORY);
    this.sourceSettingsPath = path.join(stateDirectory, "source-settings.json");
    this.sourceRunsPath = path.join(stateDirectory, "source-runs.json");
  }

  /** Resolve a content-relative path against openmindRoot (ADR-001) or repoRoot/openmind (legacy). */
  private contentPath(...segments: string[]): string {
    return this.openmindRoot
      ? path.join(this.openmindRoot, ...segments)
      // audit-no-reporoot: legacy back-compat branch (openmindRoot unset in old tests)
      : path.join(this.repoRoot, "openmind", ...segments);
  }

  /** Resolve a skill-source path (.claude/skills/...) against skillSourcesRoot or repoRoot. */
  private skillSourcePath(...segments: string[]): string {
    const base = this.skillSourcesRoot ?? this.repoRoot;
    return path.join(base, ".claude", "skills", ...segments);
  }

  /** 从已发现的 skill 里挑出带 surfacesAsSource 的,生成 skill→source 绑定。 */
  private skillSources(): SkillSourceBinding[] {
    if (this.skillSourcesCache) return this.skillSourcesCache;
    const skills = discoverSkills(this.skillSourcesRoot ?? this.repoRoot);
    const bindings = skills.flatMap<SkillSourceBinding>((skill) => {
      const source = skill.surfacesAsSource;
      if (!source || (source.kind !== "x" && source.kind !== "reddit")) return [];
      return [{ skillId: skill.id, ...source, kind: source.kind }];
    });
    this.skillSourcesCache = bindings;
    return bindings;
  }

  listSources(): SourceDefinition[] {
    const date = compactDate(new Date().toISOString().slice(0, 10));
    const rss = this.readRssSources(date);
    const generated: SourceDefinition[] = this.skillSources().map((source) => this.skillBackedSource(source.sourceId, source.sourceName, source.kind, source.skillId, date, source.artifactRoot));
    const settings = this.readSourceSettings();
    const runs = this.listSourceRuns();
    const custom = settings.customSources.map((source) => this.customSource(source));
    return [...rss, ...generated, ...custom].map((source) => {
      const override = settings.sources[source.id] || {};
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
    const existing = this.listSources().find((source) => source.id === id);
    if (!existing) throw new Error(messages.errors.source.updateNotFound);
    let targetId = id;
    let targetUrl = existing.url;
    if (existing.kind === "rss" && patch.url && patch.url !== existing.url) {
      this.replaceRssOutline(existing.url || "", { name: patch.name || existing.name, url: patch.url });
      targetUrl = patch.url;
      targetId = stableId(`rss:${patch.url}`);
    } else if (existing.kind === "rss" && patch.name && patch.name !== existing.name) {
      this.replaceRssOutline(existing.url || "", { name: patch.name, url: existing.url || "" });
    }
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

  deleteSource(id: string): boolean {
    const existing = this.listSources().find((source) => source.id === id);
    if (!existing) return false;
    if (existing.kind === "rss" && existing.url) {
      this.removeRssOutline(existing.url);
    } else if (existing.skillId) {
      throw new Error("系统数据源不能删除，可以将其停用");
    }
    const settings = this.readSourceSettings();
    settings.customSources = settings.customSources.filter((source) => source.id !== id);
    settings.disabledUrls = settings.disabledUrls.filter((url) => url !== existing.url);
    delete settings.sources[id];
    writeJsonAtomic(this.sourceSettingsPath, settings);
    return true;
  }

  addRssSource(rawInput: AddRssSourceInput): SourceDefinition {
    const input = AddRssSourceInputSchema.parse(rawInput);
    if (input.kind !== "rss") return this.addCustomSource(input);
    try { new URL(input.url); } catch { throw new Error(messages.errors.source.invalidRssUrl); }
    const current = this.listSources();
    const duplicate = current.find((source) => source.url === input.url);
    if (duplicate) return duplicate;
    this.appendRssOutlines([{ name: input.name, url: input.url }]);
    const settings = this.readSourceSettings();
    const sourceId = stableId(`rss:${input.url}`);
    settings.sources[sourceId] = {
      ...(settings.sources[sourceId] || {}),
      frequency: input.frequency,
      tags: input.tags
    };
    writeJsonAtomic(this.sourceSettingsPath, settings);
    const source = this.listSources().find((item) => item.url === input.url);
    if (!source) throw new Error(messages.errors.source.opmlWriteUnreadable);
    return source;
  }

  importOpml(filePath: string): number {
    const raw = readText(filePath);
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(raw) as Record<string, unknown>;
    const outlines = collectPrefixedOutlines(parsed)
      .filter((outline) => typeof outline["@_xmlUrl"] === "string")
      .map((outline) => ({
        name: String(outline["@_title"] || outline["@_text"] || outline["@_xmlUrl"]),
        url: String(outline["@_xmlUrl"])
      }));
    const existingUrls = new Set(this.listSources().flatMap((source) => source.url ? [source.url] : []));
    const additions = outlines.filter((outline) => !existingUrls.has(outline.url));
    if (additions.length) this.appendRssOutlines(additions);
    return additions.length;
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

  private readRssSources(date: string): SourceDefinition[] {
    const opmlPath = this.skillSourcePath("rss-article-saver", "subscriptions.opml");
    const raw = readText(opmlPath);
    if (!raw) return [];
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
    const parsed = parser.parse(raw) as Record<string, unknown>;
    const outlines = collectOutlines(parsed);
    const count = this.content.getContent("articles", date).length;
    const lastRun = newestMtime([
      this.skillSourcePath("rss-article-saver", "article_cache.json"),
      this.contentPath("article", date)
    ]);
    return outlines
      .filter((outline) => typeof outline.xmlUrl === "string")
      .map((outline, index) => SourceDefinitionSchema.parse({
        schemaVersion: 1,
        id: stableId(`rss:${outline.xmlUrl}`),
        name: String(outline.title || outline.text || `RSS ${index + 1}`),
        kind: "rss",
        url: String(outline.xmlUrl),
        skillId: "rss-article-saver",
        enabled: true,
        frequency: messages.source.frequencyPipeline,
        lastRunAt: lastRun,
        lastSuccessAt: lastRun,
        successRate: lastRun ? 100 : null,
        status: lastRun ? "success" : "idle",
        recentError: null,
        itemCount: count
      }));
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
    const opmlPath = this.skillSourcePath("rss-article-saver", "subscriptions.opml");
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
    const opmlPath = this.skillSourcePath("rss-article-saver", "subscriptions.opml");
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

  private removeRssOutline(url: string): void {
    const opmlPath = this.skillSourcePath("rss-article-saver", "subscriptions.opml");
    const parser = new XMLParser({ ignoreAttributes: false });
    const builder = new XMLBuilder({ ignoreAttributes: false, format: true, indentBy: "  " });
    const parsed = parser.parse(readText(opmlPath)) as Record<string, unknown>;
    let removed = false;
    const prune = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(prune).filter((item) => item !== undefined);
      if (!value || typeof value !== "object") return value;
      const record = value as Record<string, unknown>;
      if (record["@_xmlUrl"] === url) {
        removed = true;
        return undefined;
      }
      for (const key of Object.keys(record)) {
        const next = prune(record[key]);
        if (next === undefined) delete record[key];
        else record[key] = next;
      }
      return record;
    };
    prune(parsed);
    if (!removed) throw new Error(messages.errors.source.opmlEntryMissing);
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
    // When openmindRoot is supplied (ADR-001), strip the leading "openmind/" and
    // join onto openmindRoot directly; otherwise fall back to repoRoot joining.
    const artifactPath = this.openmindRoot
      ? path.join(this.openmindRoot, artifactRoot.replace(/^openmind\/+/, ""), date)
      : path.join(this.repoRoot, artifactRoot, date);
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

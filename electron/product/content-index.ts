import fs from "node:fs";
import path from "node:path";
import {
  ContentIndexMaintenanceSchema,
  ContentFacetsQuerySchema,
  ContentItemSchema,
  ContentQuerySchema,
  type ContentFacets,
  type ContentFacetsQuery,
  type ContentIndexMaintenance,
  type ContentItem,
  type ContentPage,
  type ContentQuery,
  type ContentState,
  type ContentStatePatch,
  type GlobalSearchResult
} from "../../shared/contracts";
import {
  CONTENT_STATE_DEFAULT,
  compactDate,
  contentKindLabel,
  contentSorter,
  normalizeContentKind,
  parseMetadata,
  safeStat,
  stableContentId,
  stateForRecord,
  stripMetadata,
  writeJsonAtomic,
  type ContentIndexFile,
  type IndexedContent,
  type ContentApi,
  type LegacyContentEntry
} from "./common";
import { ContentStateStore } from "./content-state";
import { CONTENT_DATE_ROOTS, CONTENT_FILE_ROOTS } from "../../shared/content-kinds";
import { quarantineCorruptState, statePath } from "./state-directory";

export class ContentIndexStore {
  private readonly state: ContentStateStore;
  private readonly contentIndexPath: string;
  // readContentIndex 解析结果按索引文件 mtime 缓存，避免每次 IPC/搜索按键都 readFileSync+逐条 Zod。
  private indexCache: ContentIndexFile | null = null;
  private indexCacheMtime = 0;
  // availableContentDates 按 5 个内容根目录的 mtime 指纹缓存，避免每次都 readdir 5 个目录。
  private datesCache: string[] | null = null;
  private datesFingerprint = "";

  /** ADR-001: parent dir of `.cctools` (state root). Used for relative paths in maintenance reports. */
  private readonly stateBaseDir: string;

  constructor(
    private readonly repoRoot: string,
    private readonly content: ContentApi,
    /**
     * ADR-001 §1.3: app-private state dir under userData. When omitted, falls
     * back to `<repoRoot>/.cctools` for back-compat with existing tests/users.
     */
    stateRoot?: string
  ) {
    this.stateBaseDir = stateRoot ?? repoRoot;
    this.state = new ContentStateStore(this.stateBaseDir);
    this.contentIndexPath = statePath(this.stateBaseDir, "content-index.json");
  }

  listInbox(rawQuery: ContentQuery): ContentPage {
    const query = ContentQuerySchema.parse(rawQuery);
    const indexed = this.ensureDateIndexed(compactDate(query.date));
    const state = this.state.readFor(indexed);
    const items: ContentItem[] = [];

    for (const record of indexed) {
      const item = this.toContentItem(record, stateForRecord(record, state));
      if (query.kinds.length && !query.kinds.includes(item.kind)) continue;
      if (query.source && item.source !== query.source) continue;
      if (query.minScore !== undefined && (item.state.score || 0) < query.minScore) continue;
      if (query.tags.length && !query.tags.every((tag) => item.state.tags.includes(tag))) continue;
      if (query.search) {
        const searchText = `${record.searchText} ${item.state.tags.join(" ").toLocaleLowerCase()}`;
        if (!searchText.includes(query.search.trim().toLocaleLowerCase())) continue;
      }
      items.push(item);
    }

    const sorted = items.sort(contentSorter(query.sort));
    const page = sorted.slice(query.cursor, query.cursor + query.limit);
    const nextCursor = query.cursor + page.length < sorted.length ? query.cursor + page.length : null;
    return { items: page, total: sorted.length, nextCursor };
  }

  getInboxFacets(rawQuery: ContentFacetsQuery): ContentFacets {
    const query = ContentFacetsQuerySchema.parse(rawQuery);
    const indexed = this.ensureDateIndexed(compactDate(query.date));
    const state = this.state.readFor(indexed);
    const kindCounts: Record<string, number> = {};
    const tagCounts = new Map<string, number>();
    const needle = query.search.trim().toLocaleLowerCase();
    let total = 0;

    for (const record of indexed) {
      const itemState = stateForRecord(record, state) || CONTENT_STATE_DEFAULT;
      if (query.tags.length && !query.tags.every((tag) => itemState.tags.includes(tag))) continue;
      if (needle && !`${record.searchText} ${itemState.tags.join(" ").toLocaleLowerCase()}`.includes(needle)) continue;
      total++;
      kindCounts[record.kind] = (kindCounts[record.kind] || 0) + 1;
      for (const tag of itemState.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }

    return {
      total,
      kindCounts,
      tags: [...tagCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
        .map(([tag, count]) => ({ tag, count }))
    };
  }

  updateContentState(id: string, relativePath: string, rawPatch: ContentStatePatch): ContentItem {
    const item = this.findContent(relativePath, CONTENT_STATE_DEFAULT);
    if (item.id !== id) throw new Error("内容标识与路径不匹配，请刷新后重试。");
    const state = this.state.update(id, relativePath, rawPatch);
    return this.findContent(relativePath, state);
  }

  rebuildContentIndex(): ContentIndexMaintenance {
    try { fs.rmSync(this.contentIndexPath, { force: true }); } catch { /* best effort */ }
    this.indexCache = null;
    this.indexCacheMtime = 0;
    const dates = this.availableContentDates();
    let itemCount = 0;
    for (const date of dates) itemCount += this.ensureDateIndexed(date).length;
    this.state.readFor(Object.values(this.readContentIndex().items));
    return ContentIndexMaintenanceSchema.parse({
      schemaVersion: 1,
      indexedDates: dates,
      itemCount,
      // ADR-001: report state paths relative to the state base dir (which
      // may be userData rather than mymindRoot), so the logical `.cctools/...`
      // path stays stable regardless of where state is stored.
      indexPath: path.relative(this.stateBaseDir, this.contentIndexPath),
      statePath: path.relative(this.stateBaseDir, this.state.statePath),
      rebuiltAt: new Date().toISOString()
    });
  }

  /**
   * 单天刷新：ensureDateIndexed 按 modifiedAt/size 自检过期，只重建传入的那一天。
   * 供内容保存后调用，替代曾经每次保存都跑一遍的全量 rebuildContentIndex。
   */
  refreshDate(date: string): void {
    this.ensureDateIndexed(compactDate(date));
  }

  listItemsForDate(rawDate: string): ContentItem[] {
    const indexed = this.ensureDateIndexed(compactDate(rawDate));
    const state = this.state.readFor(indexed);
    return indexed.map((record) => this.toContentItem(record, stateForRecord(record, state)));
  }

  searchContent(rawQuery: string, limit = 20): GlobalSearchResult[] {
    const query = rawQuery.trim();
    if (!query) return [];
    const results: GlobalSearchResult[] = [];
    for (const date of this.availableContentDates()) {
      const page = this.listInbox({
        date,
        kinds: [],
        search: query,
        tags: [],
        sort: "newest",
        cursor: 0,
        limit: Math.min(50, limit)
      });
      for (const item of page.items) {
        results.push({
          id: `content:${item.id}`,
          kind: "content",
          title: item.title,
          subtitle: `${item.source} · ${contentKindLabel(item.kind)}`,
          path: item.path,
          date,
          status: null,
          targetId: item.id
        });
        if (results.length >= limit) return results;
      }
    }
    return results;
  }

  availableContentDates(): string[] {
    // ADR-001: this.repoRoot is now the mymind content dir. CONTENT_DATE_ROOTS
    // are logical paths with a historical `mymind/` prefix (relative to the
    // old repo root); strip it so joins land inside mymindRoot.
    const stripMymindPrefix = (rel: string) => rel.replace(/^mymind\/+/, "");
    const dateRoots = CONTENT_DATE_ROOTS.map((rel) => path.join(this.repoRoot, stripMymindPrefix(rel)));
    const fileRoots = CONTENT_FILE_ROOTS.map((rel) => path.join(this.repoRoot, stripMymindPrefix(rel)));
    // 指纹 = 5 个根目录的 mtimeMs；新建/删除日期目录或 dated 文件才会变，故新增当天内容（已有日期下）不会误失效。
    const fingerprint = [...dateRoots, ...fileRoots]
      .map((root) => { try { return fs.statSync(root).mtimeMs; } catch { return 0; } })
      .join(",");
    if (this.datesCache && this.datesFingerprint === fingerprint) return this.datesCache;
    const dates = new Set<string>();
    for (const root of dateRoots) {
      try {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (entry.isDirectory() && /^\d{8}$/.test(entry.name)) dates.add(entry.name);
        }
      } catch { /* optional content root */ }
    }
    for (const root of fileRoots) {
      try {
        for (const entry of fs.readdirSync(root)) {
          const match = entry.match(/(\d{8})/);
          if (match) dates.add(match[1]);
        }
      } catch { /* optional content root */ }
    }
    this.datesCache = [...dates].sort().reverse().slice(0, 120);
    this.datesFingerprint = fingerprint;
    return this.datesCache;
  }

  private findContent(relativePath: string, itemState: ContentState): ContentItem {
    const dateMatch = relativePath.match(/(?:^|[\\/])(\d{8})(?:[\\/]|_)/);
    const date = dateMatch?.[1] || compactDate(new Date().toISOString().slice(0, 10));
    const record = this.ensureDateIndexed(date).find((candidate) => candidate.path === relativePath);
    if (!record) throw new Error("内容文件已不存在或不属于当前日期。");
    return this.toContentItem(record, itemState);
  }

  private indexContent(entry: LegacyContentEntry, date: string): IndexedContent {
    const record = this.content.readContent(entry.path);
    const raw = record.content || "";
    const metadata = parseMetadata(raw, entry.name || path.basename(entry.path));
    const modifiedAt = entry.modifiedAt || safeStat(path.join(this.repoRoot, entry.path))?.mtime.toISOString() || new Date(0).toISOString();
    const item = ContentItemSchema.parse({
      schemaVersion: 1,
      id: stableContentId(entry.path, metadata, raw),
      path: entry.path,
      name: entry.name || path.basename(entry.path),
      title: entry.title || metadata.title,
      kind: normalizeContentKind(entry.kind || entry.type, entry.path),
      source: metadata.source,
      author: metadata.author,
      originalUrl: metadata.url,
      publishedAt: metadata.publishedAt,
      capturedAt: modifiedAt,
      modifiedAt,
      size: entry.size || Buffer.byteLength(raw, "utf8"),
      excerpt: metadata.excerpt,
      state: CONTENT_STATE_DEFAULT
    });
    const { state: _state, ...withoutState } = item;
    return {
      ...withoutState,
      date,
      searchText: [
        item.title,
        item.source,
        item.author,
        item.excerpt,
        stripMetadata(raw).slice(0, 32_000)
      ].filter(Boolean).join(" ").toLocaleLowerCase()
    };
  }

  private toContentItem(record: IndexedContent, itemState?: ContentState): ContentItem {
    const { date: _date, searchText: _searchText, ...item } = record;
    return ContentItemSchema.parse({ ...item, state: itemState || CONTENT_STATE_DEFAULT });
  }

  private ensureDateIndexed(date: string): IndexedContent[] {
    const index = this.readContentIndex();
    const entries = this.content.getContent("all", date);
    const currentPaths = new Set(entries.map((entry) => entry.path));
    let changed = false;

    for (const [relativePath, record] of Object.entries(index.items)) {
      if (record.date === date && !currentPaths.has(relativePath)) {
        delete index.items[relativePath];
        changed = true;
      }
    }

    for (const entry of entries) {
      const existing = index.items[entry.path];
      const stat = entry.modifiedAt && entry.size ? null : safeStat(path.join(this.repoRoot, entry.path));
      const modifiedAt = entry.modifiedAt || stat?.mtime.toISOString() || "";
      const size = entry.size || stat?.size || 0;
      if (existing && existing.modifiedAt === modifiedAt && existing.size === size && existing.date === date) continue;
      index.items[entry.path] = this.indexContent(entry, date);
      changed = true;
    }

    if (changed) {
      index.updatedAt = new Date().toISOString();
      writeJsonAtomic(this.contentIndexPath, index);
      // 写入后把缓存同步为刚写入的对象 + 新 mtime，保证后续 readContentIndex 命中且与磁盘一致。
      try { this.indexCacheMtime = fs.statSync(this.contentIndexPath).mtimeMs; } catch { this.indexCacheMtime = 0; }
      this.indexCache = index;
    }
    return Object.values(index.items).filter((record) => record.date === date);
  }

  private readContentIndex(): ContentIndexFile {
    let mtime = 0;
    try { mtime = fs.statSync(this.contentIndexPath).mtimeMs; } catch { /* 索引文件尚不存在 */ }
    if (this.indexCache && this.indexCacheMtime === mtime) return this.indexCache;
    let result: ContentIndexFile;
    if (!fs.existsSync(this.contentIndexPath)) {
      result = { schemaVersion: 1, updatedAt: new Date(0).toISOString(), items: {} };
    } else {
      try {
        const raw = JSON.parse(fs.readFileSync(this.contentIndexPath, "utf8")) as {
          schemaVersion?: unknown;
          updatedAt?: unknown;
          items?: unknown;
        };
        if (raw.schemaVersion !== 1 || !raw.items || typeof raw.items !== "object" || Array.isArray(raw.items)) {
          throw new Error("内容索引结构无效。");
        }
        const items: Record<string, IndexedContent> = {};
        for (const [relativePath, value] of Object.entries(raw.items as Record<string, unknown>)) {
          const candidate = value as Partial<IndexedContent>;
          const parsed = ContentItemSchema.safeParse({ ...candidate, state: CONTENT_STATE_DEFAULT });
          if (!parsed.success || typeof candidate.date !== "string" || typeof candidate.searchText !== "string") continue;
          const { state: _state, ...withoutState } = parsed.data;
          items[relativePath] = {
            ...withoutState,
            date: candidate.date,
            searchText: candidate.searchText
          };
        }
        result = {
          schemaVersion: 1,
          updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
          items
        };
      } catch {
        quarantineCorruptState(this.contentIndexPath);
        result = { schemaVersion: 1, updatedAt: new Date(0).toISOString(), items: {} };
        mtime = 0;   // 文件已被隔离，按"不存在"记指纹，避免缓存空结果却带陈旧 mtime
      }
    }
    this.indexCache = result;
    this.indexCacheMtime = mtime;
    return result;
  }

}

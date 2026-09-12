import fs from "node:fs";
import path from "node:path";
import type { GlobalSearchResult } from "../../shared/contracts";
import {
  compactDate,
  contentKindLabel,
  IndexedContentSchema,
  normalizeContentKind,
  parseMetadata,
  safeStat,
  stableContentId,
  stripMetadata,
  writeJsonAtomic,
  type ContentIndexFile,
  type IndexedContent,
  type ContentApi,
  type LegacyContentEntry
} from "./common";
import { CONTENT_DATE_ROOTS, CONTENT_FILE_ROOTS } from "../../shared/content-kinds";
import { quarantineCorruptState, statePath } from "./state-directory";

// 单个日期的列表/索引结果在搜索键入期间的最短复用窗口。searchContent 会对
// 最多 120 个日期逐一 ensureDateIndexed，而 getContent 对 creative 等目录做
// 递归遍历——逐键全量重扫不可接受。TTL 内直接复用内存索引；与
// openmind-file-search 的索引 TTL 语义一致，内容改动最迟一个窗口后可见。
const SEARCH_DATE_REFRESH_INTERVAL_MS = 30_000;

export class ContentIndexStore {
  private readonly contentIndexPath: string;
  // readContentIndex 解析结果按索引文件 mtime 缓存，避免每次 IPC/搜索按键都 readFileSync+逐条 Zod。
  private indexCache: ContentIndexFile | null = null;
  private indexCacheMtime = 0;
  // availableContentDates 按 5 个内容根目录的 mtime 指纹缓存，避免每次都 readdir 5 个目录。
  private datesCache: string[] | null = null;
  private datesFingerprint = "";
  // 每日期的搜索索引条目，按 TTL 复用；显式 refreshDate 立即刷新。
  private readonly dateSearchCache = new Map<string, { items: IndexedContent[]; indexedAtMs: number }>();
  // 冷搜索会对最多 120 天连续 ensureDateIndexed；写盘推迟到整轮 sweep 结束，
  // 否则每个变化日期都把不断增大的完整索引原子写一次（120 天 ≈ 120 次全量写）。
  private indexDirty = false;

  constructor(
    private readonly repoRoot: string,
    private readonly content: ContentApi,
    /**
     * ADR-001 §1.3: app-private state dir under userData. When omitted, falls
     * back to `<repoRoot>/.openmind` for back-compat with existing tests/users.
     */
    stateRoot?: string
  ) {
    this.contentIndexPath = statePath(stateRoot ?? repoRoot, "content-index.json");
  }

  /**
   * 单天刷新：ensureDateIndexed 按 modifiedAt/size 自检过期，只重建传入的那一天。
   */
  refreshDate(date: string): void {
    const normalized = compactDate(date);
    const items = this.ensureDateIndexed(normalized);
    this.dateSearchCache.set(normalized, { items, indexedAtMs: Date.now() });
    this.flushIndexWrite();
  }

  searchContent(rawQuery: string, limit = 20): GlobalSearchResult[] {
    const query = rawQuery.trim();
    if (!query) return [];
    try {
      const normalizedQuery = query.toLocaleLowerCase();
      const results: GlobalSearchResult[] = [];
      const now = Date.now();
      for (const date of this.availableContentDates()) {
        let cached = this.dateSearchCache.get(date);
        if (!cached || now - cached.indexedAtMs >= SEARCH_DATE_REFRESH_INTERVAL_MS) {
          cached = { items: this.ensureDateIndexed(date), indexedAtMs: now };
          this.dateSearchCache.set(date, cached);
        }
        for (const item of cached.items) {
          if (!item.searchText.includes(normalizedQuery)) continue;
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
    } finally {
      // 提前命中 limit 也要落盘，保证已重建的日期不丢。
      this.flushIndexWrite();
    }
  }

  availableContentDates(): string[] {
    // ADR-001: this.repoRoot is now the openmind content dir. CONTENT_DATE_ROOTS
    // are logical paths with a historical `openmind/` prefix (relative to the
    // old repo root); strip it so joins land inside openmindRoot.
    const stripOpenmindPrefix = (rel: string) => rel.replace(/^openmind\/+/, "");
    const dateRoots = CONTENT_DATE_ROOTS.map((rel) => path.join(this.repoRoot, stripOpenmindPrefix(rel)));
    const fileRoots = CONTENT_FILE_ROOTS.map((rel) => path.join(this.repoRoot, stripOpenmindPrefix(rel)));
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

  private indexContent(entry: LegacyContentEntry, date: string): IndexedContent {
    const record = this.content.readContent(entry.path);
    const raw = record.content || "";
    const metadata = parseMetadata(raw, entry.name || path.basename(entry.path));
    const modifiedAt = entry.modifiedAt || safeStat(path.join(this.repoRoot, entry.path))?.mtime.toISOString() || new Date(0).toISOString();
    return IndexedContentSchema.parse({
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
      date,
      searchText: [
        metadata.title,
        metadata.source,
        metadata.author,
        metadata.excerpt,
        stripMetadata(raw).slice(0, 32_000)
      ].filter(Boolean).join(" ").toLocaleLowerCase()
    });
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

    if (changed) this.indexDirty = true;
    return Object.values(index.items).filter((record) => record.date === date);
  }

  /** 把本轮累积的索引变更一次性原子落盘；无变更时零 IO。写失败时保留 dirty 以便下轮重试。 */
  private flushIndexWrite(): void {
    if (!this.indexDirty || !this.indexCache) return;
    const index = this.indexCache;
    index.updatedAt = new Date().toISOString();
    writeJsonAtomic(this.contentIndexPath, index);
    this.indexDirty = false;
    // 写入后把缓存 mtime 同步为磁盘值，保证后续 readContentIndex 命中且与磁盘一致。
    try { this.indexCacheMtime = fs.statSync(this.contentIndexPath).mtimeMs; } catch { this.indexCacheMtime = 0; }
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
          const parsed = IndexedContentSchema.safeParse(value);
          if (parsed.success) items[relativePath] = parsed.data;
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

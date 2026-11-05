import fs from "node:fs";
import path from "node:path";
import type {
  AddRssSourceInput,
  GlobalSearchResult,
  SourceDefinition,
  SourceQuery,
  SourcePatch,
} from "../../shared/contracts";
import { ContentIndexService } from "./content-index-service";
import { SourceRegistry } from "./source-registry";
import type { ContentServiceApi, } from "./common";

export class ProductService {
  /**
   * The actual openmind root (ADR-001). Renamed from `repoRoot` to make the
   * contract explicit: this is the content directory, not a openmind checkout.
   * Paths are joined directly onto it (no `openmind/` segment).
   */
  private readonly openmindRoot: string;
  private readonly content: ContentServiceApi;
  private readonly contentIndex: ContentIndexService;
  private readonly sources: SourceRegistry;
  // getOverview / listContent 按 date 缓存，按当天内容根目录 mtime 指纹失效。
  // 避免每次 IPC（含冷启动 getBootstrap）都裸 readdirSync+statSync 重扫当天文件。
  // 粒度权衡：指纹取目录 mtimeMs，捕捉新增/删除；app 内编辑走 writeContent→refreshContentDate 显式失效。
  private readonly dateCache = new Map<string, { fingerprint: string; overview: unknown; contentLists: Map<string, unknown> }>();

  constructor(
    openmindRoot: string,
    content: ContentServiceApi,
    /**
     * Optional ADR-001 wiring. `stateRoot` is the app-private state dir under
     * userData; when omitted, services fall back to the legacy
     * `<openmindRoot>/.openmind` location for back-compat.
     */
    opts: { stateRoot?: string } = {},
  ) {
    this.openmindRoot = openmindRoot;
    this.content = content;
    this.contentIndex = new ContentIndexService(openmindRoot, content, opts.stateRoot);
    // Skill descriptors come from the installed store; mutable source
    // configuration is owned by the per-Skill data directory.
    this.sources = new SourceRegistry(openmindRoot, content, opts.stateRoot);
  }

  /** openmindRoot 切换重建实例时释放 worker 线程，避免残留。 */
  dispose(): void {
    this.contentIndex.dispose();
  }

  private overviewFingerprint(date: string): string {
    const parts: number[] = [];
    // 日期/扁平目录：原地覆盖单文件不改目录 mtime，readdir + 取文件 mtime 最大值才能
    // 捕捉原地更新（reddit md / posts.json / daily_summary 被外部 skill 重写）。
    for (const p of [
      path.join(this.openmindRoot, "article", date),
      path.join(this.openmindRoot, "reddit", date),
      path.join(this.openmindRoot, "post", date),
      path.join(this.openmindRoot, "daily-summary"),
      path.join(this.openmindRoot, "daily-topic")
    ]) {
      parts.push(this.newestFileMtime(p));
    }
    return parts.join(",");
  }

  /** 目录 mtime 与其内最新文件 mtime 的较大值——捕捉原地覆盖（不改目录 mtime）。 */
  private newestFileMtime(dir: string): number {
    let max = 0;
    try {
      max = fs.statSync(dir).mtimeMs;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        try {
          const m = fs.statSync(path.join(dir, entry.name)).mtimeMs;
          if (m > max) max = m;
        } catch { /* skip unreadable */ }
      }
    } catch { /* dir missing */ }
    return max;
  }

  /** 指纹命中返回缓存条目；指纹变化（当天目录 mtime 变）则丢弃旧条目，下次重算。 */
  private dateCacheEntry(date: string) {
    const fingerprint = this.overviewFingerprint(date);
    const cached = this.dateCache.get(date);
    if (cached && cached.fingerprint === fingerprint) return cached;
    const entry = { fingerprint, overview: undefined as unknown, contentLists: new Map<string, unknown>() };
    this.dateCache.set(date, entry);
    return entry;
  }

  getOverview(date: string): unknown {
    const entry = this.dateCacheEntry(date);
    if (entry.overview === undefined) {
      entry.overview = this.content.getOverview(date);
    }
    return entry.overview;
  }

  listContent(kind: string, date: string) {
    const entry = this.dateCacheEntry(date);
    if (!entry.contentLists.has(kind)) {
      entry.contentLists.set(kind, this.content.getContent(kind, date));
    }
    return entry.contentLists.get(kind);
  }

  readContent(relativePath: string) {
    return this.content.readContentAsync(relativePath);
  }

  getXFollowingCurls(): string[] {
    return this.sources.readXFollowingCurls();
  }

  saveXFollowingCurls(contents: string[]): void {
    this.sources.saveXFollowingCurls(contents);
  }

  /** 单天内容刷新（保存后用），只重建当天索引，避免全量 rebuild。C4：转 private，经 writeContent 自失效。 */
  private refreshContentDate(date: string): void {
    this.contentIndex.refreshDate(date);
    this.dateCache.delete(date);
  }

  listSources(query?: SourceQuery): SourceDefinition[] {
    return this.sources.listSources(query);
  }

  updateSource(id: string, patch: SourcePatch): SourceDefinition {
    const source = this.sources.updateSource(id, patch);
    return source;
  }

  removeRedditSource(id: string): void {
    this.sources.removeRedditSource(id);
  }

  addRssSource(input: AddRssSourceInput): SourceDefinition {
    const source = this.sources.addRssSource(input);
    return source;
  }

  importOpml(filePath: string): number {
    const count = this.sources.importOpml(filePath);
    return count;
  }

  recordSkillEvent(event: Record<string, unknown>): void {
    this.sources.recordSkillEvent(event);
  }

  /** 保存内容并刷新所属日期索引（dashboard 自失效，C4：main 不再手动 refresh）。 */
  writeContent(relativePath: string, rawContent: string): { path: string; name: string; content: string; truncated: boolean } {
    const record = this.content.writeContent(relativePath, rawContent);
    const dateMatch = relativePath.match(/(\d{8})/);
    if (dateMatch) this.refreshContentDate(dateMatch[1]);
    return record;
  }

  /** 冷索引构建与评分在 worker 里执行（编译产物存在时），结果异步返回。 */
  searchContent(query: string, limit = 20): Promise<GlobalSearchResult[]> {
    return this.contentIndex.searchContent(query, limit);
  }

}

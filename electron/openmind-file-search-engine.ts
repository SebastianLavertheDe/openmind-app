import fs from "node:fs";
import path from "node:path";
import type { ProjectFileMatch, ProjectFileSearchResult } from "../shared/contracts";

export const IGNORED_DIRECTORIES = new Set([
  ".agent",
  ".build",
  ".cache",
  ".claude",
  ".claudian",
  ".git",
  ".idea",
  ".mypy_cache",
  ".next",
  ".obsidian",
  ".openmind",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  ".zcode",
  "__pycache__",
  "build",
  "config",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "scripts",
  "target",
  "venv"
]);

export const MAX_INDEXED_FILES = 200_000;
export const CACHE_TTL_MS = 30_000;

export type IndexedFile = {
  path: string;
  name: string;
  directory: string;
  extension: string;
  normalizedPath: string;
  normalizedName: string;
};

/**
 * 20 万文件规模的索引构建 + 评分检索，纯 Node 逻辑、零 Electron 依赖：
 * 既在主进程兜底路径运行，也整体运行在 worker_threads 里（openmind-file-search-worker）。
 * 搜索用 bounded top-K 代替「全量收集 + 全量排序」，宽泛命中不再物化十万级中间数组。
 */
export class OpenmindFileSearchEngine {
  private cache: { files: IndexedFile[]; truncated: boolean; createdAt: number } | null = null;
  private pending: Promise<{ files: IndexedFile[]; truncated: boolean; createdAt: number }> | null = null;

  constructor(
    private readonly openmindRoot: string,
    private readonly logicalPrefix: string
  ) {}

  async search(rawQuery: string, rawLimit = 40): Promise<ProjectFileSearchResult> {
    const query = normalize(rawQuery.trim());
    const limit = Math.max(1, Math.min(100, Math.floor(rawLimit)));
    if (!query) return { items: [], indexedCount: 0, truncated: false };
    const index = await this.getIndex();
    const tokens = query.split(/\s+/).filter(Boolean);
    const top: RankedFile[] = [];
    for (const file of index.files) {
      const score = scoreFile(file, tokens);
      if (score === null) continue;
      insertRanked(top, { file, score }, limit);
    }
    return {
      items: top.map(({ file }) => ({
        path: file.path,
        name: file.name,
        directory: file.directory,
        extension: file.extension
      } satisfies ProjectFileMatch)),
      indexedCount: index.files.length,
      truncated: index.truncated
    };
  }

  invalidate(): void {
    this.cache = null;
  }

  private async getIndex(): Promise<{ files: IndexedFile[]; truncated: boolean; createdAt: number }> {
    if (this.cache && Date.now() - this.cache.createdAt < CACHE_TTL_MS) return this.cache;
    // Share one rebuild across concurrent keystrokes. Callers await an expired
    // index because the current IPC response is the only opportunity to update
    // a settled mention query; returning stale data here would leave a newly
    // added or renamed file invisible until the user changes the query again.
    if (!this.pending) {
      this.pending = this.buildIndex()
        .then((index) => { this.cache = index; return index; })
        .finally(() => { this.pending = null; });
    }
    return this.pending;
  }

  private async buildIndex(): Promise<{ files: IndexedFile[]; truncated: boolean; createdAt: number }> {
    const files: IndexedFile[] = [];
    try {
      const rootStat = await fs.promises.lstat(this.openmindRoot);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return { files, truncated: false, createdAt: Date.now() };
    } catch {
      return { files, truncated: false, createdAt: Date.now() };
    }
    const directories = [this.openmindRoot];
    let truncated = false;
    while (directories.length && files.length < MAX_INDEXED_FILES) {
      const directory = directories.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (files.length >= MAX_INDEXED_FILES) {
          truncated = true;
          break;
        }
        if (entry.isSymbolicLink()) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) directories.push(absolute);
          continue;
        }
        if (!entry.isFile()) continue;
        if (isSensitiveFile(entry.name)) continue;
        const relative = path.relative(this.openmindRoot, absolute);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
        const portablePath = `${this.logicalPrefix}/${relative.split(path.sep).join("/")}`;
        const portableDirectory = path.posix.dirname(portablePath);
        files.push({
          path: portablePath,
          name: entry.name,
          directory: portableDirectory === "." ? "" : portableDirectory,
          extension: path.extname(entry.name).slice(1).toLocaleLowerCase(),
          normalizedPath: normalize(portablePath),
          normalizedName: normalize(entry.name)
        });
      }
    }
    return { files, truncated, createdAt: Date.now() };
  }
}

type RankedFile = { file: IndexedFile; score: number };

/** 与全量排序等价的比较器：分数降序 → 路径长度升序 → 路径字典序。 */
function compareRanked(left: RankedFile, right: RankedFile): number {
  return right.score - left.score
    || left.file.path.length - right.file.path.length
    || left.file.path.localeCompare(right.file.path);
}

/**
 * 往有序 top-K 里插入一条命中。先与当前最差命中快速比较，宽泛查询的大多数
 * 命中在 O(1) 内被拒之门外；等价元素插入到既有等价元素之后，保持与稳定排序
 * 相同的输出顺序。
 */
function insertRanked(top: RankedFile[], entry: RankedFile, limit: number): void {
  if (top.length >= limit) {
    if (compareRanked(entry, top[top.length - 1]) >= 0) return;
    top.pop();
  }
  let low = 0;
  let high = top.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (compareRanked(top[middle], entry) <= 0) low = middle + 1;
    else high = middle;
  }
  top.splice(low, 0, entry);
}

export function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replaceAll("\\", "/");
}

export function scoreFile(file: IndexedFile, tokens: string[]): number | null {
  let score = 0;
  for (const token of tokens) {
    if (file.normalizedName === token) score += 140;
    else if (file.normalizedName.startsWith(token)) score += 110;
    else if (file.normalizedName.includes(token)) score += 85;
    else if (pathSegments(file.normalizedPath).some((segment) => segment.startsWith(token))) score += 62;
    else if (file.normalizedPath.includes(token)) score += 48;
    else if (isSubsequence(token, file.normalizedPath)) score += 16;
    else return null;
  }
  if (file.extension === "md") score += 5;
  if (!file.directory) score += 4;
  score -= Math.min(20, file.path.length / 40);
  return score;
}

function pathSegments(value: string): string[] {
  return value.split("/");
}

function isSubsequence(query: string, value: string): boolean {
  let queryIndex = 0;
  for (let index = 0; index < value.length && queryIndex < query.length; index++) {
    if (value[index] === query[queryIndex]) queryIndex++;
  }
  return queryIndex === query.length;
}

export function isSensitiveFile(fileName: string): boolean {
  const normalized = fileName.toLocaleLowerCase();
  if (
    normalized === ".npmrc"
    || normalized === ".pypirc"
    || normalized === ".netrc"
    || normalized === ".git-credentials"
    || normalized === "credentials"
    || normalized === "credentials.json"
    || normalized === "secrets.json"
    || normalized === "providers.yaml"
  ) return true;
  if (normalized === ".env" || normalized.startsWith(".env.")) {
    return !/\.(example|sample|template)$/u.test(normalized);
  }
  return [".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"].some((extension) => normalized.endsWith(extension));
}

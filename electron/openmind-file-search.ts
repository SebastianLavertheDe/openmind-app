import fs from "node:fs";
import path from "node:path";
import type { ProjectFileMatch, ProjectFileSearchResult } from "../shared/contracts";

const IGNORED_DIRECTORIES = new Set([
  ".build",
  ".cache",
  ".openmind",
  ".git",
  ".idea",
  ".mypy_cache",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "venv"
]);

const MAX_INDEXED_FILES = 200_000;
const CACHE_TTL_MS = 30_000;

type IndexedFile = {
  path: string;
  name: string;
  directory: string;
  extension: string;
  normalizedPath: string;
  normalizedName: string;
};

type OpenmindFileSearchOptions = {
  /** New path-boundary mode: the constructor argument is the actual root. */
  rootKind?: "openmind" | "legacy-project";
};

export class OpenmindFileSearch {
  private cache: { files: IndexedFile[]; truncated: boolean; createdAt: number } | null = null;
  private pending: Promise<{ files: IndexedFile[]; truncated: boolean; createdAt: number }> | null = null;
  private readonly projectRoot: string;
  private readonly openmindRoot: string;
  private readonly logicalPrefix: string;

  constructor(root: string, options: OpenmindFileSearchOptions = {}) {
    if (options.rootKind === "openmind") {
      this.projectRoot = path.resolve(root);
      this.openmindRoot = this.projectRoot;
      this.logicalPrefix = "openmind";
    } else {
      // Compatibility for the old constructor used by existing callers/tests.
      this.projectRoot = path.resolve(root);
      this.openmindRoot = path.join(this.projectRoot, "openmind");
      this.logicalPrefix = "openmind";
    }
  }

  async search(rawQuery: string, rawLimit = 40): Promise<ProjectFileSearchResult> {
    const query = normalize(rawQuery.trim());
    const limit = Math.max(1, Math.min(100, Math.floor(rawLimit)));
    if (!query) return { items: [], indexedCount: 0, truncated: false };
    const index = await this.getIndex();
    const tokens = query.split(/\s+/).filter(Boolean);
    const ranked: Array<{ file: IndexedFile; score: number }> = [];
    for (const file of index.files) {
      const score = scoreFile(file, tokens);
      if (score === null) continue;
      ranked.push({ file, score });
    }
    ranked.sort((left, right) =>
      right.score - left.score
      || left.file.path.length - right.file.path.length
      || left.file.path.localeCompare(right.file.path)
    );
    return {
      items: ranked.slice(0, limit).map(({ file }) => ({
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
    if (this.pending) return this.pending;
    this.pending = this.buildIndex();
    try {
      this.cache = await this.pending;
      return this.cache;
    } finally {
      this.pending = null;
    }
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

export function normalizeOpenmindSelection(rootInput: string, candidate: string, options: OpenmindFileSearchOptions = {}): string {
  const root = path.resolve(rootInput);
  const openmindRoot = options.rootKind === "openmind" ? root : path.join(root, "openmind");
  const resolved = path.resolve(candidate);
  let openmindStat: fs.Stats;
  let candidateStat: fs.Stats;
  try {
    openmindStat = fs.lstatSync(openmindRoot);
    candidateStat = fs.lstatSync(resolved);
  } catch {
    throw new Error("所选 openmind 文件不存在。");
  }
  if (!openmindStat.isDirectory() || openmindStat.isSymbolicLink() || !candidateStat.isFile() || candidateStat.isSymbolicLink()) {
    throw new Error("只能通过 @ 引用 openmind 目录内的普通文件。");
  }
  const relativeToOpenmind = path.relative(openmindRoot, resolved);
  if (!relativeToOpenmind || relativeToOpenmind.startsWith("..") || path.isAbsolute(relativeToOpenmind)) {
    throw new Error("只能通过 @ 引用 openmind 目录内的文件。");
  }
  const realOpenmindRoot = fs.realpathSync(openmindRoot);
  const realCandidate = fs.realpathSync(resolved);
  const realRelative = path.relative(realOpenmindRoot, realCandidate);
  if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error("只能通过 @ 引用 openmind 目录内的文件。");
  }
  const logicalRelative = path.relative(openmindRoot, resolved);
  return `openmind/${logicalRelative.split(path.sep).join("/")}`;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replaceAll("\\", "/");
}

function scoreFile(file: IndexedFile, tokens: string[]): number | null {
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

function isSensitiveFile(fileName: string): boolean {
  const normalized = fileName.toLocaleLowerCase();
  if (
    normalized === ".npmrc"
    || normalized === ".pypirc"
    || normalized === ".netrc"
    || normalized === ".git-credentials"
    || normalized === "credentials"
    || normalized === "credentials.json"
    || normalized === "secrets.json"
  ) return true;
  if (normalized === ".env" || normalized.startsWith(".env.")) {
    return !/\.(example|sample|template)$/u.test(normalized);
  }
  return [".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"].some((extension) => normalized.endsWith(extension));
}

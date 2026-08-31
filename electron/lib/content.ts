import fs from "node:fs";
import path from "node:path";
import {
  LEGACY_CONTENT_DATE_DIRECTORY_KINDS,
  LEGACY_CONTENT_FILE_ROOT_KINDS,
  LEGACY_GET_CONTENT_ALL_KINDS
} from "../../shared/content-kinds";
import { findRepoRoot, ensureInsideRepo, ensureInsideRepoReadable, relativeToOpenmind, resolveOpenmindPath, resolveOpenmindRoot } from "./settings";
import { messages } from "../../shared/messages";

export type ContentFileEntry = {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
};

export type ContentReadResult = {
  path: string;
  name: string;
  content: string;
  truncated: boolean;
};

export type ContentOverview = {
  date: string;
  repoRoot: string;
  metrics: { articles: number; posts: number; reddit: number; summaries: number; topics: number };
  pipeline: Array<{ id: string; label: string; complete: boolean }>;
  recent: ContentFileEntry[];
};

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function listFiles(directory: string, filter: (name: string) => boolean = () => true): ContentFileEntry[] {
  try {
    const openmindRoot = resolveOpenmindRoot();
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && filter(entry.name))
      .map((entry) => {
        const absolutePath = path.join(directory, entry.name);
        const stat = fs.statSync(absolutePath);
        return {
          name: entry.name,
          path: openmindRoot ? relativeToOpenmind(absolutePath) : path.relative(findRepoRoot(), absolutePath),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString()
        };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  } catch {
    return [];
  }
}

function countPosts(date: string): number {
  const posts = readJson<unknown>(ensureInsideRepo(path.join("openmind", "post", date, "posts.json")), []);
  if (Array.isArray(posts)) return posts.length;
  if (posts && typeof posts === "object" && Array.isArray((posts as { posts?: unknown }).posts)) return (posts as { posts: unknown[] }).posts.length;
  return 0;
}

function isXPostMarkdown(name: string): boolean {
  return /^x_/i.test(name) && name.endsWith(".md");
}

function listArticleFiles(date: string): ContentFileEntry[] {
  return listFiles(
    ensureInsideRepo(path.join("openmind", "article", date)),
    (name) => name.endsWith(".md") && !isXPostMarkdown(name)
  );
}

function listXPostFiles(date: string): ContentFileEntry[] {
  return listFiles(
    ensureInsideRepo(path.join("openmind", "article", date)),
    (name) => isXPostMarkdown(name)
  );
}

function listDatedFiles(relativeDirectory: string, date: string, suffix?: string): ContentFileEntry[] {
  return listFiles(
    ensureInsideRepo(relativeDirectory),
    (name) => (!date || name.startsWith(`${date}_`)) && (!suffix || name.endsWith(suffix))
  );
}

function latestCreativeTopics(date: string): ContentFileEntry[] {
  const formatted = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const root = ensureInsideRepo(path.join("openmind", "creative"));
  const matches: ContentFileEntry[] = [];

  function walk(directory: string, depth = 0): void {
    if (depth > 4 || !fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target, depth + 1);
      if (entry.isFile() && entry.name.includes(formatted) && entry.name.endsWith(".md")) {
        const stat = fs.statSync(target);
        matches.push({
          name: entry.name,
          path: resolveOpenmindRoot() ? relativeToOpenmind(target) : path.relative(findRepoRoot(), target),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString()
        });
      }
    }
  }

  walk(root);
  return matches.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function getOverview(date: string): ContentOverview {
  const articles = listArticleFiles(date);
  const xPosts = listXPostFiles(date);
  const reddit = listFiles(
    ensureInsideRepo(path.join("openmind", "reddit", date)),
    (name) => name.endsWith(".md")
  );
  const summary = listDatedFiles(path.join("openmind", "daily-summary"), date, ".md");
  const topics = listDatedFiles(path.join("openmind", "daily-topic"), date, ".md");
  const creative = latestCreativeTopics(date);
  const posts = Math.max(countPosts(date), xPosts.length);

  return {
    date,
    repoRoot: findRepoRoot(),
    metrics: {
      articles: articles.length,
      posts,
      reddit: reddit.length,
      summaries: summary.length,
      topics: topics.length + creative.length
    },
    pipeline: [
      { id: "collect", label: messages.pipeline.collect, complete: articles.length + posts + reddit.length > 0 },
      { id: "summary", label: messages.pipeline.summary, complete: summary.length > 0 },
      { id: "topic", label: messages.pipeline.topic, complete: topics.length + creative.length > 0 },
      { id: "writing", label: messages.pipeline.writing, complete: creative.some((file) => file.name.includes("package")) }
    ],
    recent: [...summary, ...topics, ...creative, ...articles.slice(0, 3), ...xPosts.slice(0, 2), ...reddit.slice(0, 2)]
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
      .slice(0, 7)
  };
}

function getContent(kind: string, date: string): Array<ContentFileEntry & { kind: string }> {
  const kinds = kind === "all" ? [...LEGACY_GET_CONTENT_ALL_KINDS] : [kind];
  let files: Array<ContentFileEntry & { kind: string }> = [];

  for (const item of kinds) {
    if (item === "articles") {
      files = files.concat(listArticleFiles(date).map((file) => ({ ...file, kind: item })));
      continue;
    }
    if (item === "posts") {
      files = files.concat(listXPostFiles(date).map((file) => ({ ...file, kind: item })));
    }
    const fileRoot = LEGACY_CONTENT_FILE_ROOT_KINDS[item];
    if (fileRoot) {
      files = files.concat(listDatedFiles(path.join(...fileRoot), date, ".md").map((file) => ({ ...file, kind: item })));
      continue;
    }
    const dateDirectory = LEGACY_CONTENT_DATE_DIRECTORY_KINDS[item];
    if (!dateDirectory) continue;
    files = files.concat(
      listFiles(
        ensureInsideRepo(path.join(...dateDirectory, date)),
        (name) => name.endsWith(".md") || name.endsWith(".json") || name.endsWith(".html")
      ).map((file) => ({ ...file, kind: item }))
    );
  }
  if (kind === "all" || kind === "topics") {
    files = files.concat(latestCreativeTopics(date).map((file) => ({ ...file, kind: "topics" })));
  }
  return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function readContent(relativePath: string): ContentReadResult {
  const filePath = ensureInsideRepoReadable(relativePath);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(messages.errors.file.notAFile);
  const maxBytes = 1024 * 1024;
  return {
    path: relativePath,
    name: path.basename(filePath),
    content: fs.readFileSync(filePath, "utf8").slice(0, maxBytes),
    truncated: stat.size > maxBytes
  };
}

function writeContent(relativePath: string, rawContent: string): ContentReadResult {
  const logicalPath = String(relativePath).replaceAll("\\", "/");
  const filePath = resolveOpenmindRoot() && (logicalPath === "openmind" || logicalPath.startsWith("openmind/"))
    ? resolveOpenmindPath(relativePath, "write")
    : ensureInsideRepo(relativePath);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(messages.errors.file.notAFile);
  fs.writeFileSync(filePath, rawContent, "utf8");
  return readContent(relativePath);
}

export {
  listFiles,
  countPosts,
  isXPostMarkdown,
  listArticleFiles,
  listXPostFiles,
  listDatedFiles,
  latestCreativeTopics,
  getOverview,
  getContent,
  readContent,
  writeContent
};

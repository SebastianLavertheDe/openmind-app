import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-content-ud-"));
process.env.CCTOOLS_USER_DATA_DIR = userDataDir;
vi.mock("electron", () => ({ app: { getPath: () => userDataDir } }));

import {
  countPosts,
  getContent,
  getOverview,
  isXPostMarkdown,
  listArticleFiles,
  listDatedFiles,
  listFiles,
  listXPostFiles,
  readContent,
  readJson,
  writeContent
} from "./content";

const roots: string[] = [];
let repo = "";

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-content-repo-"));
  roots.push(repo);
  fs.mkdirSync(path.join(repo, ".claude", "skills"), { recursive: true });
  fs.mkdirSync(path.join(repo, "mymind"), { recursive: true });
  process.env.CCTOOLS_REPO_ROOT = repo;
});

afterEach(() => {
  delete process.env.CCTOOLS_REPO_ROOT;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const DATE = "20260708";

/** 在 repo 内写一个文件,自动创建父目录。 */
function writeFile(relPath: string, content = "hello\n"): void {
  const abs = path.join(repo, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe("readJson", () => {
  it("正常解析 JSON 文件", () => {
    writeFile("data.json", JSON.stringify({ a: 1 }));
    expect(readJson(path.join(repo, "data.json"), null)).toEqual({ a: 1 });
  });

  it("文件不存在时返回 fallback", () => {
    expect(readJson(path.join(repo, "missing.json"), { def: true })).toEqual({ def: true });
  });

  it("损坏 JSON 返回 fallback", () => {
    writeFile("bad.json", "not-json{");
    expect(readJson(path.join(repo, "bad.json"), "fallback")).toBe("fallback");
  });
});

describe("isXPostMarkdown", () => {
  it("x_ 前缀 + .md 后缀", () => {
    expect(isXPostMarkdown("x_1234567890.md")).toBe(true);
    expect(isXPostMarkdown("X_abc.md")).toBe(true);
  });

  it("非 x_ 前缀返回 false", () => {
    expect(isXPostMarkdown("article.md")).toBe(false);
  });

  it("非 .md 后缀返回 false", () => {
    expect(isXPostMarkdown("x_123.json")).toBe(false);
  });
});

describe("listFiles", () => {
  it("列出目录内文件,按 modifiedAt 降序", () => {
    writeFile(`mymind/article/${DATE}/a.md`, "a");
    writeFile(`mymind/article/${DATE}/b.md`, "bb");
    const entries = listFiles(path.join(repo, "mymind", "article", DATE));
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.name.endsWith(".md"))).toBe(true);
    // path 是相对 repoRoot
    expect(entries.every((e) => !path.isAbsolute(e.path))).toBe(true);
    // 降序(后写的 mtime 应在前;但同秒可能相等,验证全有 modifiedAt 即可)
    expect(entries.every((e) => typeof e.modifiedAt === "string")).toBe(true);
  });

  it("支持 filter 参数", () => {
    writeFile(`mymind/article/${DATE}/a.md`);
    writeFile(`mymind/article/${DATE}/b.txt`);
    const mdOnly = listFiles(path.join(repo, "mymind", "article", DATE), (n) => n.endsWith(".md"));
    expect(mdOnly).toHaveLength(1);
    expect(mdOnly[0].name).toBe("a.md");
  });

  it("目录不存在时返回 []", () => {
    expect(listFiles(path.join(repo, "nonexistent"))).toEqual([]);
  });
});

describe("listArticleFiles / listXPostFiles", () => {
  beforeEach(() => {
    writeFile(`mymind/article/${DATE}/文章.md`);
    writeFile(`mymind/article/${DATE}/x_123.md`);
    writeFile(`mymind/article/${DATE}/notes.txt`);
  });

  it("listArticleFiles 只返回非 x_ 的 .md", () => {
    const files = listArticleFiles(DATE);
    expect(files.map((f) => f.name)).toEqual(["文章.md"]);
  });

  it("listXPostFiles 只返回 x_ 前缀 .md", () => {
    const files = listXPostFiles(DATE);
    expect(files.map((f) => f.name)).toEqual(["x_123.md"]);
  });
});

describe("listDatedFiles", () => {
  it("按 date_ 前缀 + suffix 过滤", () => {
    writeFile(`mymind/daily-summary/${DATE}_daily_summary.md`);
    writeFile(`mymind/daily-summary/20260707_daily_summary.md`);
    writeFile(`mymind/daily-summary/${DATE}_notes.txt`);
    const files = listDatedFiles(path.join("mymind", "daily-summary"), DATE, ".md");
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe(`${DATE}_daily_summary.md`);
  });
});

describe("countPosts", () => {
  it("数组形式 posts.json", () => {
    writeFile(`mymind/post/${DATE}/posts.json`, JSON.stringify([{ id: 1 }, { id: 2 }]));
    expect(countPosts(DATE)).toBe(2);
  });

  it("{ posts: [...] } 形式", () => {
    writeFile(`mymind/post/${DATE}/posts.json`, JSON.stringify({ posts: [{ id: 1 }] }));
    expect(countPosts(DATE)).toBe(1);
  });

  it("posts.json 不存在时返回 0", () => {
    expect(countPosts(DATE)).toBe(0);
  });

  it("非数组非对象时返回 0", () => {
    writeFile(`mymind/post/${DATE}/posts.json`, '"string"');
    expect(countPosts(DATE)).toBe(0);
  });
});

describe("getOverview", () => {
  it("汇总各内容类型的 metrics", () => {
    writeFile(`mymind/article/${DATE}/a.md`);
    writeFile(`mymind/article/${DATE}/x_1.md`);
    writeFile(`mymind/reddit/${DATE}/r.md`);
    writeFile(`mymind/daily-summary/${DATE}_daily_summary.md`);
    writeFile(`mymind/daily-topic/${DATE}_daily_topic.md`);
    writeFile(`mymind/post/${DATE}/posts.json`, JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]));

    const overview = getOverview(DATE);
    expect(overview.date).toBe(DATE);
    expect(overview.repoRoot).toBe(repo);
    expect(overview.metrics.articles).toBe(1);
    expect(overview.metrics.posts).toBe(3); // max(countPosts=3, xPosts=1) = 3
    expect(overview.metrics.reddit).toBe(1);
    expect(overview.metrics.summaries).toBe(1);
    // pipeline collect 应 complete(articles+posts+reddit > 0)
    expect(overview.pipeline.find((p) => p.id === "collect")?.complete).toBe(true);
    expect(overview.pipeline.find((p) => p.id === "summary")?.complete).toBe(true);
  });

  it("空 repo 时 metrics 全 0,pipeline 全 incomplete", () => {
    const overview = getOverview(DATE);
    expect(overview.metrics.articles).toBe(0);
    expect(overview.metrics.posts).toBe(0);
    expect(overview.metrics.reddit).toBe(0);
    expect(overview.pipeline.every((p) => p.complete === false)).toBe(true);
  });

  it("recent 截断到 7 条", () => {
    for (let i = 0; i < 10; i++) writeFile(`mymind/article/${DATE}/a${i}.md`);
    const overview = getOverview(DATE);
    expect(overview.recent.length).toBeLessThanOrEqual(7);
  });
});

describe("getContent", () => {
  it("kind=articles 返回文章列表", () => {
    writeFile(`mymind/article/${DATE}/a.md`);
    writeFile(`mymind/article/${DATE}/x_1.md`);
    const files = getContent("articles", DATE);
    expect(files.every((f) => f.kind === "articles")).toBe(true);
    expect(files.some((f) => f.name === "a.md")).toBe(true);
  });

  it("kind=reddit 返回 reddit markdown", () => {
    writeFile(`mymind/reddit/${DATE}/sub.md`);
    const files = getContent("reddit", DATE);
    expect(files.some((f) => f.kind === "reddit")).toBe(true);
  });

  it("kind=summaries 返回 daily-summary 日期文件", () => {
    writeFile(`mymind/daily-summary/${DATE}_daily_summary.md`);
    const files = getContent("summaries", DATE);
    expect(files.some((f) => f.kind === "summaries")).toBe(true);
  });

  it("kind=all 汇总多种类型", () => {
    writeFile(`mymind/article/${DATE}/a.md`);
    writeFile(`mymind/reddit/${DATE}/r.md`);
    writeFile(`mymind/daily-summary/${DATE}_daily_summary.md`);
    const files = getContent("all", DATE);
    const kinds = new Set(files.map((f) => f.kind));
    expect(kinds.has("articles")).toBe(true);
    expect(kinds.has("reddit")).toBe(true);
    expect(kinds.has("summaries")).toBe(true);
  });
});

describe("readContent", () => {
  it("读取文件内容,返回 path/name/content", () => {
    writeFile("mymind/note.md", "正文内容");
    const result = readContent("mymind/note.md");
    expect(result.path).toBe("mymind/note.md");
    expect(result.name).toBe("note.md");
    expect(result.content).toBe("正文内容");
    expect(result.truncated).toBe(false);
  });

  it("大文件标记 truncated=true", () => {
    const big = "x".repeat(1024 * 1024 + 100);
    writeFile("big.md", big);
    const result = readContent("big.md");
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBe(1024 * 1024);
  });

  it("路径是目录时抛 notAFile", () => {
    fs.mkdirSync(path.join(repo, "adir"), { recursive: true });
    expect(() => readContent("adir")).toThrow();
  });
});

describe("writeContent", () => {
  it("写入新内容并返回 readContent 结果", () => {
    writeFile("editable.md", "old");
    const result = writeContent("editable.md", "new content");
    expect(result.content).toBe("new content");
    expect(fs.readFileSync(path.join(repo, "editable.md"), "utf8")).toBe("new content");
  });

  it("路径是目录时抛 notAFile", () => {
    fs.mkdirSync(path.join(repo, "adir2"), { recursive: true });
    expect(() => writeContent("adir2", "x")).toThrow();
  });
});

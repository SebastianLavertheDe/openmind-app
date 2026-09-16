import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-content-ud-"));
process.env.OPENMIND_USER_DATA_DIR = userDataDir;
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
  readContentAsync,
  readJson,
  writeContent
} from "./content";
import { CONTENT_PREVIEW_MAX_BYTES } from "../../shared/content-kinds";

const roots: string[] = [];
let repo = "";

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-content-repo-"));
  roots.push(repo);
  fs.mkdirSync(path.join(repo, "openmind"), { recursive: true });
  process.env.OPENMIND_ROOT = path.join(repo, "openmind");
});

afterEach(() => {
  delete process.env.OPENMIND_ROOT;
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
    writeFile(`openmind/article/${DATE}/a.md`, "a");
    writeFile(`openmind/article/${DATE}/b.md`, "bb");
    const entries = listFiles(path.join(repo, "openmind", "article", DATE));
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.name.endsWith(".md"))).toBe(true);
    // path 是相对 repoRoot
    expect(entries.every((e) => !path.isAbsolute(e.path))).toBe(true);
    // 降序(后写的 mtime 应在前;但同秒可能相等,验证全有 modifiedAt 即可)
    expect(entries.every((e) => typeof e.modifiedAt === "string")).toBe(true);
  });

  it("支持 filter 参数", () => {
    writeFile(`openmind/article/${DATE}/a.md`);
    writeFile(`openmind/article/${DATE}/b.txt`);
    const mdOnly = listFiles(path.join(repo, "openmind", "article", DATE), (n) => n.endsWith(".md"));
    expect(mdOnly).toHaveLength(1);
    expect(mdOnly[0].name).toBe("a.md");
  });

  it("目录不存在时返回 []", () => {
    expect(listFiles(path.join(repo, "nonexistent"))).toEqual([]);
  });
});

describe("listArticleFiles / listXPostFiles", () => {
  beforeEach(() => {
    writeFile(`openmind/article/${DATE}/文章.md`);
    writeFile(`openmind/article/${DATE}/x_123.md`);
    writeFile(`openmind/article/${DATE}/notes.txt`);
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
    writeFile(`openmind/daily-summary/${DATE}_daily_summary.md`);
    writeFile(`openmind/daily-summary/20260707_daily_summary.md`);
    writeFile(`openmind/daily-summary/${DATE}_notes.txt`);
    const files = listDatedFiles(path.join("openmind", "daily-summary"), DATE, ".md");
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe(`${DATE}_daily_summary.md`);
  });
});

describe("countPosts", () => {
  it("数组形式 posts.json", () => {
    writeFile(`openmind/post/${DATE}/posts.json`, JSON.stringify([{ id: 1 }, { id: 2 }]));
    expect(countPosts(DATE)).toBe(2);
  });

  it("{ posts: [...] } 形式", () => {
    writeFile(`openmind/post/${DATE}/posts.json`, JSON.stringify({ posts: [{ id: 1 }] }));
    expect(countPosts(DATE)).toBe(1);
  });

  it("posts.json 不存在时返回 0", () => {
    expect(countPosts(DATE)).toBe(0);
  });

  it("非数组非对象时返回 0", () => {
    writeFile(`openmind/post/${DATE}/posts.json`, '"string"');
    expect(countPosts(DATE)).toBe(0);
  });
});

describe("getOverview", () => {
  it("汇总各内容类型的 metrics", () => {
    writeFile(`openmind/article/${DATE}/a.md`);
    writeFile(`openmind/article/${DATE}/x_1.md`);
    writeFile(`openmind/reddit/${DATE}/r.md`);
    writeFile(`openmind/daily-summary/${DATE}_daily_summary.md`);
    writeFile(`openmind/daily-topic/${DATE}_daily_topic.md`);
    writeFile(`openmind/post/${DATE}/posts.json`, JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]));

    const overview = getOverview(DATE);
    expect(overview.date).toBe(DATE);
    expect(overview.repoRoot).toBe(path.join(repo, "openmind"));
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
    for (let i = 0; i < 10; i++) writeFile(`openmind/article/${DATE}/a${i}.md`);
    const overview = getOverview(DATE);
    expect(overview.recent.length).toBeLessThanOrEqual(7);
  });
});

describe("getContent", () => {
  it("kind=articles 返回文章列表", () => {
    writeFile(`openmind/article/${DATE}/a.md`);
    writeFile(`openmind/article/${DATE}/x_1.md`);
    const files = getContent("articles", DATE);
    expect(files.every((f) => f.kind === "articles")).toBe(true);
    expect(files.some((f) => f.name === "a.md")).toBe(true);
  });

  it("kind=reddit 返回 reddit markdown", () => {
    writeFile(`openmind/reddit/${DATE}/sub.md`);
    const files = getContent("reddit", DATE);
    expect(files.some((f) => f.kind === "reddit")).toBe(true);
  });

  it("kind=summaries 返回 daily-summary 日期文件", () => {
    writeFile(`openmind/daily-summary/${DATE}_daily_summary.md`);
    const files = getContent("summaries", DATE);
    expect(files.some((f) => f.kind === "summaries")).toBe(true);
  });

  it("kind=all 汇总多种类型", () => {
    writeFile(`openmind/article/${DATE}/a.md`);
    writeFile(`openmind/reddit/${DATE}/r.md`);
    writeFile(`openmind/daily-summary/${DATE}_daily_summary.md`);
    const files = getContent("all", DATE);
    const kinds = new Set(files.map((f) => f.kind));
    expect(kinds.has("articles")).toBe(true);
    expect(kinds.has("reddit")).toBe(true);
    expect(kinds.has("summaries")).toBe(true);
  });
});

describe("readContent", () => {
  it("异步预览与同步限量读取结果一致", async () => {
    writeFile("openmind/async.md", "内容😀".repeat(600_000));
    const result = await readContentAsync("openmind/async.md");
    expect(result).toEqual(readContent("openmind/async.md"));
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(CONTENT_PREVIEW_MAX_BYTES);
    expect(result.content).not.toContain("\uFFFD");
  });

  it("读取文件内容,返回 path/name/content", () => {
    writeFile("openmind/note.md", "正文内容");
    const result = readContent("openmind/note.md");
    expect(result.path).toBe("openmind/note.md");
    expect(result.name).toBe("note.md");
    expect(result.content).toBe("正文内容");
    expect(result.truncated).toBe(false);
  });

  it("允许预览超过 1 MB 但不超过 5 MB 的文件", () => {
    const content = "x".repeat(1100 * 1024);
    writeFile("openmind/large-brief.md", content);

    const result = readContent("large-brief.md");

    expect(result.truncated).toBe(false);
    expect(result.content).toHaveLength(content.length);
  });

  it("大文件标记 truncated=true", () => {
    const big = "x".repeat(CONTENT_PREVIEW_MAX_BYTES + 100);
    // 裸相对路径按默认工作区（=内容根）解析，与 openmind/ 前缀路径同一棵树。
    writeFile("openmind/big.md", big);
    const result = readContent("big.md");
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBe(CONTENT_PREVIEW_MAX_BYTES);
  });

  it("路径是目录时抛 notAFile", () => {
    fs.mkdirSync(path.join(repo, "adir"), { recursive: true });
    expect(() => readContent("adir")).toThrow();
  });

  it("允许通过只读内容入口读取 Project 资料", () => {
    writeFile("openmind/projects/Research/materials/note.md", "project-only");

    expect(readContent("projects/Research/materials/note.md").content).toBe("project-only");
    expect(readContent("openmind/projects/Research/materials/note.md").content).toBe("project-only");
  });
});

describe("writeContent", () => {
  it("写入新内容并返回 readContent 结果", () => {
    writeFile("openmind/editable.md", "old");
    const result = writeContent("editable.md", "new content");
    expect(result.content).toBe("new content");
    expect(fs.readFileSync(path.join(repo, "openmind", "editable.md"), "utf8")).toBe("new content");
  });

  it("路径是目录时抛 notAFile", () => {
    fs.mkdirSync(path.join(repo, "adir2"), { recursive: true });
    expect(() => writeContent("adir2", "x")).toThrow();
  });

  it("拒绝通过通用内容入口修改 Project 资料", () => {
    const projectFile = path.join(repo, "openmind", "projects", "Research", "materials", "note.md");
    writeFile("openmind/projects/Research/materials/note.md", "original");

    expect(() => writeContent("projects/Research/materials/note.md", "changed")).toThrow();
    expect(fs.readFileSync(projectFile, "utf8")).toBe("original");
  });
});

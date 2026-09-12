import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-content-source-"));
process.env.OPENMIND_USER_DATA_DIR = userDataDir;

vi.mock("electron", () => ({
  app: {
    getPath: () => userDataDir
  }
}));

import { createExplicitContentSource } from "./content-source";
import { getContent, readContent } from "../lib/content";

// 奇偶校验：显式 root 内容源（worker 用，纯 Node）必须与 lib/content（主进程，
// settings 依赖）在索引引擎消费的语义上完全一致，否则 worker 化会引入行为漂移。

const roots: string[] = [];
let root = "";
let source: ReturnType<typeof createExplicitContentSource>;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-content-src-"));
  roots.push(root);
  process.env.OPENMIND_ROOT = root;
  source = createExplicitContentSource(root);
});

afterEach(() => {
  delete process.env.OPENMIND_ROOT;
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function write(relative: string, content = relative): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function mtime(relative: string): string {
  return fs.statSync(path.join(root, relative)).mtime.toISOString();
}

describe("createExplicitContentSource 与 lib/content 的奇偶校验", () => {
  beforeEach(() => {
    write("article/20260617/a.md");
    write("article/20260617/x_post.md");
    write("article/20260617/X_UPPER.md");
    write("article/20260617/notes.txt");
    write("article/20260618/b.md");
    write("reddit/20260617/r1.md");
    write("reddit/20260617/r2.json");
    write("reddit/20260617/r3.html");
    write("daily-summary/20260617_daily_summary.md");
    write("daily-summary/20260618_daily_summary.md");
    write("daily-topic/20260617_topic.md");
    write("creative/2026-06-17-top.md");
    write("creative/level1/2026-06-17-depth1.md");
    write("creative/l1/l2/l3/l4/2026-06-17-depth4.md");
    write("creative/l1/l2/l3/l4/l5/2026-06-17-too-deep.md");
    write("projects/managed/20260617-forbidden.md");
  });

  it("getContent('all', date) 逐项一致（含 x_ 拆分、日期前缀、creative 深度裁剪）", () => {
    for (const date of ["20260617", "20260618", "20260619"]) {
      expect(source.getContent("all", date)).toEqual(getContent("all", date));
    }
    const entries = source.getContent("all", "20260617");
    const byPath = new Map(entries.map((entry) => [entry.path, entry.kind]));
    expect(byPath.get("openmind/article/20260617/a.md")).toBe("articles");
    expect(byPath.get("openmind/article/20260617/x_post.md")).toBe("posts");
    expect(byPath.get("openmind/article/20260617/X_UPPER.md")).toBe("posts");
    expect(byPath.get("openmind/reddit/20260617/r1.md")).toBe("reddit");
    expect(byPath.get("openmind/reddit/20260617/r2.json")).toBe("reddit");
    expect(byPath.get("openmind/daily-summary/20260617_daily_summary.md")).toBe("summaries");
    expect(byPath.get("openmind/daily-topic/20260617_topic.md")).toBe("topics");
    expect(byPath.get("openmind/creative/2026-06-17-top.md")).toBe("topics");
    expect(byPath.get("openmind/creative/l1/l2/l3/l4/2026-06-17-depth4.md")).toBe("topics");
    expect(byPath.has("openmind/creative/l1/l2/l3/l4/l5/2026-06-17-too-deep.md")).toBe(false);
    expect(byPath.has("openmind/article/20260617/notes.txt")).toBe(false);
    expect(byPath.has("openmind/article/20260618/b.md")).toBe(false);
  });

  it("特定 kind 与排序规则一致", () => {
    expect(source.getContent("articles", "20260617")).toEqual(getContent("articles", "20260617"));
    expect(source.getContent("summaries", "20260617")).toEqual(getContent("summaries", "20260617"));
    expect(source.getContent("topics", "20260617")).toEqual(getContent("topics", "20260617"));
    expect(source.getContent("posts", "20260617")).toEqual(getContent("posts", "20260617"));
  });

  it("readContent 逐项一致", () => {
    const logical = "openmind/article/20260617/a.md";
    expect(source.readContent(logical)).toEqual(readContent(logical));
    expect(() => source.readContent("openmind/article/20260619/missing.md")).toThrow();
  });

  it("条目携带真实的 size 与 modifiedAt", () => {
    const entry = source.getContent("summaries", "20260617").find((item) => item.path === "openmind/daily-summary/20260617_daily_summary.md");
    expect(entry).toMatchObject({ name: "20260617_daily_summary.md", size: fs.statSync(path.join(root, "daily-summary/20260617_daily_summary.md")).size, modifiedAt: mtime("daily-summary/20260617_daily_summary.md") });
  });
});

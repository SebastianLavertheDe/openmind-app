import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContextReference } from "../../shared/contracts";
import {
  cleanupImages,
  cleanupStaleImages,
  extractImageContexts,
  materializeImages,
  resolveChatAttachment,
  stripImageContent
} from "./scheduler-images";

const roots: string[] = [];

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-images-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function imageContext(overrides: Partial<ContextReference> = {}): ContextReference {
  return {
    id: "img1",
    kind: "image",
    label: "截图",
    content: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
    ...overrides
  };
}

function legacyTemporaryImage(root: string, runId: string, id: string): void {
  const directory = path.join(root, ".openmind", "ai", "tmp-images");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${runId}-${id}.png`), Buffer.from("legacy fixture"));
}

describe("materializeImages", () => {
  it("stores conversation attachments under app-private state and returns absolute paths", () => {
    const root = createRoot();
    const stateRoot = createRoot();
    const result = materializeImages(root, "run-private", [imageContext()], stateRoot);

    expect(result[0].path).toBe(path.join(stateRoot, ".openmind", "ai", "attachments", "run-private-img1.png"));
    expect(fs.existsSync(result[0].path!)).toBe(true);
    expect(fs.existsSync(path.join(root, ".openmind"))).toBe(false);
  });

  it("解码 dataURL 写盘并回填 path/mediaType/byteSize,清空 content", () => {
    const root = createRoot();
    const result = materializeImages(root, "run-1", [imageContext()]);

    const ctx = result[0];
    expect(ctx.content).toBeUndefined();
    expect(ctx.path).toBe(path.join(".openmind", "ai", "attachments", "run-1-img1.png"));
    expect(ctx.mediaType).toBe("image/png");
    expect(typeof ctx.byteSize).toBe("number");
    expect(ctx.byteSize).toBeGreaterThan(0);

    // 真实写盘校验
    const absFile = path.join(root, ctx.path!);
    expect(fs.existsSync(absFile)).toBe(true);
  });

  it("image/jpeg 扩展名为 jpg", () => {
    const root = createRoot();
    const result = materializeImages(root, "run-1", [
      imageContext({ id: "jpeg1", content: "data:image/jpeg;base64,/9j/4AAQ=" })
    ]);
    expect(result[0].path).toMatch(/jpeg1\.jpg$/);
    expect(result[0].mediaType).toBe("image/jpeg");
  });

  it("非 image context 透传不动", () => {
    const root = createRoot();
    const file: ContextReference = { id: "f1", kind: "file", label: "笔记", path: "a.md" };
    const result = materializeImages(root, "run-1", [file]);
    expect(result[0]).toEqual(file);
  });

  it("已 materialize(无 content)的 image 保留原样", () => {
    const root = createRoot();
    const ctx = imageContext({ content: undefined, path: "existing.png", mediaType: "image/png", byteSize: 10 });
    const result = materializeImages(root, "run-1", [ctx]);
    expect(result[0]).toEqual(ctx);
  });

  it("非 dataURL 的 content 跳过并清空 content,warn", () => {
    const root = createRoot();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = materializeImages(root, "run-1", [imageContext({
      content: "not-a-data-url",
      path: "projects/Research/materials/private.png"
    })]);
    expect(result[0].content).toBeUndefined();
    expect(result[0].path).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("非 dataURL"));
  });

  it("写盘失败时 catch 并清空 content,warn", () => {
    const root = createRoot();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // mkdirSync 抛错 → 进入 catch
    vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    const result = materializeImages(root, "run-1", [imageContext()]);
    expect(result[0].content).toBeUndefined();
    expect(result[0].path).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("materialize img1 失败"));
  });
});

describe("cleanupImages", () => {
  it("删除指定 runId 前缀的文件,保留其他 run", () => {
    const root = createRoot();
    legacyTemporaryImage(root, "run-A", "a1");
    legacyTemporaryImage(root, "run-B", "b1");
    const dir = path.join(root, ".openmind", "ai", "tmp-images");
    expect(fs.readdirSync(dir)).toHaveLength(2);

    cleanupImages(root, "run-A");
    const remaining = fs.readdirSync(dir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatch(/^run-B-/);
  });

  it("目录不存在时 early return 不抛错", () => {
    const root = createRoot();
    expect(() => cleanupImages(root, "run-X")).not.toThrow();
  });

  it("unlink 单文件失败时静默跳过", () => {
    const root = createRoot();
    legacyTemporaryImage(root, "run-A", "a1");
    // 让 unlinkSync 抛错,但整体不应抛
    vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw new Error("perm denied");
    });
    expect(() => cleanupImages(root, "run-A")).not.toThrow();
  });
});

describe("cleanupStaleImages", () => {
  it("删除 mtime 超过 7 天的文件,保留新文件", () => {
    const root = createRoot();
    legacyTemporaryImage(root, "run-old", "old");
    legacyTemporaryImage(root, "run-new", "new");
    const dir = path.join(root, ".openmind", "ai", "tmp-images");

    // 把 old 文件的 mtime 改成 8 天前
    const oldFile = path.join(dir, "run-old-old.png");
    const eightDaysAgo = (Date.now() / 1000) - 8 * 24 * 3600;
    fs.utimesSync(oldFile, eightDaysAgo, eightDaysAgo);

    cleanupStaleImages(root);
    const remaining = fs.readdirSync(dir);
    expect(remaining.some((f) => f.startsWith("run-old-"))).toBe(false);
    expect(remaining.some((f) => f.startsWith("run-new-"))).toBe(true);
  });

  it("目录不存在时 early return 不抛错", () => {
    const root = createRoot();
    expect(() => cleanupStaleImages(root)).not.toThrow();
  });
});

describe("stripImageContent", () => {
  it("keeps sent attachments readable after run cleanup and age-based startup cleanup", () => {
    const workspace = createRoot();
    const state = createRoot();
    const [image] = materializeImages(workspace, "finished-run", [imageContext()], state);
    const file = image.path!;
    const old = Date.now() / 1000 - 30 * 24 * 3600;
    fs.utimesSync(file, old, old);
    cleanupImages(workspace, "finished-run", state);
    cleanupStaleImages(workspace, state);
    const [stored] = JSON.parse(JSON.stringify(stripImageContent([image]))) as ContextReference[];
    expect(stored.content).toBeUndefined();
    expect(resolveChatAttachment(stored.path!, state)).toBe(fs.realpathSync.native(file));
    expect(fs.readFileSync(file)).toEqual(Buffer.from("iVBORw0KGgoAAAANSUhEUg==", "base64"));
    expect(resolveChatAttachment(file, createRoot())).toBeNull();
    expect(resolveChatAttachment(path.join(state, "credentials", "key.png"), state)).toBeNull();
    expect(resolveChatAttachment(path.join(state, ".openmind", "ai", "attachments", "..", "run.json"), state)).toBeNull();
  });

  it("rejects attachment symlinks that escape their storage directory", () => {
    const root = createRoot();
    const outside = createRoot();
    const directory = path.join(root, ".openmind", "ai", "attachments");
    fs.mkdirSync(directory, { recursive: true });
    const link = path.join(directory, "escape");
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    expect(() => resolveChatAttachment(path.join(link, "image.png"), root)).toThrow(/超出会话存储范围/);
  });

  it("剥离 image 的 content,保留元数据", () => {
    const ctx = imageContext({ path: "x.png", mediaType: "image/png", byteSize: 100 });
    const result = stripImageContent([ctx]);
    expect(result[0]).toEqual({
      id: "img1",
      kind: "image",
      label: "截图",
      path: "x.png",
      mediaType: "image/png",
      byteSize: 100
    });
    expect("content" in result[0]).toBe(false);
  });

  it("非 image context 原样透传(含 content)", () => {
    const file: ContextReference = { id: "f1", kind: "file", label: "笔记", content: "hello", path: "a.md" };
    const result = stripImageContent([file]);
    expect(result[0]).toEqual(file);
  });
});

describe("extractImageContexts", () => {
  it("相对路径基于 projectRoot 解析为绝对路径", () => {
    const root = createRoot();
    const result = extractImageContexts(root, [
      imageContext({ content: undefined, path: ".openmind/ai/tmp-images/img.png", mediaType: "image/png" })
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "img1",
      path: path.resolve(root, ".openmind/ai/tmp-images/img.png"),
      mediaType: "image/png"
    });
  });

  it("绝对路径保留原值", () => {
    const root = createRoot();
    const abs = path.join(root, "abs.png");
    const result = extractImageContexts(root, [
      imageContext({ content: undefined, path: abs, mediaType: "image/png" })
    ]);
    expect(result[0].path).toBe(abs);
  });

  it("无 path 的 image 跳过", () => {
    const result = extractImageContexts("/root", [imageContext({ content: undefined, path: undefined })]);
    expect(result).toEqual([]);
  });

  it("mediaType 缺省时回退 image/png", () => {
    const root = createRoot();
    const result = extractImageContexts(root, [
      imageContext({ content: undefined, path: path.join(root, "abs.png"), mediaType: undefined })
    ]);
    expect(result[0].mediaType).toBe("image/png");
  });

  it("allows app-private materialized images but rejects paths outside both roots", () => {
    const root = createRoot();
    const stateRoot = createRoot();
    const materialized = materializeImages(root, "run-private", [imageContext()], stateRoot);
    expect(extractImageContexts(root, materialized, stateRoot)[0].path).toBe(materialized[0].path);

    const outside = path.join(path.dirname(root), "outside-image.png");
    expect(() => extractImageContexts(root, [
      imageContext({ content: undefined, path: outside })
    ], stateRoot)).toThrow(/超出会话执行根/);
  });

  it("非 image context 跳过", () => {
    const file: ContextReference = { id: "f1", kind: "file", label: "n", path: "a.md" };
    expect(extractImageContexts("/root", [file])).toEqual([]);
  });
});

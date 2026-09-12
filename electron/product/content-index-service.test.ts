import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ContentIndexService } from "./content-index-service";
import type { ContentApi } from "./common";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-content-index-svc-"));
  roots.push(root);
  return root;
}

function createContentApi(root: string): ContentApi {
  return {
    getContent: (_kind: string, date: string) => {
      const directory = path.join(root, "article", date);
      try {
        return fs.readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
          .map((entry) => {
            const stat = fs.statSync(path.join(directory, entry.name));
            return { name: entry.name, path: `openmind/article/${date}/${entry.name}`, size: stat.size, modifiedAt: stat.mtime.toISOString(), kind: "articles" };
          });
      } catch {
        return [];
      }
    },
    readContent: (relativePath: string) => {
      const physical = path.join(root, relativePath.replace(/^openmind\//, ""));
      return { path: relativePath, name: path.basename(physical), content: fs.readFileSync(physical, "utf8"), truncated: false };
    }
  };
}

function writeArticle(root: string, name: string, needle: string): void {
  fs.mkdirSync(path.join(root, "article", "20260617"), { recursive: true });
  fs.writeFileSync(path.join(root, "article", "20260617", name), `# 标题\n\n来源: Suite\n\n ${needle}`);
}

describe("ContentIndexService（进程内回退）", () => {
  it("searchContent 与 refreshDate 保持保存即刷新语义", async () => {
    const root = createRoot();
    writeArticle(root, "a.md", "needle-a");
    const service = new ContentIndexService(root, createContentApi(root));
    try {
      expect((await service.searchContent("needle-a", 10)).map((item) => item.path)).toEqual(["openmind/article/20260617/a.md"]);

      writeArticle(root, "b.md", "needle-b");
      service.refreshDate("20260617");
      expect((await service.searchContent("needle-b", 10)).map((item) => item.path)).toEqual(["openmind/article/20260617/b.md"]);
    } finally {
      service.dispose();
    }
  });

  it("dispose 幂等，且后续搜索按懒初始化恢复", async () => {
    const root = createRoot();
    writeArticle(root, "a.md", "needle-a");
    const service = new ContentIndexService(root, createContentApi(root));
    await service.searchContent("needle-a", 10);
    service.dispose();
    service.dispose();
    expect((await service.searchContent("needle-a", 10)).map((item) => item.path)).toEqual(["openmind/article/20260617/a.md"]);
    service.dispose();
  });
});

describe("ContentIndexService worker 传输", () => {
  const workerPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    ".build",
    "electron",
    "electron",
    "product",
    "content-index.worker.js"
  );

  it.skipIf(!fs.existsSync(workerPath))("round-trips search and ordered refreshDate through worker_threads", async () => {
    const root = createRoot();
    writeArticle(root, "a.md", "needle-a");
    const worker = new Worker(workerPath);
    try {
      const request = <T,>(id: number, payload: Record<string, unknown>): Promise<T> => new Promise<T>((resolve, reject) => {
        const onMessage = (message: { kind: string; id?: number; result?: T; message?: string }) => {
          if (message.kind === "result" && message.id === id) {
            worker.off("message", onMessage);
            resolve(message.result as T);
          }
          if (message.kind === "error" && message.id === id) {
            worker.off("message", onMessage);
            reject(new Error(message.message));
          }
        };
        worker.on("message", onMessage);
        worker.on("error", reject);
        worker.postMessage(payload);
      });

      worker.postMessage({ kind: "init", openmindRoot: root, stateRoot: null });
      const first = await request<Array<{ path: string }>>(1, { kind: "search", id: 1, query: "needle-a", limit: 10 });
      expect(first.map((item) => item.path)).toEqual(["openmind/article/20260617/a.md"]);

      // 保存即刷新：文件变化 → refreshDate → 后续 search 一定看到新内容。
      writeArticle(root, "b.md", "needle-b");
      worker.postMessage({ kind: "refreshDate", date: "20260617" });
      const second = await request<Array<{ path: string }>>(2, { kind: "search", id: 2, query: "needle-b", limit: 10 });
      expect(second.map((item) => item.path)).toEqual(["openmind/article/20260617/b.md"]);
    } finally {
      await worker.terminate();
    }
  });
});

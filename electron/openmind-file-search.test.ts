import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { OpenmindFileSearch, normalizeOpenmindSelection } from "./openmind-file-search";
import { OpenmindFileSearchEngine, normalize, scoreFile, type IndexedFile } from "./openmind-file-search-engine";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("OpenmindFileSearch", () => {
  it("ranks exact file-name matches ahead of path-only matches", async () => {
    const root = createRoot();
    write(root, "openmind/notes/composer.md");
    write(root, "openmind/composer/notes.md");
    write(root, "openmind/notes/other-composer-helper.md");

    const result = await new OpenmindFileSearch(root).search("composer", 10);

    expect(result.items.map((item) => item.path)).toEqual([
      "openmind/notes/composer.md",
      "openmind/notes/other-composer-helper.md",
      "openmind/composer/notes.md"
    ]);
    expect(result.indexedCount).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("supports multi-token and Unicode path searches", async () => {
    const root = createRoot();
    write(root, "openmind/daily-summary/每日 总结.md");
    write(root, "openmind/article/总结.md");

    const result = await new OpenmindFileSearch(root).search("daily 总结", 10);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].path).toBe("openmind/daily-summary/每日 总结.md");
  });

  it("ignores dependencies, build output, runtime data and symlinks", async () => {
    const root = createRoot();
    const outside = createRoot();
    write(root, "openmind/notes/target.md");
    write(root, "openmind/node_modules/pkg/target.md");
    write(root, "openmind/.build/target.md");
    write(root, "openmind/.openmind/target.log");
    write(outside, "outside-target.md");
    fs.mkdirSync(path.join(root, "openmind"), { recursive: true });
    fs.symlinkSync(
      outside,
      path.join(root, "openmind", "linked-outside"),
      process.platform === "win32" ? "junction" : "dir"
    );

    const result = await new OpenmindFileSearch(root).search("target", 20);

    expect(result.items.map((item) => item.path)).toEqual(["openmind/notes/target.md"]);
  });

  it("indexes and manually selects app-managed Project files for Workspace AI reads", async () => {
    const root = createRoot();
    write(root, "openmind/notes/visible.md");
    write(root, "openmind/projects/Research/materials/project-secret.md");

    const result = await new OpenmindFileSearch(root).search("project-secret", 20);
    expect(result.items.map((item) => item.path)).toEqual([
      "openmind/projects/Research/materials/project-secret.md"
    ]);
    expect(result.indexedCount).toBe(2);
    expect(normalizeOpenmindSelection(
      root,
      path.join(root, "openmind", "projects", "Research", "materials", "project-secret.md")
    )).toBe("openmind/projects/Research/materials/project-secret.md");
  });

  it("only indexes openmind and excludes credentials and private keys", async () => {
    const root = createRoot();
    write(root, "renderer/src/composer.tsx");
    write(root, "README.md");
    write(root, "openmind/settings.json");
    write(root, "openmind/.env");
    write(root, "openmind/.env.production");
    write(root, "openmind/.env.example");
    write(root, "openmind/certs/client.key");

    const composer = await new OpenmindFileSearch(root).search("composer", 10);
    const readme = await new OpenmindFileSearch(root).search("readme", 10);
    const settings = await new OpenmindFileSearch(root).search("settings", 10);
    const env = await new OpenmindFileSearch(root).search("env", 10);
    const key = await new OpenmindFileSearch(root).search("client", 10);

    expect(composer.items).toEqual([]);
    expect(readme.items).toEqual([]);
    expect(settings.items.map((item) => item.path)).toEqual(["openmind/settings.json"]);
    expect(env.items.map((item) => item.path)).toEqual(["openmind/.env.example"]);
    expect(key.items).toEqual([]);
  });

  it("does not build the project index for an empty query", async () => {
    const root = createRoot();
    write(root, "openmind/file.md");
    const result = await new OpenmindFileSearch(root).search("", 20);
    expect(result).toEqual({ items: [], indexedCount: 0, truncated: false });
  });

  it("invalidation makes the next query pick up newly added files", async () => {
    const root = createRoot();
    const search = new OpenmindFileSearch(root);
    write(root, "openmind/existing.md");
    await search.search("existing", 20);

    write(root, "openmind/brand-new.md");
    search.invalidate();

    const result = await search.search("brand-new", 20);
    expect(result.items.map((item) => item.path)).toEqual(["openmind/brand-new.md"]);
  });

  it("returns an empty index when openmind is missing or is a symlink", async () => {
    const missingRoot = createRoot();
    const linkedRoot = createRoot();
    const outside = createRoot();
    write(outside, "outside.md");
    fs.symlinkSync(
      outside,
      path.join(linkedRoot, "openmind"),
      process.platform === "win32" ? "junction" : "dir"
    );

    expect(await new OpenmindFileSearch(missingRoot).search("outside", 10)).toEqual({
      items: [],
      indexedCount: 0,
      truncated: false
    });
    expect(await new OpenmindFileSearch(linkedRoot).search("outside", 10)).toEqual({
      items: [],
      indexedCount: 0,
      truncated: false
    });
  });

  it("normalizes manual @ selections and rejects files outside openmind", () => {
    const root = createRoot();
    const inside = path.join(root, "openmind", "daily-summary", "today.md");
    const outside = path.join(root, "package.json");
    const outsideTarget = path.join(root, "outside.md");
    const linked = path.join(root, "openmind", "linked");
    write(root, "openmind/daily-summary/today.md");
    write(root, "package.json");
    write(root, "outside.md");
    fs.symlinkSync(
      path.dirname(outsideTarget),
      linked,
      process.platform === "win32" ? "junction" : "dir"
    );

    expect(normalizeOpenmindSelection(root, inside)).toBe("openmind/daily-summary/today.md");
    expect(() => normalizeOpenmindSelection(root, outside)).toThrow("只能通过 @ 引用 openmind");
    expect(() => normalizeOpenmindSelection(root, path.join(root, "openmind"))).toThrow("只能通过 @ 引用 openmind");
    expect(() => normalizeOpenmindSelection(root, path.join(linked, path.basename(outsideTarget)))).toThrow("只能通过 @ 引用 openmind");
  });
});

describe("OpenmindFileSearchEngine", () => {
  it("rebuilds the index once the TTL expires", async () => {
    const root = createRoot();
    const engine = new OpenmindFileSearchEngine(path.join(root, "openmind"), "openmind");
    write(root, "openmind/existing.md");
    await engine.search("existing", 20);

    write(root, "openmind/brand-new.md");
    const state = engine as unknown as { cache: { createdAt: number } | null };
    expect(state.cache).not.toBeNull();
    state.cache!.createdAt = 0;

    const result = await engine.search("brand-new", 20);
    expect(result.items.map((item) => item.path)).toEqual(["openmind/brand-new.md"]);
  });

  it("bounded top-K equals a full stable sort over all broad-query matches", async () => {
    const root = createRoot();
    for (let index = 0; index < 300; index++) {
      write(root, `openmind/docs/segment-${index % 7}/note-alpha-${index}.md`);
    }
    write(root, "openmind/alpha.md");
    const engine = new OpenmindFileSearchEngine(path.join(root, "openmind"), "openmind");
    const result = await engine.search("alpha", 12);

    // 参考实现：全量收集 + 稳定排序 + slice，与 bounded top-K 输出必须逐项一致。
    const files = (engine as unknown as { cache: { files: IndexedFile[] } }).cache!.files;
    const tokens = normalize("alpha").split(/\s+/).filter(Boolean);
    const ranked = files
      .flatMap((file) => {
        const score = scoreFile(file, tokens);
        return score === null ? [] : [{ file, score }];
      })
      .sort((left, right) =>
        right.score - left.score
        || left.file.path.length - right.file.path.length
        || left.file.path.localeCompare(right.file.path)
      );
    expect(ranked.length).toBeGreaterThan(12);
    expect(result.items.map((item) => item.path)).toEqual(ranked.slice(0, 12).map(({ file }) => file.path));
  });
});

describe("OpenmindFileSearch worker transport", () => {
  const workerPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    ".build",
    "electron",
    "electron",
    "openmind-file-search.worker.js"
  );

  it.skipIf(!fs.existsSync(workerPath))("round-trips search and invalidate through worker_threads", async () => {
    const root = createRoot();
    write(root, "openmind/notes/composer.md");
    const worker = new Worker(workerPath);
    try {
      const first = await request(worker, root, "composer");
      expect(first.map((item) => item.path)).toEqual(["openmind/notes/composer.md"]);

      worker.postMessage({ kind: "invalidate" });
      write(root, "openmind/brand-new.md");
      const second = await request(worker, root, "brand-new");
      expect(second.map((item) => item.path)).toEqual(["openmind/brand-new.md"]);
    } finally {
      await worker.terminate();
    }
  });

  function request(worker: Worker, root: string, query: string): Promise<Array<{ path: string }>> {
    return new Promise((resolve, reject) => {
      const onMessage = (message: { kind: string; id?: number; result?: { items: Array<{ path: string }> }; message?: string }) => {
        if (message.kind === "result" && message.id === 1) {
          worker.off("message", onMessage);
          resolve(message.result!.items);
        }
        if (message.kind === "error" && message.id === 1) {
          worker.off("message", onMessage);
          reject(new Error(message.message));
        }
      };
      worker.on("message", onMessage);
      worker.on("error", reject);
      worker.postMessage({ kind: "init", openmindRoot: path.join(root, "openmind"), logicalPrefix: "openmind" });
      worker.postMessage({ kind: "search", id: 1, query, limit: 10 });
    });
  }
});

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-files-"));
  roots.push(root);
  return root;
}

function write(root: string, relative: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, relative);
}

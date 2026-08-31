import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OpenmindFileSearch, normalizeOpenmindSelection } from "./openmind-file-search";

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

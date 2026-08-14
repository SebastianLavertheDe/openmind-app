import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MymindFileSearch, normalizeMymindSelection } from "./mymind-file-search";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("MymindFileSearch", () => {
  it("ranks exact file-name matches ahead of path-only matches", async () => {
    const root = createRoot();
    write(root, "mymind/notes/composer.md");
    write(root, "mymind/composer/notes.md");
    write(root, "mymind/notes/other-composer-helper.md");

    const result = await new MymindFileSearch(root).search("composer", 10);

    expect(result.items.map((item) => item.path)).toEqual([
      "mymind/notes/composer.md",
      "mymind/notes/other-composer-helper.md",
      "mymind/composer/notes.md"
    ]);
    expect(result.indexedCount).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("supports multi-token and Unicode path searches", async () => {
    const root = createRoot();
    write(root, "mymind/daily-summary/每日 总结.md");
    write(root, "mymind/article/总结.md");

    const result = await new MymindFileSearch(root).search("daily 总结", 10);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].path).toBe("mymind/daily-summary/每日 总结.md");
  });

  it("ignores dependencies, build output, runtime data and symlinks", async () => {
    const root = createRoot();
    const outside = createRoot();
    write(root, "mymind/notes/target.md");
    write(root, "mymind/node_modules/pkg/target.md");
    write(root, "mymind/.build/target.md");
    write(root, "mymind/.cctools/target.log");
    write(outside, "outside-target.md");
    fs.mkdirSync(path.join(root, "mymind"), { recursive: true });
    fs.symlinkSync(
      outside,
      path.join(root, "mymind", "linked-outside"),
      process.platform === "win32" ? "junction" : "dir"
    );

    const result = await new MymindFileSearch(root).search("target", 20);

    expect(result.items.map((item) => item.path)).toEqual(["mymind/notes/target.md"]);
  });

  it("only indexes mymind and excludes credentials and private keys", async () => {
    const root = createRoot();
    write(root, "desktop-app/renderer/src/composer.tsx");
    write(root, "README.md");
    write(root, "mymind/settings.json");
    write(root, "mymind/.env");
    write(root, "mymind/.env.production");
    write(root, "mymind/.env.example");
    write(root, "mymind/certs/client.key");

    const composer = await new MymindFileSearch(root).search("composer", 10);
    const readme = await new MymindFileSearch(root).search("readme", 10);
    const settings = await new MymindFileSearch(root).search("settings", 10);
    const env = await new MymindFileSearch(root).search("env", 10);
    const key = await new MymindFileSearch(root).search("client", 10);

    expect(composer.items).toEqual([]);
    expect(readme.items).toEqual([]);
    expect(settings.items.map((item) => item.path)).toEqual(["mymind/settings.json"]);
    expect(env.items.map((item) => item.path)).toEqual(["mymind/.env.example"]);
    expect(key.items).toEqual([]);
  });

  it("does not build the project index for an empty query", async () => {
    const root = createRoot();
    write(root, "mymind/file.md");
    const result = await new MymindFileSearch(root).search("", 20);
    expect(result).toEqual({ items: [], indexedCount: 0, truncated: false });
  });

  it("returns an empty index when mymind is missing or is a symlink", async () => {
    const missingRoot = createRoot();
    const linkedRoot = createRoot();
    const outside = createRoot();
    write(outside, "outside.md");
    fs.symlinkSync(
      outside,
      path.join(linkedRoot, "mymind"),
      process.platform === "win32" ? "junction" : "dir"
    );

    expect(await new MymindFileSearch(missingRoot).search("outside", 10)).toEqual({
      items: [],
      indexedCount: 0,
      truncated: false
    });
    expect(await new MymindFileSearch(linkedRoot).search("outside", 10)).toEqual({
      items: [],
      indexedCount: 0,
      truncated: false
    });
  });

  it("normalizes manual @ selections and rejects files outside mymind", () => {
    const root = createRoot();
    const inside = path.join(root, "mymind", "daily-summary", "today.md");
    const outside = path.join(root, "desktop-app", "package.json");
    const outsideTarget = path.join(root, "outside.md");
    const linked = path.join(root, "mymind", "linked");
    write(root, "mymind/daily-summary/today.md");
    write(root, "desktop-app/package.json");
    write(root, "outside.md");
    fs.symlinkSync(
      path.dirname(outsideTarget),
      linked,
      process.platform === "win32" ? "junction" : "dir"
    );

    expect(normalizeMymindSelection(root, inside)).toBe("mymind/daily-summary/today.md");
    expect(() => normalizeMymindSelection(root, outside)).toThrow("只能通过 @ 引用 mymind");
    expect(() => normalizeMymindSelection(root, path.join(root, "mymind"))).toThrow("只能通过 @ 引用 mymind");
    expect(() => normalizeMymindSelection(root, path.join(linked, path.basename(outsideTarget)))).toThrow("只能通过 @ 引用 mymind");
  });
});

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-files-"));
  roots.push(root);
  return root;
}

function write(root: string, relative: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, relative);
}

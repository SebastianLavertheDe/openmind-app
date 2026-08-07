import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildAnonymousMymindFixture, disposeFixture, type BuiltFixture } from "./mymind-fixture";

let fixture: BuiltFixture | null = null;
beforeEach(() => {
  fixture = buildAnonymousMymindFixture();
});
afterEach(() => {
  if (fixture) {
    disposeFixture(fixture);
    fixture = null;
  }
});

describe("buildAnonymousMymindFixture", () => {
  it("creates all current content top-level dirs", () => {
    for (const d of ["article", "creative", "daily-summary", "daily-topic", "post", "reddit", "wiki"]) {
      expect(fs.existsSync(path.join(fixture!.root, d))).toBe(true);
    }
  });

  it("creates the Chinese creative stage dirs verbatim", () => {
    expect(
      fs.existsSync(
        path.join(fixture!.root, "creative", "01-内容生产", "文稿库", "02-制作中")
      )
    ).toBe(true);
    expect(
      fs.existsSync(path.join(fixture!.root, "creative", "01-内容生产", "选题管理"))
    ).toBe(true);
  });

  it("creates an optional tool-private dir (.claude) without requiring it", () => {
    expect(fs.existsSync(path.join(fixture!.root, ".claude"))).toBe(true);
  });

  it("creates a user-unknown dir that must never be deleted", () => {
    expect(fs.existsSync(path.join(fixture!.root, "my-custom-notes"))).toBe(true);
  });

  it("creates an empty dir", () => {
    expect(fs.statSync(path.join(fixture!.root, "article", "empty-day")).isDirectory()).toBe(true);
    expect(fs.readdirSync(path.join(fixture!.root, "article", "empty-day")).length).toBe(0);
  });

  it("creates a volume-smoke dir with many files", () => {
    const many = fs.readdirSync(path.join(fixture!.root, "article", "20260801"));
    expect(many.length).toBeGreaterThanOrEqual(50);
  });

  it("creates a symlink that stays inside the root", () => {
    const link = path.join(fixture!.root, "article", "20260805-link");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    const real = fs.realpathSync(link);
    expect(real.startsWith(fixture!.root)).toBe(true);
  });

  it("creates a symlink that escapes the root (for resolver rejection tests)", () => {
    const link = path.join(fixture!.root, "article", "escape-link");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    const real = fs.realpathSync(link);
    expect(real.startsWith(fixture!.root)).toBe(false);
  });

  it("creates a CJK + space + emoji filename", () => {
    expect(
      fs.existsSync(path.join(fixture!.root, "article", "20260805", "中文 文件名 🎉.md"))
    ).toBe(true);
  });

  it("creates an invented top-level dir not in the layout contract", () => {
    expect(fs.existsSync(path.join(fixture!.root, "invented-toplevel"))).toBe(true);
  });

  it("disposeFixture removes the root and outside dirs", () => {
    const f = buildAnonymousMymindFixture();
    const root = f.root;
    const outside = f.outside;
    expect(fs.existsSync(root)).toBe(true);
    disposeFixture(f);
    expect(fs.existsSync(root)).toBe(false);
    expect(fs.existsSync(outside)).toBe(false);
  });
});

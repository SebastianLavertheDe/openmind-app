import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OpenmindPathError,
  OpenmindPathResolver,
  computeRootId,
  isCanonicalPathWithin,
  resolvePathInsideCanonicalRoot,
  type OpenmindRootSnapshot
} from "./openmind-path-resolver";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-resolver-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function snapshot(dir = tmpRoot): OpenmindRootSnapshot {
  return {
    rootPath: path.resolve(dir),
    rootId: computeRootId(path.resolve(dir)),
    rootGeneration: 1
  };
}

function resolver(dir = tmpRoot, caseSensitive?: boolean): OpenmindPathResolver {
  return new OpenmindPathResolver(snapshot(dir), caseSensitive === undefined ? {} : { caseSensitive });
}

describe("OpenmindPathResolver — normalisation", () => {
  it("accepts a logical path without the openmind/ prefix", () => {
    const r = resolver().resolve("article/20260805/x.md");
    expect(r.physicalPath).toBe(path.join(tmpRoot, "article", "20260805", "x.md"));
    expect(r.logicalPath).toBe("article/20260805/x.md");
  });

  it("accepts a logical path with a single openmind/ prefix and strips it", () => {
    const r = resolver().resolve("openmind/article/20260805/x.md");
    expect(r.logicalPath).toBe("article/20260805/x.md");
  });

  it("accepts just 'openmind' as the root", () => {
    const r = resolver().resolve("openmind");
    expect(r.physicalPath).toBe(path.resolve(tmpRoot));
    expect(r.logicalPath).toBe("");
  });

  it("normalises backslashes to forward slashes", () => {
    const r = resolver().resolve("article\\20260805\\x.md");
    expect(r.logicalPath).toBe("article/20260805/x.md");
  });

  it("collapses repeated separators and trailing slashes", () => {
    const r = resolver().resolve("article//20260805/x.md/");
    expect(r.logicalPath).toBe("article/20260805/x.md");
  });
});

describe("OpenmindPathResolver — rejection", () => {
  const cases: Array<[string, string]> = [
    ["/etc/passwd", "absolute-path-forbidden"],
    ["/article/x.md", "absolute-path-forbidden"],
    ["//host/share/x", "unc-path-forbidden"],
    ["C:/evil/main.py", "drive-path-forbidden"],
    ["C:\\evil\\main.py", "drive-path-forbidden"],
    ["article/../secret", "parent-segment-forbidden"],
    ["../secret", "parent-segment-forbidden"],
    ["article/./x.md", "dot-segment-forbidden"],
    ["article/%2e%2e/secret", "traversal-detected"]
  ];
  for (const [input, code] of cases) {
    it(`rejects ${input} with ${code}`, () => {
      try {
        resolver().resolve(input);
        throw new Error(`expected ${input} to be rejected`);
      } catch (e) {
        expect(e).toBeInstanceOf(OpenmindPathError);
        expect((e as OpenmindPathError).code).toBe(code);
      }
    });
  }

  it("rejects an empty path", () => {
    expect(() => resolver().resolve("")).toThrow(OpenmindPathError);
  });

  it("allows app-managed Project data in read mode", () => {
    fs.mkdirSync(path.join(tmpRoot, "projects", "Research", "materials"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "projects", "Research", "materials", "note.md"), "secret");
    expect(resolver().resolve("projects/Research/materials/note.md", "read").physicalPath)
      .toBe(path.join(tmpRoot, "projects", "Research", "materials", "note.md"));
  });

  it("allows an in-root symlink alias that resolves into readable Project data", () => {
    const materialDir = path.join(tmpRoot, "projects", "Research", "materials");
    fs.mkdirSync(materialDir, { recursive: true });
    fs.writeFileSync(path.join(materialDir, "note.md"), "secret");
    fs.symlinkSync(materialDir, path.join(tmpRoot, "project-alias"), process.platform === "win32" ? "junction" : "dir");
    expect(resolver().resolve("project-alias/note.md", "read").physicalPath)
      .toBe(path.join(tmpRoot, "project-alias", "note.md"));
  });
});

describe("OpenmindPathResolver — write mode", () => {
  it("allows writing to a known content top-level", () => {
    const r = resolver().resolve("daily-summary/20260805_daily_summary.md", "write");
    expect(r.logicalPath).toBe("daily-summary/20260805_daily_summary.md");
  });

  it("allows writing to a known Chinese creative path", () => {
    const r = resolver().resolve(
      "creative/01-内容生产/文稿库/02-制作中/pkg/draft.md",
      "write"
    );
    expect(r.logicalPath.startsWith("creative/")).toBe(true);
  });

  it("refuses to write to an unknown top-level directory", () => {
    try {
      resolver().resolve("new-invented-toplevel/x.md", "write");
      throw new Error("expected unknown top-level write to be refused");
    } catch (e) {
      expect(e).toBeInstanceOf(OpenmindPathError);
      expect((e as OpenmindPathError).code).toBe("unknown-top-level-write");
    }
  });

  it("keeps generic and Skill-style writes out of app-managed projects", () => {
    expect(() => resolver().resolve("projects/Research/materials/note.md", "write"))
      .toThrow(/Project 专用接口/);
  });

  it("read mode tolerates unknown top-level dirs (a user-created dir)", () => {
    fs.mkdirSync(path.join(tmpRoot, "user-custom"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "user-custom", "note.md"), "x");
    const r = resolver().resolve("user-custom/note.md", "read");
    expect(r.physicalPath.endsWith(path.join("user-custom", "note.md"))).toBe(true);
  });
});

describe("OpenmindPathResolver — symlink safety", () => {
  it("allows a symlink that stays inside the root", () => {
    fs.mkdirSync(path.join(tmpRoot, "article"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "article", "real"), { recursive: true });
    fs.symlinkSync(
      path.join(tmpRoot, "article", "real"),
      path.join(tmpRoot, "article", "link"),
      process.platform === "win32" ? "junction" : "dir"
    );
    expect(() =>
      resolver().resolve("article/link/file.md")
    ).not.toThrow();
  });

  it("rejects a symlink that escapes the root", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-outside-"));
    try {
      fs.mkdirSync(path.join(tmpRoot, "article"), { recursive: true });
      fs.symlinkSync(
        outside,
        path.join(tmpRoot, "article", "escape"),
        process.platform === "win32" ? "junction" : "dir"
      );
      try {
        resolver().resolve("article/escape/leaked.md");
        throw new Error("expected escaping symlink to be rejected");
      } catch (e) {
        expect(e).toBeInstanceOf(OpenmindPathError);
        expect((e as OpenmindPathError).code).toBe("symlink-escapes-root");
      }
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("does not require the leaf file to exist (write path)", () => {
    expect(() =>
      resolver().resolve("daily-summary/20260805_new.md", "write")
    ).not.toThrow();
  });
});

describe("resolvePathInsideCanonicalRoot", () => {
  it("rejects existing and prospective paths below an escaping symlink", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-canonical-outside-"));
    fs.writeFileSync(path.join(outside, "secret.md"), "secret");
    fs.symlinkSync(outside, path.join(tmpRoot, "escape"), process.platform === "win32" ? "junction" : "dir");
    try {
      expect(() => resolvePathInsideCanonicalRoot(tmpRoot, path.join(tmpRoot, "escape", "secret.md"))).toThrow(/Workspace/);
      expect(() => resolvePathInsideCanonicalRoot(tmpRoot, path.join(tmpRoot, "escape", "new.md"))).toThrow(/Workspace/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("fails closed for a broken symlink and a prospective child below it", () => {
    const broken = path.join(tmpRoot, "broken");
    fs.symlinkSync(path.join(tmpRoot, "missing-target"), broken, process.platform === "win32" ? "junction" : "dir");
    expect(() => resolvePathInsideCanonicalRoot(tmpRoot, broken)).toThrow(/Workspace/);
    expect(() => resolvePathInsideCanonicalRoot(tmpRoot, path.join(broken, "new.md"))).toThrow(/Workspace/);
  });
});

describe("canonical path membership", () => {
  it("treats only the Windows volume identity as case-insensitive", () => {
    expect(isCanonicalPathWithin("C:\\Root", "c:\\Root\\child.md", "win32")).toBe(true);
    expect(isCanonicalPathWithin("C:\\Root", "C:\\root\\child.md", "win32")).toBe(false);
    expect(isCanonicalPathWithin("C:\\Root", "C:\\RootElse\\child.md", "win32")).toBe(false);
  });

  it("folds an UNC root but preserves canonical directory component spelling", () => {
    expect(isCanonicalPathWithin("\\\\Server\\Share\\Root", "\\\\server\\share\\Root\\child", "win32")).toBe(true);
    expect(isCanonicalPathWithin("\\\\Server\\Share\\Root", "\\\\server\\share\\root\\child", "win32")).toBe(false);
  });
});

describe("OpenmindPathResolver — snapshot pinning", () => {
  it("returns the pinned snapshot", () => {
    const snap = snapshot();
    const r = new OpenmindPathResolver(snap);
    expect(r.getRoot()).toBe(snap);
  });

  it("computeRootId is deterministic for the same path", () => {
    const a = computeRootId("/srv/openmind");
    const b = computeRootId("/srv/openmind");
    expect(a).toBe(b);
    expect(a.startsWith("root-")).toBe(true);
  });

  it("computeRootId differs for different paths", () => {
    expect(computeRootId("/srv/openmind")).not.toBe(computeRootId("/srv/other"));
  });
});

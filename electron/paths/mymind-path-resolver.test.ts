import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MymindPathError,
  MymindPathResolver,
  computeRootId,
  type MymindRootSnapshot
} from "./mymind-path-resolver";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-resolver-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function snapshot(dir = tmpRoot): MymindRootSnapshot {
  return {
    rootPath: path.resolve(dir),
    rootId: computeRootId(path.resolve(dir)),
    rootGeneration: 1
  };
}

function resolver(dir = tmpRoot, caseSensitive?: boolean): MymindPathResolver {
  return new MymindPathResolver(snapshot(dir), caseSensitive === undefined ? {} : { caseSensitive });
}

describe("MymindPathResolver — normalisation", () => {
  it("accepts a logical path without the mymind/ prefix", () => {
    const r = resolver().resolve("article/20260805/x.md");
    expect(r.physicalPath).toBe(path.join(tmpRoot, "article", "20260805", "x.md"));
    expect(r.logicalPath).toBe("article/20260805/x.md");
  });

  it("accepts a logical path with a single mymind/ prefix and strips it", () => {
    const r = resolver().resolve("mymind/article/20260805/x.md");
    expect(r.logicalPath).toBe("article/20260805/x.md");
  });

  it("accepts just 'mymind' as the root", () => {
    const r = resolver().resolve("mymind");
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

describe("MymindPathResolver — rejection", () => {
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
        expect(e).toBeInstanceOf(MymindPathError);
        expect((e as MymindPathError).code).toBe(code);
      }
    });
  }

  it("rejects an empty path", () => {
    expect(() => resolver().resolve("")).toThrow(MymindPathError);
  });
});

describe("MymindPathResolver — write mode", () => {
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
      expect(e).toBeInstanceOf(MymindPathError);
      expect((e as MymindPathError).code).toBe("unknown-top-level-write");
    }
  });

  it("read mode tolerates unknown top-level dirs (a user-created dir)", () => {
    fs.mkdirSync(path.join(tmpRoot, "user-custom"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "user-custom", "note.md"), "x");
    const r = resolver().resolve("user-custom/note.md", "read");
    expect(r.physicalPath.endsWith(path.join("user-custom", "note.md"))).toBe(true);
  });
});

describe("MymindPathResolver — symlink safety", () => {
  it("allows a symlink that stays inside the root", () => {
    fs.mkdirSync(path.join(tmpRoot, "article"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "article", "real"), { recursive: true });
    fs.symlinkSync(
      path.join(tmpRoot, "article", "real"),
      path.join(tmpRoot, "article", "link")
    );
    expect(() =>
      resolver().resolve("article/link/file.md")
    ).not.toThrow();
  });

  it("rejects a symlink that escapes the root", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-outside-"));
    try {
      fs.mkdirSync(path.join(tmpRoot, "article"), { recursive: true });
      fs.symlinkSync(outside, path.join(tmpRoot, "article", "escape"));
      try {
        resolver().resolve("article/escape/leaked.md");
        throw new Error("expected escaping symlink to be rejected");
      } catch (e) {
        expect(e).toBeInstanceOf(MymindPathError);
        expect((e as MymindPathError).code).toBe("symlink-escapes-root");
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

describe("MymindPathResolver — snapshot pinning", () => {
  it("returns the pinned snapshot", () => {
    const snap = snapshot();
    const r = new MymindPathResolver(snap);
    expect(r.getRoot()).toBe(snap);
  });

  it("computeRootId is deterministic for the same path", () => {
    const a = computeRootId("/srv/mymind");
    const b = computeRootId("/srv/mymind");
    expect(a).toBe(b);
    expect(a.startsWith("root-")).toBe(true);
  });

  it("computeRootId differs for different paths", () => {
    expect(computeRootId("/srv/mymind")).not.toBe(computeRootId("/srv/other"));
  });
});

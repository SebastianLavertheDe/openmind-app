import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ContextReference } from "../../shared/contracts";
import {
  canonicalizeTrustedProjectRoot,
  normalizeContextReferences,
  normalizeCwd,
  resolvePathInsideRoot,
  resolveCwd
} from "./scheduler-paths";

describe("resolveCwd", () => {
  it("returns the project root for empty or '.' cwd", () => {
    const root = path.resolve("/proj");
    expect(resolveCwd(root, "")).toBe(root);
    expect(resolveCwd(root, ".")).toBe(root);
  });

  it("resolves relative paths inside the project", () => {
    const root = path.resolve("/proj");
    expect(resolveCwd(root, "sub")).toBe(path.resolve(root, "sub"));
  });

  it("throws when the resolved path escapes the project root", () => {
    const root = path.resolve("/proj");
    expect(() => resolveCwd(root, "../outside")).toThrow(/项目范围/);
  });
});

describe("realpath project boundary", () => {
  it("rejects a symlinked cwd or file that escapes the root", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-ai-paths-"));
    const root = path.join(fixture, "project");
    const outside = path.join(fixture, "outside");
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "secret.md"), "secret");
    fs.symlinkSync(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    try {
      expect(() => resolveCwd(root, "escape")).toThrow(/项目范围/);
      expect(() => resolvePathInsideRoot(root, "escape/secret.md")).toThrow(/项目范围/);
      expect(() => normalizeContextReferences(root, [{
        id: "secret",
        kind: "file",
        label: "secret",
        path: "escape/secret.md"
      }])).toThrow(/项目目录/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("accepts only a matching non-symlink direct child as a trusted Project root", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-ai-project-root-"));
    const projects = path.join(fixture, "projects");
    const project = path.join(projects, "AI安全");
    fs.mkdirSync(project, { recursive: true });
    const alias = path.join(projects, "alias");
    fs.symlinkSync(project, alias, process.platform === "win32" ? "junction" : "dir");
    try {
      expect(canonicalizeTrustedProjectRoot(projects, "AI安全", project)).toBe(fs.realpathSync.native(project));
      expect(() => canonicalizeTrustedProjectRoot(projects, "wrong", project)).toThrow(/不匹配/);
      expect(() => canonicalizeTrustedProjectRoot(projects, "alias", alias)).toThrow(/符号链接/);
      expect(() => canonicalizeTrustedProjectRoot(projects, "AI安全", fixture)).toThrow(/不匹配/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});

describe("normalizeCwd", () => {
  it("returns '.' for empty or '.' cwd", () => {
    const root = path.resolve("/proj");
    expect(normalizeCwd(root, "")).toBe(".");
    expect(normalizeCwd(root, ".")).toBe(".");
  });

  it("returns the relative path for an in-project cwd", () => {
    const root = path.resolve("/proj");
    expect(normalizeCwd(root, "sub/deep")).toBe(path.join("sub", "deep"));
  });

  it("accepts absolute paths inside the project and relativizes them", () => {
    const root = path.resolve("/proj");
    expect(normalizeCwd(root, path.resolve(root, "sub"))).toBe("sub");
  });

  it("throws when an absolute path points outside the project", () => {
    const root = path.resolve("/proj");
    expect(() => normalizeCwd(root, path.resolve("/other"))).toThrow(/项目范围/);
  });
});

describe("normalizeContextReferences", () => {
  function ctx(overrides: Partial<ContextReference>): ContextReference {
    return { id: "c1", kind: "file", label: "L", ...overrides } as ContextReference;
  }

  it("passes pasted image data through untouched before materialization", () => {
    const root = path.resolve("/proj");
    const image = ctx({ kind: "image", content: "data:image/png;base64,eA==" });
    expect(normalizeContextReferences(root, [image])).toEqual([image]);
  });

  it("drops an untrusted fallback path when pasted image data is present", () => {
    const root = path.resolve("/proj");
    const image = ctx({
      kind: "image",
      content: "not-a-data-url",
      path: "projects/Research/materials/private.png"
    });

    expect(normalizeContextReferences(root, [image])).toEqual([{ ...image, path: undefined }]);
  });

  it("validates caller-supplied image paths like other file contexts", () => {
    const root = path.resolve("/proj");
    expect(() => normalizeContextReferences(root, [ctx({ kind: "image", path: "/tmp/x.png" })]))
      .toThrow(/项目目录/);
  });

  it("passes contexts without a path through untouched", () => {
    const root = path.resolve("/proj");
    const noPath = ctx({ kind: "file", label: "L", path: undefined });
    expect(normalizeContextReferences(root, [noPath])).toEqual([noPath]);
  });

  it("relativizes in-project paths", () => {
    const root = path.resolve("/proj");
    const out = normalizeContextReferences(root, [ctx({ path: "docs/a.md" })]);
    expect(out[0].path).toBe(path.join("docs", "a.md"));
  });

  it("throws when a context path escapes the project root", () => {
    const root = path.resolve("/proj");
    expect(() => normalizeContextReferences(root, [ctx({ path: "../secret" })])).toThrow(/项目目录/);
  });
});

import { describe, expect, it } from "vitest";
import path from "node:path";
import type { ContextReference } from "../../shared/contracts";
import {
  normalizeContextReferences,
  normalizeCwd,
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

  it("passes image contexts through untouched (no in-project assertion)", () => {
    const root = path.resolve("/proj");
    const image = ctx({ kind: "image", path: "/tmp/x.png" });
    expect(normalizeContextReferences(root, [image])).toEqual([image]);
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

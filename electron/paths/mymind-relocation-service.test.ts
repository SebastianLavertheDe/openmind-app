import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAppPaths, ensureAppPaths } from "./app-paths-service";
import {
  previewMymindRelocation,
  relocateMymind,
  type MymindRelocationInput
} from "./mymind-relocation-service";

const cleanupRoots: string[] = [];

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeCase(): { source: string; target: string; userData: string; input: MymindRelocationInput } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-mymind-relocation-"));
  cleanupRoots.push(root);
  const source = path.join(root, "source-mymind");
  const target = path.join(root, "target-mymind");
  const userData = path.join(root, "user-data");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  const paths = buildAppPaths(userData);
  ensureAppPaths(paths);
  return { source, target, userData, input: { sourceDirectory: source, targetDirectory: target, paths } };
}

describe("mymind relocation", () => {
  it("previews without modifying a non-empty target and refuses merge", () => {
    const testCase = makeCase();
    fs.mkdirSync(path.join(testCase.source, "article"));
    fs.writeFileSync(path.join(testCase.source, "article", "one.md"), "one");
    fs.writeFileSync(path.join(testCase.target, "keep.txt"), "do not overwrite");

    const preview = previewMymindRelocation(testCase.input);

    expect(preview.canCommit).toBe(false);
    expect(preview.targetState).toBe("non-empty");
    expect(preview.blockingReasons.join(" ")).toContain("拒绝 merge/overwrite");
    expect(fs.readFileSync(path.join(testCase.target, "keep.txt"), "utf8")).toBe("do not overwrite");
  });

  it("copies hidden and unknown entries, verifies the tree, and preserves source", () => {
    const testCase = makeCase();
    fs.mkdirSync(path.join(testCase.source, ".obsidian"));
    fs.mkdirSync(path.join(testCase.source, "private-notes"));
    fs.writeFileSync(path.join(testCase.source, ".obsidian", "workspace.json"), "{}");
    fs.writeFileSync(path.join(testCase.source, "private-notes", "draft.md"), "draft");
    fs.writeFileSync(path.join(testCase.source, "README.md"), "hello");

    const preview = previewMymindRelocation(testCase.input);
    expect(preview.canCommit).toBe(true);
    const report = relocateMymind(testCase.input);

    expect(report.status).toBe("committed");
    expect(report.sourcePreserved).toBe(true);
    expect(report.verified).toBe(true);
    expect(fs.readFileSync(path.join(testCase.source, "private-notes", "draft.md"), "utf8")).toBe("draft");
    expect(fs.readFileSync(path.join(testCase.target, ".obsidian", "workspace.json"), "utf8")).toBe("{}");
    expect(fs.readFileSync(path.join(testCase.target, "README.md"), "utf8")).toBe("hello");
    expect(fs.readdirSync(path.dirname(testCase.target)).filter((name) => name.includes("cctools-mymind-relocation")).filter((name) => name.includes("staging") || name.includes("backup"))).toEqual([]);
  });

  it("rejects nested roots, symlinks, active runs, and app-private targets", () => {
    const testCase = makeCase();
    fs.writeFileSync(path.join(testCase.source, "one.md"), "one");
    const nested = path.join(testCase.source, "nested-target");
    fs.mkdirSync(nested);
    expect(previewMymindRelocation({ ...testCase.input, targetDirectory: nested }).canCommit).toBe(false);

    const sourceWithSymlink = path.join(testCase.source, "linked");
    try {
      const linkTarget = path.join(testCase.source, "link-target");
      fs.mkdirSync(linkTarget);
      fs.symlinkSync(linkTarget, sourceWithSymlink, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return;
    }
    expect(previewMymindRelocation(testCase.input).blockingReasons.join(" ")).toContain("symlink");
    expect(previewMymindRelocation({ ...testCase.input, activeRunCount: 1 }).blockingReasons.join(" ")).toContain("运行中的任务");
    expect(previewMymindRelocation({ ...testCase.input, targetDirectory: testCase.userData }).blockingReasons.join(" ")).toContain("userData");
  });
});

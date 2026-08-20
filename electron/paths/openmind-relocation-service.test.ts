import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAppPaths, ensureAppPaths } from "./app-paths-service";
import {
  previewOpenmindRelocation,
  relocateOpenmind,
  type OpenmindRelocationInput
} from "./openmind-relocation-service";

const cleanupRoots: string[] = [];

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeCase(): { source: string; target: string; userData: string; input: OpenmindRelocationInput } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-openmind-relocation-"));
  cleanupRoots.push(root);
  const source = path.join(root, "source-openmind");
  const target = path.join(root, "target-openmind");
  const userData = path.join(root, "user-data");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  const paths = buildAppPaths(userData);
  ensureAppPaths(paths);
  return { source, target, userData, input: { sourceDirectory: source, targetDirectory: target, paths } };
}

describe("openmind relocation", () => {
  it("previews without modifying a non-empty target and refuses merge", () => {
    const testCase = makeCase();
    fs.mkdirSync(path.join(testCase.source, "article"));
    fs.writeFileSync(path.join(testCase.source, "article", "one.md"), "one");
    fs.writeFileSync(path.join(testCase.target, "keep.txt"), "do not overwrite");

    const preview = previewOpenmindRelocation(testCase.input);

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

    const preview = previewOpenmindRelocation(testCase.input);
    expect(preview.canCommit).toBe(true);
    const report = relocateOpenmind(testCase.input);

    expect(report.status).toBe("committed");
    expect(report.sourcePreserved).toBe(true);
    expect(report.verified).toBe(true);
    expect(fs.readFileSync(path.join(testCase.source, "private-notes", "draft.md"), "utf8")).toBe("draft");
    expect(fs.readFileSync(path.join(testCase.target, ".obsidian", "workspace.json"), "utf8")).toBe("{}");
    expect(fs.readFileSync(path.join(testCase.target, "README.md"), "utf8")).toBe("hello");
    expect(fs.readdirSync(path.dirname(testCase.target)).filter((name) => name.includes("openmind-openmind-relocation")).filter((name) => name.includes("staging") || name.includes("backup"))).toEqual([]);
  });

  it("rejects nested roots, symlinks, active runs, and app-private targets", () => {
    const testCase = makeCase();
    fs.writeFileSync(path.join(testCase.source, "one.md"), "one");
    const nested = path.join(testCase.source, "nested-target");
    fs.mkdirSync(nested);
    expect(previewOpenmindRelocation({ ...testCase.input, targetDirectory: nested }).canCommit).toBe(false);

    const sourceWithSymlink = path.join(testCase.source, "linked");
    try {
      const linkTarget = path.join(testCase.source, "link-target");
      fs.mkdirSync(linkTarget);
      fs.symlinkSync(linkTarget, sourceWithSymlink, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return;
    }
    expect(previewOpenmindRelocation(testCase.input).blockingReasons.join(" ")).toContain("symlink");
    expect(previewOpenmindRelocation({ ...testCase.input, activeRunCount: 1 }).blockingReasons.join(" ")).toContain("运行中的任务");
    expect(previewOpenmindRelocation({ ...testCase.input, targetDirectory: testCase.userData }).blockingReasons.join(" ")).toContain("userData");
  });
});

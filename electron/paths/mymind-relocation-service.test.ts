import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAppPaths, ensureAppPaths } from "./app-paths-service";
import {
  previewMymindRelocation,
  recoverPendingMymindRelocations,
  relocateMymind,
  type MymindRelocationInput
} from "./mymind-relocation-service";
import { copyDirectoryRecursively } from "../lib/fs-utils";

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

  it("recovers an interrupted sibling swap only when the target matches the transaction", () => {
    const testCase = makeCase();
    fs.mkdirSync(path.join(testCase.source, "article"));
    fs.writeFileSync(path.join(testCase.source, "article", "one.md"), "one");
    const preview = previewMymindRelocation(testCase.input);
    expect(preview.canCommit).toBe(true);

    const transactionId = "recovery-fixture";
    const base = path.basename(testCase.target);
    const prefix = `.cctools-mymind-relocation-${base}-${transactionId}-`;
    const staging = path.join(path.dirname(testCase.target), `${prefix}staging`);
    const backup = path.join(path.dirname(testCase.target), `${prefix}backup`);
    copyDirectoryRecursively(testCase.source, staging);
    fs.renameSync(testCase.target, backup);
    const tree = inspectTreeForFixture(staging);
    const markerDirectory = path.join(testCase.input.paths.migrations, "mymind-relocation");
    const marker = path.join(markerDirectory, `${transactionId}.pending.json`);
    fs.mkdirSync(markerDirectory, { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({
      schemaVersion: 1,
      status: "pending",
      id: transactionId,
      sourceDirectory: fs.realpathSync(testCase.source),
      targetDirectory: path.resolve(testCase.target),
      stagingDirectory: staging,
      backupDirectory: backup,
      tree,
      phase: "target-moved",
      preparedAt: new Date().toISOString()
    }));

    const reports = recoverPendingMymindRelocations(testCase.input.paths);
    expect(reports).toHaveLength(1);
    expect(fs.readFileSync(path.join(testCase.target, "article", "one.md"), "utf8")).toBe("one");
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.existsSync(backup)).toBe(false);
  });
});

function inspectTreeForFixture(root: string) {
  const entries: Array<{ relativePath: string; kind: "file" | "directory"; size?: number; sha256?: string }> = [];
  const walk = (current: string) => {
    for (const name of fs.readdirSync(current).sort()) {
      const absolute = path.join(current, name);
      const relativePath = path.relative(root, absolute).split(path.sep).join("/");
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) {
        entries.push({ relativePath, kind: "directory" });
        walk(absolute);
      } else {
        const body = fs.readFileSync(absolute);
        entries.push({ relativePath, kind: "file", size: stat.size, sha256: crypto.createHash("sha256").update(body).digest("hex") });
      }
    }
  };
  walk(root);
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return {
    entries,
    fileCount: entries.filter((entry) => entry.kind === "file").length,
    directoryCount: entries.filter((entry) => entry.kind === "directory").length,
    bytes: entries.reduce((total, entry) => total + (entry.size || 0), 0),
    digest: crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex")
  };
}

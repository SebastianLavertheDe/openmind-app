import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateLegacyState, previewLegacyStateMigration } from "./legacy-state-migration";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-state-migration-"));
  roots.push(root);
  return root;
}

describe("migrateLegacyState", () => {
  it("previews without creating target state or touching the source", () => {
    const base = tempRoot();
    const repo = path.join(base, "repo");
    const target = path.join(base, "userData", "state", "root-preview");
    const sourceFile = path.join(repo, ".cctools", "source-runs.json");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, "preview", "utf8");

    const preview = previewLegacyStateMigration({
      legacyRepoRoot: repo,
      targetStateRoot: target,
      stagingRoot: path.join(base, "staging"),
      rootId: "root-preview"
    });

    expect(preview.canCommit).toBe(true);
    expect(preview.sourceFileCount).toBe(1);
    expect(preview.sourceBytes).toBe(7);
    expect(preview.targetState).toBe("absent");
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readFileSync(sourceFile, "utf8")).toBe("preview");
  });

  it("copies legacy state atomically while preserving the source", () => {
    const base = tempRoot();
    const repo = path.join(base, "repo");
    const target = path.join(base, "userData", "state", "root-1");
    const staging = path.join(base, "userData", "staging");
    const sourceFile = path.join(repo, ".cctools", "source-runs.json");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, "[{\"status\":\"success\"}]", "utf8");

    const first = migrateLegacyState({ legacyRepoRoot: repo, targetStateRoot: target, stagingRoot: staging, rootId: "root-1" });
    expect(first.status).toBe("committed");
    expect(fs.readFileSync(path.join(target, ".cctools", "source-runs.json"), "utf8")).toContain("success");
    expect(fs.readFileSync(sourceFile, "utf8")).toContain("success");

    fs.writeFileSync(sourceFile, "changed", "utf8");
    const second = migrateLegacyState({ legacyRepoRoot: repo, targetStateRoot: target, stagingRoot: staging, rootId: "root-1" });
    expect(second).toEqual(first);
    expect(fs.readFileSync(path.join(target, ".cctools", "source-runs.json"), "utf8")).toContain("success");
  });

  it("rejects a non-empty target instead of merging or overwriting it", () => {
    const base = tempRoot();
    const repo = path.join(base, "repo");
    const target = path.join(base, "userData", "state", "root-conflict");
    const sourceFile = path.join(repo, ".cctools", "source-runs.json");
    const targetFile = path.join(target, ".cctools", "existing.json");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(sourceFile, "source", "utf8");
    fs.writeFileSync(targetFile, "target", "utf8");

    const preview = previewLegacyStateMigration({ legacyRepoRoot: repo, targetStateRoot: target, stagingRoot: path.join(base, "staging"), rootId: "root-conflict" });
    expect(preview.canCommit).toBe(false);
    expect(preview.targetState).toBe("non-empty");
    expect(() => migrateLegacyState({ legacyRepoRoot: repo, targetStateRoot: target, stagingRoot: path.join(base, "staging"), rootId: "root-conflict" })).toThrow(/拒绝 merge\/overwrite/);
    expect(fs.readFileSync(sourceFile, "utf8")).toBe("source");
    expect(fs.readFileSync(targetFile, "utf8")).toBe("target");
    expect(fs.existsSync(path.join(target, ".cctools", "source-runs.json"))).toBe(false);
  });

  it("recovers a prepared pending transaction without merging", () => {
    const base = tempRoot();
    const repo = path.join(base, "repo");
    const target = path.join(base, "userData", "state", "root-pending");
    const staging = path.join(base, "staging");
    const sourceFile = path.join(repo, ".cctools", "source-runs.json");
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.writeFileSync(sourceFile, "pending", "utf8");

    const stateDirectory = path.join(target, ".cctools");
    const pending = path.join(target, "legacy-state-migration.pending.json");
    fs.mkdirSync(stateDirectory, { recursive: true });
    fs.writeFileSync(path.join(stateDirectory, "source-runs.json"), "pending", "utf8");
    const sha256 = crypto.createHash("sha256").update("pending").digest("hex");
    fs.writeFileSync(pending, JSON.stringify({
      schemaVersion: 1,
      status: "pending",
      sourceDirectory: path.join(repo, ".cctools"),
      targetDirectory: stateDirectory,
      stagingDirectory: path.join(staging, "legacy-state-root-pending"),
      tree: [{ relativePath: "source-runs.json", kind: "file", size: 7, sha256 }],
      preparedAt: new Date().toISOString()
    }), "utf8");

    // Simulate the crash window after the directory rename and before the
    // final marker. The matching pending tree is committed without a merge.
    const recovered = migrateLegacyState({ legacyRepoRoot: repo, targetStateRoot: target, stagingRoot: staging, rootId: "root-pending" });
    expect(recovered.status).toBe("committed");
    expect(fs.existsSync(path.join(target, "legacy-state-migration.json"))).toBe(true);
    expect(fs.existsSync(pending)).toBe(false);
    expect(fs.readFileSync(path.join(stateDirectory, "source-runs.json"), "utf8")).toBe("pending");
    expect(fs.readFileSync(sourceFile, "utf8")).toBe("pending");
  });

  it("records a retry-safe skipped marker when no legacy state exists", () => {
    const base = tempRoot();
    const report = migrateLegacyState({
      legacyRepoRoot: path.join(base, "repo"),
      targetStateRoot: path.join(base, "state"),
      stagingRoot: path.join(base, "staging"),
      rootId: "root-2"
    });
    expect(report.status).toBe("skipped");
    expect(fs.existsSync(path.join(base, "state", "legacy-state-migration.json"))).toBe(true);

    const second = migrateLegacyState({
      legacyRepoRoot: path.join(base, "repo"),
      targetStateRoot: path.join(base, "state"),
      stagingRoot: path.join(base, "staging"),
      rootId: "root-2"
    });
    expect(second).toEqual(report);
  });
});

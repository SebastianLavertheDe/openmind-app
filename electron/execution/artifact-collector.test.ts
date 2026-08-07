import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactCollector } from "./artifact-collector";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ArtifactCollector", () => {
  it("collects declared mymind artifacts and reports undeclared writes", () => {
    const root = makeRoot();
    const mymind = path.join(root, "mymind");
    const run = path.join(root, "run");
    fs.mkdirSync(path.join(mymind, "daily-summary"), { recursive: true });
    fs.mkdirSync(run, { recursive: true });
    const collector = new ArtifactCollector();
    const before = collector.snapshot(mymind);
    fs.writeFileSync(path.join(mymind, "daily-summary", "20260805_daily_summary.md"), "summary");
    fs.writeFileSync(path.join(mymind, "daily-summary", "private.md"), "undeclared");

    const result = collector.collect({
      runId: "run-1",
      skillId: "daily-article-summarizer",
      mymindRoot: mymind,
      runDir: run,
      before,
      declarations: [{ id: "summary", type: "markdown", logicalPath: "daily-summary/20260805_daily_summary.md" }]
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.undeclaredPaths).toEqual(["mymind/daily-summary/private.md"]);
  });

  it("does not collect an escaping symlink or revoked external binding", () => {
    const root = makeRoot();
    const mymind = path.join(root, "mymind");
    const run = path.join(root, "run");
    const outside = path.join(root, "outside.txt");
    fs.mkdirSync(mymind, { recursive: true });
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(outside, "secret");
    fs.symlinkSync(outside, path.join(mymind, "leak.txt"));
    const collector = new ArtifactCollector();

    const result = collector.collect({
      runId: "run-2",
      skillId: "skill",
      mymindRoot: mymind,
      runDir: run,
      before: collector.snapshot(mymind),
      declarations: [
        { id: "leak", type: "other", logicalPath: "leak.txt" },
        { id: "export", type: "video", externalPathRef: "export-1" }
      ],
      externalBindings: { "export-1": { bindingId: "export-1", canonicalPath: outside, revoked: true } }
    });

    expect(result.artifacts).toEqual([]);
  });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-artifact-"));
  roots.push(root);
  return root;
}

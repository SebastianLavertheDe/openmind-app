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
  it("collects only declared mymind artifacts without auditing sibling writes", () => {
    const root = makeRoot();
    const mymind = path.join(root, "mymind");
    fs.mkdirSync(path.join(mymind, "daily-summary"), { recursive: true });
    const collector = new ArtifactCollector();
    fs.writeFileSync(path.join(mymind, "daily-summary", "20260805_daily_summary.md"), "summary");
    fs.writeFileSync(path.join(mymind, "daily-summary", "private.md"), "undeclared");

    const result = collector.collect({
      runId: "run-1",
      skillId: "daily-article-summarizer",
      mymindRoot: mymind,
      declarations: [{ id: "summary", type: "markdown", logicalPath: "daily-summary/20260805_daily_summary.md" }]
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.artifacts[0].logicalPath).toBe("mymind/daily-summary/20260805_daily_summary.md");
  });

  it("does not scan unrelated historical content", () => {
    const root = makeRoot();
    const mymind = path.join(root, "mymind");
    fs.mkdirSync(path.join(mymind, "article", "history"), { recursive: true });
    fs.mkdirSync(path.join(mymind, "daily-summary"), { recursive: true });
    for (let index = 0; index < 20; index += 1) {
      fs.writeFileSync(path.join(mymind, "article", "history", `${index}.md`), "old");
    }
    fs.writeFileSync(path.join(mymind, "daily-summary", "20260805_daily_summary.md"), "summary");

    const result = new ArtifactCollector(5).collect({
      runId: "run-scoped",
      skillId: "daily-article-summarizer",
      mymindRoot: mymind,
      declarations: [{ id: "summary", type: "markdown", logicalPath: "daily-summary/20260805_daily_summary.md" }]
    });

    expect(result.artifacts.map((artifact) => artifact.logicalPath)).toEqual([
      "mymind/daily-summary/20260805_daily_summary.md"
    ]);
  });

  it("does not collect an escaping symlink or revoked external binding", () => {
    const root = makeRoot();
    const mymind = path.join(root, "mymind");
    const outside = path.join(root, "outside");
    fs.mkdirSync(mymind, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(outside, path.join(mymind, "leak"), process.platform === "win32" ? "junction" : "dir");
    const collector = new ArtifactCollector();

    const result = collector.collect({
      runId: "run-2",
      skillId: "skill",
      mymindRoot: mymind,
      declarations: [
        { id: "leak", type: "other", logicalPath: "leak/**" },
        { id: "export", type: "video", externalPathRef: "export-1" }
      ],
      externalBindings: { "export-1": { bindingId: "export-1", canonicalPath: path.join(outside, "secret.txt"), revoked: true } }
    });

    expect(result.artifacts).toEqual([]);
  });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-artifact-"));
  roots.push(root);
  return root;
}

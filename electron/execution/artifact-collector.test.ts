import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunArtifactSchema } from "../../shared/execution-contracts";
import { ArtifactCollector } from "./artifact-collector";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ArtifactCollector", () => {
  it("collects only declared openmind artifacts without auditing sibling writes", () => {
    const root = makeRoot();
    const openmind = path.join(root, "openmind");
    fs.mkdirSync(path.join(openmind, "daily-summary"), { recursive: true });
    const collector = new ArtifactCollector();
    fs.writeFileSync(path.join(openmind, "daily-summary", "20260805_daily_summary.md"), "summary");
    fs.writeFileSync(path.join(openmind, "daily-summary", "private.md"), "undeclared");

    const result = collector.collect({
      runId: "run-1",
      skillId: "daily-article-summarizer",
      openmindRoot: openmind,
      declarations: [{ id: "summary", type: "markdown", logicalPath: "daily-summary/20260805_daily_summary.md" }]
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].id).toBe("summary:openmind/daily-summary/20260805_daily_summary.md");
    expect(result.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.artifacts[0].logicalPath).toBe("openmind/daily-summary/20260805_daily_summary.md");
  });

  it("uses stable bounded IDs for artifacts with long logical paths", () => {
    const root = makeRoot();
    const openmind = path.join(root, "openmind");
    const articleDir = path.join(openmind, "article", "20260823");
    fs.mkdirSync(articleDir, { recursive: true });
    fs.writeFileSync(path.join(articleDir, `18_${"a".repeat(100)}.md`), "first");
    fs.writeFileSync(path.join(articleDir, `19_${"b".repeat(100)}.md`), "second");
    const collector = new ArtifactCollector();
    const input = {
      runId: "run-long-paths",
      skillId: "rss-article-saver",
      openmindRoot: openmind,
      declarations: [{ id: "articles", type: "markdown" as const, logicalPath: "article/20260823/*.md" }]
    };

    const first = collector.collect(input);
    const second = collector.collect(input);

    expect(first.artifacts).toHaveLength(2);
    expect(first.artifacts.map((artifact) => artifact.id)).toEqual(second.artifacts.map((artifact) => artifact.id));
    expect(first.artifacts.every((artifact) => artifact.id.length <= 120)).toBe(true);
    expect(new Set(first.artifacts.map((artifact) => artifact.id)).size).toBe(2);
    expect(() => first.artifacts.forEach((artifact) => RunArtifactSchema.parse(artifact))).not.toThrow();
    expect(first.artifacts.map((artifact) => artifact.logicalPath).sort()).toEqual([
      `openmind/article/20260823/18_${"a".repeat(100)}.md`,
      `openmind/article/20260823/19_${"b".repeat(100)}.md`
    ].sort());
  });

  it("does not scan unrelated historical content", () => {
    const root = makeRoot();
    const openmind = path.join(root, "openmind");
    fs.mkdirSync(path.join(openmind, "article", "history"), { recursive: true });
    fs.mkdirSync(path.join(openmind, "daily-summary"), { recursive: true });
    for (let index = 0; index < 20; index += 1) {
      fs.writeFileSync(path.join(openmind, "article", "history", `${index}.md`), "old");
    }
    fs.writeFileSync(path.join(openmind, "daily-summary", "20260805_daily_summary.md"), "summary");

    const result = new ArtifactCollector(5).collect({
      runId: "run-scoped",
      skillId: "daily-article-summarizer",
      openmindRoot: openmind,
      declarations: [{ id: "summary", type: "markdown", logicalPath: "daily-summary/20260805_daily_summary.md" }]
    });

    expect(result.artifacts.map((artifact) => artifact.logicalPath)).toEqual([
      "openmind/daily-summary/20260805_daily_summary.md"
    ]);
  });

  it("does not collect an escaping symlink or revoked external binding", () => {
    const root = makeRoot();
    const openmind = path.join(root, "openmind");
    const outside = path.join(root, "outside");
    fs.mkdirSync(openmind, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(outside, path.join(openmind, "leak"), process.platform === "win32" ? "junction" : "dir");
    const collector = new ArtifactCollector();

    const result = collector.collect({
      runId: "run-2",
      skillId: "skill",
      openmindRoot: openmind,
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-artifact-"));
  roots.push(root);
  return root;
}

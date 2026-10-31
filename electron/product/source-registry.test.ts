import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { SourceRegistry } from "./source-registry";
import type { ContentApi } from "./common";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reddit-source-query-")); roots.push(root);
  const write = (file: string, value: unknown) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value)); };
  write(".agent/skills/reddit-fetcher/SKILL.md", "---\nname: reddit-fetcher\nsurfacesAsSource:\n  sourceId: reddit\n  sourceName: Reddit\n  kind: reddit\n  artifactRoot: reddit\n---\n");
  const sources = ["A", "B"].map(name => ({ id: name, name, url: `https://reddit.com/r/${name}/hot.json`, enabled: true, frequency: "daily", tags: [] }));
  write(".agent/skill-data/reddit-fetcher/user-sources.yaml", { schemaVersion: 2, sources });
  const getContent = vi.fn(() => { throw new Error("Unrelated content must not be read"); });
  const registry = new SourceRegistry(root, { getContent } as unknown as ContentApi);
  const status = (index: number, state: "success" | "failed" | "running", pid = process.pid) => write(`.agent/skill-data/reddit-fetcher/source-status/${crypto.createHash("sha256").update(sources[index].url).digest("hex")}.json`, {
    schemaVersion: 1, url: sources[index].url, attempt: "fixture", startedAt: "2026-10-30T00:00:00.000Z", completedAt: state === "running" ? null : "2026-10-30T00:00:01.000Z",
    status: state, pid, itemCount: state === "success" ? 3 : 0, lastSuccessAt: state === "success" ? "2026-10-30T00:00:01.000Z" : null, error: state === "failed" ? "B failed" : null
  });
  return { root, write, sources, registry, status, getContent };
}

it("lists, updates and adds Reddit sources even when RSS is corrupt, without reading content", () => {
  const { registry, write, getContent } = fixture();
  write(".agent/skill-data/rss-article-saver/sources.json", "invalid JSON");
  expect(registry.listSources({ kind: "reddit", skillId: "reddit-fetcher" })).toHaveLength(2);
  expect(registry.updateSource("A", { enabled: false })).toMatchObject({ enabled: false, status: "disabled" });
  expect(registry.addRssSource({ kind: "reddit", name: "C", url: "https://reddit.com/r/C/hot.json" })).toMatchObject({ name: "C", status: "idle" });
  expect(getContent).not.toHaveBeenCalled();
});

it("persists community deletion without removing content or restoring package defaults", () => {
  const { registry, root, write, status, getContent } = fixture();
  write(".agent/skills/reddit-fetcher/config.yaml", { fetch: { sources: ["https://reddit.com/r/A/hot.json"] } });
  write("reddit/20261030/saved.md", "Saved community content");
  write(".agent/skill-data/rss-article-saver/sources.json", "invalid JSON");
  status(0, "success");
  registry.removeRedditSource("A");
  expect(registry.listSources({ kind: "reddit" }).map(source => source.id)).toEqual(["B"]);
  registry.removeRedditSource("B");
  const restarted = new SourceRegistry(root, {} as ContentApi);
  expect(restarted.listSources({ kind: "reddit" })).toEqual([]);
  expect(fs.readFileSync(path.join(root, "reddit/20261030/saved.md"), "utf8")).toBe("Saved community content");
  expect(fs.readdirSync(path.join(root, ".agent/skill-data/reddit-fetcher/source-status"))).toHaveLength(1);
  expect(getContent).not.toHaveBeenCalled();
});

it("leaves community configuration intact when deletion targets are missing or configuration is invalid", () => {
  const { registry, root, write } = fixture();
  const config = path.join(root, ".agent/skill-data/reddit-fetcher/user-sources.yaml");
  const original = fs.readFileSync(config, "utf8");
  expect(() => registry.removeRedditSource("missing")).toThrow();
  expect(fs.readFileSync(config, "utf8")).toBe(original);
  write(".agent/skill-data/reddit-fetcher/user-sources.yaml", "invalid YAML configuration");
  expect(() => registry.removeRedditSource("A")).toThrow("Reddit");
  expect(fs.readFileSync(config, "utf8")).toBe("invalid YAML configuration");
});

it("keeps community outcomes separate from batch history and invalidates results when its URL changes", () => {
  const { registry, status } = fixture();
  status(0, "success"); status(1, "failed");
  registry.recordSkillEvent({ skillId: "reddit-fetcher", invocationId: "batch", type: "status", state: "failed" });
  expect(registry.listSources({ kind: "reddit" }).map(source => [source.status, source.itemCount, source.recentError])).toEqual([["success", 3, null], ["failed", 0, "B failed"]]);
  expect(registry.updateSource("A", { url: "https://reddit.com/r/A/new.json" })).toMatchObject({ status: "idle", lastRunAt: null });
  expect(registry.listSources({ kind: "reddit" })[1].status).toBe("failed");
});

it("does not inherit historical batch status and reports an interrupted collector", () => {
  const { registry, status } = fixture();
  registry.recordSkillEvent({ skillId: "reddit-fetcher", sourceId: "A", invocationId: "old", type: "status", state: "failed" });
  expect(registry.listSources({ kind: "reddit" }).every(source => source.status === "idle")).toBe(true);
  status(0, "running", 2147483647);
  expect(registry.listSources({ kind: "reddit" })[0]).toMatchObject({ status: "failed", recentError: expect.any(String) });
});

it("reports invalid Reddit configuration in its panel without breaking other source updates", () => {
  const { registry, write } = fixture();
  write(".agent/skill-data/reddit-fetcher/user-sources.yaml", { schemaVersion: 2, sources: ["invalid"] });
  expect(() => registry.listSources({ kind: "reddit" })).toThrow("Reddit");
  const source = registry.listSources().find(source => source.kind === "rss")!;
  expect(source).toBeDefined();
  expect(registry.updateSource(source.id, { enabled: !source.enabled }).enabled).toBe(!source.enabled);
});

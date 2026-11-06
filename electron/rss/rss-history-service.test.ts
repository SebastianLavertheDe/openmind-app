// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSync } from "esbuild";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { RssRepository } from "./rss-repository";
import { RssHistoryService } from "./rss-history-service";
import { RunStore } from "../execution/run-store";
import { SkillRunRequestSchema } from "../../shared/execution-contracts";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rss-history-worker-"));
const workerFile = path.join(directory, "rss-history.worker.cjs");
let service: RssHistoryService;
beforeAll(() => {
  buildSync({ entryPoints: [path.resolve("electron/rss/rss-history.worker.ts")], outfile: workerFile, bundle: true, platform: "node", format: "cjs" });
  service = new RssHistoryService(workerFile);
});
afterAll(() => { service.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });

it("indexes history and pages logs in the worker while enforcing source and root isolation", async () => {
  const root = path.join(directory, "root"); fs.mkdirSync(root);
  const repository = new RssRepository(root, { schemaVersion: 1, adapters: [], sources: [{ id: "one", name: "One", inputUrl: "https://one.test/", kind: "feed", adapterId: "feed", enabled: true, group: "ai", tags: [], legacyAliases: [] }] });
  repository.read();
  const runsRoot = path.join(directory, "runs"), store = new RunStore(runsRoot);
  store.create(SkillRunRequestSchema.parse({ skillId: "rss-article-saver", inputs: {}, providerBindings: {}, trigger: { type: "manual" }, rootGeneration: 1 }), "worker-run");
  store.bindRssContext("worker-run", { root: fs.realpathSync(root), mode: "pipeline", sourceIds: ["one"] });
  for (let index = 0; index < 201; index++) store.appendOutput("worker-run", "stdout", `row ${index}`);
  const read = vi.spyOn(fs, "readSync");
  try {
    expect((await service.runs(repository, runsRoot, { sourceId: "one" })).runs.map(run => run.id)).toEqual(["worker-run"]);
    const first = await service.events(repository, runsRoot, { sourceId: "one", runId: "worker-run", limit: 200 });
    expect(first.events).toHaveLength(200); expect(first.nextAfter).not.toBeNull();
    const next = await service.events(repository, runsRoot, { sourceId: "one", runId: "worker-run", after: first.nextAfter!, limit: 200 });
    expect(next.events).toHaveLength(1); expect(next.nextAfter).toBeNull(); // RSS after=0 excludes the initial sequence-zero event.
    expect(read).not.toHaveBeenCalled(); // Neither run.json nor log bytes are read on the calling thread.
    await expect(service.runs(repository, runsRoot, { sourceId: "one", rootKey: "another-root" })).rejects.toThrow(/folder changed/);
    await expect(service.events(repository, runsRoot, { sourceId: "missing", runId: "worker-run" })).rejects.toThrow(/deleted/);
    const otherRoot = path.join(directory, "other-root"); fs.mkdirSync(otherRoot);
    const other = new RssRepository(otherRoot, repository.catalog); other.read();
    expect((await service.runs(other, runsRoot, { sourceId: "one" })).runs).toEqual([]);
    await expect(service.events(other, runsRoot, { sourceId: "one", runId: "worker-run" })).rejects.toThrow(/unavailable/);
  } finally { read.mockRestore(); }
});

it("rejects pending queries on disposal and starts a fresh worker for subsequent queries", async () => {
  const root = path.join(directory, "restart"); fs.mkdirSync(root);
  const repository = new RssRepository(root, { schemaVersion: 1, adapters: [], sources: [] });
  const pending = service.runs(repository, path.join(directory, "runs"), { sourceId: "one" });
  service.dispose();
  await expect(pending).rejects.toThrow(/closed/);
  await expect(service.runs(repository, path.join(directory, "runs"), { sourceId: "one" })).rejects.toThrow(/deleted/);
});

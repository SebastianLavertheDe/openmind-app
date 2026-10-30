// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSync } from "esbuild";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { RssRepository } from "./rss-repository";
import { RssEntriesService } from "./rss-entries-service";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rss-entry-worker-"));
const workerFile = path.join(directory, "rss-entries.worker.cjs");
let service: RssEntriesService;
beforeAll(() => {
  buildSync({ entryPoints: [path.resolve("electron/rss/rss-entries.worker.ts")], outfile: workerFile, bundle: true, platform: "node", format: "cjs" });
  service = new RssEntriesService(workerFile);
});
afterAll(() => { service.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });

it("reads and pages real XML in a worker, invalidates replacements, and isolates roots", async () => {
  const root = path.join(directory, "root"); fs.mkdirSync(root);
  const repository = new RssRepository(root, { schemaVersion: 1, adapters: [], sources: [{ id: "one", name: "One", inputUrl: "https://one.test/", kind: "feed", adapterId: "feed", enabled: true, group: "ai", tags: [], legacyAliases: [] }] });
  const file = repository.view().sources[0].localFeed.path; fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `<rss><channel>${Array.from({ length: 5000 }, (_, i) => `<item><title>Item ${i}</title><link>https://one.test/${i}</link></item>`).join("")}</channel></rss>`);
  const open = vi.spyOn(fs, "openSync");
  try {
    const first = await service.entries(repository, { sourceId: "one", rootKey: repository.rootKey() });
    expect(first.total).toBe(5000); expect(first.entries).toHaveLength(30);
    const second = await service.entries(repository, { sourceId: "one", cursor: first.nextCursor! });
    expect(second.entries[0].title).toBe("Item 30");
    expect(open.mock.calls.some(args => args[0] === file)).toBe(false); // XML never opened on the main thread.
    fs.writeFileSync(file, "<rss><channel/></rss>");
    expect(await service.entries(repository, { sourceId: "one", cursor: second.nextCursor! })).toMatchObject({ total: 0, reset: true });
    await expect(service.entries(repository, { sourceId: "one", rootKey: "another-root" })).rejects.toThrow(/folder changed/);
  } finally { open.mockRestore(); }
});

it("rejects pending work on disposal and can start another worker", async () => {
  const root = path.join(directory, "restart"); fs.mkdirSync(root);
  const repository = new RssRepository(root, { schemaVersion: 1, adapters: [], sources: [] });
  const pending = service.entries(repository, { sourceId: "one" });
  service.dispose();
  await expect(pending).rejects.toThrow(/closed/);
  await expect(service.entries(repository, { sourceId: "one" })).rejects.toThrow(/deleted/);
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAppPaths } from "./app-paths-service";
import { MymindLocationService } from "./mymind-location-service";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-location-"));
  roots.push(root);
  return root;
}

describe("MymindLocationService", () => {
  it("reports missing create-if-needed entries without rejecting a partial root", () => {
    const root = makeRoot();
    const service = new MymindLocationService({ paths: buildAppPaths(makeRoot()) });
    const health = service.inspect(root);
    expect(health.accessible).toBe(true);
    expect(health.readable).toBe(true);
    expect(health.writable).toBe(true);
    expect(health.missingCreateIfNeededEntries).toContain("article");
    expect(health.warnings).toEqual([]);
  });

  it("preserves unknown and optional entries as observations", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, ".obsidian"));
    fs.mkdirSync(path.join(root, "private-notes"));
    const service = new MymindLocationService({ paths: buildAppPaths(makeRoot()) });
    const health = service.inspect(root);
    expect(health.optionalObservedEntries).toEqual([".obsidian"]);
    expect(health.unknownPreservedEntries).toEqual(["private-notes"]);
  });

  it("increments generation on a root switch and pins snapshots", () => {
    const first = makeRoot();
    const second = makeRoot();
    const service = new MymindLocationService({ paths: buildAppPaths(makeRoot()) });
    const binding = service.bind(first);
    const same = service.bind(first, binding);
    const switched = service.bind(second, same);
    expect(binding.generation).toBe(1);
    expect(same.generation).toBe(1);
    expect(switched.generation).toBe(2);
    expect(service.snapshot(switched)).toEqual({
      rootPath: path.resolve(second),
      rootId: switched.rootId,
      rootGeneration: 2
    });
  });

  it("blocks switching while a run is active", () => {
    const root = makeRoot();
    const service = new MymindLocationService({ paths: buildAppPaths(makeRoot()), activeRunCount: () => 1 });
    expect(() => service.bind(root)).toThrow("运行中的任务");
  });

  it("flags an app-private path conflict", () => {
    const userData = makeRoot();
    const service = new MymindLocationService({ paths: buildAppPaths(userData) });
    expect(() => service.bind(userData)).toThrow("路径冲突");
  });
});

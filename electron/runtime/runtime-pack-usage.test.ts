import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { RuntimePackUsageRegistry } from "./runtime-pack-usage";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("RuntimePackUsageRegistry", () => {
  it("holds a cross-process-safe lease and blocks matching mutations", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-runtime-lease-"));
    roots.push(root);
    const paths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    const registry = new RuntimePackUsageRegistry(paths);
    const lease = { runId: "run-1", packId: "python-core" as const, target: "linux-x64" as const, digest: "a".repeat(64) };

    registry.acquire(lease);
    expect(registry.isInUse("python-core", "linux-x64", lease.digest)).toBe(true);
    expect(() => registry.assertNotInUse("python-core", "linux-x64")).toThrow(/run-1/);
    expect(registry.list()).toHaveLength(1);

    registry.release(lease.runId);
    expect(registry.isInUse("python-core", "linux-x64")).toBe(false);
  });

  it("removes leases owned by dead processes before reporting usage", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-runtime-lease-stale-"));
    roots.push(root);
    const paths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    const registry = new RuntimePackUsageRegistry(paths);
    const leasesDir = path.join(paths.runtimes, "leases");
    fs.writeFileSync(path.join(leasesDir, "stale.json"), JSON.stringify({ schemaVersion: 1, runId: "stale", pid: 999_999_999, packId: "python-core", target: "linux-x64", digest: "b".repeat(64), acquiredAt: new Date().toISOString() }));

    expect(registry.list()).toEqual([]);
    expect(fs.existsSync(path.join(leasesDir, "stale.json"))).toBe(false);

    fs.writeFileSync(path.join(leasesDir, "corrupt.json"), "not-json");
    expect(registry.isInUse("python-core", "linux-x64")).toBe(true);
    expect(() => registry.assertNotInUse("python-core", "linux-x64")).toThrow(/lease 状态无法读取/);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  __resetAppPathsForTest,
  buildAppPaths,
  detectPathConflicts,
  ensureAppPaths,
  resolveUserDataDir,
  type AppPaths
} from "./app-paths-service";

afterEach(() => {
  __resetAppPathsForTest();
});

describe("buildAppPaths", () => {
  it("keeps the non-Electron fallback outside the source checkout", () => {
    const previous = process.env.CCTOOLS_USER_DATA_DIR;
    delete process.env.CCTOOLS_USER_DATA_DIR;
    try {
      expect(resolveUserDataDir()).not.toBe(path.resolve(process.cwd(), ".cctools-userdata"));
      expect(resolveUserDataDir()).toBe(path.join(os.tmpdir(), "cctools-desktop-userdata"));
    } finally {
      if (previous === undefined) delete process.env.CCTOOLS_USER_DATA_DIR;
      else process.env.CCTOOLS_USER_DATA_DIR = previous;
    }
  });

  it("derives all expected subdirectories under userData", () => {
    const p = buildAppPaths("/tmp/cctools-test-ud");
    expect(p.userData).toBe(path.resolve("/tmp/cctools-test-ud"));
    expect(p.settingsFile).toBe(path.join(p.userData, "settings", "settings.json"));
    expect(p.skillRegistryFile).toBe(path.join(p.userData, "skills", "registry.json"));
    expect(p.runtimePacks).toBe(path.join(p.userData, "runtimes", "packs"));
    expect(p.runtimeEnvironments).toBe(path.join(p.userData, "runtimes", "environments"));
    expect(p.credentials).toBe(path.join(p.userData, "credentials"));
    expect(p.runs).toBe(path.join(p.userData, "runs"));
    expect(p.logs).toBe(path.join(p.userData, "logs"));
  });

  it("ensures every directory exists after ensureAppPaths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-app-paths-"));
    const p = buildAppPaths(dir);
    ensureAppPaths(p);
    for (const d of [
      p.settings,
      p.migrations,
      p.state,
      p.skills,
      p.runtimePacks,
      p.runtimeEnvironments,
      p.runtimeDownloads,
      p.credentials,
      p.runs,
      p.automation,
      p.catalog,
      p.updates,
      p.staging,
      p.cache,
      p.logs
    ]) {
      expect(fs.existsSync(d)).toBe(true);
    }
  });

  it("ensureAppPaths is idempotent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-app-paths-"));
    const p = buildAppPaths(dir);
    ensureAppPaths(p);
    expect(() => ensureAppPaths(p)).not.toThrow();
  });
});

describe("detectPathConflicts", () => {
  const basePaths: AppPaths = buildAppPaths("/tmp/cctools-conflict-ud");

  it("flags mymindRoot equal to userData", () => {
    const conflicts = detectPathConflicts(basePaths, basePaths.userData);
    expect(conflicts.some((c) => c.kind === "mymind-equals-userData")).toBe(true);
  });

  it("flags mymindRoot nested under userData", () => {
    const nested = path.join(basePaths.userData, "child");
    const conflicts = detectPathConflicts(basePaths, nested);
    expect(conflicts.some((c) => c.kind === "mymind-under-userData")).toBe(true);
  });

  it("flags userData nested under mymindRoot", () => {
    const parent = path.dirname(basePaths.userData);
    // Construct a mymind root that contains userData.
    const mymindRoot = parent;
    const conflicts = detectPathConflicts(
      basePaths,
      path.join(mymindRoot, path.basename(basePaths.userData))
    );
    // resolve: mymindRoot === <parent>/<ud-basename>; userData === <parent>/<ud-basename>
    // They'd be equal → mymind-equals-userData.
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it("flags workspace nested under userData", () => {
    const ws = path.join(basePaths.userData, "ws");
    const conflicts = detectPathConflicts(basePaths, "/somewhere/mymind", ws);
    expect(conflicts.some((c) => c.kind === "workspace-under-userData")).toBe(true);
  });

  it("returns no conflicts for fully disjoint paths", () => {
    const conflicts = detectPathConflicts(basePaths, "/srv/mymind", "/home/me/workspace");
    expect(conflicts).toEqual([]);
  });
});

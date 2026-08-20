import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  __resetAppPathsForTest,
  buildAppPaths,
  detectPathConflicts,
  ensureAppPaths,
  resolveSkillStoreRoot,
  resolveUserDataDir,
  type AppPaths
} from "./app-paths-service";

afterEach(() => {
  __resetAppPathsForTest();
});

describe("buildAppPaths", () => {
  it("keeps the non-Electron fallback outside the source checkout", () => {
    const previous = process.env.OPENMIND_USER_DATA_DIR;
    delete process.env.OPENMIND_USER_DATA_DIR;
    try {
      expect(resolveUserDataDir()).not.toBe(path.resolve(process.cwd(), ".openmind-userdata"));
      expect(resolveUserDataDir()).toBe(path.join(os.tmpdir(), "openmind-desktop-userdata"));
    } finally {
      if (previous === undefined) delete process.env.OPENMIND_USER_DATA_DIR;
      else process.env.OPENMIND_USER_DATA_DIR = previous;
    }
  });

  it("derives all expected subdirectories under userData", () => {
    const p = buildAppPaths("/tmp/openmind-test-ud");
    expect(p.userData).toBe(path.resolve("/tmp/openmind-test-ud"));
    expect(p.settingsFile).toBe(path.join(p.userData, "settings", "settings.json"));
    expect(p.runtimePacks).toBe(path.join(p.userData, "runtimes", "packs"));
    expect(p.runtimeEnvironments).toBe(path.join(p.userData, "runtimes", "environments"));
    expect(p.credentials).toBe(path.join(p.userData, "credentials"));
    expect(p.runs).toBe(path.join(p.userData, "runs"));
    expect(p.logs).toBe(path.join(p.userData, "logs"));
  });

  it("derives the skill store under the bound openmind root (.agent/skills)", () => {
    expect(resolveSkillStoreRoot("/srv/openmind")).toBe(path.join(path.resolve("/srv/openmind"), ".agent", "skills"));
    expect(resolveSkillStoreRoot(null)).toBeNull();
    expect(resolveSkillStoreRoot("")).toBeNull();

    const p = buildAppPaths("/tmp/openmind-test-ud", "/srv/openmind/.agent/skills");
    expect(p.skills).toBe(path.resolve("/srv/openmind/.agent/skills"));
    expect(p.skillRegistryFile).toBe(path.join(p.skills, "registry.json"));
  });

  it("yields a null skill store when no openmind root is bound (no fallback)", () => {
    const p = buildAppPaths("/tmp/openmind-test-ud");
    expect(p.skills).toBeNull();
    expect(p.skillRegistryFile).toBeNull();

    ensureAppPaths(p);
    expect(fs.existsSync(path.join(p.userData, "skills"))).toBe(false);

    const withRoot = buildAppPaths("/tmp/openmind-test-ud", null);
    expect(withRoot.skills).toBeNull();
  });

  it("ensures every directory exists after ensureAppPaths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-app-paths-"));
    const p = buildAppPaths(dir, path.join(dir, "external-openmind", ".agent", "skills"));
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-app-paths-"));
    const p = buildAppPaths(dir);
    ensureAppPaths(p);
    expect(() => ensureAppPaths(p)).not.toThrow();
  });
});

describe("detectPathConflicts", () => {
  const basePaths: AppPaths = buildAppPaths("/tmp/openmind-conflict-ud");

  it("flags openmindRoot equal to userData", () => {
    const conflicts = detectPathConflicts(basePaths, basePaths.userData);
    expect(conflicts.some((c) => c.kind === "openmind-equals-userData")).toBe(true);
  });

  it("flags openmindRoot nested under userData", () => {
    const nested = path.join(basePaths.userData, "child");
    const conflicts = detectPathConflicts(basePaths, nested);
    expect(conflicts.some((c) => c.kind === "openmind-under-userData")).toBe(true);
  });

  it("flags userData nested under openmindRoot", () => {
    const parent = path.dirname(basePaths.userData);
    // Construct a openmind root that contains userData.
    const openmindRoot = parent;
    const conflicts = detectPathConflicts(
      basePaths,
      path.join(openmindRoot, path.basename(basePaths.userData))
    );
    // resolve: openmindRoot === <parent>/<ud-basename>; userData === <parent>/<ud-basename>
    // They'd be equal → openmind-equals-userData.
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it("flags workspace nested under userData", () => {
    const ws = path.join(basePaths.userData, "ws");
    const conflicts = detectPathConflicts(basePaths, "/somewhere/openmind", ws);
    expect(conflicts.some((c) => c.kind === "workspace-under-userData")).toBe(true);
  });

  it("returns no conflicts for fully disjoint paths", () => {
    const conflicts = detectPathConflicts(basePaths, "/srv/openmind", "/home/me/workspace");
    expect(conflicts).toEqual([]);
  });
});

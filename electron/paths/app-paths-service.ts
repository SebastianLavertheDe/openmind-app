/**
 * AppPathsService — derives and validates all app-private path roots from
 * `app.getPath("userData")`.
 *
 * Frozen by ADR-001. The user never types these paths; they are not
 * configurable per-feature. All app-owned state (settings, state, skills,
 * runtimes, credentials, runs, automation, catalog, updates, staging, cache,
 * logs) lives under `userData` and is partitioned by concern.
 *
 * This module is pure path computation + a single disjointness check. It
 * does not perform IO except `mkdir -p` on `ensure()` (idempotent). It is
 * safe to construct in tests by passing an explicit `userDataDir`.
 */

import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AppPaths {
  readonly userData: string;
  readonly settings: string;
  readonly settingsFile: string;
  readonly migrations: string;
  readonly state: string;
  readonly skills: string;
  readonly skillRegistryFile: string;
  readonly runtimes: string;
  readonly runtimePacks: string;
  readonly runtimeEnvironments: string;
  readonly runtimeDownloads: string;
  readonly credentials: string;
  readonly runs: string;
  readonly automation: string;
  readonly catalog: string;
  readonly updates: string;
  readonly staging: string;
  readonly cache: string;
  readonly logs: string;
}

/**
 * Resolve the userData directory. In tests pass an explicit dir; otherwise
 * fall back to Electron's userData, then an env override, then a tmp dir.
 */
export function resolveUserDataDir(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  // app may be undefined when imported from a non-electron context (vitest).
  const electronApp = (globalThis as { process?: NodeJS.Process }).process
    ? (app as { getPath?: (n: "userData") => string } | undefined)
    : undefined;
  const fromElectron = electronApp?.getPath?.("userData");
  if (fromElectron) return fromElectron;
  const fromEnv = process.env.CCTOOLS_USER_DATA_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  // Non-Electron callers (tests and small maintenance tools) must not create
  // an app-state directory inside the source checkout. Packaged Electron
  // always uses app.getPath("userData") above; this fallback is deliberately
  // outside the workspace.
  return path.join(os.tmpdir(), "cctools-desktop-userdata");
}

/**
 * Build the full AppPaths for a given userData dir. Pure computation; no IO.
 */
export function buildAppPaths(userDataDir?: string): AppPaths {
  const userData = resolveUserDataDir(userDataDir);
  return {
    userData,
    settings: path.join(userData, "settings"),
    settingsFile: path.join(userData, "settings", "settings.json"),
    migrations: path.join(userData, "settings", "migrations"),
    state: path.join(userData, "state"),
    skills: path.join(userData, "skills"),
    skillRegistryFile: path.join(userData, "skills", "registry.json"),
    runtimes: path.join(userData, "runtimes"),
    runtimePacks: path.join(userData, "runtimes", "packs"),
    runtimeEnvironments: path.join(userData, "runtimes", "environments"),
    runtimeDownloads: path.join(userData, "runtimes", "downloads"),
    credentials: path.join(userData, "credentials"),
    runs: path.join(userData, "runs"),
    automation: path.join(userData, "automation"),
    catalog: path.join(userData, "catalog"),
    updates: path.join(userData, "updates"),
    staging: path.join(userData, "staging"),
    cache: path.join(userData, "cache"),
    logs: path.join(userData, "logs")
  };
}

/** Cached singleton; mirrors the old settings.ts pattern but for app paths. */
let cached: AppPaths | null = null;

/**
 * Returns the process-wide AppPaths. The first call wins; subsequent calls
 * with a different explicit dir throw to prevent silent path drift.
 */
export function getAppPaths(): AppPaths {
  if (!cached) {
    cached = buildAppPaths();
    return cached;
  }
  return cached;
}

/** Test-only: reset the singleton. Not exported to the renderer. */
export function __resetAppPathsForTest(): void {
  cached = null;
}

/** Test-only: force a specific AppPaths instance. */
export function __setAppPathsForTest(paths: AppPaths): void {
  cached = paths;
}

/**
 * Ensure every directory in AppPaths exists. Idempotent.
 */
export function ensureAppPaths(paths: AppPaths): void {
  const dirs = [
    paths.userData,
    paths.settings,
    paths.migrations,
    paths.state,
    paths.skills,
    paths.runtimes,
    paths.runtimePacks,
    paths.runtimeEnvironments,
    paths.runtimeDownloads,
    paths.credentials,
    paths.runs,
    paths.automation,
    paths.catalog,
    paths.updates,
    paths.staging,
    paths.cache,
    paths.logs
  ];
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Disjointness check: mymindRoot, workspaceRoot, and userData must not alias
 * or contain one another. Returns the list of violations (empty = ok).
 *
 * This guards against pathological user choices like selecting userData as
 * the mymind root, which would let skill writes corrupt app state.
 */
export function detectPathConflicts(
  paths: AppPaths,
  mymindRoot: string,
  workspaceRoot?: string
): PathConflict[] {
  const conflicts: PathConflict[] = [];
  const a = path.resolve(mymindRoot);
  const u = path.resolve(paths.userData);
  if (a === u) conflicts.push({ kind: "mymind-equals-userData", a, b: u });
  else if (a.startsWith(u + path.sep))
    conflicts.push({ kind: "mymind-under-userData", a, b: u });
  else if (u.startsWith(a + path.sep))
    conflicts.push({ kind: "userData-under-mymind", a: u, b: a });
  if (workspaceRoot) {
    const w = path.resolve(workspaceRoot);
    if (w === u) conflicts.push({ kind: "workspace-equals-userData", a: w, b: u });
    else if (w.startsWith(u + path.sep))
      conflicts.push({ kind: "workspace-under-userData", a: w, b: u });
    else if (u.startsWith(w + path.sep))
      conflicts.push({ kind: "userData-under-workspace", a: u, b: w });
    // mymindRoot and workspaceRoot may legitimately overlap (same user dir);
    // not flagged here.
  }
  return conflicts;
}

export type PathConflictKind =
  | "mymind-equals-userData"
  | "mymind-under-userData"
  | "userData-under-mymind"
  | "workspace-equals-userData"
  | "workspace-under-userData"
  | "userData-under-workspace";

export interface PathConflict {
  readonly kind: PathConflictKind;
  readonly a: string;
  readonly b: string;
}

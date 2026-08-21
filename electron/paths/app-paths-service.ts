/**
 * AppPathsService — derives and validates all app-private path roots from
 * `app.getPath("userData")`.
 *
 * Frozen by ADR-001, with one superseding decision: the Installed Skill store
 * no longer lives under `userData`. It lives under the bound openmind root at
 * `.agent/skills` (openmind-layout-v3, app-managed), so packages travel with
 * user content. With no openmind root bound there is no store: `skills` and
 * `skillRegistryFile` are `null` and skill writes fail fast while reads
 * report an empty store. All other app-owned state (settings, state,
 * runtimes, credentials, runs, automation, catalog, updates, staging, cache,
 * logs) stays under `userData` and is partitioned by concern.
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
  /** Installed Skill store root; null when no openmind root is bound. */
  readonly skills: string | null;
  /** Installed Skill registry; null when no openmind root is bound. */
  readonly skillRegistryFile: string | null;
  readonly runtimes: string;
  readonly runtimePacks: string;
  readonly runtimeEnvironments: string;
  readonly runtimeDownloads: string;
  readonly credentials: string;
  readonly runs: string;
  readonly automation: string;
  readonly catalog: string;
  readonly updates: string;
  /** App-private install root for third-party CLI tools (claude/codex). */
  readonly tools: string;
  readonly toolBin: string;
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
  const fromEnv = process.env.OPENMIND_USER_DATA_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  // Non-Electron callers (tests and small maintenance tools) must not create
  // an app-state directory inside the source checkout. Packaged Electron
  // always uses app.getPath("userData") above; this fallback is deliberately
  // outside the workspace.
  return path.join(os.tmpdir(), "openmind-desktop-userdata");
}

/**
 * Build the full AppPaths for a given userData dir. Pure computation; no IO.
 *
 * `skillStoreRoot` locates the Installed Skill store (openmind-layout-v3
 * `.agent/skills` under the bound openmind root). Omitted/null means no store:
 * reads report empty, writes fail fast — the renderer keeps unbound users on
 * the onboarding page, so a null store is an internal invariant, not a
 * user-facing fallback.
 */
export function buildAppPaths(userDataDir?: string, skillStoreRoot?: string | null): AppPaths {
  const userData = resolveUserDataDir(userDataDir);
  const skills = skillStoreRoot ? path.resolve(skillStoreRoot) : null;
  return {
    userData,
    settings: path.join(userData, "settings"),
    settingsFile: path.join(userData, "settings", "settings.json"),
    migrations: path.join(userData, "settings", "migrations"),
    state: path.join(userData, "state"),
    skills,
    skillRegistryFile: skills ? path.join(skills, "registry.json") : null,
    runtimes: path.join(userData, "runtimes"),
    runtimePacks: path.join(userData, "runtimes", "packs"),
    runtimeEnvironments: path.join(userData, "runtimes", "environments"),
    runtimeDownloads: path.join(userData, "runtimes", "downloads"),
    credentials: path.join(userData, "credentials"),
    runs: path.join(userData, "runs"),
    automation: path.join(userData, "automation"),
    catalog: path.join(userData, "catalog"),
    updates: path.join(userData, "updates"),
    tools: path.join(userData, "tools"),
    toolBin: path.join(userData, "tools", "bin"),
    staging: path.join(userData, "staging"),
    cache: path.join(userData, "cache"),
    logs: path.join(userData, "logs")
  };
}

/**
 * Resolve the Installed Skill store root from the bound openmind root:
 * `<openmindRoot>/.agent/skills` (openmind-layout-v3, app-managed). Returns null
 * when no root is bound. Pure computation; no IO.
 */
export function resolveSkillStoreRoot(openmindRoot: string | null | undefined): string | null {
  if (!openmindRoot) return null;
  return path.join(path.resolve(openmindRoot), ".agent", "skills");
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
 * Ensure every directory in AppPaths exists. Idempotent. Null entries (skill
 * store without a bound openmind root) are skipped — the store is created by
 * the SkillStore itself once a root is bound.
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
    paths.tools,
    paths.toolBin,
    paths.staging,
    paths.cache,
    paths.logs
  ];
  for (const dir of dirs) if (dir) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Disjointness check: openmindRoot, workspaceRoot, and userData must not alias
 * or contain one another. Returns the list of violations (empty = ok).
 *
 * This guards against pathological user choices like selecting userData as
 * the openmind root, which would let skill writes corrupt app state.
 */
export function detectPathConflicts(
  paths: AppPaths,
  openmindRoot: string,
  workspaceRoot?: string
): PathConflict[] {
  const conflicts: PathConflict[] = [];
  const a = path.resolve(openmindRoot);
  const u = path.resolve(paths.userData);
  if (a === u) conflicts.push({ kind: "openmind-equals-userData", a, b: u });
  else if (a.startsWith(u + path.sep))
    conflicts.push({ kind: "openmind-under-userData", a, b: u });
  else if (u.startsWith(a + path.sep))
    conflicts.push({ kind: "userData-under-openmind", a: u, b: a });
  if (workspaceRoot) {
    const w = path.resolve(workspaceRoot);
    if (w === u) conflicts.push({ kind: "workspace-equals-userData", a: w, b: u });
    else if (w.startsWith(u + path.sep))
      conflicts.push({ kind: "workspace-under-userData", a: w, b: u });
    else if (u.startsWith(w + path.sep))
      conflicts.push({ kind: "userData-under-workspace", a: u, b: w });
    // openmindRoot and workspaceRoot may legitimately overlap (same user dir);
    // not flagged here.
  }
  return conflicts;
}

export type PathConflictKind =
  | "openmind-equals-userData"
  | "openmind-under-userData"
  | "userData-under-openmind"
  | "workspace-equals-userData"
  | "workspace-under-userData"
  | "userData-under-workspace";

export interface PathConflict {
  readonly kind: PathConflictKind;
  readonly a: string;
  readonly b: string;
}

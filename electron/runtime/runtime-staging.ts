import fs from "node:fs";
import path from "node:path";
import type { AppPaths } from "../paths/app-paths-service";

const RUNTIME_STAGING_SCHEMA_VERSION = 1 as const;
const RUNTIME_STAGING_MARKER = ".openmind-runtime-staging.json";

export type RuntimeStagingKind =
  | "pack-install"
  | "pack-repair"
  | "pack-extract"
  | "python-environment";

type RuntimeStagingMarker = {
  schemaVersion: typeof RUNTIME_STAGING_SCHEMA_VERSION;
  pid: number;
  kind: RuntimeStagingKind;
  createdAt: string;
};

export type RuntimeStagingHandle = {
  root: string;
  clearMarker(): void;
};

const PREFIX_KIND: ReadonlyArray<readonly [string, RuntimeStagingKind]> = [
  ["runtime-pack-repair-", "pack-repair"],
  ["runtime-pack-extract-", "pack-extract"],
  ["runtime-pack-", "pack-install"],
  ["runtime-env-", "python-environment"]
];

/** Creates a marked, app-private temporary directory for a runtime operation. */
export function createRuntimeStaging(paths: AppPaths, prefix: string, kind: RuntimeStagingKind): RuntimeStagingHandle {
  fs.mkdirSync(paths.staging, { recursive: true });
  const root = fs.mkdtempSync(path.join(paths.staging, prefix));
  const marker = path.join(root, RUNTIME_STAGING_MARKER);
  const value: RuntimeStagingMarker = {
    schemaVersion: RUNTIME_STAGING_SCHEMA_VERSION,
    pid: process.pid,
    kind,
    createdAt: new Date().toISOString()
  };
  try {
    fs.writeFileSync(marker, JSON.stringify(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return {
    root,
    clearMarker: () => fs.rmSync(marker, { force: true })
  };
}

/**
 * Removes only marked staging roots whose owning process is no longer alive.
 * Unmarked, unknown, symlinked, malformed, or still-owned roots are retained.
 */
export function garbageCollectRuntimeStaging(paths: AppPaths): string[] {
  if (!fs.existsSync(paths.staging)) return [];
  const stagingRoot = canonicalDirectory(paths.staging);
  if (!stagingRoot) return [];
  const removed: string[] = [];
  for (const entry of fs.readdirSync(stagingRoot, { withFileTypes: true })) {
    const kind = kindForEntry(entry.name);
    if (!kind || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const candidate = path.join(stagingRoot, entry.name);
    const marker = path.join(candidate, RUNTIME_STAGING_MARKER);
    const value = readMarker(marker);
    if (!value || value.kind !== kind || isProcessAlive(value.pid)) continue;
    const realCandidate = canonicalDirectory(candidate);
    if (!realCandidate || !isDescendant(realCandidate, stagingRoot)) continue;
    try {
      fs.rmSync(realCandidate, { recursive: true, force: false });
      removed.push(realCandidate);
    } catch {
      // A concurrent process or filesystem failure is fail-closed for GC.
    }
  }
  return removed;
}

function kindForEntry(name: string): RuntimeStagingKind | undefined {
  for (const [prefix, kind] of PREFIX_KIND) {
    if (name.startsWith(prefix)) return kind;
  }
  return undefined;
}

function readMarker(file: string): RuntimeStagingMarker | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<RuntimeStagingMarker>;
    if (value.schemaVersion !== RUNTIME_STAGING_SCHEMA_VERSION
      || !Number.isInteger(value.pid) || (value.pid || 0) <= 0
      || typeof value.kind !== "string" || !isRuntimeStagingKind(value.kind)
      || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) return undefined;
    return value as RuntimeStagingMarker;
  } catch {
    return undefined;
  }
}

function isRuntimeStagingKind(value: string): value is RuntimeStagingKind {
  return PREFIX_KIND.some(([, kind]) => kind === value);
}

function canonicalDirectory(candidate: string): string | undefined {
  try {
    return fs.statSync(candidate).isDirectory() ? fs.realpathSync(candidate) : undefined;
  } catch {
    return undefined;
  }
}

function isDescendant(candidate: string, root: string): boolean {
  return candidate !== root && candidate.startsWith(`${root}${path.sep}`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export { RUNTIME_STAGING_MARKER };

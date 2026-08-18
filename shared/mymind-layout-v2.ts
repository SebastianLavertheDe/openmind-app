/**
 * mymind layout contract v2 — machine-readable source of truth.
 *
 * Supersedes mymind-layout-v1 (frozen by ADR-002). The v1→v2 migration is
 * purely additive: every v1 entry is carried over verbatim and exactly one
 * entry is added, so no on-disk migration is required — existing roots are
 * valid under both versions.
 *
 * What changed in v2:
 * - new category `app-managed`: top-level structures owned and written by the
 *   desktop app itself. Never part of `contentContract`, so manifests'
 *   `mymind.write` patterns cannot target them, and they are not created by
 *   skills.
 * - new entry `.agent/skills`: the Installed Skill store (registry.json +
 *   package bytes) relocated from app-private userData to the bound mymind
 *   root (see the ADR-001 superseding note).
 *
 * Categories:
 * - initializeRequired: created when the user explicitly "initialises a new
 *   root". Absent on bind of an existing root is informational, never fatal.
 * - createIfNeeded: created lazily by the owning skill on first write.
 *   Absence is NOT a bind failure; surfaced in RootHealth only.
 * - optionalPreserveOnly: observed tool-private dirs (`.claude`, `.claudian`,
 *   `.obsidian`). Never created, never required, never deleted.
 * - appManaged: app-owned structures (`.agent`). Created only by the app's
 *   SkillStore; preserved verbatim by relocation; not writable by skills.
 *
 * `contentContract` = initializeRequired ∪ createIfNeeded. Manifest
 * `mymind.write` patterns must be a subset of `contentContract` top-level
 * names; the resolver rejects writes that would create a new top-level
 * directory outside the writable set.
 */

import { MYMIND_LAYOUT_V1 } from "./mymind-layout-v1";

export const MYMIND_LAYOUT_VERSION = "mymind-layout-v2" as const;

/** Top-level mymind entries that are part of the content contract. */
export type MymindEntryCategory =
  | "initialize-required"
  | "create-if-needed"
  | "optional-preserve-only"
  | "app-managed";

export interface MymindLayoutEntry {
  /** Logical relative path from mymindRoot, using forward slashes. */
  readonly logicalPath: string;
  readonly category: MymindEntryCategory;
  /** Owning skill / producer; informational. */
  readonly owner: string;
  /** Human-readable note; safe to show in UI. */
  readonly note: string;
}

/** The v2 entry table: all v1 entries (verbatim) plus the app-managed store. */
export const MYMIND_LAYOUT_V2: readonly MymindLayoutEntry[] = [
  ...MYMIND_LAYOUT_V1,
  { logicalPath: ".agent/skills", category: "app-managed", owner: "desktop-app SkillStore", note: "Installed Skill packages + registry.json; managed by the app, never by skills" }
] as const;

/** All logical paths in the contract (normalised forward-slash form). */
export const MYMIND_LAYOUT_PATHS: readonly string[] = MYMIND_LAYOUT_V2.map((e) => e.logicalPath);

/** Top-level directory names the layout knows about (any category). */
export const MYMIND_ALLOWED_TOP_LEVEL_DIRS: ReadonlySet<string> = new Set(
  MYMIND_LAYOUT_V2.map((e) => e.logicalPath.split("/")[0])
);

/**
 * Top-level dirs a skill write may create or write into: content-contract
 * entries only. App-managed and optional-preserve-only tops are excluded so
 * the skill store and tool-private dirs stay outside skill reach.
 */
export const MYMIND_WRITABLE_TOP_LEVEL_DIRS: ReadonlySet<string> = new Set(
  MYMIND_LAYOUT_V2
    .filter((e) => e.category === "initialize-required" || e.category === "create-if-needed")
    .map((e) => e.logicalPath.split("/")[0])
);

/** Top-level dirs that bind() health classifies as "missing create-if-needed". */
export const MYMIND_CREATE_IF_NEEDED_TOP_LEVEL: readonly string[] = MYMIND_LAYOUT_V2
  .filter((e) => e.category === "create-if-needed" && !e.logicalPath.includes("/"))
  .map((e) => e.logicalPath);

/** Top-level dirs that bind() classifies as "optional observed". */
export const MYMIND_OPTIONAL_TOP_LEVEL: readonly string[] = MYMIND_LAYOUT_V2
  .filter((e) => e.category === "optional-preserve-only" && !e.logicalPath.includes("/"))
  .map((e) => e.logicalPath);

/** Top-level dirs owned by the app (informational for health reporting). */
export const MYMIND_APP_MANAGED_TOP_LEVEL: readonly string[] = [...new Set(
  MYMIND_LAYOUT_V2
    .filter((e) => e.category === "app-managed")
    .map((e) => e.logicalPath.split("/")[0])
)];

/** Look up an entry by logical path (exact match). */
export function findLayoutEntry(logicalPath: string): MymindLayoutEntry | undefined {
  return MYMIND_LAYOUT_V2.find((e) => e.logicalPath === logicalPath);
}

/**
 * Returns the top-level name for a logical path, e.g.
 * `article/20260805/x.md` → `article`. Returns `null` for empty/root.
 */
export function topLevelOf(logicalPath: string): string | null {
  const head = logicalPath.split("/")[0];
  return head && head.length > 0 ? head : null;
}

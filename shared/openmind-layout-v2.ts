/**
 * openmind layout contract v2 — machine-readable source of truth.
 *
 * Supersedes openmind-layout-v1 (frozen by ADR-002). The v1→v2 migration is
 * purely additive: every v1 entry is carried over verbatim and exactly one
 * entry is added, so no on-disk migration is required — existing roots are
 * valid under both versions.
 *
 * What changed in v2:
 * - new category `app-managed`: top-level structures owned and written by the
 *   desktop app itself. Never part of `contentContract`, so manifests'
 *   `openmind.write` patterns cannot target them, and they are not created by
 *   skills.
 * - new entry `.agent/skills`: the Installed Skill store (registry.json +
 *   package bytes) relocated from app-private userData to the bound openmind
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
 * `openmind.write` patterns must be a subset of `contentContract` top-level
 * names; the resolver rejects writes that would create a new top-level
 * directory outside the writable set.
 */

import { OPENMIND_LAYOUT_V1 } from "./openmind-layout-v1";

/** Top-level openmind entries that are part of the content contract. */
export type OpenmindEntryCategory =
  | "initialize-required"
  | "create-if-needed"
  | "optional-preserve-only"
  | "app-managed";

export interface OpenmindLayoutEntry {
  /** Logical relative path from openmindRoot, using forward slashes. */
  readonly logicalPath: string;
  readonly category: OpenmindEntryCategory;
  /** Owning skill / producer; informational. */
  readonly owner: string;
  /** Human-readable note; safe to show in UI. */
  readonly note: string;
}

/** The v2 entry table: all v1 entries (verbatim) plus the app-managed store. */
export const OPENMIND_LAYOUT_V2: readonly OpenmindLayoutEntry[] = [
  ...OPENMIND_LAYOUT_V1,
  { logicalPath: ".agent/skills", category: "app-managed", owner: "desktop-app SkillStore", note: "Installed Skill packages + registry.json; managed by the app, never by skills" },
  { logicalPath: ".agent/skill-data", category: "app-managed", owner: "skill runtime (OPENMIND_SKILL_DATA_DIR)", note: "Persistent per-skill runtime state (dedup caches, login state, data dirs) injected by the Execution Broker / cron; preserved verbatim by relocation, never written via openmind.write patterns" }
] as const;

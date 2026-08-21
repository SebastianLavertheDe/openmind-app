/**
 * openmind layout contract v3 — machine-readable source of truth.
 *
 * Supersedes openmind-layout-v2. The selected private repository is now the content
 * root itself, rather than a parent containing an `openmind/` directory.
 * This application is pre-release, so it does not migrate legacy bindings.
 *
 * What changed in v3 (flat-root audit, 2026-08-21):
 * - the selected content root is flat: `article/`, `config/`, `.agent/` etc.
 *   sit directly under openmindRoot (no `openmind/` sub-directory). Logical
 *   paths keep their `openmind/…` display prefix; the resolver strips it.
 * - new create-if-needed entry `assets`: shared media/evidence output
 *   (`assets/browser-evidence/…`), so skill manifests may declare
 *   `openmind.write: assets/…`.
 * - new app-managed tops `config` (providers.yaml) and `.openmind` (product
 *   state stores): written directly by the app, never via openmind.write.
 * - `.agent/skills/<name>/SKILL.md` is the flat Agent Skills store and
 *   `.claude` is an app-managed directory link to `.agent`, allowing Claude
 *   Code to perform its native project Skill discovery without an app filter.
 * - new optional-preserve-only entries `.zcode`, `scripts`, and the root
 *   documentation files (AGENTS.md, CLAUDE.md, README.md, .gitignore,
 *   .gitattributes): recognised, preserved verbatim, never created by the app.
 *
 * `video` stays create-if-needed: absent from the audited root but still owned
 * by the `video-burnin-subtitles` skill contract.
 */

import { OPENMIND_LAYOUT_V2 } from "./openmind-layout-v2";

export const OPENMIND_LAYOUT_VERSION = "openmind-layout-v3" as const;

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

const V2_UNCHANGED_ENTRIES = OPENMIND_LAYOUT_V2.filter(
  (entry) => entry.logicalPath !== ".claude" && entry.logicalPath !== ".agent/skills"
);

/** The v3 entry table, replacing the two entries whose ownership changed. */
export const OPENMIND_LAYOUT_V3: readonly OpenmindLayoutEntry[] = [
  ...V2_UNCHANGED_ENTRIES,
  { logicalPath: ".agent/skills", category: "app-managed", owner: "desktop-app + Agent Skills clients", note: "Flat <name>/SKILL.md packages + registry.json; visible to native clients through .claude/skills" },
  { logicalPath: ".claude", category: "app-managed", owner: "desktop-app compatibility link", note: "Directory link to .agent; enables unfiltered Claude Code project Skill discovery" },
  { logicalPath: "assets", category: "create-if-needed", owner: "browser-evidence-capture", note: "Shared media/evidence output, e.g. assets/browser-evidence/<run>/" },
  { logicalPath: "config", category: "app-managed", owner: "desktop-app (providers.yaml)", note: "App-owned configuration; written directly by the app, never via openmind.write patterns" },
  { logicalPath: ".openmind", category: "app-managed", owner: "desktop-app product stores", note: "App runtime state (content-index, brief watchlist, …); preserved verbatim by relocation, never written by skills" },
  { logicalPath: ".zcode", category: "optional-preserve-only", owner: "(tool)", note: "May exist; never created by app" },
  { logicalPath: "scripts", category: "optional-preserve-only", owner: "(user tooling)", note: "User automation scripts; preserved verbatim, never created by app" },
  { logicalPath: "AGENTS.md", category: "optional-preserve-only", owner: "(user docs)", note: "Root agent instructions; preserved verbatim" },
  { logicalPath: "CLAUDE.md", category: "optional-preserve-only", owner: "(user docs)", note: "Root agent instructions; preserved verbatim" },
  { logicalPath: "README.md", category: "optional-preserve-only", owner: "(user docs)", note: "Root documentation; preserved verbatim" },
  { logicalPath: ".gitignore", category: "optional-preserve-only", owner: "(git)", note: "May exist; never created by app" },
  { logicalPath: ".gitattributes", category: "optional-preserve-only", owner: "(git)", note: "May exist; never created by app" }
] as const;

/** All logical paths in the contract (normalised forward-slash form). */
export const OPENMIND_LAYOUT_PATHS: readonly string[] = OPENMIND_LAYOUT_V3.map((e) => e.logicalPath);

/** Top-level entry names the layout knows about (any category; includes files). */
export const OPENMIND_ALLOWED_TOP_LEVEL_DIRS: ReadonlySet<string> = new Set(
  OPENMIND_LAYOUT_V3.map((e) => e.logicalPath.split("/")[0])
);

/**
 * Top-level dirs a skill write may create or write into: content-contract
 * entries only. App-managed and optional-preserve-only tops are excluded so
 * the skill store, provider config, app state, and tool-private dirs stay
 * outside skill reach.
 */
export const OPENMIND_WRITABLE_TOP_LEVEL_DIRS: ReadonlySet<string> = new Set(
  OPENMIND_LAYOUT_V3
    .filter((e) => e.category === "initialize-required" || e.category === "create-if-needed")
    .map((e) => e.logicalPath.split("/")[0])
);

/** Top-level entries that bind() health classifies as "missing create-if-needed". */
export const OPENMIND_CREATE_IF_NEEDED_TOP_LEVEL: readonly string[] = OPENMIND_LAYOUT_V3
  .filter((e) => e.category === "create-if-needed" && !e.logicalPath.includes("/"))
  .map((e) => e.logicalPath);

/** Top-level entries that bind() classifies as "optional observed" (dirs and files). */
export const OPENMIND_OPTIONAL_TOP_LEVEL: readonly string[] = OPENMIND_LAYOUT_V3
  .filter((e) => e.category === "optional-preserve-only" && !e.logicalPath.includes("/"))
  .map((e) => e.logicalPath);

/** Top-level dirs owned by the app (informational for health reporting). */
export const OPENMIND_APP_MANAGED_TOP_LEVEL: readonly string[] = [...new Set(
  OPENMIND_LAYOUT_V3
    .filter((e) => e.category === "app-managed")
    .map((e) => e.logicalPath.split("/")[0])
)];

/** Look up an entry by logical path (exact match). */
export function findLayoutEntry(logicalPath: string): OpenmindLayoutEntry | undefined {
  return OPENMIND_LAYOUT_V3.find((e) => e.logicalPath === logicalPath);
}

/**
 * Returns the top-level name for a logical path, e.g.
 * `article/20260805/x.md` → `article`. Returns `null` for empty/root.
 */
export function topLevelOf(logicalPath: string): string | null {
  const head = logicalPath.split("/")[0];
  return head && head.length > 0 ? head : null;
}

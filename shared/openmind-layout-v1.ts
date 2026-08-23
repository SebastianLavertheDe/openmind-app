/**
 * openmind layout contract v1 — machine-readable source of truth.
 *
 * Frozen by ADR-002. Do NOT rename, reorder, or reclassify entries without
 * bumping to openmind-layout-v2 and writing a migration. This object is the
 * authoritative input to {@link OpenmindPathResolver} and `RootHealth`.
 *
 * Categories:
 * - initializeRequired: created when the user explicitly "initialises a new
 *   root". Absent on bind of an existing root is informational, never fatal.
 * - createIfNeeded: created lazily by the owning skill on first write.
 *   Absence is NOT a bind failure; surfaced in RootHealth only.
 * - optionalPreserveOnly: observed tool-private dirs (`.claude`, `.claudian`,
 *   `.obsidian`). Never created, never required, never deleted.
 *
 * `contentContract` = initializeRequired ∪ createIfNeeded. Manifest
 * `openmind.write` patterns must be a subset of `contentContract` top-level
 * names; the resolver rejects writes that would create a new top-level
 * directory not in this list.
 */

/** Top-level openmind entries that are part of the content contract. */
export type OpenmindEntryCategory =
  | "initialize-required"
  | "create-if-needed"
  | "optional-preserve-only";

export interface OpenmindLayoutEntry {
  /** Logical relative path from openmindRoot, using forward slashes. */
  readonly logicalPath: string;
  readonly category: OpenmindEntryCategory;
  /** Owning skill / producer; informational. */
  readonly owner: string;
  /** Human-readable note; safe to show in UI. */
  readonly note: string;
}

/**
 * The frozen v1 entry table. Derived from the on-disk layout audited on
 * 2026-08-05 and from the 16 skills' documented relative-path conventions.
 */
export const OPENMIND_LAYOUT_V1: readonly OpenmindLayoutEntry[] = [
  // --- content contract: create-if-needed ---
  { logicalPath: "article", category: "create-if-needed", owner: "rss-article-saver", note: "RSS/article output, organised by YYYYMMDD/" },
  { logicalPath: "creative", category: "create-if-needed", owner: "creative-writing", note: "Creative workspace root" },
  { logicalPath: "creative/01-内容生产/文稿库/02-制作中", category: "create-if-needed", owner: "daily-writing-orchestrator", note: "In-progress writing packages" },
  { logicalPath: "creative/01-内容生产/选题管理", category: "create-if-needed", owner: "ai-media-topic-selector", note: "Topic collection; 00-兴趣收集箱.md, ai_topic_*.md" },
  { logicalPath: "daily-summary", category: "create-if-needed", owner: "daily-article-summarizer", note: "YYYYMMDD_daily_summary.md" },
  { logicalPath: "daily-topic", category: "create-if-needed", owner: "daily-topic-selector", note: "YYYYMMDD_daily_topic.md" },
  { logicalPath: "post", category: "create-if-needed", owner: "x-following-fetcher", note: "X/post output, organised by YYYYMMDD/" },
  { logicalPath: "reddit", category: "create-if-needed", owner: "reddit-fetcher", note: "Reddit output, organised by YYYYMMDD/" },
  { logicalPath: "wiki", category: "create-if-needed", owner: "knowledge-wiki-compiler", note: "Compiled wiki" },
  { logicalPath: "video", category: "create-if-needed", owner: "video-burnin-subtitles", note: "Existing video contract; openmind/video/<job>/" },

  // --- optional / tool-private ---
  { logicalPath: ".claude", category: "optional-preserve-only", owner: "(tool)", note: "May exist; never created by app" },
  { logicalPath: ".claudian", category: "optional-preserve-only", owner: "(tool)", note: "May exist; never created by app" },
  { logicalPath: ".obsidian", category: "optional-preserve-only", owner: "(tool)", note: "May exist; never created by app" }
] as const;

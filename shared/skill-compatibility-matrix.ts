/**
 * 16-skill compatibility matrix — Phase 0 deliverable #12.
 *
 * Machine-readable record of the audited classification of the 16 current
 * skills (refactor plan §17.1, §17.2). Frozen as a baseline so the Phase 6
 * migration can be验收 against it:
 *   - 12 process skills
 *   - 1 workflow skill
 *   - 3 agent skills
 *   - `_shared` is NOT a runnable skill; it becomes a versioned shared package.
 *
 * Audited 2026-08-05 against `.claude/skills/`. Each row records the facts
 * that drive the migration: kind, runtime packs needed, mymind read/write
 * patterns, external-export binding, the legacy `.env`/ancestor-walk issues
 * to fix, and the migration batch (A/B/C, §17.6).
 */

import type { SkillKind } from "./skill-manifest-schema";
import type { PlatformTarget } from "./skill-manifest-schema";

export type MigrationBatch = "A" | "B" | "C";

export interface SkillCompatibilityEntry {
  readonly id: string;
  /** Directory name under `.claude/skills/` (case-sensitive on disk). */
  readonly sourceDir: string;
  readonly targetKind: SkillKind;
  readonly runtimePacks: readonly string[];
  readonly externalExport: boolean;
  /** Logical mymind read patterns (top-level only, audited). */
  readonly mymindRead: readonly string[];
  /** Logical mymind write patterns (top-level only, audited). */
  readonly mymindWrite: readonly string[];
  /** Legacy issues to fix in Phase 6. */
  readonly legacyIssues: readonly SkillLegacyIssue[];
  readonly batch: MigrationBatch;
  readonly primaryArtifact: string;
  readonly notes: string;
}

export type SkillLegacyIssue =
  | "env-file-direct-read"      // skill reads its own .env directly
  | "ancestor-repo-walk"         // walks Path(__file__).parents[n] to find repo
  | "shared-ai-client-relative"  // imports _shared/ai_client.py via relative path
  | "system-curl-dependency"     // shells out to system curl
  | "missing-uv-lock"            // has pyproject.toml but no uv.lock
  | "no-pyproject";              // no pyproject.toml at all

const ALL_PLATFORMS: readonly PlatformTarget[] = [
  "windows-x64",
  "macos-arm64",
  "linux-x64"
];

export const SKILL_COMPATIBILITY_MATRIX: readonly SkillCompatibilityEntry[] = [
  // --- Batch A: low-dependency process skills ---
  {
    id: "asset-collector",
    sourceDir: "asset-collector",
    targetKind: "process",
    runtimePacks: ["python-core"],
    externalExport: false,
    mymindRead: ["creative/**"],
    mymindWrite: ["creative/**"],
    legacyIssues: ["ancestor-repo-walk", "no-pyproject"],
    batch: "A",
    primaryArtifact: "creative/01-内容生产/文稿库/02-制作中/<pkg>/assets/",
    notes: "Input schema; artifact JSON; no custom mymind sub-root."
  },
  {
    id: "collect-interest-markers",
    sourceDir: "collect-interest-markers",
    targetKind: "process",
    runtimePacks: ["python-core"],
    externalExport: false,
    mymindRead: ["daily-summary/**"],
    mymindWrite: ["creative/**"],
    legacyIssues: ["ancestor-repo-walk", "no-pyproject"],
    batch: "A",
    primaryArtifact: "creative/01-内容生产/选题管理/00-兴趣收集箱.md",
    notes: "dry-run support; move state out of content dir."
  },
  {
    id: "daily-writing-orchestrator",
    sourceDir: "daily-writing-orchestrator",
    targetKind: "process",
    runtimePacks: ["python-core"],
    externalExport: false,
    mymindRead: ["daily-topic/**", "creative/**"],
    mymindWrite: ["creative/**"],
    legacyIssues: ["ancestor-repo-walk", "no-pyproject"],
    batch: "A",
    primaryArtifact: "creative/01-内容生产/文稿库/02-制作中/<pkg>/",
    notes: "Structured handoff to creative-writing; fix artifact pattern."
  },
  {
    id: "skill-run-reporter",
    sourceDir: "skill-run-reporter",
    targetKind: "process",
    runtimePacks: ["python-core"],
    externalExport: false,
    mymindRead: [],
    mymindWrite: [],
    legacyIssues: ["ancestor-repo-walk", "no-pyproject"],
    batch: "A",
    primaryArtifact: "structured report (run artifact)",
    notes: "Read RunStore API/export instead of fixed parent-dir inference."
  },
  {
    id: "reddit-fetcher",
    sourceDir: "reddit-fetcher",
    targetKind: "process",
    runtimePacks: ["python-core"],
    externalExport: false,
    mymindRead: [],
    mymindWrite: ["reddit/**"],
    legacyIssues: [],
    batch: "A",
    primaryArtifact: "reddit/<YYYYMMDD>/",
    notes: "Config overlay; cache/content separation; network capability."
  },

  // --- Batch B: AI / network content chain ---
  {
    id: "daily-article-summarizer",
    sourceDir: "daily-article-summarizer",
    targetKind: "process",
    runtimePacks: ["python-core"],
    externalExport: false,
    mymindRead: ["article/**", "reddit/**"],
    mymindWrite: ["daily-summary/**"],
    legacyIssues: ["env-file-direct-read", "shared-ai-client-relative"],
    batch: "B",
    primaryArtifact: "daily-summary/YYYYMMDD_daily_summary.md",
    notes: "Provider Profile; date schema; fatal error non-zero exit; cache→userData."
  },
  {
    id: "daily-topic-selector",
    sourceDir: "daily-topic-selector",
    targetKind: "process",
    runtimePacks: ["python-core"],
    externalExport: false,
    mymindRead: ["daily-summary/**"],
    mymindWrite: ["daily-topic/**"],
    legacyIssues: ["shared-ai-client-relative", "no-pyproject"],
    batch: "B",
    primaryArtifact: "daily-topic/YYYYMMDD_daily_topic.md",
    notes: "Remove direct dependency on other skills' .env; unified Provider."
  },
  {
    id: "knowledge-wiki-compiler",
    sourceDir: "knowledge-wiki-compiler",
    targetKind: "process",
    runtimePacks: ["python-core"],
    externalExport: false,
    mymindRead: ["article/**", "post/**"],
    mymindWrite: ["wiki/**"],
    legacyIssues: ["ancestor-repo-walk", "shared-ai-client-relative"],
    batch: "B",
    primaryArtifact: "wiki/",
    notes: "Remove ancestor-based `.claude` discovery; config overlay."
  },
  {
    id: "rss-article-saver",
    sourceDir: "rss-article-saver",
    targetKind: "process",
    runtimePacks: ["python-core", "browser-playwright"],
    externalExport: false,
    mymindRead: [],
    mymindWrite: ["article/**"],
    legacyIssues: ["env-file-direct-read", "shared-ai-client-relative"],
    batch: "B",
    primaryArtifact: "article/<YYYYMMDD>/",
    notes: "OPML/Provider config; on-demand browser pack; fatal exit non-zero."
  },
  {
    id: "x-following-fetcher",
    sourceDir: "x-following-fetcher",
    targetKind: "process",
    runtimePacks: ["python-core", "media-core"],
    externalExport: false,
    mymindRead: [],
    mymindWrite: ["post/**", "article/**"],
    legacyIssues: ["shared-ai-client-relative"],
    batch: "B",
    primaryArtifact: "post/<YYYYMMDD>/ and article/.../x_*.md",
    notes: "Broker-managed structured credential JSON; Python HTTP client; config schema; cache→userData."
  },

  // --- Batch C: media, agent, workflow ---
  {
    id: "VideoDownload",
    sourceDir: "VideoDownload",
    targetKind: "process",
    runtimePacks: ["python-core", "media-core"],
    externalExport: true,
    mymindRead: [],
    mymindWrite: [],
    legacyIssues: [],
    batch: "C",
    primaryArtifact: "external export (video file)",
    notes: "Remove cwd/parent inference; structured URL/output name; declare download/disk/model needs. Uses Export Location Binding."
  },
  {
    id: "video-burnin-subtitles",
    sourceDir: "video-burnin-subtitles",
    targetKind: "process",
    runtimePacks: ["python-core", "media-core", "speech-whisper", "cjk-subtitle-fonts"],
    externalExport: false,
    mymindRead: [],
    mymindWrite: ["video/**"],
    legacyIssues: [],
    batch: "C",
    primaryArtifact: "video/<job>/ (existing contract)",
    notes: "Windows native entry; subtitle steps; large packs on demand. MUST keep mymind/video contract."
  },
  {
    id: "agent-browser",
    sourceDir: "agent-browser",
    targetKind: "agent",
    runtimePacks: ["browser-agent"],
    externalExport: true,
    mymindRead: [],
    mymindWrite: [],
    legacyIssues: [],
    batch: "C",
    primaryArtifact: "run artifact or external-authorised screenshot/evidence",
    notes: "Agent invokes controlled Browser Tool; no fake process run."
  },
  {
    id: "ai-media-topic-selector",
    sourceDir: "ai-media-topic-selector",
    targetKind: "agent",
    runtimePacks: [],
    externalExport: false,
    mymindRead: ["article/**", "post/**", "daily-summary/**"],
    mymindWrite: ["creative/**"],
    legacyIssues: [],
    batch: "C",
    primaryArtifact: "creative/01-内容生产/选题管理/ai_topic_YYYY-MM-DD.md",
    notes: "Install references; unified mymindRoot; declare network + write."
  },
  {
    id: "creative-writing",
    sourceDir: "creative-writing",
    targetKind: "agent",
    runtimePacks: [],
    externalExport: false,
    mymindRead: ["creative/**", "article/**", "wiki/**"],
    mymindWrite: ["creative/**"],
    legacyIssues: [],
    batch: "C",
    primaryArtifact: "creative/01-内容生产/文稿库/...",
    notes: "Agent Bridge/Internal Agent; methodology references; capability approval."
  },
  {
    id: "rss-to-summary-workflow",
    sourceDir: "rss-to-summary-workflow",
    targetKind: "workflow",
    runtimePacks: [],
    externalExport: false,
    mymindRead: [],
    mymindWrite: [],
    legacyIssues: [],
    batch: "C",
    primaryArtifact: "child skills' existing artifacts",
    notes: "Manifest-only Workflow; reference Skill IDs; step retry/history; single shared root snapshot."
  }
] as const;

/** All 16 skill IDs. */
export const ALL_SKILL_IDS: readonly string[] = SKILL_COMPATIBILITY_MATRIX.map((e) => e.id);

/** Count by kind — used by the §17.7 acceptance gate. */
export function countByKind(): Record<SkillKind, number> {
  const counts: Record<SkillKind, number> = { process: 0, workflow: 0, agent: 0 };
  for (const e of SKILL_COMPATIBILITY_MATRIX) counts[e.targetKind] += 1;
  return counts;
}

/** Look up an entry by skill id. */
export function findSkillEntry(id: string): SkillCompatibilityEntry | undefined {
  return SKILL_COMPATIBILITY_MATRIX.find((e) => e.id === id);
}

export { ALL_PLATFORMS };

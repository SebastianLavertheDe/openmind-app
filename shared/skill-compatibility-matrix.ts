/** The 8 retained native Skills shipped from config/skill-library/packages.
 * Original migration batch/issue fields document provenance; executable
 * contracts are validated from the current manifests during every build. */

import type { SkillKind } from "./skill-manifest-schema";

export type MigrationBatch = "A" | "B" | "C";

export interface SkillCompatibilityEntry {
  readonly id: string;
  /** Directory name under `config/skill-library/packages/` (case-sensitive on disk). */
  readonly sourceDir: string;
  readonly targetKind: SkillKind;
  readonly runtimePacks: readonly string[];
  readonly externalExport: boolean;
  /** Logical openmind read patterns (top-level only, audited). */
  readonly openmindRead: readonly string[];
  /** Logical openmind write patterns (top-level only, audited). */
  readonly openmindWrite: readonly string[];
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


export const SKILL_COMPATIBILITY_MATRIX: readonly SkillCompatibilityEntry[] = [
  {
    id: "reddit-fetcher",
    sourceDir: "reddit-fetcher",
    targetKind: "process",
    runtimePacks: ["python-core"],
    externalExport: false,
    openmindRead: [],
    openmindWrite: ["reddit/**"],
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
    openmindRead: ["article/**", "reddit/**"],
    openmindWrite: ["daily-summary/**"],
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
    openmindRead: ["daily-summary/**"],
    openmindWrite: ["daily-topic/**"],
    legacyIssues: ["shared-ai-client-relative", "no-pyproject"],
    batch: "B",
    primaryArtifact: "daily-topic/YYYYMMDD_daily_topic.md",
    notes: "Remove direct dependency on other skills' .env; unified Provider."
  },
  {
    id: "rss-article-saver",
    sourceDir: "rss-article-saver",
    targetKind: "process",
    runtimePacks: ["python-core", "browser-playwright"],
    externalExport: false,
    openmindRead: [],
    openmindWrite: ["article/**"],
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
    openmindRead: [],
    openmindWrite: ["post/**", "article/**"],
    legacyIssues: ["shared-ai-client-relative"],
    batch: "B",
    primaryArtifact: "post/<YYYYMMDD>/ and article/.../x_*.md",
    notes: "Skill-data-scoped curl credentials parsed without shell execution; Python HTTP client; config schema; cache→Skill data."
  },

  // --- Batch C: media, agent, workflow ---
  {
    id: "video-download",
    sourceDir: "VideoDownload",
    targetKind: "process",
    runtimePacks: ["python-core", "media-core"],
    externalExport: true,
    openmindRead: [],
    openmindWrite: [],
    legacyIssues: [],
    batch: "C",
    primaryArtifact: "external export (video file)",
    notes: "Remove cwd/parent inference; structured URL/output name; declare download/disk/model needs. Uses Export Location Binding."
  },
  {
    id: "agent-browser",
    sourceDir: "agent-browser",
    targetKind: "agent",
    runtimePacks: ["browser-agent"],
    externalExport: true,
    openmindRead: [],
    openmindWrite: [],
    legacyIssues: [],
    batch: "C",
    primaryArtifact: "run artifact or external-authorised screenshot/evidence",
    notes: "Agent invokes controlled Browser Tool; no fake process run."
  },
  {
    id: "rss-to-summary-workflow",
    sourceDir: "rss-to-summary-workflow",
    targetKind: "workflow",
    runtimePacks: [],
    externalExport: false,
    openmindRead: [],
    openmindWrite: [],
    legacyIssues: [],
    batch: "C",
    primaryArtifact: "child skills' existing artifacts",
    notes: "Desktop Workflow Engine via openmind.skill.yaml; local/cron launcher via scripts/run_workflow.py + workflows.yaml; reference Skill IDs; step retry/history; single shared root snapshot."
  }
] as const;

/** All 8 retained native skill IDs. */
export const ALL_SKILL_IDS: readonly string[] = SKILL_COMPATIBILITY_MATRIX.map((e) => e.id);

/** Count by kind — used by the §17.7 acceptance gate. */

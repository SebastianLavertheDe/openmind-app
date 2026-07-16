import type { CreativeStage } from "./contracts";

/** 创作 workflow stage 的稳定 ID（contracts CreativeStageSchema 子集 + UI 用 today）。 */
export type CreativeStageId = CreativeStage;

export type CreativeBucketId = "topic" | "drafting" | "pending" | "published";

export type CreativePlatformId = "wechat" | "xiaohongshu" | "twitter";

export type CreativeReleaseAction =
  | "project_created"
  | "stage_changed"
  | "file_saved"
  | "review_generated"
  | "review_status_changed"
  | "content_exported"
  | "publish_scheduled"
  | "schedule_cancelled"
  | "publish_draft"
  | "publish_updated"
  | "version_restored"
  | "project_copied"
  | "project_archived";

export type CreativeReviewDimension = "structure" | "accuracy" | "readability" | "platform" | "seo";

export type CreativeTopicSectionId = "recommendation" | "xiaohongshu" | "wechat" | "pool";

/** 文稿库根目录（相对 repoRoot）。 */
export const CREATIVE_WORKSPACE_SEGMENTS = ["mymind", "creative", "01-内容生产", "文稿库"] as const;

/** 磁盘 stage 目录名 ↔ stage id（扫描/移动/路径解析共用，勿 i18n）。 */
export const CREATIVE_STAGE_SCAN_FOLDERS: ReadonlyArray<{ diskFolder: string; stage: CreativeStageId }> = [
  { diskFolder: "01-今日推荐", stage: "today" },
  { diskFolder: "02-制作中", stage: "drafting" },
  { diskFolder: "03-待审核", stage: "review" },
  { diskFolder: "04-待发布", stage: "ready" },
  { diskFolder: "05-已发布", stage: "published" },
  { diskFolder: "99-归档", stage: "archived" }
];

/** workflow 阶段目录（不含 today/archived 的特殊根）。 */
export const CREATIVE_STAGE_DISK_FOLDERS: Record<Exclude<CreativeStageId, "today">, string> = {
  drafting: "02-制作中",
  review: "03-待审核",
  ready: "04-待发布",
  published: "05-已发布",
  archived: "99-归档"
};

export const ALLOWED_STAGE_TRANSITIONS: Record<string, readonly CreativeStageId[]> = {
  drafting: ["review"],
  review: ["drafting", "ready"],
  ready: ["review", "published"],
  published: [],
  archived: []
};

/** UI workflow 主 stages（route / stream 过滤用）。 */
export const CREATIVE_WORKFLOW_STAGES = ["today", "drafting", "review", "ready", "published"] as const;

export type CreativeWorkflowStage = typeof CREATIVE_WORKFLOW_STAGES[number];

export const CREATIVE_BUCKETS: ReadonlyArray<{ id: CreativeBucketId; stages: readonly CreativeWorkflowStage[] }> = [
  { id: "topic", stages: ["today"] },
  { id: "drafting", stages: ["drafting"] },
  { id: "pending", stages: ["review", "ready"] },
  { id: "published", stages: ["published"] }
];

export const CREATIVE_PLATFORMS: ReadonlyArray<{ id: CreativePlatformId; file: string }> = [
  { id: "wechat", file: "wechat-draft.md" },
  { id: "xiaohongshu", file: "xiaohongshu-draft.md" },
  { id: "twitter", file: "twitter-thread.md" }
];

/** 选题 markdown section 头（磁盘格式，勿 i18n）。 */
export const TOPIC_SECTION_HEADERS = {
  recommendation: "## 1.",
  xiaohongshu: "## 2.",
  wechat: "## 3.",
  pool: "## 4.",
  end: ["## 5.", "## 6."]
} as const;

/** section id → platform id（parseTopicMarkdown 落盘用 key，展示走 platformLabel）。 */
export const TOPIC_SECTION_PLATFORM: Record<CreativeTopicSectionId, CreativePlatformId> = {
  recommendation: "wechat",
  xiaohongshu: "xiaohongshu",
  wechat: "wechat",
  pool: "wechat"
};

export function stageFromProjectPath(projectDir: string): CreativeStageId {
  const normalized = String(projectDir).replaceAll("\\", "/");
  return CREATIVE_STAGE_SCAN_FOLDERS.find(({ diskFolder }) => normalized.includes(`/${diskFolder}/`))?.stage || "drafting";
}

export function bucketForStage(stage: string): CreativeBucketId {
  return CREATIVE_BUCKETS.find((bucket) => bucket.stages.includes(stage as CreativeWorkflowStage))?.id ?? "drafting";
}

export function nextWorkflowStage(value: CreativeWorkflowStage): CreativeWorkflowStage {
  return ({ drafting: "review", review: "ready", ready: "published" } as Partial<Record<CreativeWorkflowStage, CreativeWorkflowStage>>)[value] || "published";
}

export const CREATIVE_PREFERRED_FILES: Record<CreativeWorkflowStage | "default", readonly string[]> = {
  review: ["review.md", "draft.md", "wechat-draft.md"],
  default: ["draft.md", "wechat-draft.md", "xiaohongshu-draft.md", "twitter-thread.md", "topic-brief.md"],
  today: ["topic-brief.md"],
  drafting: ["draft.md", "wechat-draft.md", "xiaohongshu-draft.md", "twitter-thread.md", "topic-brief.md"],
  ready: ["draft.md", "wechat-draft.md", "xiaohongshu-draft.md", "twitter-thread.md", "topic-brief.md"],
  published: ["draft.md", "wechat-draft.md", "xiaohongshu-draft.md", "twitter-thread.md", "topic-brief.md"]
};

export function preferredCreativeFile(files: string[], stage: string): string {
  const preferences = stage === "review"
    ? CREATIVE_PREFERRED_FILES.review
    : CREATIVE_PREFERRED_FILES[stage as CreativeWorkflowStage] || CREATIVE_PREFERRED_FILES.default;
  return preferences.find((file) => files.includes(file)) || files[0] || "";
}

/** 兼容旧选题数据里存的 display 平台名 → platform id。 */
export const LEGACY_PLATFORM_DISPLAY_TO_ID: Readonly<Record<string, CreativePlatformId>> = {
  公众号: "wechat",
  小红书: "xiaohongshu"
};

export function normalizePlatformId(value: string | undefined | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (CREATIVE_PLATFORMS.some((platform) => platform.id === raw)) return raw;
  return LEGACY_PLATFORM_DISPLAY_TO_ID[raw] || raw;
}

import type { TranslationOf } from "../types";
import type { coreMessages as zhCN } from "../zh-CN/core";

/** Navigation, content types, and shared creative labels. */
export const coreMessages = {
  nav: { sources: "Library", skills: "Skills", brief: "Daily Brief", creative: "Creative", automation: "Automation", runs: "Runs", ai: "New Task", settings: "Settings" },
  navGroup: { create: "", core: "", workspace: "Recent tasks", system: "" },
  repoRequired: { action: "Open settings" },
  contentKind: { article: "Article", post: "Post", summary: "Summary", topic: "Topic", reddit: "Reddit", html: "HTML", unknown: "File", all: "All" },
  creative: {
    stage: { today: "Recommended today", drafting: "Drafting", review: "In review", ready: "Ready to publish", published: "Published", archived: "Archived" },
    bucket: { topic: "Topics", drafting: "Drafting", pending: "Ready to publish", published: "Published" },
    platform: { wechat: "WeChat Official Account", xiaohongshu: "Xiaohongshu", twitter: "Twitter/X long post" },
    releaseAction: {
      project_created: "Create draft", stage_changed: "Change stage", file_saved: "Save file", review_generated: "Generate review", review_status_changed: "Change review status",
      content_exported: "Export draft", publish_scheduled: "Schedule publication", schedule_cancelled: "Cancel schedule", publish_draft: "Publish draft", publish_updated: "Update publication",
      version_restored: "Restore version", project_copied: "Copy draft", project_archived: "Archive draft"
    },
    reviewDimension: { seo: "Local heuristics" },
    defaults: { topicCreation: "Content creation", unnamedTopic: "Untitled topic", owner: "Local user", topicBriefPlaceholder: "## Topic brief\n\nTo be added.", copySuffix: " (copy)" },
    version: { beforeSave: "Before saving", manual: "Manual version", history: "Previous version", beforeRestore: "Before restoring", restoredFrom: (name: string) => `Restored from ${name}`, stageChange: (from: string, to: string) => `Stage change: ${from} → ${to}` }
  },
  common: {
    noDescription: "No description", unspecified: "Not specified", unnamedTopic: "(Untitled topic)", justSaved: "Just saved", justNow: "Just now", close: "Close", copy: "Copy", retry: "Retry", open: "Open",
    minutesAgo: (n: number) => `${n} minute${n === 1 ? "" : "s"} ago`, hoursAgo: (n: number) => `${n} hour${n === 1 ? "" : "s"} ago`, daysAgo: (n: number) => `${n} day${n === 1 ? "" : "s"} ago`,
    chars: (n: number) => `${n} character${n === 1 ? "" : "s"}`, hours: (n: number) => `${n} hour${n === 1 ? "" : "s"}`
  }
} satisfies TranslationOf<typeof zhCN>;

import type { TranslationOf } from "../types";
import type { coreMessages as zhCN } from "../zh-CN/core";

/** Navigation and content types. */
export const coreMessages = {
  nav: { sources: "RSS Sources", skills: "Skills", brief: "Daily Brief", automation: "Automation", runs: "Runs", ai: "New Task", settings: "Settings" },
  navGroup: { create: "", core: "", workspace: "Recent tasks", system: "" },
  repoRequired: { action: "Open settings" },
  contentKind: { article: "Article", post: "Post", summary: "Summary", topic: "Topic", reddit: "Reddit", html: "HTML", unknown: "File", all: "All" },
  common: {
    noDescription: "No description", unspecified: "Not specified", unnamedTopic: "(Untitled topic)", justSaved: "Just saved", justNow: "Just now", close: "Close", copy: "Copy", retry: "Retry", open: "Open",
    minutesAgo: (n: number) => `${n} minute${n === 1 ? "" : "s"} ago`, hoursAgo: (n: number) => `${n} hour${n === 1 ? "" : "s"} ago`, daysAgo: (n: number) => `${n} day${n === 1 ? "" : "s"} ago`,
    chars: (n: number) => `${n} character${n === 1 ? "" : "s"}`, hours: (n: number) => `${n} hour${n === 1 ? "" : "s"}`
  }
} satisfies TranslationOf<typeof zhCN>;

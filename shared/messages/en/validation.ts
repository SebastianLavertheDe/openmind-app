import type { validationMessages as zhCN } from "../zh-CN/validation";
import type { TranslationOf } from "../types";

export const validationMessages = {
  validation: {
    project: {
      nameRequired: "Enter a project name.",
      nameLength: (characters: number, bytes: number) => `Project names can contain up to ${characters} characters and ${bytes} bytes.`,
      nameCharacters: "The project name contains characters unsupported by cross-platform file systems.",
      namePath: "Project names cannot contain .., start or end with a dot, or have leading or trailing whitespace.",
      nameReserved: "Project names cannot use Windows reserved device names.",
      updateRequired: "Update at least one project setting.",
      httpUrl: "Only HTTP(S) URLs are supported.",
      duplicateSession: "Previous sessions cannot be repeated.",
      providerRequired: "New project tasks require a provider.",
      outputTaskRequired: "Outputs sourced from a session or message must be linked to a project task.",
      outputSessionRequired: "Outputs sourced from a message must be linked to a session."
    },
    automation: {
      relativePath: "File-change paths must be relative to openmindRoot.",
      duplicateWeekday: "Weekly triggers cannot contain duplicate days.",
      completionTarget: "A run-completed trigger can target either a Skill or a workflow, but not both.",
      secretInput: "Automation inputs cannot store secrets directly.",
      defaults: {
        rss: { name: "RSS collection and daily summary", description: "Run rss-to-summary-workflow every hour to fetch feeds and generate a daily summary, matching the rss-to-summary-workflow cron job." },
        x: { name: "X/Twitter following collection", description: "Fetch the latest posts from followed accounts every 15 minutes, matching the x-following-fetcher cron job." },
        reddit: { name: "Reddit trending collection", description: "Fetch trending Reddit posts at 5 minutes past every hour, matching the reddit-fetcher cron job." },
        topics: { name: "Daily topic generation", description: "Generate topic candidates for the next day at 23:55 after the evening summary, matching the daily-topic-selector cron job." }
      }
    },
    skillSource: {
      controlCharacters: "Git URLs cannot contain control characters.",
      invalidUrl: "Enter a valid HTTPS Git URL.",
      httpsOnly: "Git sources support HTTPS only. SSH, file, and HTTP URLs are not supported.",
      privateUrl: "Git URLs cannot contain credentials, query parameters, or fragments."
    },
    artifact: {
      untitled: "Untitled artifact",
      untitledNumbered: (index: number) => `Untitled artifact ${index}`
    }
  }
} as const satisfies TranslationOf<typeof zhCN>;

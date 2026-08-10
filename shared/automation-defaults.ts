import type { AutomationRuleInput } from "./automation-contracts";

/**
 * Default Automation rules. Mirror the Linux crontab pipeline so the desktop
 * app runs the same four scheduled jobs a user has on WSL:
 *   1. rss-to-summary-workflow — every hour
 *   2. x-following-fetcher    — every 15 minutes
 *   3. reddit-fetcher          — at minute 5 of each hour
 *   4. daily-topic-selector    — daily at 23:55
 *
 * They are deliberately ordinary Rule inputs so the renderer never owns
 * scheduling policy or a second copy of the Automation model.
 */
export const DEFAULT_AUTOMATION_RULES: AutomationRuleInput[] = [
  {
    id: "rss-capture",
    name: "RSS 抓取与每日总结",
    description: "每小时运行 rss-to-summary-workflow（抓取订阅源 → 生成每日总结），对应 crontab 里的 rss-to-summary-workflow。",
    enabled: true,
    target: { type: "workflow", id: "rss-to-summary-workflow", versionPolicy: "*" },
    trigger: { type: "hourly" },
    inputs: {},
    providerBindings: {},
    externalExportBindingIds: [],
    concurrencyPolicy: "skip",
    missedRunPolicy: "run-once",
    retryPolicy: { maxAttempts: 1, backoffMs: 30_000 },
    timezone: "UTC"
  },
  {
    id: "x-following-capture",
    name: "X/Twitter 关注动态抓取",
    description: "每 15 分钟拉取关注账号的最新帖子，对应 crontab 里的 x-following-fetcher。",
    enabled: true,
    target: { type: "skill", id: "x-following-fetcher", versionPolicy: "*" },
    trigger: { type: "interval", everyMinutes: 15 },
    inputs: {},
    providerBindings: {},
    externalExportBindingIds: [],
    concurrencyPolicy: "skip",
    missedRunPolicy: "run-once",
    retryPolicy: { maxAttempts: 1, backoffMs: 30_000 },
    timezone: "UTC"
  },
  {
    id: "reddit-capture",
    name: "Reddit 热门抓取",
    description: "每小时第 5 分钟拉取 Reddit 热门帖子，对应 crontab 里的 reddit-fetcher。",
    enabled: true,
    target: { type: "skill", id: "reddit-fetcher", versionPolicy: "*" },
    trigger: { type: "cron", expression: "5 * * * *" },
    inputs: {},
    providerBindings: {},
    externalExportBindingIds: [],
    concurrencyPolicy: "skip",
    missedRunPolicy: "run-once",
    retryPolicy: { maxAttempts: 1, backoffMs: 30_000 },
    timezone: "UTC"
  },
  {
    id: "daily-topic-generation",
    name: "每日选题生成",
    description: "每天 23:55 在晚间摘要完成后生成次日候选选题，对应 crontab 里的 daily-topic-selector。",
    enabled: true,
    target: { type: "skill", id: "daily-topic-selector", versionPolicy: "*" },
    trigger: { type: "daily", at: "23:55" },
    inputs: {},
    providerBindings: {},
    externalExportBindingIds: [],
    concurrencyPolicy: "skip",
    missedRunPolicy: "run-once",
    retryPolicy: { maxAttempts: 1, backoffMs: 30_000 },
    timezone: "UTC"
  }
];

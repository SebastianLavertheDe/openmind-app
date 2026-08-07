import type { AutomationRuleInput } from "./automation-contracts";

/**
 * First-boot examples are persisted into the app-private registry.  They are
 * deliberately ordinary Rule inputs so the renderer never owns scheduling
 * policy or a second copy of the Automation model.
 */
export const DEFAULT_AUTOMATION_RULES: AutomationRuleInput[] = [
  {
    id: "daily-brief",
    name: "每日简报生成",
    description: "每天早晨汇总过去 24 小时的资料并生成本地 Markdown 简报。",
    enabled: true,
    target: { type: "skill", id: "daily-article-summarizer", versionPolicy: "*" },
    trigger: { type: "daily", at: "08:00" },
    inputs: {},
    providerBindings: {},
    externalExportBindingIds: [],
    concurrencyPolicy: "skip",
    missedRunPolicy: "run-once",
    retryPolicy: { maxAttempts: 1, backoffMs: 30_000 },
    timezone: "UTC"
  },
  {
    id: "classify-new-content",
    name: "新资料自动归类",
    description: "采集完成后扫描新增资料并生成候选选题。默认关闭，启用前需由用户确认。",
    enabled: false,
    target: { type: "skill", id: "daily-topic-selector", versionPolicy: "*" },
    trigger: { type: "run-completed", skillId: "rss-article-saver" },
    inputs: {},
    providerBindings: {},
    externalExportBindingIds: [],
    concurrencyPolicy: "skip",
    missedRunPolicy: "run-once",
    retryPolicy: { maxAttempts: 1, backoffMs: 30_000 },
    timezone: "UTC"
  },
  {
    id: "rss-capture",
    name: "RSS 定时抓取",
    description: "按固定频率通过统一 Skill Broker 拉取订阅源。",
    enabled: true,
    target: { type: "skill", id: "rss-article-saver", versionPolicy: "*" },
    trigger: { type: "interval", everyMinutes: 15 },
    inputs: {},
    providerBindings: {},
    externalExportBindingIds: [],
    concurrencyPolicy: "skip",
    missedRunPolicy: "run-once",
    retryPolicy: { maxAttempts: 1, backoffMs: 30_000 },
    timezone: "UTC"
  }
];

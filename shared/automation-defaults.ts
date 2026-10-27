import { messages } from "./messages";
import type { AutomationRuleInput } from "./automation-contracts";

export function isDefaultAutomationRule(rule: Pick<AutomationRuleInput, "id" | "target">): boolean {
  return (rule.id === "rss-capture" && rule.target.type === "workflow" && rule.target.id === "rss-to-summary-workflow") || DEFAULT_AUTOMATION_RULES.some(item => item.id === rule.id && item.target.type === rule.target.type && item.target.id === rule.target.id);
}

function rule(id: string, name: () => string, description: () => string, skill: string, trigger: AutomationRuleInput["trigger"], inputs = {}): AutomationRuleInput {
  return { id, get name() { return name(); }, get description() { return description(); }, enabled: false,
    target: { type: "skill", id: skill, versionPolicy: "*" }, trigger, inputs, providerBindings: {}, externalExportBindingIds: [],
    concurrencyPolicy: "skip", missedRunPolicy: "run-once", retryPolicy: { maxAttempts: 1, backoffMs: 30_000 },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" };
}

/** Packages, subscriptions and schedules have independent opt-in states. */
export const DEFAULT_AUTOMATION_RULES: AutomationRuleInput[] = [
  rule("rss-sync", () => messages.rss.syncTask, () => messages.rss.syncDescription, "rss-article-saver", { type: "hourly" }, { mode: "sync" }),
  rule("rss-capture", () => messages.rss.collectTask, () => messages.rss.collectDescription, "rss-article-saver", { type: "interval", everyMinutes: 30 }, { mode: "collect" }),
  rule("daily-summary-generation", () => messages.rss.summaryTask, () => messages.rss.summaryDescription, "daily-article-summarizer", { type: "daily", at: "22:00" }),
  rule("daily-topic-generation", () => messages.validation.automation.defaults.topics.name, () => messages.validation.automation.defaults.topics.description, "daily-topic-selector", { type: "daily", at: "23:00" }),
  rule("x-following-capture", () => messages.validation.automation.defaults.x.name, () => messages.validation.automation.defaults.x.description, "x-following-fetcher", { type: "interval", everyMinutes: 15 }),
  rule("reddit-capture", () => messages.validation.automation.defaults.reddit.name, () => messages.validation.automation.defaults.reddit.description, "reddit-fetcher", { type: "cron", expression: "5 * * * *" })
];

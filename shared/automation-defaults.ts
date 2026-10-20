import { messages } from "./messages";
import type { AutomationRuleInput } from "./automation-contracts";

export function isDefaultAutomationRule(rule: Pick<AutomationRuleInput, "id" | "target">): boolean {
  return DEFAULT_AUTOMATION_RULES.some((item) =>
    item.id === rule.id && item.target.type === rule.target.type && item.target.id === rule.target.id);
}

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
    get name() { return messages.validation.automation.defaults.rss.name; },
    get description() { return messages.validation.automation.defaults.rss.description; },
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
    get name() { return messages.validation.automation.defaults.x.name; },
    get description() { return messages.validation.automation.defaults.x.description; },
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
    get name() { return messages.validation.automation.defaults.reddit.name; },
    get description() { return messages.validation.automation.defaults.reddit.description; },
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
    get name() { return messages.validation.automation.defaults.topics.name; },
    get description() { return messages.validation.automation.defaults.topics.description; },
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

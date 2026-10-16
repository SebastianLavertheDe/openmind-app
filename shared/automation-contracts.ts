import { messages } from "./messages";
import { z } from "zod";

export const AUTOMATION_SCHEMA_VERSION = 1 as const;

const AutomationIdSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z][A-Za-z0-9._-]*$/);
const SkillIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z][A-Za-z0-9._-]*$/);
const TimezoneSchema = z.string().trim().min(1).max(80);
const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const RelativeFilePathSchema = z.string().trim().min(1).max(240).refine((value) => {
  if (value.includes("\\")) return false;
  const normalized = value.replace(/^\.\//, "");
  return normalized !== "" && normalized !== "." && !normalized.startsWith("/") && !normalized.split("/").includes("..") && !normalized.includes("\0");
}, { error: () => messages.validation.automation.relativePath });
const WeekdaySchema = z.number().int().min(0).max(6);

export const AutomationTargetSchema = z.object({
  type: z.enum(["skill", "workflow"]),
  id: SkillIdSchema,
  versionPolicy: z.string().trim().min(1).max(80).default("*")
}).strict();
export type AutomationTarget = z.infer<typeof AutomationTargetSchema>;

export const AutomationTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily"), at: TimeOfDaySchema }).strict(),
  z.object({ type: z.literal("weekly"), daysOfWeek: z.array(WeekdaySchema).min(1).max(7), at: TimeOfDaySchema }).strict().superRefine((value, context) => {
    if (new Set(value.daysOfWeek).size !== value.daysOfWeek.length) context.addIssue({ code: "custom", path: ["daysOfWeek"], message: messages.validation.automation.duplicateWeekday });
  }),
  z.object({ type: z.literal("hourly") }).strict(),
  z.object({ type: z.literal("interval"), everyMinutes: z.number().int().min(1).max(7 * 24 * 60) }).strict(),
  z.object({ type: z.literal("cron"), expression: z.string().trim().min(1).max(160) }).strict(),
  z.object({ type: z.literal("app-start") }).strict(),
  z.object({ type: z.literal("file-change"), paths: z.array(RelativeFilePathSchema).min(1).max(64), debounceMinutes: z.number().int().min(1).max(7 * 24 * 60).default(5) }).strict(),
  z.object({ type: z.literal("network"), state: z.enum(["online", "offline"]), everyMinutes: z.number().int().min(1).max(7 * 24 * 60).default(5) }).strict(),
  z.object({ type: z.literal("power"), state: z.enum(["ac", "battery"]), everyMinutes: z.number().int().min(1).max(7 * 24 * 60).default(5) }).strict(),
  z.object({ type: z.literal("run-completed"), skillId: SkillIdSchema.optional(), workflowSkillId: SkillIdSchema.optional() }).strict()
]).superRefine((value, context) => {
  if (value.type === "run-completed" && value.skillId && value.workflowSkillId) {
    context.addIssue({ code: "custom", message: messages.validation.automation.completionTarget });
  }
});

export const AutomationRetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(0).max(10).default(0),
  backoffMs: z.number().int().min(0).max(3_600_000).default(0)
}).strict();

const AutomationRuleFields = {
  id: AutomationIdSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000).default(""),
  enabled: z.boolean().default(true),
  target: AutomationTargetSchema,
  trigger: AutomationTriggerSchema,
  inputs: z.record(z.string().trim().min(1).max(120), z.unknown()).default({}),
  providerBindings: z.record(z.string().trim().min(1).max(120), z.string().trim().min(1).max(120)).default({}),
  externalExportBindingIds: z.array(z.string().trim().min(1).max(120)).max(32).default([]),
  concurrencyPolicy: z.enum(["skip", "queue", "replace"]).default("skip"),
  missedRunPolicy: z.enum(["skip", "run-once"]).default("run-once"),
  retryPolicy: AutomationRetryPolicySchema.default({ maxAttempts: 0, backoffMs: 0 }),
  timezone: TimezoneSchema.default("UTC"),
  lastTriggeredAt: z.string().datetime().nullable().default(null),
  lastScheduledKey: z.string().max(160).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
} as const;

export const AutomationRuleSchema = z.object({
  schemaVersion: z.literal(AUTOMATION_SCHEMA_VERSION),
  ...AutomationRuleFields
}).strict();
export type AutomationRule = z.infer<typeof AutomationRuleSchema>;

export const AutomationRuleInputSchema = z.object({
  id: AutomationRuleFields.id,
  name: AutomationRuleFields.name,
  description: AutomationRuleFields.description,
  enabled: AutomationRuleFields.enabled,
  target: AutomationRuleFields.target,
  trigger: AutomationRuleFields.trigger,
  inputs: AutomationRuleFields.inputs,
  providerBindings: AutomationRuleFields.providerBindings,
  externalExportBindingIds: AutomationRuleFields.externalExportBindingIds,
  concurrencyPolicy: AutomationRuleFields.concurrencyPolicy,
  missedRunPolicy: AutomationRuleFields.missedRunPolicy,
  retryPolicy: AutomationRuleFields.retryPolicy,
  timezone: AutomationRuleFields.timezone
}).strict().superRefine((value, context) => {
  const dangerous = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|password|cookie|secret)/i;
  const visit = (input: unknown, path: string[]) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return;
    for (const [key, child] of Object.entries(input)) {
      if (dangerous.test(key)) context.addIssue({ code: "custom", path: [...path, key], message: messages.validation.automation.secretInput });
      visit(child, [...path, key]);
    }
  };
  visit(value.inputs, ["inputs"]);
});
export type AutomationRuleInput = z.infer<typeof AutomationRuleInputSchema>;

export const AutomationRunStateSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled", "skipped", "blocked"]);

export const AutomationRunRecordSchema = z.object({
  schemaVersion: z.literal(AUTOMATION_SCHEMA_VERSION),
  id: AutomationIdSchema,
  ruleId: AutomationIdSchema,
  target: AutomationTargetSchema,
  state: AutomationRunStateSchema,
  attempt: z.number().int().nonnegative().default(0),
  retryAt: z.string().datetime().nullable().default(null),
  childRunId: z.string().min(1).max(120).nullable(),
  triggerReason: z.string().max(240),
  scheduledFor: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  error: z.string().max(2000).nullable()
}).strict();
export type AutomationRunRecord = z.infer<typeof AutomationRunRecordSchema>;

export const AutomationScheduleSnapshotSchema = z.object({
  ruleId: AutomationIdSchema,
  nextRunAt: z.string().datetime().nullable(),
  blockedReason: z.string().max(500).nullable()
}).strict();
export type AutomationScheduleSnapshot = z.infer<typeof AutomationScheduleSnapshotSchema>;

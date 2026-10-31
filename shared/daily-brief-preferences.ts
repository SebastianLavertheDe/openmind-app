import { z } from "zod";
import defaults from "../config/skill-library/packages/_shared/brief_defaults.json";

export const SUMMARY_FIELDS = ["translated_title", "summary", "key_points", "category", "score"] as const;
export const SummaryPromptSchema = z.object({
  instructions: z.string().max(12000),
  fields: z.object({
    translated_title: z.string().max(4000), summary: z.string().max(4000),
    key_points: z.string().max(4000), category: z.string().max(4000), score: z.string().max(4000)
  }).strict()
}).strict();
export type SummaryPrompt = z.infer<typeof SummaryPromptSchema>;
export const DEFAULT_SUMMARY_PROMPT: SummaryPrompt = SummaryPromptSchema.parse(defaults.summaryPrompt);
export const LEGACY_TOPIC_RULES = defaults.legacyTopicRules;
export const DEFAULT_TOPIC_PROMPT = defaults.topicPrompt;
export const TopicPlatformSchema = z.object({ id: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(80), prompt: z.string().max(12000) }).strict();
export type TopicPlatform = z.infer<typeof TopicPlatformSchema>;
export const TopicPlatformsSchema = z.array(TopicPlatformSchema).max(12).superRefine((platforms, ctx) => {
  const names = new Set<string>(), ids = new Set<string>();
  platforms.forEach((platform, index) => {
    const name = platform.name.normalize("NFKC").toLowerCase();
    if (names.has(name)) ctx.addIssue({ code: "custom", path: [index, "name"], message: "Platform names must be unique." });
    if (ids.has(platform.id)) ctx.addIssue({ code: "custom", path: [index, "id"], message: "Platform IDs must be unique." });
    names.add(name); ids.add(platform.id);
  });
});
export const DEFAULT_TOPIC_PLATFORMS = TopicPlatformsSchema.parse(defaults.topicPlatforms);
export const DailyBriefPreferencesSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(), text: z.string().max(12000), updatedAt: z.string().nullable(),
  summaryPrompt: SummaryPromptSchema.optional(), topicRules: z.string().max(20000).optional(),
  topicPrompt: z.string().max(20000).optional(), topicPlatforms: TopicPlatformsSchema.optional()
});
export const SaveDailyBriefPreferencesSchema = z.object({
  revision: z.number().int().nonnegative(), text: z.string().trim().max(12000),
  summaryPrompt: SummaryPromptSchema.optional(), topicRules: z.string().max(20000).optional(),
  topicPrompt: z.string().max(20000).optional(), topicPlatforms: TopicPlatformsSchema.optional()
}).strict();
export type DailyBriefPreferences = z.infer<typeof DailyBriefPreferencesSchema>;
export type SaveDailyBriefPreferences = z.infer<typeof SaveDailyBriefPreferencesSchema>;

/** Resolve legacy snapshots without rewriting user files or discarding extra preferences. */
export function resolveDailyBriefPreferences(value: DailyBriefPreferences) {
  const prompt = value.summaryPrompt;
  const { topicRules: legacyRules, ...rest } = value;
  const customLegacyRules = legacyRules?.trim() && legacyRules.trim() !== LEGACY_TOPIC_RULES.trim() ? legacyRules.trim() : undefined;
  return {
    ...rest,
    summaryPrompt: {
      instructions: prompt?.instructions.trim() || DEFAULT_SUMMARY_PROMPT.instructions,
      fields: Object.fromEntries(SUMMARY_FIELDS.map(key => [key, prompt?.fields[key].trim() || DEFAULT_SUMMARY_PROMPT.fields[key]])) as SummaryPrompt["fields"]
    },
    topicPrompt: value.topicPrompt?.trim() ?? customLegacyRules ?? DEFAULT_TOPIC_PROMPT,
    topicPlatforms: structuredClone(value.topicPlatforms ?? DEFAULT_TOPIC_PLATFORMS)
  };
}

/** Only user-visible content rules are composed here; output formatting is separate. */
export function topicPromptContext(preferences: DailyBriefPreferences): string {
  const resolved = resolveDailyBriefPreferences(preferences);
  return [
    "## 通用选题提示词", resolved.topicPrompt,
    ...resolved.topicPlatforms.flatMap(platform => [`## 平台：${platform.name}`, platform.prompt]),
    ...(resolved.text.trim() ? ["## 补充偏好", resolved.text.trim()] : [])
  ].join("\n\n");
}

export function summaryPromptContext(prompt: SummaryPrompt): string {
  return [prompt.instructions, ...SUMMARY_FIELDS.map(key => `${key}: ${prompt.fields[key]}`)].join("\n\n");
}

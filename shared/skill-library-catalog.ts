import { z } from "zod";
import { DEFAULT_LOCALE, getLocale, type Locale } from "./messages";
import { SkillSceneSchema } from "./skill-library";
import { SkillIdSchema } from "./skill-manifest-schema";
import { SkillContributorSchema } from "./skill-contributor";

export const SKILL_LIBRARY_CATALOG_FILE = "catalog.json";
export const SKILL_LIBRARY_PUBLISHER = "openmind-library";
export const SKILL_LIBRARY_SOURCE = "openmind:skill-library";

const InstructionSchema = z.string().trim().min(1).max(20_000);
const AssetPathSchema = z.string().min(1).max(512).refine(value =>
  !value.includes("\\") && !value.includes(":") && value.split("/").every(part => part && part !== "." && part !== ".."), "Use a relative asset path without traversal");
// Strings remain relative to assets/<skill-id>; mapped files can share one
// explicitly declared source under assets/ without coupling installed packages.
const AssetSchema = z.union([AssetPathSchema, z.object({ source: AssetPathSchema, target: AssetPathSchema }).strict()]);

const SkillLibraryCopySchema = z.object({
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().max(1_000).default(""),
  description: z.string().max(5_000).optional(),
  inputHint: z.string().max(1_000).default("")
}).strict();

export const SkillLibraryPresetSchema = z.object({
  id: SkillIdSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default("1.0.0"),
  category: SkillSceneSchema,
  contributor: SkillContributorSchema.optional(),
  instructions: z.array(InstructionSchema).max(50).default([]),
  packageDirectory: AssetPathSchema.optional(),
  executionKind: z.enum(["agent", "process", "workflow"]).default("agent"),
  discoverable: z.boolean().default(true),
  files: z.array(AssetSchema).max(50).default([]),
  requirement: z.enum(["image", "ffmpeg", "python"]).optional(),
  display: z.object({
    "zh-CN": SkillLibraryCopySchema.optional(),
    en: SkillLibraryCopySchema.optional()
  }).strict().refine(value => Boolean(value["zh-CN"] || value.en), "Provide at least one display language")
}).strict().refine(value => Boolean(value.packageDirectory) || value.instructions.length > 0, "Provide instructions or a manifest package directory");

export const SkillLibraryCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  executionRules: z.array(InstructionSchema).max(20).default([]),
  skills: z.array(SkillLibraryPresetSchema)
}).strict().superRefine((catalog, context) => {
  const ids = new Set<string>();
  catalog.skills.forEach((skill, index) => {
    if (ids.has(skill.id)) context.addIssue({ code: "custom", path: ["skills", index, "id"], message: `Duplicate Skill id: ${skill.id}` });
    ids.add(skill.id);
  });
});

export type SkillLibraryCatalog = z.infer<typeof SkillLibraryCatalogSchema>;
export type SkillLibraryPreset = z.infer<typeof SkillLibraryPresetSchema>;

export function resolveSkillLibraryCopy(preset: SkillLibraryPreset, locale: Locale = getLocale()) {
  return preset.display[locale] ?? preset.display[DEFAULT_LOCALE] ?? preset.display.en!;
}

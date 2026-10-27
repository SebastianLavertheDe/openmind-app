import { z } from "zod";
import { messages } from "./messages";
import { SkillContributorNickSchema, SkillContributorProfileUrlSchema, SkillContributorSchema, type SkillContributorView } from "./skill-contributor";

export const SKILL_SCENES = ["research", "writing", "image", "slides", "video", "web"] as const;
export const SkillSceneSchema = z.enum(SKILL_SCENES);
const SkillRuntimeRequirementSchema = z.enum(["image", "python", "ffmpeg"]);
export type SkillScene = z.infer<typeof SkillSceneSchema>;
export type SkillLibraryMode = "explore" | "mine";
export type SkillLibrarySection = "all" | SkillScene | "github-installed" | "local-imported";
export const SkillSelectionInputSchema = z.object({ key: z.string().min(1).max(257), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type SkillSelectionInput = z.infer<typeof SkillSelectionInputSchema>;
export const SkillAssetSchema = z.object({ id: z.string().uuid(), name: z.string().max(240), kind: z.enum(["image", "document"]), extension: z.string().regex(/^\.[a-z0-9]{1,8}$/) });
export type SkillAsset = z.infer<typeof SkillAssetSchema>;
export const AuthoredSkillContributorSchema = z.object({
  nick: SkillContributorNickSchema,
  avatar: SkillAssetSchema.refine(asset => asset.kind === "image" && /^\.(png|jpe?g|webp)$/.test(asset.extension), { error: () => messages.skillLibrary.errors.avatar }).optional(),
  profileUrl: SkillContributorProfileUrlSchema.optional()
}).strict();
export type AuthoredSkillContributor = z.infer<typeof AuthoredSkillContributorSchema>;
const limited = (max: number) => z.string().refine(value => Array.from(value).length <= max, { error: () => messages.skillLibrary.errors.tooLong(max) });
export const SkillInstructionSchema = z.object({
  id: z.string().uuid(), text: limited(20_000),
  assets: z.array(SkillAssetSchema).max(20).default([]),
  skills: z.array(SkillSelectionInputSchema).max(10).default([])
});
export const AuthoredSkillSchema = z.object({
  schemaVersion: z.literal(1).default(1), id: z.string().uuid(), revision: z.number().int().nonnegative().default(0),
  icon: z.enum(["auto", ...SKILL_SCENES]).default("auto"),
  name: limited(40), subtitle: limited(60), category: SkillSceneSchema,
  contributor: AuthoredSkillContributorSchema.optional(),
  instructions: z.array(SkillInstructionSchema).min(1).max(20),
  executionModel: z.object({ provider: z.enum(["codex", "claude"]), model: z.string().trim().min(1).max(200) }).nullable().default(null),
  requirement: SkillRuntimeRequirementSchema.optional(),
  inputHint: limited(200), images: z.array(SkillAssetSchema).max(4).default([]), description: limited(5_000),
  /** Legacy attribution for personal skills created before the copy action was removed. */
  copiedFrom: SkillSelectionInputSchema.nullable().default(null)
}).superRefine((value, ctx) => {
  if (value.instructions.reduce((total, block) => total + Array.from(block.text).length, 0) > 100_000) ctx.addIssue({ code: "custom", path: ["instructions"], message: messages.skillLibrary.errors.tooLong(100_000) });
  if (new Set(value.instructions.map(block => block.id)).size !== value.instructions.length) ctx.addIssue({ code: "custom", path: ["instructions"], message: messages.skillLibrary.errors.invalid });
});
export type AuthoredSkill = z.infer<typeof AuthoredSkillSchema>;
export const SkillPublishInputSchema = z.object({ document: AuthoredSkillSchema, operationId: z.string().uuid() });
export const SkillLibraryMetadataSchema = z.object({
  schemaVersion: z.literal(1), origin: z.enum(["preset", "authored"]), presetId: z.string().optional(),
  capabilityMode: z.literal("session").optional(),
  requirement: SkillRuntimeRequirementSchema.optional(),
  document: AuthoredSkillSchema.optional(), category: SkillSceneSchema, inputHint: z.string().max(1000).default(""),
  contributor: SkillContributorSchema.optional(),
  executionModel: z.object({ provider: z.enum(["codex", "claude"]), model: z.string().max(200) }).nullable().default(null),
  dependencies: z.array(SkillSelectionInputSchema).max(10).default([])
});
export type SkillLibraryMetadata = z.infer<typeof SkillLibraryMetadataSchema>;
export interface SkillLibraryEntry {
  id: string; title: string; subtitle: string; description: string; inputHint: string;
  category: SkillScene | null; origin: "preset" | "authored" | "git" | "local";
  installed: boolean; enabled: boolean; usable: boolean; reason: string | null;
  key: string | null; digest: string | null; version: string | null; skillId: string;
  authoringId: string | null; revision: number; draft: boolean; imageCount: number; source: string;
  executionModel: AuthoredSkill["executionModel"];
  cover?: SkillAsset;
  icon?: SkillScene | "auto";
  updatedAt?: string;
  images?: SkillAsset[];
  discoverable?: boolean;
  /** A newer bundled definition is applied on the next explicit card use. */
  updateAvailable?: boolean;
  contributor?: SkillContributorView;
}

export function filterSkillLibrary(entries: SkillLibraryEntry[], mode: SkillLibraryMode, section: SkillLibrarySection, query = "", origin = "all"): SkillLibraryEntry[] {
  const q = query.trim().toLocaleLowerCase();
  return entries.filter(entry => (mode === "explore" ? entry.origin === "preset" && entry.discoverable !== false : entry.installed || entry.origin === "authored")
    && (section === "all" || section === "github-installed" ? section !== "github-installed" || entry.origin === "git"
      : section === "local-imported" ? entry.origin === "local" : entry.category === section)
    && (mode === "explore" || origin === "all" || entry.origin === origin || origin === "imported" && ["git", "local"].includes(entry.origin))
    && (!q || `${entry.title} ${entry.subtitle} ${entry.description} ${entry.skillId} ${entry.source} ${entry.contributor ? `@${entry.contributor.nick}` : ""}`.toLocaleLowerCase().includes(q)));
}

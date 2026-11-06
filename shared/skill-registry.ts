import { z } from "zod";
import { SKILL_AVATAR_MAX_BYTES } from "./skill-contributor";
import { SkillLibraryPresetSchema } from "./skill-library-catalog";

/** Only these runtime integrations ship in the application installation. */
export const BUILTIN_SKILL_IDS = [
  "video-download", "daily-article-summarizer", "daily-topic-selector",
  "reddit-fetcher", "rss-article-saver", "rss-to-summary-workflow", "x-following-fetcher"
] as const;

export const SKILL_REGISTRY_CATALOG_MAX_BYTES = 8 * 1024 * 1024;
export const SKILL_REGISTRY_PACKAGE_MAX_BYTES = 64 * 1024 * 1024;
export const SKILL_REGISTRY_COVER_MAX_BYTES = 512 * 1024;
export const SKILL_REGISTRY_MAX_ENTRIES = 500;

const builtinIds: ReadonlySet<string> = new Set(BUILTIN_SKILL_IDS);
export function isBuiltinSkillId(id: string): boolean { return builtinIds.has(id); }

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const PackagePathSchema = z.string().min(1).max(512).regex(/^packages\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.zip$/);

function rasterDataUrlSchema(maxBytes: number) {
  return z.string().max(Math.ceil(maxBytes / 3) * 4 + 32).refine(value => {
    const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[1].length % 4 !== 0) return false;
    const padding = match[1].endsWith("==") ? 2 : match[1].endsWith("=") ? 1 : 0;
    return match[1].length / 4 * 3 - padding <= maxBytes;
  }, "Use a bounded PNG, JPEG or WebP data URL");
}

export const RemoteSkillCatalogEntrySchema = z.object({
  preset: SkillLibraryPresetSchema,
  package: z.object({
    path: PackagePathSchema,
    sha256: DigestSchema,
    size: z.number().int().positive().max(SKILL_REGISTRY_PACKAGE_MAX_BYTES),
    digest: DigestSchema
  }).strict(),
  avatarDataUrl: rasterDataUrlSchema(SKILL_AVATAR_MAX_BYTES).optional(),
  coverDataUrl: rasterDataUrlSchema(SKILL_REGISTRY_COVER_MAX_BYTES).optional()
}).strict().refine(entry => !isBuiltinSkillId(entry.preset.id), "Built-in Skills cannot be replaced by registry entries");

export const RemoteSkillCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime(),
  skills: z.array(RemoteSkillCatalogEntrySchema).max(SKILL_REGISTRY_MAX_ENTRIES)
}).strict().superRefine((catalog, context) => {
  const ids = new Set<string>();
  for (const [index, entry] of catalog.skills.entries()) {
    if (ids.has(entry.preset.id)) context.addIssue({ code: "custom", path: ["skills", index, "preset", "id"], message: `Duplicate Skill id: ${entry.preset.id}` });
    ids.add(entry.preset.id);
  }
});

export type RemoteSkillCatalogEntry = z.infer<typeof RemoteSkillCatalogEntrySchema>;
export type RemoteSkillCatalog = z.infer<typeof RemoteSkillCatalogSchema>;

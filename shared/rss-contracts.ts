import { z } from "zod";

export const RssUrlSchema = z.string().trim().max(4096).url().refine(value => { try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }, "Use an HTTP or HTTPS URL");
export const RssErrorSchema = z.object({ stage: z.enum(["detect", "sync", "collect", "configuration"]), code: z.string(), message: z.string(), retryable: z.boolean() });
export const RssSourceSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/), name: z.string().trim().min(1).max(200),
  inputUrl: z.union([RssUrlSchema, z.literal("")]), kind: z.enum(["website", "feed"]),
  resolvedFeedUrl: RssUrlSchema.nullable().default(null), adapterId: z.string().max(100).default("feed"),
  enabled: z.boolean(), presetId: z.string().nullable().default(null), revision: z.number().int().positive(),
  group: z.string().max(200).default(""), tags: z.array(z.string().max(100)).max(30).default([]),
  lastAttemptAt: z.string().nullable().default(null), lastSuccessAt: z.string().nullable().default(null),
  lastError: RssErrorSchema.nullable().default(null), itemCount: z.number().int().nonnegative().default(0),
  feedRevision: z.number().int().nonnegative().default(0)
});
export const RssDocumentSchema = z.object({
  schemaVersion: z.literal(1), initialized: z.literal(true), revision: z.number().int().nonnegative(),
  sources: z.array(RssSourceSchema), deletedPresetIds: z.array(z.string()).default([]),
  migrationWarnings: z.array(z.string()).default([])
});
export const RssSourceInputSchema = z.object({ name: z.string().trim().min(1).max(200), inputUrl: RssUrlSchema, enabled: z.boolean().default(true), selectedFeedUrl: RssUrlSchema.optional() });
export const RssSourcePatchSchema = z.object({ id: RssSourceSchema.shape.id, revision: z.number().int().positive(), name: z.string().trim().min(1).max(200).optional(), inputUrl: RssUrlSchema.optional(), selectedFeedUrl: RssUrlSchema.optional(), enabled: z.boolean().optional() });
export const RssDetectionSchema = z.object({ kind: z.enum(["website", "feed"]), inputUrl: RssUrlSchema, resolvedFeedUrl: RssUrlSchema.nullable(), adapterId: z.string(), candidates: z.array(z.object({ title: z.string(), url: RssUrlSchema })).default([]) });
export const RssRunInputSchema = z.object({ mode: z.enum(["sync", "collect", "pipeline"]).default("pipeline"), sourceId: RssSourceSchema.shape.id.optional(), date: z.string().regex(/^\d{8}$/).optional() });
export type RssSource = z.infer<typeof RssSourceSchema>;
export type RssDocument = z.infer<typeof RssDocumentSchema>;
/** Main-process filesystem facts for display; never persisted in sources.json. */
export type RssSourceView = RssSource & { localFeed: { path: string; status: "ready" | "missing" | "outdated" } };
export type RssDocumentView = Omit<RssDocument, "sources"> & { sources: RssSourceView[] };
export type RssSourceInput = z.infer<typeof RssSourceInputSchema>;
export type RssSourcePatch = z.infer<typeof RssSourcePatchSchema>;
export type RssDetection = z.infer<typeof RssDetectionSchema>;
export type RssRunInput = z.infer<typeof RssRunInputSchema>;
export interface RssCatalog {
  schemaVersion: 1;
  adapters: { id: string; module: string; className: string; url: string }[];
  sources: { id: string; name: string; inputUrl: string; kind: "website" | "feed"; adapterId: string; enabled: boolean; group: string; tags: string[]; legacyAliases: string[] }[];
}

/** URL preserves query parameters, path case and trailing slash semantics. */
export function rssUrlIdentity(value: string): string { const url = new URL(value); url.hash = ""; return url.href; }

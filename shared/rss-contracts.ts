import { z } from "zod";
import type { BrokerRunEvent, BrokerRunState } from "./execution-contracts";

export const RssUrlSchema = z.string().trim().max(4096).url().refine(value => { try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }, "Use an HTTP or HTTPS URL");
export const RssErrorSchema = z.object({ stage: z.enum(["detect", "sync", "collect", "configuration"]), code: z.string(), message: z.string(), retryable: z.boolean() });
export const RssSourceSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/), name: z.string().trim().min(1).max(200),
  inputUrl: z.union([RssUrlSchema, z.literal("")]), kind: z.enum(["website", "feed"]),
  resolvedFeedUrl: RssUrlSchema.nullable().default(null), adapterId: z.string().max(100).default("feed"),
  enabled: z.boolean(), presetId: z.string().nullable().default(null), revision: z.number().int().positive(),
  group: z.string().max(200).default(""), tags: z.array(z.string().max(100)).max(30).default([]),
  lastAttemptAt: z.string().nullable().default(null), lastSuccessAt: z.string().nullable().default(null),
  lastSyncAt: z.string().nullable().default(null), lastCollectAt: z.string().nullable().default(null),
  lastAttemptStage: z.enum(["sync", "collect"]).nullable().default(null),
  lastError: RssErrorSchema.nullable().default(null), itemCount: z.number().int().nonnegative().default(0),
  feedRevision: z.number().int().nonnegative().default(0)
});
export const RssDocumentSchema = z.object({
  schemaVersion: z.literal(1), initialized: z.literal(true), revision: z.number().int().nonnegative(),
  categoryVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  sources: z.array(RssSourceSchema), deletedPresetIds: z.array(z.string()).default([]),
  migrationWarnings: z.array(z.string()).default([])
});
export const RssSourceInputSchema = z.object({ name: z.string().trim().min(1).max(200), inputUrl: RssUrlSchema, group: RssSourceSchema.shape.group.optional(), enabled: z.boolean().default(true), selectedFeedUrl: RssUrlSchema.optional() });
export const RssSourcePatchSchema = z.object({ id: RssSourceSchema.shape.id, revision: z.number().int().positive(), name: z.string().trim().min(1).max(200).optional(), group: RssSourceSchema.shape.group.optional(), inputUrl: RssUrlSchema.optional(), selectedFeedUrl: RssUrlSchema.optional(), enabled: z.boolean().optional() });
export const RssDetectionSchema = z.object({ kind: z.enum(["website", "feed"]), inputUrl: RssUrlSchema, resolvedFeedUrl: RssUrlSchema.nullable(), adapterId: z.string(), candidates: z.array(z.object({ title: z.string(), url: RssUrlSchema })).default([]) });
export const RssRunInputSchema = z.object({ mode: z.enum(["sync", "collect", "pipeline"]).default("pipeline"), sourceId: RssSourceSchema.shape.id.optional(), date: z.string().regex(/^\d{8}$/).optional() });
export type RssSource = z.infer<typeof RssSourceSchema>;
export type RssDocument = z.infer<typeof RssDocumentSchema>;
/** Main-process filesystem facts for display; never persisted in sources.json. */
export type RssSourceView = RssSource & { localFeed: { path: string; status: "ready" | "missing" | "outdated"; version?: string } };
export type RssDocumentView = Omit<RssDocument, "sources"> & { sources: RssSourceView[]; rootKey?: string };
export type RssSourceInput = z.infer<typeof RssSourceInputSchema>;
export type RssSourcePatch = z.infer<typeof RssSourcePatchSchema>;
export type RssDetection = z.infer<typeof RssDetectionSchema>;
export type RssRunInput = z.infer<typeof RssRunInputSchema>;

const rootKey = z.string().max(64).optional();
export const RssEntriesQuerySchema = z.object({ sourceId: RssSourceSchema.shape.id, rootKey, cursor: z.string().max(1024).optional(), limit: z.number().int().min(1).max(100).default(30) }).strict();
export const RssRunsQuerySchema = z.object({ sourceId: RssSourceSchema.shape.id, rootKey, cursor: z.string().max(1024).optional(), limit: z.number().int().min(1).max(50).default(20) }).strict();
export const RssRunEventsQuerySchema = z.object({ sourceId: RssSourceSchema.shape.id, rootKey, runId: z.string().regex(/^[a-zA-Z0-9-]{1,120}$/), after: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(500).default(200) }).strict();
/** Trusted admission metadata, kept separately from arbitrary Skill input values. */
export const RssRunContextSchema = z.object({ root: z.string().min(1), mode: z.enum(["sync", "collect", "pipeline"]), sourceIds: z.array(RssSourceSchema.shape.id) }).strict();
export type RssRunContext = z.infer<typeof RssRunContextSchema>;
export type RssEntriesQuery = z.input<typeof RssEntriesQuerySchema>;
export type RssRunsQuery = z.input<typeof RssRunsQuerySchema>;
export type RssRunEventsQuery = z.input<typeof RssRunEventsQuerySchema>;
export type RssEntry = { title: string; url: string; publishedAt: string | null };
export type RssEntriesPage = { entries: RssEntry[]; total: number; version: string | null; status: RssSourceView["localFeed"]["status"]; nextCursor: string | null; reset: boolean };
export type RssEntriesWorkerRequest = { id: number; root: string; catalog: RssCatalog; legacyStateRoots: string[]; query: RssEntriesQuery };
export type RssEntriesWorkerReply = { id: number; result: RssEntriesPage } | { id: number; error: string };
export type RssSourceRun = {
  id: string; mode: RssRunInput["mode"]; createdAt: string; completedAt: string | null; state: BrokerRunState;
  outcome: "succeeded" | "failed" | "skipped" | null; updated: number | null; collected: number | null;
  error: z.infer<typeof RssErrorSchema> | null; reason: string | null;
};
export type RssRunsPage = { runs: RssSourceRun[]; nextCursor: string | null };
export type RssRunEventsPage = { events: BrokerRunEvent[]; nextAfter: number | null };
export interface RssCatalog {
  schemaVersion: 1;
  adapters: { id: string; module: string; className: string; url: string }[];
  sources: { id: string; name: string; inputUrl: string; kind: "website" | "feed"; adapterId: string; enabled: boolean; group: string; tags: string[]; legacyAliases: string[] }[];
}

/** URL preserves query parameters, path case and trailing slash semantics. */
export function rssUrlIdentity(value: string): string { const url = new URL(value); url.hash = ""; return url.href; }

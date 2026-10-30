import { z } from "zod";

/** Written atomically by the bundled collector, one file per source URL. */
export const RedditSourceStatusSchema = z.object({
  schemaVersion: z.literal(1), url: z.string().url(), attempt: z.string(),
  startedAt: z.string().datetime(), completedAt: z.string().datetime().nullable(),
  lastSuccessAt: z.string().datetime().nullable(),
  status: z.enum(["running", "success", "failed"]),
  itemCount: z.number().int().nonnegative(), error: z.string().nullable(),
  pid: z.number().int().positive()
});

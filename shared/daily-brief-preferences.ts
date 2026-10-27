import { z } from "zod";
export const DailyBriefPreferencesSchema = z.object({ schemaVersion: z.literal(1), revision: z.number().int().nonnegative(), text: z.string().max(12000), updatedAt: z.string().nullable() });
export const SaveDailyBriefPreferencesSchema = z.object({ revision: z.number().int().nonnegative(), text: z.string().trim().max(12000) });
export type DailyBriefPreferences = z.infer<typeof DailyBriefPreferencesSchema>;

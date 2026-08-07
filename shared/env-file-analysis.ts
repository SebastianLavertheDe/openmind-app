import { z } from "zod";

export const EnvVariableKindSchema = z.enum([
  "api-key",
  "token",
  "password",
  "cookie",
  "private-key",
  "credential",
  "unknown"
]);
export type EnvVariableKind = z.infer<typeof EnvVariableKindSchema>;

export const EnvVariableInsightSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  line: z.number().int().min(1),
  kind: EnvVariableKindSchema,
  hasValue: z.boolean(),
  valueLength: z.number().int().min(0).max(1024 * 1024)
}).strict();
export type EnvVariableInsight = z.infer<typeof EnvVariableInsightSchema>;

export const EnvFileAnalysisSchema = z.object({
  path: z.string().min(1).max(4096),
  variables: z.array(EnvVariableInsightSchema).max(10_000),
  ignoredLines: z.number().int().min(0),
  warnings: z.array(z.string().max(500)).max(100),
  containsPotentialSecrets: z.boolean()
}).strict();
export type EnvFileAnalysis = z.infer<typeof EnvFileAnalysisSchema>;

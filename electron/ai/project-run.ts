import { AiSessionOriginSchema } from "../../shared/ai-session-origin";
import { SkillSelectionInputSchema } from "../../shared/skill-library";
import { z } from "zod";
import { ImageSelectionSchema } from "../../shared/image-generation";
import { ContextReferenceSchema, PermissionProfileSchema } from "../../shared/contracts";

const ProjectRunPromptSchema = z.string().min(1).max(2_000_000);
const ProjectRunContextsSchema = z.array(ContextReferenceSchema).max(50).default([]);

/**
 * Main-only request accepted by the AI worker. The create branch carries the
 * root already resolved by ProjectPathResolver; the continuation branch can
 * only name the frozen Session and cannot switch root, Project or Provider.
 */
export const TrustedProjectRunInputSchema = z.union([
  z.object({
    origin: AiSessionOriginSchema.nullable().optional(),
    projectRoot: z.string().min(1),
    projectId: z.string().uuid(),
    projectName: z.string().min(1).max(80),
    taskId: z.string().min(1).max(128),
    providerId: z.string().min(1).max(160),
    permissionProfile: PermissionProfileSchema.default("auto"),
    prompt: ProjectRunPromptSchema,
    selectedSkill: SkillSelectionInputSchema.nullable().optional(),
    imageGeneration: ImageSelectionSchema.nullable().optional(),
    contexts: ProjectRunContextsSchema
  }).strict(),
  z.object({
    sessionId: z.string().min(1).max(160),
    retryOfRunId: z.string().min(1).max(160).optional(),
    permissionProfile: PermissionProfileSchema.default("auto"),
    prompt: ProjectRunPromptSchema,
    selectedSkill: SkillSelectionInputSchema.nullable().optional(),
    imageGeneration: ImageSelectionSchema.nullable().optional(),
    contexts: ProjectRunContextsSchema
  }).strict()
]);

export type TrustedProjectRunInput = z.input<typeof TrustedProjectRunInputSchema>;

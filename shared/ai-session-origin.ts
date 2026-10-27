import { z } from "zod";

const filePath = z.string().min(1).max(4096).nullable().optional();

/** UI location at creation time. Never grants filesystem access or changes scope. */
export const AiSessionOriginSchema = z.discriminatedUnion("page", [
  z.object({ page: z.literal("ai"), filePath }),
  z.object({ page: z.literal("brief"), filePath, previewPath: filePath }),
  z.object({
    page: z.literal("creative"), projectDir: filePath, filePath, previewPath: filePath,
    date: z.string().max(32).optional(), topicTitle: z.string().max(4096).optional(),
    stage: z.enum(["today", "drafting", "review", "ready", "published"]).optional()
  }),
  z.object({
    page: z.literal("projects"), projectId: z.string().uuid(), projectName: z.string().min(1).max(80),
    section: z.enum(["tasks", "materials", "outputs"]), filePath,
    fileKind: z.enum(["material", "output"]).optional()
  })
]);
export type AiSessionOrigin = z.infer<typeof AiSessionOriginSchema>;

export function originForSessionScope(origin: AiSessionOrigin | null | undefined, scope:
  | { type: "workspace" }
  | { type: "project-task"; projectId: string; projectName: string }
): AiSessionOrigin {
  if (scope.type === "project-task") {
    return origin?.page === "projects" && origin.projectId === scope.projectId
      ? { ...origin, projectName: scope.projectName }
      : { page: "projects", projectId: scope.projectId, projectName: scope.projectName, section: "tasks" };
  }
  return origin && origin.page !== "projects" ? origin : { page: "ai" };
}

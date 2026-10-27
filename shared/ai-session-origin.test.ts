import { describe, expect, it } from "vitest";
import { AiSessionOriginSchema, originForSessionScope } from "./ai-session-origin";

describe("session origin scope", () => {
  const scope = { type: "project-task", projectId: "5a111111-1111-4111-8111-111111111111", projectName: "Project 1" } as const;
  it("uses the trusted project locator and rejects a foreign origin", () => {
    const origin = { page: "projects", projectId: scope.projectId, projectName: "stale name", section: "materials", filePath: "materials/A.md" } as const;
    expect(originForSessionScope(origin, scope)).toEqual({ ...origin, projectName: scope.projectName });
    expect(originForSessionScope({ ...origin, projectId: "5a222222-2222-4222-8222-222222222222" }, scope)).toEqual({ page: "projects", projectId: scope.projectId, projectName: scope.projectName, section: "tasks" });
    expect(originForSessionScope(origin, { type: "workspace" })).toEqual({ page: "ai" });
  });
  it("accepts only supported locations and strips unrelated execution fields", () => {
    expect(AiSessionOriginSchema.parse({ page: "brief", filePath: "A.md", cwd: "/outside" })).toEqual({ page: "brief", filePath: "A.md" });
    expect(AiSessionOriginSchema.safeParse({ page: "shell", filePath: "A.md" }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  ProjectCreateInputSchema,
  ProjectNameSchema,
  ProjectStartTaskRunInputSchema,
  projectNameUniquenessKey
} from "./project-contracts";

describe("ProjectNameSchema", () => {
  it("keeps the display spelling while comparing names across case and compatibility forms", () => {
    expect(ProjectNameSchema.parse("研究计划")).toBe("研究计划");
    expect(projectNameUniquenessKey("Ａlpha")).toBe(projectNameUniquenessKey("alpha"));
  });

  it.each([
    "", " Alpha", "Alpha ", ".hidden", "a..b", "a/b", "a\\b", "CON", "lpt1.txt", "a%2fb",
    "CONIN$", "conout$.txt", "COM¹", "LPT³.log"
  ])(
    "rejects unsafe cross-platform identity %j",
    (name) => expect(ProjectNameSchema.safeParse(name).success).toBe(false)
  );

  it("does not silently rewrite a project identity", () => {
    expect(ProjectCreateInputSchema.safeParse({ name: "  Project  " }).success).toBe(false);
  });
});

describe("ProjectStartTaskRunInputSchema", () => {
  const taskId = "7f43fc74-10a1-4e71-97cd-ec90d2660c1c";

  it("requires a provider for a new Project Task session", () => {
    expect(ProjectStartTaskRunInputSchema.safeParse({ projectName: "Alpha", taskId, prompt: "写作" }).success).toBe(false);
    expect(ProjectStartTaskRunInputSchema.safeParse({ projectName: "Alpha", taskId, providerId: "claude", prompt: "写作" }).success).toBe(true);
  });

  it("allows a continuation to carry only its frozen session identity", () => {
    expect(ProjectStartTaskRunInputSchema.safeParse({ projectName: "Alpha", taskId, sessionId: "session-1", prompt: "继续" }).success).toBe(true);
  });
});

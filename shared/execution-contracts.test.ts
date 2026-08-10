import { describe, expect, it } from "vitest";
import { SkillRunRequestSchema, toStoredSkillRunRequest } from "./execution-contracts";

describe("execution contracts", () => {
  it("stores request shape without input values", () => {
    const request = SkillRunRequestSchema.parse({
      skillId: "daily-article-summarizer",
      digest: "A".repeat(64),
      inputs: { date: "20260805", apiKey: "must-not-persist" },
      providerBindings: { default: "provider-main" },
      trigger: { type: "manual" },
      rootGeneration: 3
    });
    const stored = toStoredSkillRunRequest(request);

    expect(stored.inputKeys).toEqual(["apiKey", "date"]);
    expect(JSON.stringify(stored)).not.toContain("must-not-persist");
    expect(stored.digest).toBe("a".repeat(64));
  });

  it("rejects request-level executable, cwd and environment escape hatches", () => {
    expect(() => SkillRunRequestSchema.parse({
      skillId: "skill",
      executable: "/bin/sh",
      cwd: "/tmp",
      env: { SECRET: "x" },
      inputs: {},
      trigger: { type: "manual" },
      rootGeneration: 0
    })).toThrow();
  });
});

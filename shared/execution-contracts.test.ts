import { describe, expect, it } from "vitest";
import {
  SkillArtifactReportSchema,
  SkillRunRequestSchema,
  toStoredSkillRunRequest
} from "./execution-contracts";

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

  it("accepts only the minimal child-authored Artifact report shape", () => {
    expect(SkillArtifactReportSchema.parse({
      schemaVersion: 1,
      artifacts: [{ declarationId: "x-articles", logicalPath: "article/20260824/x_123.md" }]
    })).toEqual({
      schemaVersion: 1,
      artifacts: [{ declarationId: "x-articles", logicalPath: "article/20260824/x_123.md" }]
    });

    expect(() => SkillArtifactReportSchema.parse({
      schemaVersion: 1,
      artifacts: [{
        declarationId: "x-articles",
        logicalPath: "article/20260824/x_123.md",
        sha256: "child-process-must-not-supply-trust-metadata"
      }]
    })).toThrow();
  });
});

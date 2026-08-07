import { describe, expect, it } from "vitest";
import { AgentCheckpointSchema, SkillRunRequestSchema, toStoredSkillRunRequest } from "./execution-contracts";

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

  it("accepts both provider checkpoint protocols but never accepts tool arguments", () => {
    const common = { turn: 1, updatedAt: new Date().toISOString() };
    expect(AgentCheckpointSchema.parse({
      ...common,
      protocol: "openai-responses",
      responseId: "resp-1",
      toolOutputs: [{ callId: "call-1", output: "[REDACTED]" }]
    }).protocol).toBe("openai-responses");
    expect(AgentCheckpointSchema.parse({
      ...common,
      protocol: "anthropic-messages",
      messageId: "msg-1",
      toolResults: [{ toolUseId: "tool-1", toolName: "mymind_write", output: "[REDACTED]" }]
    }).protocol).toBe("anthropic-messages");
    expect(() => AgentCheckpointSchema.parse({
      ...common,
      protocol: "anthropic-messages",
      messageId: "msg-1",
      toolResults: [{ toolUseId: "tool-1", toolName: "mymind_write", arguments: { content: "secret" }, output: "[REDACTED]" }]
    })).toThrow();
  });
});

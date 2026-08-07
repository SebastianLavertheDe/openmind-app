import { describe, expect, it } from "vitest";
import { AutomationRuleInputSchema, AutomationTriggerSchema } from "./automation-contracts";

describe("automation contracts", () => {
  it("accepts weekly and host-condition triggers", () => {
    expect(AutomationTriggerSchema.parse({ type: "weekly", daysOfWeek: [1, 3, 5], at: "08:30" })).toMatchObject({ type: "weekly" });
    expect(AutomationTriggerSchema.parse({ type: "network", state: "online" })).toMatchObject({ everyMinutes: 5 });
    expect(AutomationTriggerSchema.parse({ type: "power", state: "ac" })).toMatchObject({ everyMinutes: 5 });
  });

  it("rejects duplicate weekly days and escaping file paths", () => {
    expect(() => AutomationTriggerSchema.parse({ type: "weekly", daysOfWeek: [1, 1], at: "08:30" })).toThrow(/不能重复/);
    expect(() => AutomationTriggerSchema.parse({ type: "file-change", paths: ["../secret.txt"] })).toThrow(/相对路径/);
    expect(() => AutomationTriggerSchema.parse({ type: "file-change", paths: ["/absolute.txt"] })).toThrow(/相对路径/);
  });

  it("keeps Secret-like Automation inputs out of durable rules", () => {
    expect(() => AutomationRuleInputSchema.parse({
      id: "secret-rule",
      name: "Secret",
      target: { type: "skill", id: "example-skill", versionPolicy: "*" },
      trigger: { type: "file-change", paths: ["article/index.md"] },
      inputs: { apiKey: "should-not-persist" },
      timezone: "UTC"
    })).toThrow(/不能直接保存 Secret/);
  });
});

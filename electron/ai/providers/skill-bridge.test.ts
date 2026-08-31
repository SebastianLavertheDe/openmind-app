import { describe, expect, it } from "vitest";
import { buildProviderSkillContext, type ProviderSkillBridge } from "./skill-bridge";

function createBridge(): ProviderSkillBridge {
  return {
    id: "installed-agent",
    version: "1.0.0",
    digest: "a".repeat(64),
    packageRoot: "/packages/installed-agent",
    skillPath: "/packages/installed-agent/SKILL.md",
    instructions: "# Installed Agent\nFollow the admitted workflow.",
    referencePaths: ["references/rules.md"],
    openmindRoot: "/repo",
    capabilities: {
      openmind: { read: ["article/**"], write: ["creative/**"] },
      network: { required: false, hosts: [] },
      subprocess: { allowed: false },
      browser: false
    }
  };
}

describe("Provider Skill bridge", () => {
  it("builds the structured, non-secret capability context", () => {
    expect(buildProviderSkillContext(createBridge())).toContain("openmind_write: creative/**");
    expect(buildProviderSkillContext(createBridge())).toContain("Follow the admitted workflow.");
  });
});

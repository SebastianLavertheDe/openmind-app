import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildClaudeSkillBridgeInstructions, buildProviderSkillContext, readProviderSkillBundle, type ProviderSkillBridge } from "./skill-bridge";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function createBridge(): ProviderSkillBridge {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-provider-skill-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "references"), { recursive: true });
  fs.writeFileSync(path.join(root, "SKILL.md"), "# Installed Agent\n\nFollow the package instructions.\n");
  fs.writeFileSync(path.join(root, "references", "rules.md"), "- Keep outputs bounded.\n");
  return {
    id: "installed-agent",
    version: "1.0.0",
    digest: "a".repeat(64),
    packageRoot: root,
    skillPath: path.join(root, "SKILL.md"),
    referencePaths: ["references/rules.md"],
    openmindRoot: path.join(root, "openmind"),
    capabilities: {
      openmind: { read: ["article/**"], write: ["creative/**"] },
      network: { required: false, hosts: [] },
      subprocess: { allowed: false },
      browser: false
    }
  };
}

describe("Provider Skill bridge", () => {
  it("reads only bounded package-owned instructions and references", () => {
    const bridge = createBridge();
    expect(readProviderSkillBundle(bridge)).toEqual({
      skillText: expect.stringContaining("Installed Agent"),
      references: [{ path: "references/rules.md", text: "- Keep outputs bounded.\n" }]
    });
    expect(buildProviderSkillContext(bridge)).toContain("openmind_write: creative/**");
    expect(buildClaudeSkillBridgeInstructions(bridge)).toContain("<skill_md>");
    expect(buildClaudeSkillBridgeInstructions(bridge)).toContain("references/rules.md");
  });

  it("rejects a skill path or reference that escapes the installed package", () => {
    const bridge = createBridge();
    expect(() => readProviderSkillBundle({ ...bridge, skillPath: path.join(bridge.packageRoot, "..", "outside.md") })).toThrow(/越出/);
    expect(() => readProviderSkillBundle({ ...bridge, referencePaths: ["../outside.md"] })).toThrow(/越出/);
  });
});

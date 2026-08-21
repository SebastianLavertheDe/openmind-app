import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureClaudeAgentLink, ensureClaudeSkillAliases } from "./claude-agent-link";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-claude-link-"));
  roots.push(root);
  return root;
}

describe("Claude project Skill compatibility link", () => {
  it("links .claude to .agent idempotently", () => {
    const root = fixture();
    expect(ensureClaudeAgentLink(root).created).toBe(true);
    expect(fs.realpathSync(path.join(root, ".claude"))).toBe(fs.realpathSync(path.join(root, ".agent")));
    expect(ensureClaudeAgentLink(root).created).toBe(false);
  });

  it("preserves an existing .claude directory and keeps non-conflicting settings active", () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, ".agent", "skills"), { recursive: true });
    fs.mkdirSync(path.join(root, ".claude", "skills"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "settings.json"), "{}");

    const result = ensureClaudeAgentLink(root);

    expect(fs.existsSync(path.join(root, ".agent", "settings.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".agent", "legacy-claude", "skills"))).toBe(true);
    expect(result.legacyPath).toBe(path.join(root, ".agent", "legacy-claude"));
    expect(fs.realpathSync(path.join(root, ".claude"))).toBe(fs.realpathSync(path.join(root, ".agent")));
  });

  it("creates direct aliases for publisher-nested historical installs", () => {
    const root = fixture();
    const nested = path.join(root, "skills", "cctools", "demo");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\n");

    expect(ensureClaudeSkillAliases(path.join(root, "skills"))).toEqual([path.join(root, "skills", "demo")]);
    expect(fs.realpathSync(path.join(root, "skills", "demo"))).toBe(fs.realpathSync(nested));
  });

  it("repairs a dangling historical alias without replacing real entries", () => {
    const root = fixture();
    const skillsRoot = path.join(root, "skills");
    const nested = path.join(skillsRoot, "cctools", "demo");
    const alias = path.join(skillsRoot, "demo");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\n");
    fs.symlinkSync(path.join(root, "missing"), alias, process.platform === "win32" ? "junction" : "dir");

    expect(ensureClaudeSkillAliases(skillsRoot)).toEqual([alias]);
    expect(fs.realpathSync(alias)).toBe(fs.realpathSync(nested));
  });
});

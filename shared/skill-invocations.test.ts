import { describe, expect, it } from "vitest";
import type { SkillDefinition } from "./contracts";
import { parseSkillSlashInvocation, skillMatchScore } from "./skill-invocations";

function skill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: "rss-saver",
    title: "RSS Saver",
    description: "Saves RSS articles",
    cwd: "/skills/rss",
    command: "uv run python main.py",
    group: "ingest",
    ...overrides
  };
}

describe("parseSkillSlashInvocation", () => {
  it("parses /skill with a multi-word argument", () => {
    const out = parseSkillSlashInvocation("/rss-saver fetch --today", [skill()]);
    expect(out).not.toBeNull();
    expect(out?.skill.id).toBe("rss-saver");
    expect(out?.argument).toBe("fetch --today");
    expect(out?.raw).toBe("/rss-saver fetch --today");
  });

  it("matches case-insensitively", () => {
    expect(parseSkillSlashInvocation("/RSS-SAVER", [skill()])?.skill.id).toBe("rss-saver");
    expect(parseSkillSlashInvocation("/Rss-Saver", [skill()])?.skill.id).toBe("rss-saver");
  });

  it("returns null when the value is not a slash command", () => {
    expect(parseSkillSlashInvocation("just a prompt", [skill()])).toBeNull();
    expect(parseSkillSlashInvocation("", [skill()])).toBeNull();
    expect(parseSkillSlashInvocation("rss", [skill()])).toBeNull();
  });

  it("returns null for a slash command that does not match any skill", () => {
    expect(parseSkillSlashInvocation("/unknown-skill arg", [skill()])).toBeNull();
  });

  it("returns an empty argument when none is provided", () => {
    const out = parseSkillSlashInvocation("/rss-saver", [skill()]);
    expect(out?.argument).toBe("");
  });

  it("trims leading/trailing whitespace before parsing", () => {
    expect(parseSkillSlashInvocation("  /rss-saver arg  ", [skill()])?.argument).toBe("arg");
  });
});

describe("skillMatchScore", () => {
  it("returns 100 for an exact id match", () => {
    expect(skillMatchScore(skill(), "rss-saver")).toBe(100);
  });

  it("returns 80 when the id starts with the query", () => {
    expect(skillMatchScore(skill(), "rss")).toBe(80);
  });

  it("returns 60 when the id contains the query", () => {
    expect(skillMatchScore(skill(), "saver")).toBe(60);
  });

  it("returns 30 when the query matches title/description/group text but not the id", () => {
    expect(skillMatchScore(skill(), "articles")).toBe(30); // in description
    expect(skillMatchScore(skill(), "ingest")).toBe(30); // in group
  });

  it("returns -1 when nothing matches", () => {
    expect(skillMatchScore(skill(), "xyz")).toBe(-1);
  });

  it("returns 0 for an empty query", () => {
    expect(skillMatchScore(skill(), "")).toBe(0);
  });
});

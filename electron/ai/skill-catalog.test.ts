import { describe, expect, it } from "vitest";
import type { SkillTool } from "./skill-tool-registry";
import { composeSkillCatalog } from "./skill-catalog";

function skill(overrides: Partial<SkillTool> = {}): SkillTool {
  return {
    id: "rss",
    name: "RSS Saver",
    description: "Saves RSS articles",
    cwd: "/skills/rss",
    runner: "uv",
    args: ["run", "python", "main.py"],
    inputSchema: {},
    permission: "auto",
    outputArtifacts: [],
    timeoutMs: 60_000,
    ...overrides
  };
}

describe("composeSkillCatalog", () => {
  it("returns empty string for no skills", () => {
    expect(composeSkillCatalog([])).toBe("");
  });

  it("renders header, command per skill, and outputArtifacts when present", () => {
    const out = composeSkillCatalog([skill({ outputArtifacts: ["out/a.md", "out/b.md"] })]);
    expect(out).toContain("## 可用的 cctools skills");
    expect(out).toContain("- rss（RSS Saver）：Saves RSS articles");
    expect(out).toContain("命令：cd /skills/rss && uv run python main.py");
    expect(out).toContain("产物：out/a.md、out/b.md");
  });

  it("omits the 产物： line when there are no output artifacts (header mentions 产物, so check the artifact line specifically)", () => {
    const out = composeSkillCatalog([skill({ outputArtifacts: [] })]);
    expect(out).not.toContain("  产物：");
  });

  it("lists multiple skills in order", () => {
    const out = composeSkillCatalog([
      skill({ id: "a", name: "A" }),
      skill({ id: "b", name: "B", runner: "node", args: ["x.js"] })
    ]);
    const aIdx = out.indexOf("- a（A）");
    const bIdx = out.indexOf("- b（B）");
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(aIdx);
    expect(out).toContain("node x.js");
  });
});

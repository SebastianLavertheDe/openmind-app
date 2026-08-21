import { describe, expect, it } from "vitest";
import {
  OPENMIND_ALLOWED_TOP_LEVEL_DIRS,
  OPENMIND_APP_MANAGED_TOP_LEVEL,
  OPENMIND_CREATE_IF_NEEDED_TOP_LEVEL,
  OPENMIND_LAYOUT_V3,
  OPENMIND_LAYOUT_VERSION,
  OPENMIND_OPTIONAL_TOP_LEVEL,
  OPENMIND_WRITABLE_TOP_LEVEL_DIRS,
  findLayoutEntry
} from "./openmind-layout-v3";
import { OPENMIND_LAYOUT_V2 } from "./openmind-layout-v2";

describe("openmind-layout-v3", () => {
  it("carries v2 forward while changing the Claude/Agent Skill ownership", () => {
    for (const entry of OPENMIND_LAYOUT_V2.filter((item) => ![".claude", ".agent/skills"].includes(item.logicalPath))) {
      expect(OPENMIND_LAYOUT_V3).toContainEqual(entry);
    }
    expect(OPENMIND_LAYOUT_V3.length).toBe(OPENMIND_LAYOUT_V2.length + 10);
    expect(findLayoutEntry(".agent/skills")?.note).toContain("Flat");
    expect(findLayoutEntry(".claude")?.category).toBe("app-managed");
    expect(findLayoutEntry("assets")?.category).toBe("create-if-needed");
    expect(findLayoutEntry("config")?.category).toBe("app-managed");
    expect(findLayoutEntry(".openmind")?.category).toBe("app-managed");
    expect(findLayoutEntry(".zcode")?.category).toBe("optional-preserve-only");
    expect(findLayoutEntry("scripts")?.category).toBe("optional-preserve-only");
    expect(OPENMIND_LAYOUT_VERSION).toBe("openmind-layout-v3");
  });

  it("recognises the audited flat-root entries without making them writable", () => {
    for (const top of ["config", ".openmind", ".zcode", "scripts", "AGENTS.md", "README.md"]) {
      expect(OPENMIND_ALLOWED_TOP_LEVEL_DIRS.has(top)).toBe(true);
      expect(OPENMIND_WRITABLE_TOP_LEVEL_DIRS.has(top)).toBe(false);
    }
  });

  it("adds assets to the writable content contract", () => {
    expect(OPENMIND_WRITABLE_TOP_LEVEL_DIRS.has("assets")).toBe(true);
    expect(OPENMIND_CREATE_IF_NEEDED_TOP_LEVEL).toContain("assets");
  });

  it("keeps app-managed and tool-private tops outside the writable set", () => {
    expect(OPENMIND_APP_MANAGED_TOP_LEVEL).toEqual([".agent", ".claude", "config", ".openmind"]);
    expect(OPENMIND_WRITABLE_TOP_LEVEL_DIRS.has(".agent")).toBe(false);
    expect(OPENMIND_OPTIONAL_TOP_LEVEL).toContain(".zcode");
    expect(OPENMIND_OPTIONAL_TOP_LEVEL).toContain("scripts");
    expect(OPENMIND_OPTIONAL_TOP_LEVEL).not.toContain(".claude");
  });
});

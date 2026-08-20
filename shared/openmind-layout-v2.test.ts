import { describe, expect, it } from "vitest";
import {
  OPENMIND_ALLOWED_TOP_LEVEL_DIRS,
  OPENMIND_APP_MANAGED_TOP_LEVEL,
  OPENMIND_CREATE_IF_NEEDED_TOP_LEVEL,
  OPENMIND_LAYOUT_V2,
  OPENMIND_LAYOUT_VERSION,
  OPENMIND_WRITABLE_TOP_LEVEL_DIRS,
  findLayoutEntry
} from "./openmind-layout-v2";
import { OPENMIND_LAYOUT_V1 } from "./openmind-layout-v1";

describe("openmind-layout-v2", () => {
  it("carries every v1 entry verbatim and adds exactly the app-managed .agent structures", () => {
    expect(OPENMIND_LAYOUT_V2.slice(0, OPENMIND_LAYOUT_V1.length)).toEqual(OPENMIND_LAYOUT_V1);
    expect(OPENMIND_LAYOUT_V2.length).toBe(OPENMIND_LAYOUT_V1.length + 2);
    expect(findLayoutEntry(".agent/skills")?.category).toBe("app-managed");
    expect(findLayoutEntry(".agent/skill-data")?.category).toBe("app-managed");
    expect(OPENMIND_LAYOUT_VERSION).toBe("openmind-layout-v2");
  });

  it("knows the .agent top-level but keeps it outside the writable set", () => {
    expect(OPENMIND_ALLOWED_TOP_LEVEL_DIRS.has(".agent")).toBe(true);
    expect(OPENMIND_WRITABLE_TOP_LEVEL_DIRS.has(".agent")).toBe(false);
    // Content contract tops stay writable; tool-private tops do not.
    expect(OPENMIND_WRITABLE_TOP_LEVEL_DIRS.has("article")).toBe(true);
    expect(OPENMIND_WRITABLE_TOP_LEVEL_DIRS.has(".obsidian")).toBe(false);
    expect(OPENMIND_APP_MANAGED_TOP_LEVEL).toEqual([".agent"]);
  });

  it("does not surface .agent as create-if-needed content", () => {
    expect(OPENMIND_CREATE_IF_NEEDED_TOP_LEVEL).not.toContain(".agent");
  });
});

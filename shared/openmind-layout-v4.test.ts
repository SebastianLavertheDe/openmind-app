import { describe, expect, it } from "vitest";
import { OPENMIND_LAYOUT_V3 } from "./openmind-layout-v3";
import {
  OPENMIND_LAYOUT_VERSION_V4,
  OPENMIND_LAYOUT_V4,
  OPENMIND_V4_ALLOWED_TOP_LEVEL_DIRS,
  OPENMIND_V4_APP_MANAGED_TOP_LEVEL,
  OPENMIND_V4_WRITABLE_TOP_LEVEL_DIRS,
  findLayoutV4Entry
} from "./openmind-layout-v4";

describe("openmind layout v4", () => {
  it("adds projects without mutating the frozen v3 contract", () => {
    expect(OPENMIND_LAYOUT_VERSION_V4).toBe("openmind-layout-v4");
    expect(OPENMIND_LAYOUT_V4.slice(0, OPENMIND_LAYOUT_V3.length)).toEqual(OPENMIND_LAYOUT_V3);
    expect(findLayoutV4Entry("projects")?.category).toBe("app-managed");
  });

  it("allows ProjectService discovery but never grants generic Skill writes", () => {
    expect(OPENMIND_V4_ALLOWED_TOP_LEVEL_DIRS.has("projects")).toBe(true);
    expect(OPENMIND_V4_APP_MANAGED_TOP_LEVEL).toContain("projects");
    expect(OPENMIND_V4_WRITABLE_TOP_LEVEL_DIRS.has("projects")).toBe(false);
  });
});

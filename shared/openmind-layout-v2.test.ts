import { describe, expect, it } from "vitest";
import { OPENMIND_LAYOUT_V2 } from "./openmind-layout-v2";
import { OPENMIND_LAYOUT_V1 } from "./openmind-layout-v1";

describe("openmind-layout-v2", () => {
  it("carries every v1 entry verbatim and adds exactly the app-managed .agent structures", () => {
    expect(OPENMIND_LAYOUT_V2.slice(0, OPENMIND_LAYOUT_V1.length)).toEqual(OPENMIND_LAYOUT_V1);
    expect(OPENMIND_LAYOUT_V2.length).toBe(OPENMIND_LAYOUT_V1.length + 2);
    const byPath = new Map(OPENMIND_LAYOUT_V2.map((e) => [e.logicalPath, e.category]));
    expect(byPath.get(".agent/skills")).toBe("app-managed");
    expect(byPath.get(".agent/skill-data")).toBe("app-managed");
  });

  it("keeps .agent outside the writable (content-contract) categories", () => {
    const writable = OPENMIND_LAYOUT_V2
      .filter((e) => e.category === "initialize-required" || e.category === "create-if-needed")
      .map((e) => e.logicalPath.split("/")[0]);
    expect(writable).not.toContain(".agent");
    expect(writable).toContain("article");
    expect(writable).not.toContain(".obsidian");
  });
});

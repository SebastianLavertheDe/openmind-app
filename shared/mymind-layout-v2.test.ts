import { describe, expect, it } from "vitest";
import {
  MYMIND_ALLOWED_TOP_LEVEL_DIRS,
  MYMIND_APP_MANAGED_TOP_LEVEL,
  MYMIND_CREATE_IF_NEEDED_TOP_LEVEL,
  MYMIND_LAYOUT_V2,
  MYMIND_LAYOUT_VERSION,
  MYMIND_WRITABLE_TOP_LEVEL_DIRS,
  findLayoutEntry
} from "./mymind-layout-v2";
import { MYMIND_LAYOUT_V1 } from "./mymind-layout-v1";

describe("mymind-layout-v2", () => {
  it("carries every v1 entry verbatim and adds exactly the app-managed skill store", () => {
    expect(MYMIND_LAYOUT_V2.slice(0, MYMIND_LAYOUT_V1.length)).toEqual(MYMIND_LAYOUT_V1);
    expect(MYMIND_LAYOUT_V2.length).toBe(MYMIND_LAYOUT_V1.length + 1);
    const entry = findLayoutEntry(".agent/skills");
    expect(entry?.category).toBe("app-managed");
    expect(MYMIND_LAYOUT_VERSION).toBe("mymind-layout-v2");
  });

  it("knows the .agent top-level but keeps it outside the writable set", () => {
    expect(MYMIND_ALLOWED_TOP_LEVEL_DIRS.has(".agent")).toBe(true);
    expect(MYMIND_WRITABLE_TOP_LEVEL_DIRS.has(".agent")).toBe(false);
    // Content contract tops stay writable; tool-private tops do not.
    expect(MYMIND_WRITABLE_TOP_LEVEL_DIRS.has("article")).toBe(true);
    expect(MYMIND_WRITABLE_TOP_LEVEL_DIRS.has(".obsidian")).toBe(false);
    expect(MYMIND_APP_MANAGED_TOP_LEVEL).toEqual([".agent"]);
  });

  it("does not surface .agent as create-if-needed content", () => {
    expect(MYMIND_CREATE_IF_NEEDED_TOP_LEVEL).not.toContain(".agent");
  });
});

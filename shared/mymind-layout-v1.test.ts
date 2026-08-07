import { describe, expect, it } from "vitest";
import {
  MYMIND_ALLOWED_TOP_LEVEL_DIRS,
  MYMIND_CREATE_IF_NEEDED_TOP_LEVEL,
  MYMIND_LAYOUT_V1,
  MYMIND_LAYOUT_VERSION,
  MYMIND_OPTIONAL_TOP_LEVEL,
  findLayoutEntry,
  topLevelOf
} from "./mymind-layout-v1";

describe("mymind-layout-v1", () => {
  it("version is frozen as mymind-layout-v1", () => {
    expect(MYMIND_LAYOUT_VERSION).toBe("mymind-layout-v1");
  });

  it("includes the audited on-disk top-level content dirs", () => {
    const tops = new Set(MYMIND_LAYOUT_V1.map((e) => e.logicalPath.split("/")[0]));
    for (const expected of [
      "article",
      "creative",
      "daily-summary",
      "daily-topic",
      "post",
      "reddit",
      "wiki",
      "video"
    ]) {
      expect(tops.has(expected)).toBe(true);
    }
  });

  it("preserves the Chinese creative stage paths verbatim", () => {
    expect(findLayoutEntry("creative/01-内容生产/文稿库/02-制作中")).toBeDefined();
    expect(findLayoutEntry("creative/01-内容生产/选题管理")).toBeDefined();
  });

  it("classifies optional tool dirs as optional-preserve-only", () => {
    expect(findLayoutEntry(".claude")?.category).toBe("optional-preserve-only");
    expect(findLayoutEntry(".obsidian")?.category).toBe("optional-preserve-only");
  });

  it("create-if-needed entries are a subset of allowed top-level dirs", () => {
    for (const top of MYMIND_CREATE_IF_NEEDED_TOP_LEVEL) {
      expect(MYMIND_ALLOWED_TOP_LEVEL_DIRS.has(top)).toBe(true);
    }
  });

  it("optional top-level entries are also in the allowed set (for read classification)", () => {
    for (const top of MYMIND_OPTIONAL_TOP_LEVEL) {
      expect(MYMIND_ALLOWED_TOP_LEVEL_DIRS.has(top)).toBe(true);
    }
  });

  it("topLevelOf extracts the first path segment", () => {
    expect(topLevelOf("article/20260805/x.md")).toBe("article");
    expect(topLevelOf("daily-summary/20260805_daily_summary.md")).toBe("daily-summary");
    expect(topLevelOf("creative/01-内容生产/文稿库/02-制作中/pkg/file.md")).toBe("creative");
    expect(topLevelOf("")).toBeNull();
  });

  it("does not allow an unknown top-level dir as a write target", () => {
    expect(MYMIND_ALLOWED_TOP_LEVEL_DIRS.has("new-toplevel-not-in-contract")).toBe(false);
  });

  it("every entry has a non-empty owner and note (documentation hygiene)", () => {
    for (const e of MYMIND_LAYOUT_V1) {
      expect(e.owner.length).toBeGreaterThan(0);
      expect(e.note.length).toBeGreaterThan(0);
    }
  });
});

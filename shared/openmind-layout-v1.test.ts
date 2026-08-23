import { describe, expect, it } from "vitest";
import { OPENMIND_LAYOUT_V1 } from "./openmind-layout-v1";

describe("openmind-layout-v1", () => {
  it("includes the audited on-disk top-level content dirs", () => {
    const tops = new Set(OPENMIND_LAYOUT_V1.map((e) => e.logicalPath.split("/")[0]));
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
    const paths = new Set(OPENMIND_LAYOUT_V1.map((e) => e.logicalPath));
    expect(paths.has("creative/01-内容生产/文稿库/02-制作中")).toBe(true);
    expect(paths.has("creative/01-内容生产/选题管理")).toBe(true);
  });

  it("classifies optional tool dirs as optional-preserve-only", () => {
    const byPath = new Map(OPENMIND_LAYOUT_V1.map((e) => [e.logicalPath, e.category]));
    expect(byPath.get(".claude")).toBe("optional-preserve-only");
    expect(byPath.get(".obsidian")).toBe("optional-preserve-only");
  });

  it("every entry has a non-empty owner and note (documentation hygiene)", () => {
    for (const e of OPENMIND_LAYOUT_V1) {
      expect(e.owner.length).toBeGreaterThan(0);
      expect(e.note.length).toBeGreaterThan(0);
    }
  });
});

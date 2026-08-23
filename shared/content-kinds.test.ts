import { describe, expect, it } from "vitest";
import {
  CONTENT_DATE_ROOTS,
  CONTENT_FILE_ROOTS,
  LEGACY_CONTENT_DATE_DIRECTORY_KINDS,
  LEGACY_CONTENT_FILE_ROOT_KINDS,
  LEGACY_GET_CONTENT_ALL_KINDS,
  LEGACY_KIND_MATCHERS
} from "./content-kinds";

describe("LEGACY_KIND_MATCHERS", () => {
  it("covers the five legacy content types with substring rules", () => {
    const kinds = LEGACY_KIND_MATCHERS.map((m) => m.kind);
    expect(kinds.sort()).toEqual(["article", "post", "reddit", "summary", "topic"]);
  });

  it("uses substrings that match the plural and singular forms", () => {
    // "summar" intentionally matches both "summary" and "summaries"
    const summary = LEGACY_KIND_MATCHERS.find((m) => m.kind === "summary");
    expect(summary?.includes).toBe("summar");
    expect("summaries".includes(summary!.includes)).toBe(true);
    expect("summary".includes(summary!.includes)).toBe(true);
  });
});

describe("content roots", () => {
  it("CONTENT_DATE_ROOTS are dated-subdirectory roots", () => {
    expect(CONTENT_DATE_ROOTS).toEqual(["openmind/article", "openmind/post", "openmind/reddit"]);
  });
  it("CONTENT_FILE_ROOTS are date-in-filename roots", () => {
    expect(CONTENT_FILE_ROOTS).toEqual(["openmind/daily-summary", "openmind/daily-topic"]);
  });
});

describe("LEGACY_GET_CONTENT_ALL_KINDS", () => {
  it("keeps the plural IPC contract forms", () => {
    expect(LEGACY_GET_CONTENT_ALL_KINDS).toEqual(["articles", "reddit", "posts", "summaries", "topics"]);
  });
});

describe("LEGACY_CONTENT_DATE_DIRECTORY_KINDS / FILE_ROOT_KINDS", () => {
  it("maps reddit/posts to dated subdirectories", () => {
    expect(LEGACY_CONTENT_DATE_DIRECTORY_KINDS.reddit).toEqual(["openmind", "reddit"]);
    expect(LEGACY_CONTENT_DATE_DIRECTORY_KINDS.posts).toEqual(["openmind", "post"]);
  });
  it("maps summaries/topics to date-in-filename directories", () => {
    expect(LEGACY_CONTENT_FILE_ROOT_KINDS.summaries).toEqual(["openmind", "daily-summary"]);
    expect(LEGACY_CONTENT_FILE_ROOT_KINDS.topics).toEqual(["openmind", "daily-topic"]);
  });
});

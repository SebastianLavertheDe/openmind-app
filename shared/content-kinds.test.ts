import { describe, expect, it } from "vitest";
import type { ContentKind } from "./contracts";
import {
  CONTENT_DATE_ROOTS,
  CONTENT_FILE_ROOTS,
  CONTENT_KIND_INITIALS,
  INBOX_FILTER_KIND_ORDER,
  LEGACY_CONTENT_DATE_DIRECTORY_KINDS,
  LEGACY_CONTENT_FILE_ROOT_KINDS,
  LEGACY_GET_CONTENT_ALL_KINDS,
  LEGACY_KIND_MATCHERS
} from "./content-kinds";

const ALL_KINDS: ContentKind[] = ["article", "post", "summary", "topic", "reddit", "html", "unknown"];

describe("CONTENT_KIND_INITIALS", () => {
  it("maps every ContentKind to a single character", () => {
    for (const kind of ALL_KINDS) {
      expect(CONTENT_KIND_INITIALS[kind]).toHaveLength(1);
    }
  });
});

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
    expect(CONTENT_DATE_ROOTS).toEqual(["mymind/article", "mymind/post", "mymind/reddit"]);
  });
  it("CONTENT_FILE_ROOTS are date-in-filename roots", () => {
    expect(CONTENT_FILE_ROOTS).toEqual(["mymind/daily-summary", "mymind/daily-topic"]);
  });
});

describe("INBOX_FILTER_KIND_ORDER", () => {
  it("excludes html and unknown and lists the user-facing kinds", () => {
    expect(INBOX_FILTER_KIND_ORDER).toEqual(["article", "summary", "topic", "post", "reddit"]);
    expect(INBOX_FILTER_KIND_ORDER).not.toContain("html");
    expect(INBOX_FILTER_KIND_ORDER).not.toContain("unknown");
  });
});

describe("LEGACY_GET_CONTENT_ALL_KINDS", () => {
  it("keeps the plural IPC contract forms", () => {
    expect(LEGACY_GET_CONTENT_ALL_KINDS).toEqual(["articles", "reddit", "posts", "summaries", "topics"]);
  });
});

describe("LEGACY_CONTENT_DATE_DIRECTORY_KINDS / FILE_ROOT_KINDS", () => {
  it("maps reddit/posts to dated subdirectories", () => {
    expect(LEGACY_CONTENT_DATE_DIRECTORY_KINDS.reddit).toEqual(["mymind", "reddit"]);
    expect(LEGACY_CONTENT_DATE_DIRECTORY_KINDS.posts).toEqual(["mymind", "post"]);
  });
  it("maps summaries/topics to date-in-filename directories", () => {
    expect(LEGACY_CONTENT_FILE_ROOT_KINDS.summaries).toEqual(["mymind", "daily-summary"]);
    expect(LEGACY_CONTENT_FILE_ROOT_KINDS.topics).toEqual(["mymind", "daily-topic"]);
  });
});

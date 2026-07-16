import { describe, expect, it } from "vitest";
import type { ContentItem } from "./contracts";
import { CONTENT_SORT_COMPARATORS, contentSorter } from "./content-sort";

function item(overrides: Partial<ContentItem>): ContentItem {
  return {
    schemaVersion: 1,
    id: "id",
    path: "p",
    name: "n",
    title: "title",
    kind: "article",
    source: "src",
    author: null,
    originalUrl: null,
    publishedAt: null,
    capturedAt: "2026-07-07T00:00:00.000Z",
    modifiedAt: "2026-07-07T00:00:00.000Z",
    size: 0,
    excerpt: "",
    state: { read: false, starred: false, score: null, tags: [], lastViewedAt: null },
    ...overrides
  } as ContentItem;
}

describe("contentSorter", () => {
  it("returns the comparator registered for the given sort key", () => {
    expect(contentSorter("newest")).toBe(CONTENT_SORT_COMPARATORS.newest);
    expect(contentSorter("score")).toBe(CONTENT_SORT_COMPARATORS.score);
  });
});

describe("CONTENT_SORT_COMPARATORS", () => {
  const a = item({ id: "a", title: "苹果", source: "知乎", modifiedAt: "2026-07-03T00:00:00.000Z", state: { read: false, starred: false, score: 50, tags: [], lastViewedAt: null } });
  const b = item({ id: "b", title: "香蕉", source: "微博", modifiedAt: "2026-07-05T00:00:00.000Z", state: { read: false, starred: false, score: 80, tags: [], lastViewedAt: null } });

  it("newest sorts by modifiedAt descending", () => {
    const sorted = [a, b].sort(CONTENT_SORT_COMPARATORS.newest);
    expect(sorted.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("oldest sorts by modifiedAt ascending", () => {
    const sorted = [b, a].sort(CONTENT_SORT_COMPARATORS.oldest);
    expect(sorted.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("title sorts by locale-aware title ascending", () => {
    const sorted = [b, a].sort(CONTENT_SORT_COMPARATORS.title);
    expect(sorted.map((i) => i.title)).toEqual(["苹果", "香蕉"]);
  });

  it("score sorts by score descending, breaking ties by modifiedAt desc", () => {
    expect([a, b].sort(CONTENT_SORT_COMPARATORS.score).map((i) => i.id)).toEqual(["b", "a"]); // b has higher score
    // tie on score → newest first
    const tie1 = item({ id: "t1", modifiedAt: "2026-07-01T00:00:00.000Z", state: { read: false, starred: false, score: 50, tags: [], lastViewedAt: null } });
    const tie2 = item({ id: "t2", modifiedAt: "2026-07-09T00:00:00.000Z", state: { read: false, starred: false, score: 50, tags: [], lastViewedAt: null } });
    expect([tie1, tie2].sort(CONTENT_SORT_COMPARATORS.score).map((i) => i.id)).toEqual(["t2", "t1"]);
  });

  it("score treats null score as 0", () => {
    const nullScore = item({ id: "null", modifiedAt: "2026-07-09T00:00:00.000Z", state: { read: false, starred: false, score: null, tags: [], lastViewedAt: null } });
    const zero = item({ id: "zero", modifiedAt: "2026-07-01T00:00:00.000Z", state: { read: false, starred: false, score: 0, tags: [], lastViewedAt: null } });
    // both score 0 → newest first (null is 07-09)
    expect([zero, nullScore].sort(CONTENT_SORT_COMPARATORS.score).map((i) => i.id)).toEqual(["null", "zero"]);
  });

  it("source sorts by locale-aware source ascending, breaking ties by modifiedAt desc", () => {
    expect([a, b].sort(CONTENT_SORT_COMPARATORS.source).map((i) => i.source)).toEqual(["微博", "知乎"]);
  });
});

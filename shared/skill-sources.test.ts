import { describe, expect, it } from "vitest";
import { parseSkillSources, parseSkillToSourceId } from "./skill-sources";

describe("skill-sources", () => {
  it("derives bindings from surfacesAsSource on skill manifest entries", () => {
    const sources = parseSkillSources([
      { id: "x-following-fetcher", surfacesAsSource: { sourceId: "x-following", sourceName: "X", kind: "x", artifactRoot: "mymind/post" } },
      { id: "rss-article-saver" }
    ]);
    expect(sources).toEqual([
      { skillId: "x-following-fetcher", sourceId: "x-following", sourceName: "X", kind: "x", artifactRoot: "mymind/post" }
    ]);
    expect(parseSkillToSourceId(sources)).toEqual({ "x-following-fetcher": "x-following" });
  });
});

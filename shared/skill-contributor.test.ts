import { describe, expect, it } from "vitest";
import { SkillContributorProfileUrlSchema, SkillContributorSchema } from "./skill-contributor";
import { AuthoredSkillContributorSchema } from "./skill-library";

describe("Skill contributor homepages", () => {
  it.each([
    ["https://github.com/yang0", "https://github.com/yang0"],
    [" https://www.GitHub.com/A-B/ ", "https://github.com/A-B"],
    ["https://x.com/author_01/", "https://x.com/author_01"],
    ["https://www.x.com/a", "https://x.com/a"]
  ])("normalizes an account homepage: %s", (input, expected) => {
    expect(SkillContributorProfileUrlSchema.parse(input)).toBe(expected);
    expect(AuthoredSkillContributorSchema.parse({ nick: "Author", profileUrl: input }).profileUrl).toBe(expected);
  });

  it.each([
    "https://example.com/author", "https://twitter.com/author", "http://github.com/yang0", "javascript:alert(1)",
    "https://github.com.evil.test/yang0", "https://x.com@evil.test/author", "https://evil.test@github.com/yang0",
    "https://github.com:8443/yang0", "https://api.github.com/yang0", "//github.com/yang0",
    "https://github.com/yang0/handraw-style", "https://x.com/author/status/123", "https://x.com/author/photo",
    "https://github.com/", "https://x.com/", "https://github.com/settings", "https://github.com/LOGIN/", "https://x.com/home", "https://x.com/i",
    "https://github.com/yang0?tab=repositories", "https://x.com/author#bio", "https://github.com/yang0?",
    "https://github.com/%79ang0", "https://github.com/a/../yang0", "https://github.com\\@evil.test/yang0", "https://git\nhub.com/yang0",
    "https://github.com/a--b", "https://github.com/-author", "https://github.com/author_01", `https://github.com/${"a".repeat(40)}`,
    "https://x.com/author-name", `https://x.com/${"a".repeat(16)}`
  ])("rejects unsupported or non-profile URLs at both configuration boundaries: %s", profileUrl => {
    expect(SkillContributorSchema.safeParse({ nick: "Author", profileUrl }).success).toBe(false);
    expect(AuthoredSkillContributorSchema.safeParse({ nick: "Author", profileUrl }).success).toBe(false);
  });

  it("keeps legacy contributor metadata valid without a homepage", () => {
    expect(SkillContributorSchema.parse({ nick: "Author" })).toEqual({ nick: "Author" });
    expect(AuthoredSkillContributorSchema.parse({ nick: "" })).toEqual({ nick: "" });
  });
});

import { describe, expect, it } from "vitest";
import { resolveDocumentFileLink } from "./document-file-links";

const brief = "openmind/daily-summary/20261101_daily_summary.md";

describe("document file links", () => {
  it.each([
    ["../article/20261101/rss-example.md", "openmind/article/20261101/rss-example.md"],
    ["..\\article\\20261101\\rss-example.md", "openmind/article/20261101/rss-example.md"],
    ["..%5Carticle%5C20261101%5Crss-example.md", "openmind/article/20261101/rss-example.md"],
    ["../article/20261101/source%20file.md#section", "openmind/article/20261101/source file.md"],
    ["./companion.md", "openmind/daily-summary/companion.md"],
    ["openmind/article/20261101/source.md", "openmind/article/20261101/source.md"],
    ["D:\\work\\openmind\\article\\source.md", "D:/work/openmind/article/source.md"],
    ["file:///D:/work/openmind/article/source%20file.md", "D:/work/openmind/article/source file.md"],
    ["file:///tmp/source.md", "/tmp/source.md"]
  ])("resolves %s against the document location", (href, expected) => {
    expect(resolveDocumentFileLink(href, brief)).toBe(expected);
  });

  it.each(["#heading", "https://example.com/source.md", "//example.com/source.md", "mailto:a@example.com", "javascript:source.md", "data:text/plain,source.md", "file://server/share/source.md", "../../outside.md", "../source%00.md", "../invalid%.md"])("does not route %s to the local file viewer", href => {
    expect(resolveDocumentFileLink(href, brief)).toBeNull();
  });
});

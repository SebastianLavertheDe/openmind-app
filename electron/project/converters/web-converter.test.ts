import { describe, expect, it } from "vitest";
import { extractWebPageMarkdown } from "./web-extract";

describe("Project web material conversion", () => {
  it("extracts readable Markdown and strips executable HTML", () => {
    const result = extractWebPageMarkdown(`<!doctype html>
      <html><head><title>Research Note</title><script>alert(1)</script></head>
      <body><article>
        <h1>Research Note</h1>
        <p>This is a sufficiently long article paragraph with useful project reference material.</p>
        <a href="/source">Source link</a>
        <img src="javascript:alert(1)" onerror="alert(2)">
        <img src="https://tracker.example/pixel.png" alt="tracking pixel">
        <iframe src="https://evil.example"></iframe>
      </article></body></html>`, "https://example.com/articles/one");

    expect(result.title).toBe("Research Note");
    expect(result.markdown).toContain("https://example.com/source");
    expect(result.markdown).toContain("useful project reference material");
    expect(result.markdown).not.toMatch(/script|iframe|javascript:|onerror/i);
    expect(result.markdown).not.toMatch(/tracker\.example|tracking pixel/i);
  });
});

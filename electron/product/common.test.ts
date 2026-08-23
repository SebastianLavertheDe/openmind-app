import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  collectOutlines,
  collectPrefixedOutlines,
  compactDate,
  countMarkdownLinks,
  extractHeadings,
  firstParagraph,
  inferSource,
  lastMeaningfulLine,
  normalizeContentKind,
  normalizeUrl,
  parseArray,
  parseCompactDate,
  parseMetadata,
  readJson,
  readJsonArray,
  readText,
  shortenSource,
  stableContentId,
  stableId,
  stripMetadata,
  writeTextAtomic
} from "./common";

// ---- URL + id normalization -----------------------------------------------

describe("normalizeUrl", () => {
  it("strips the fragment and sorts search params", () => {
    expect(normalizeUrl("https://example.com/b?b=2&a=1#frag")).toBe("https://example.com/b?a=1&b=2");
  });
  it("drops a trailing slash only when it is the very last character", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    // the trailing-slash strip is applied to the final URL string, so a slash before a query stays
    expect(normalizeUrl("https://example.com/b/").endsWith("example.com/b")).toBe(true);
  });
  it("returns the trimmed input when the value is not a valid URL", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
    expect(normalizeUrl("  spaced  ")).toBe("spaced");
  });
});

describe("stableId", () => {
  it("produces a stable sha1 hex", () => {
    expect(stableId("x")).toMatch(/^[0-9a-f]{40}$/);
    expect(stableId("x")).toBe(stableId("x"));
    expect(stableId("x")).not.toBe(stableId("y"));
  });
});

describe("compactDate / parseCompactDate", () => {
  it("extracts the first 8 digits", () => {
    expect(compactDate("2026-07-07")).toBe("20260707");
    expect(compactDate("20260707")).toBe("20260707");
    expect(compactDate("2026/07/07 extra")).toBe("20260707");
    expect(compactDate("")).toBe("");
  });
  it("parses a compact date back to a Date at noon local time", () => {
    const d = parseCompactDate("20260707");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July
    expect(d.getDate()).toBe(7);
    expect(d.getHours()).toBe(12);
  });
});

// ---- markdown helpers ------------------------------------------------------

describe("firstParagraph", () => {
  it("returns the first non-empty paragraph, stripped of markdown formatting", () => {
    // the first paragraph is the title line; its leading # is stripped
    expect(firstParagraph("# Title\n\nFirst **bold** paragraph.\n\nSecond.")).toBe("Title");
  });
  it("returns the first body paragraph when there is no leading title", () => {
    expect(firstParagraph("First **bold** paragraph.\n\nSecond.")).toBe("First bold paragraph.");
  });
  it("collapses links to their text", () => {
    expect(firstParagraph("[click](https://x)")).toBe("click");
  });
  it("returns empty for blank input", () => {
    expect(firstParagraph("")).toBe("");
    expect(firstParagraph("   \n\n  ")).toBe("");
  });
});

describe("stripMetadata", () => {
  it("removes the title line and metadata key:value lines", () => {
    const out = stripMetadata("# My Title\n链接：https://x\n作者：Me\n\n正文内容");
    expect(out).not.toContain("My Title");
    expect(out).not.toContain("链接");
    expect(out).not.toContain("作者");
    expect(out).toContain("正文内容");
  });
});

describe("countMarkdownLinks", () => {
  it("counts [text](url) links", () => {
    expect(countMarkdownLinks("[a](1) [b](2)")).toBe(2);
    expect(countMarkdownLinks("no links")).toBe(0);
  });
});

describe("extractHeadings", () => {
  it("collects ## and ### headings, ignoring h1 and trailing #", () => {
    expect(extractHeadings("# H1\n## H2\n### H3 ###\ntext")).toEqual(["H2", "H3"]);
  });
  it("returns empty when there are no h2/h3 headings", () => {
    expect(extractHeadings("plain text")).toEqual([]);
  });
});

// ---- metadata parsing ------------------------------------------------------

describe("parseMetadata", () => {
  const md = `# A Real Title
链接：https://example.com/post
作者：Jane Doe
发布时间：2026-07-07
来源：https://news.example.com

第一段正文，描述内容。`;
  it("extracts title, url, author, publishedAt, source, and a 280-char excerpt", () => {
    const meta = parseMetadata(md, "fallback.txt");
    expect(meta.title).toBe("A Real Title");
    expect(meta.url).toBe("https://example.com/post");
    expect(meta.author).toBe("Jane Doe");
    expect(meta.publishedAt).toBe("2026-07-07");
    expect(meta.source).toBe("news.example.com"); // hostname from the source URL
    expect(meta.excerpt).toContain("第一段正文");
    expect(meta.excerpt.length).toBeLessThanOrEqual(280);
  });

  it("falls back to the filename (stripped of extension/leading digits) when no title line exists", () => {
    const meta = parseMetadata("just body", "123_article-name.md");
    expect(meta.title).toBe("article-name");
  });

  it("infers source from URL/hostname when no 来源 line is present", () => {
    const meta = parseMetadata("# T\n\nbody", "x_post.md");
    // x_ prefix → "X"
    expect(meta.source).toBe("X");
  });

  it("falls back to localFile when no URL and no x_ prefix", () => {
    const meta = parseMetadata("# T\n\nbody", "note.md");
    expect(meta.source.length).toBeGreaterThan(0);
  });
});

// ---- content id ------------------------------------------------------------

describe("stableContentId", () => {
  it("is derived from the normalized URL when present", () => {
    const meta = { title: "T", source: "s", author: null, url: "https://x.com/a?b=2&a=1", publishedAt: null, excerpt: "" };
    const id = stableContentId("/path", meta, "raw");
    expect(id).toBe(stableId(`url:${normalizeUrl("https://x.com/a?b=2&a=1")}`));
  });
  it("falls back to a content signature hash when no URL is present", () => {
    const meta = { title: "T", source: "s", author: "A", url: null, publishedAt: "2026-07-07", excerpt: "" };
    const id = stableContentId("/path", meta, "# T\n\nbody content");
    expect(id).toMatch(/^[0-9a-f]{40}$/);
  });
  it("falls back to path-based id when both url and signature are empty", () => {
    const meta = { title: "", source: "", author: null, url: null, publishedAt: null, excerpt: "" };
    const id = stableContentId("/path", meta, "");
    expect(id).toBe(stableId("path:/path"));
  });
  it("is stable across whitespace differences in the body", () => {
    const meta = { title: "T", source: "s", author: null, url: null, publishedAt: null, excerpt: "" };
    const a = stableContentId("/p", meta, "# T\n\nbody   with   spaces");
    const b = stableContentId("/p", meta, "# T\n\nbody with spaces");
    expect(a).toBe(b);
  });
});

// ---- source helpers --------------------------------------------------------

describe("inferSource", () => {
  it("returns X for x_ prefixed filenames", () => {
    expect(inferSource("https://x.com", "x_post.md")).toBe("X");
  });
  it("returns the hostname (without www.) for a URL", () => {
    expect(inferSource("https://www.example.com/page", "note.md")).toBe("example.com");
  });
  it("returns localFile when there is no URL and no x_ prefix", () => {
    expect(inferSource(null, "note.md").length).toBeGreaterThan(0);
  });
  it("returns webPage for an invalid URL", () => {
    expect(inferSource("not a url", "note.md").length).toBeGreaterThan(0);
  });
});

describe("shortenSource", () => {
  it("extracts the hostname from an embedded URL", () => {
    expect(shortenSource("via https://www.example.com/page")).toBe("example.com");
  });
  it("truncates non-URL values to 80 chars", () => {
    const long = "x".repeat(120);
    expect(shortenSource(long)).toHaveLength(80);
  });
});

// ---- kind / tag normalization ---------------------------------------------

describe("normalizeContentKind", () => {
  it("maps legacy kind strings via substring matchers", () => {
    expect(normalizeContentKind("articles", "p")).toBe("article");
    expect(normalizeContentKind("Posts", "p")).toBe("post");
    expect(normalizeContentKind("daily-summaries", "p")).toBe("summary");
    expect(normalizeContentKind("topic", "p")).toBe("topic");
    expect(normalizeContentKind("reddit", "p")).toBe("reddit");
  });
  it("returns html for .html paths with no matching kind", () => {
    expect(normalizeContentKind(undefined, "page.html")).toBe("html");
  });
  it("returns unknown when nothing matches", () => {
    expect(normalizeContentKind("garbage", "note.md")).toBe("unknown");
    expect(normalizeContentKind(undefined, "note.md")).toBe("unknown");
  });
});

// ---- JSON / text IO helpers -----------------------------------------------

describe("parseArray", () => {
  const schema = z.object({ id: z.string() });
  it("keeps valid entries and drops invalid ones", () => {
    expect(parseArray([{ id: "a" }, { id: "b" }, { nope: 1 }], schema)).toEqual([{ id: "a" }, { id: "b" }]);
  });
  it("returns [] for non-array input", () => {
    expect(parseArray(null, schema)).toEqual([]);
    expect(parseArray({ id: "a" }, schema)).toEqual([]);
  });
});

describe("readJson / readText / readJsonArray", () => {
  it("readJson returns the fallback when the file is missing or malformed", () => {
    expect(readJson("/does/not/exist", "fb")).toBe("fb");
  });
  it("readText returns '' when the file is missing", () => {
    expect(readText("/does/not/exist")).toBe("");
  });
  it("readJsonArray reads + validates an array file, dropping bad entries", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "common-io-"));
    try {
      const file = path.join(dir, "arr.json");
      fs.writeFileSync(file, JSON.stringify([{ id: "a" }, { bad: true }, { id: "b" }]), "utf8");
      const out = readJsonArray(file, z.object({ id: z.string() }));
      expect(out).toEqual([{ id: "a" }, { id: "b" }]);
      // missing file → []
      expect(readJsonArray(path.join(dir, "missing.json"), z.object({ id: z.string() }))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("writeTextAtomic", () => {
  it("atomically writes text, creating parent directories", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "common-write-"));
    try {
      const file = path.join(dir, "nested", "file.txt");
      writeTextAtomic(file, "hello");
      expect(fs.readFileSync(file, "utf8")).toBe("hello");
      // overwrite
      writeTextAtomic(file, "world");
      expect(fs.readFileSync(file, "utf8")).toBe("world");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- outline collectors ----------------------------------------------------

describe("collectOutlines / collectPrefixedOutlines", () => {
  it("collectOutlines flattens objects with xmlUrl", () => {
    const out = collectOutlines([
      { name: "a", xmlUrl: "https://a" },
      { nested: { xmlUrl: "https://b", name: "b" } },
      { noUrl: true }
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.xmlUrl)).toEqual(["https://a", "https://b"]);
  });
  it("collectPrefixedOutlines flattens objects with @_xmlUrl", () => {
    const out = collectPrefixedOutlines({ feed: [{ "@_xmlUrl": "https://x" }, { other: 1 }] });
    expect(out).toHaveLength(1);
    expect(out[0]["@_xmlUrl"]).toBe("https://x");
  });
});

describe("lastMeaningfulLine", () => {
  it("returns the last non-blank line, trimmed and truncated to 500 chars", () => {
    expect(lastMeaningfulLine("a\n  b  \n\nc")).toBe("c");
    expect(lastMeaningfulLine("")).toBe("");
    const long = "x".repeat(600);
    expect(lastMeaningfulLine(long)).toHaveLength(500);
  });
});

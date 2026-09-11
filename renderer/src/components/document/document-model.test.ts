import { describe, expect, it } from "vitest";
import { buildReadingDocument, DOCUMENT_BLOCK_CHARACTERS, findDocumentMatches } from "./document-model";
import { buildPlainDocument } from "./plain-document";
import type { Element, RootContent } from "hast";

function elements(node: RootContent, tag: string): Element[] {
  return node.type === "element" ? [...(node.tagName === tag ? [node] : []), ...node.children.flatMap(child => elements(child, tag))] : [];
}
describe("reading document model", () => {
  it("bounds huge individual paragraphs and preserves all text and Unicode", () => {
    const source = "中文😀".repeat(10000);
    const doc = buildReadingDocument(source);
    expect(doc.blocks.length).toBeGreaterThan(30);
    expect(doc.blocks.every(block => block.text.length <= DOCUMENT_BLOCK_CHARACTERS)).toBe(true);
    expect(doc.text).toBe(source);
    for (const block of doc.blocks) expect(block.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
  });
  it("parses references once for the whole document, not independently per block", () => {
    const doc = buildReadingDocument(`[link][target]\n\n${"paragraph\n\n".repeat(100)}[target]: https://example.com`);
    expect(elements(doc.blocks[0].tree.children[0], "a")[0].properties.href).toBe("https://example.com");
  });
  it("indexes offscreen footnote targets and back references", () => {
    const doc = buildReadingDocument(`a[^note]\n\n${"paragraph\n\n".repeat(100)}[^note]: footnote`);
    expect(doc.anchors["user-content-fn-note"]).toBeGreaterThan(99);
    expect(doc.anchors["user-content-fnref-note"]).toBe(0);
  });
  it("preserves table columns across long cells and many rows", () => {
    const doc = buildReadingDocument(`| A | B |\n|---|---|\n${Array.from({ length: 200 }, (_, i) => `| ${"x".repeat(i === 0 ? 5000 : 20)} | unique${i} |`).join("\n")}`);
    expect(doc.blocks.length).toBeGreaterThan(200);
    for (const block of doc.blocks) {
      const rows = elements(block.tree.children[0], "tr");
      for (const row of rows) expect(row.children.filter(child => child.type === "element")).toHaveLength(2);
    }
    expect(findDocumentMatches(doc, "unique199")).toHaveLength(1);
    expect(doc.text.match(/x/g)).toHaveLength(5000 + 199 * 20);
  });
  it("retains ordered list numbering when splitting lists", () => {
    const doc = buildReadingDocument(Array.from({ length: 100 }, (_, i) => `${i + 3}. ${"item ".repeat(30)}`).join("\n"));
    const items = doc.blocks.flatMap(block => block.tree.children.flatMap(child => elements(child, "li")));
    expect(items.map(item => item.properties.value)).toEqual(Array.from({ length: 100 }, (_, i) => i + 3));
  });
  it("finds literal queries and keeps offsets after case-folding-sensitive characters", () => {
    const doc = buildReadingDocument("İ😀 literal [x] End");
    const matches = findDocumentMatches(doc, "end");
    expect(doc.text.slice(matches[0].start, matches[0].end)).toBe("End");
    expect(findDocumentMatches(doc, "[x]")).toHaveLength(1);
    expect(findDocumentMatches(doc, "")).toEqual([]);
  });
  it("does not preserve executable links or raw HTML", () => {
    const doc = buildReadingDocument("[bad](javascript:alert%281%29)\n\n<script>alert(1)</script>");
    expect(JSON.stringify(doc)).not.toContain("javascript:");
    expect(doc.text).not.toContain("alert(1)");
  });
  it("keeps math trees intact", () => {
    const doc = buildReadingDocument(`$$${Array.from({ length: 60 }, () => "\\frac{x}{y}").join("+")}$$`, true);
    expect(doc.blocks.flatMap(block => block.tree.children.flatMap(child => elements(child, "math")))).toHaveLength(1);
  });
  it("keeps one complete copy source for a split code block", () => {
    const source = "const value = 1;\n".repeat(300);
    const doc = buildReadingDocument(`\`\`\`js\n${source}\`\`\``);
    expect(doc.blocks.length).toBeGreaterThan(1);
    expect(Object.values(doc.code)).toEqual([source]);
    for (const block of doc.blocks) expect(elements(block.tree.children[0], "pre")[0].properties.dataDocumentCodeId).toBe("0");
  });
  it("includes safe image-link labels in the same offset space as rendered text", () => {
    const doc = buildReadingDocument("before ![image label](https://example.com/image.png) after");
    expect(doc.text).toBe("before image label after");
    expect(elements(doc.blocks[0].tree.children[0], "img")).toEqual([]);
  });
  it("incrementally appends plain text without rebuilding sealed blocks", () => {
    const first = buildPlainDocument("abc\n".repeat(3000));
    const second = buildPlainDocument(first.text + "😀 tail", first);
    expect(second.blocks[0]).toBe(first.blocks[0]);
    expect(second.blocks.map(block => block.text).join("")).toBe(second.text);
    expect(buildPlainDocument("replacement", second).text).toBe("replacement");
  });
});

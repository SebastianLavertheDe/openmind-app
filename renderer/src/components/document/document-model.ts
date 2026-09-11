import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import type { Element, Root, RootContent } from "hast";
import type { DocumentBlock, DocumentMatch, ReadingDocument } from "@shared/document-view";
import { normalizeMarkdownTables, remarkCjkSpacing } from "../markdown-normalize";

// Budgets apply to a single block as well as to the viewport. Otherwise a
// one-megabyte paragraph or one huge table defeats top-level virtualization.
export const DOCUMENT_BLOCK_CHARACTERS = 1_024;
const BLOCK_NODES = 96;
export const ASYNC_DOCUMENT_CHARACTERS = 16_384;

function textOf(node: RootContent): string {
  return node.type === "text" ? node.value : node.type === "element" ? node.children.map(textOf).join("") : "";
}
function cost(node: RootContent): number {
  return 1 + (node.type === "element" ? node.children.reduce((sum, child) => sum + cost(child), 0) : 0);
}
function wrap(node: Element, children: RootContent[]): Element {
  return { ...node, children: children.filter((child): child is Element["children"][number] => child.type !== "doctype") };
}

function splitNode(node: RootContent, budget = DOCUMENT_BLOCK_CHARACTERS): RootContent[] {
  if (node.type === "text") {
    const pieces: RootContent[] = [];
    let rest = node.value;
    while (rest.length > budget) {
      let end = budget;
      const boundary = Math.max(rest.lastIndexOf("\n", end - 1), rest.lastIndexOf(" ", end - 1));
      if (boundary > end / 2) end = boundary + 1;
      if (/^[\uDC00-\uDFFF]$/.test(rest[end])) end--;
      pieces.push({ type: "text", value: rest.slice(0, end) });
      rest = rest.slice(end);
    }
    if (rest) pieces.push({ type: "text", value: rest });
    return pieces;
  }
  if (node.type !== "element") return [];
  // KaTeX output is an atomic, non-wrapping layout, not a paragraph. Splitting
  // its accessibility/visual trees would corrupt both the formula and offsets.
  const classes = node.properties.className;
  if (Array.isArray(classes) && classes.some(value => value === "katex" || value === "katex-display")) return [node];
  if (node.tagName === "ol") {
    let ordinal = Number(node.properties.start) || 1;
    node.children.forEach(child => { if (child.type === "element" && child.tagName === "li") {
      child.properties.value = ordinal++;
    } });
  }
  if (node.tagName === "table") {
    const head = node.children.find((child): child is Element => child.type === "element" && child.tagName === "thead");
    const body = node.children.find((child): child is Element => child.type === "element" && child.tagName === "tbody");
    if (body && (textOf(node).length > budget || cost(node) > BLOCK_NODES)) {
      // Preserve columns even when one cell spans thousands of characters.
      // Only the first group owns the header, so full-text copy has no repeats.
      return body.children.filter((child): child is Element => child.type === "element").flatMap((row, index) => {
        const cells = row.children.filter((child): child is Element => child.type === "element");
        const parts = cells.map(cell => splitNode(cell, Math.max(32, Math.floor(budget / Math.max(1, cells.length)))));
        return Array.from({ length: Math.max(1, ...parts.map(part => part.length)) }, (_, part) => wrap(node,
          [...(head && index === 0 && part === 0 ? [head] : []), wrap(body, [wrap(row, cells.map((cell, column) => parts[column][part] || wrap(cell, [])))])]));
      });
    }
  }
  if (textOf(node).length <= budget && cost(node) <= BLOCK_NODES) return [node];
  const result: RootContent[] = [];
  let children: RootContent[] = [];
  let chars = 0, nodes = 0;
  for (const child of node.children.flatMap(child => splitNode(child, budget))) {
    const length = textOf(child).length, count = cost(child);
    if (children.length && (chars + length > budget || nodes + count > BLOCK_NODES)) {
      result.push(wrap(node, children)); children = []; chars = 0; nodes = 0;
    }
    children.push(child); chars += length; nodes += count;
  }
  if (children.length) result.push(wrap(node, children));
  return result.length ? result : [node];
}

function safeTree(node: RootContent): void {
  if (node.type !== "element") return;
  for (const key of ["href", "src"]) {
    const value = node.properties[key];
    if (typeof value !== "string") continue;
    const compact = value.replace(/[\u0000-\u0020]/g, "");
    if (/^[a-z][a-z\d+.-]*:/i.test(compact) && !/^(https?:|mailto:|data:image\/(png|gif|jpe?g|webp|avif);base64,)/i.test(compact)) delete node.properties[key];
  }
  if (node.tagName === "img" && !/^data:image\/(png|gif|jpe?g|webp|avif);base64,/i.test(String(node.properties.src || ""))) {
    const src = node.properties.src;
    const label = String(node.properties.alt || (src ? "远程图片（未自动加载）" : "图片"));
    // Model the safe link's actual text, so image labels do not shift selection
    // offsets for all subsequent text in the same paragraph.
    node.tagName = src ? "a" : "span";
    node.properties = src ? { href: src } : {};
    node.children = [{ type: "text", value: label }];
  }
  node.children.forEach(safeTree);
}

export function buildReadingDocument(content: string, math = false): ReadingDocument {
  const parser = unified().use(remarkParse).use(remarkGfm);
  if (math) parser.use(remarkMath);
  else parser.use(remarkCjkSpacing);
  parser.use(remarkRehype);
  if (math) parser.use(rehypeKatex).use(rehypeHighlight);
  const tree = parser.runSync(parser.parse(normalizeMarkdownTables(content))) as Root;
  const blocks: DocumentBlock[] = [];
  const headings: ReadingDocument["headings"] = [];
  const anchors: Record<string, number> = Object.create(null);
  const code: Record<string, string> = Object.create(null);
  let codeIndex = 0;
  const indexCode = (node: RootContent) => {
    if (node.type !== "element") return;
    if (node.tagName === "pre") {
      const id = String(codeIndex++);
      node.properties.dataDocumentCodeId = id;
      code[id] = textOf(node);
    }
    node.children.forEach(indexCode);
  };
  tree.children.forEach(indexCode);
  const allText: string[] = [];
  let offset = 0;
  for (const [section, node] of tree.children.entries()) {
    if (node.type === "text" && !node.value.trim()) continue;
    safeTree(node);
    if (node.type === "element" && /^h[1-6]$/.test(node.tagName)) {
      const title = textOf(node);
      const id = String(node.properties.id || title.trim().toLowerCase().replace(/\s+/g, "-"));
      node.properties.id = id;
      headings.push({ id, title, block: blocks.length });
    }
    const parts = splitNode(node);
    for (const [part, piece] of parts.entries()) {
      const recordAnchors = (element: RootContent) => {
        if (element.type !== "element") return;
        const id = element.properties.id;
        if (typeof id === "string" && !Object.hasOwn(anchors, id)) anchors[id] = blocks.length;
        element.children.forEach(recordAnchors);
      };
      recordAnchors(piece);
      const value = textOf(piece);
      const separator = blocks.length && part === 0 ? "\n\n" : "";
      allText.push(separator, value); offset += separator.length;
      blocks.push({ id: `${section}:${part}`, tree: { type: "root", children: [piece] }, text: value, start: offset,
        kind: piece.type === "element" ? piece.tagName : "text", continuation: part > 0 });
      offset += value.length;
    }
  }
  return { blocks, text: allText.join(""), headings, anchors, code };
}

export function findDocumentMatches(document: ReadingDocument, query: string): DocumentMatch[] {
  if (!query) return [];
  const result: DocumentMatch[] = [];
  // RegExp preserves original UTF-16 offsets (lowercasing the haystack does not,
  // e.g. capital dotted I expands to two code points).
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  let block = 0;
  for (const match of document.text.matchAll(pattern)) {
    const start = match.index;
    while (block + 1 < document.blocks.length && document.blocks[block + 1].start <= start) block++;
    result.push({ start, end: start + match[0].length, block });
  }
  return result;
}

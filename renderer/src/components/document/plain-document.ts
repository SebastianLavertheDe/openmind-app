import type { ReadingDocument } from "@shared/document-view";
import { DOCUMENT_BLOCK_CHARACTERS } from "./document-model";

/** Streaming text seals completed blocks. Appending only rebuilds the tail;
 * previous AST blocks remain referentially stable for the virtual renderer. */
export function buildPlainDocument(content: string, previous?: ReadingDocument | null): ReadingDocument {
  const blocks = previous && content.startsWith(previous.text) ? previous.blocks.slice(0, -1) : [];
  let start = blocks.length ? blocks.at(-1)!.start + blocks.at(-1)!.text.length : 0;
  while (start < content.length) {
    let end = Math.min(content.length, start + DOCUMENT_BLOCK_CHARACTERS);
    if (end < content.length) {
      const boundary = Math.max(content.lastIndexOf("\n", end - 1), content.lastIndexOf(" ", end - 1));
      if (boundary > start + DOCUMENT_BLOCK_CHARACTERS / 2) end = boundary + 1;
      if (/^[\uDC00-\uDFFF]$/.test(content[end])) end--;
    }
    const text = content.slice(start, end);
    blocks.push({ id: String(start), start, text, continuation: start > 0, kind: "plain",
      tree: { type: "root", children: [{ type: "text", value: text }] } });
    start = end;
  }
  return { blocks, text: content, headings: [], anchors: {}, code: {} };
}

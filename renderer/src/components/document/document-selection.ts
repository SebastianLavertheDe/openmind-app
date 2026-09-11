import type { ReadingDocument } from "@shared/document-view";

const models = new WeakMap<HTMLElement, ReadingDocument>();
export function registerReadingDocument(element: HTMLElement, model: ReadingDocument): () => void {
  models.set(element, model);
  return () => { models.delete(element); };
}

export function documentPoint(node: Node | null, offset: number): { host: HTMLElement; index: number; offset: number } | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const block = element?.closest<HTMLElement>("[data-document-block]");
  const host = block?.closest<HTMLElement>("[data-reading-document]");
  if (!node || !block || !host || !models.has(host)) return null;
  try {
    const range = document.createRange();
    range.selectNodeContents(block); range.setEnd(node, offset);
    return { host, index: Number(block.dataset.documentBlock), offset: range.toString().length };
  } catch { return null; }
}

/** Resolve text from the model, including blocks which are not mounted in DOM. */
export function readingSelectionText(selection: Selection | null, within?: HTMLElement): string | null {
  if (!selection || selection.isCollapsed) return null;
  const anchor = documentPoint(selection.anchorNode, selection.anchorOffset);
  const focus = documentPoint(selection.focusNode, selection.focusOffset);
  if (!anchor || !focus || anchor.host !== focus.host || (within && !within.contains(anchor.host))) return null;
  const model = models.get(anchor.host)!;
  const a = model.blocks[anchor.index], b = model.blocks[focus.index];
  if (!a || !b) return null;
  const from = a.start + Math.min(a.text.length, anchor.offset);
  const to = b.start + Math.min(b.text.length, focus.offset);
  return model.text.slice(Math.min(from, to), Math.max(from, to));
}

export function textPoint(element: HTMLElement, offset: number): [Node, number] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode(), last: Node = element;
  while (node) {
    last = node;
    const length = node.textContent?.length || 0;
    if (offset <= length) return [node, offset];
    offset -= length; node = walker.nextNode();
  }
  return [last, last.nodeType === Node.TEXT_NODE ? last.textContent?.length || 0 : last.childNodes.length];
}

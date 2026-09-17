import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { closeHistory } from "@milkdown/kit/prose/history";

export type DocumentHeading = { pos: number; level: number; text: string };
type Match = { from: number; to: number };
export type DocumentSearch = { query: string; matches: Match[]; index: number };
const key = new PluginKey<DocumentSearch>("openmind-document-search");
const emptySearch: DocumentSearch = { query: "", matches: [], index: -1 };

export function documentHeadings(doc: Node): DocumentHeading[] {
  const headings: DocumentHeading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") headings.push({ pos, level: node.attrs.level, text: node.textContent || "未命名标题" });
  });
  return headings;
}

// Search the rendered text of each block, including text split by bold/link marks.
// A leaf occupies one ProseMirror position, so matching offsets remain exact.
function findMatches(doc: Node, query: string): Match[] {
  if (!query) return [];
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const matches: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const text = node.textBetween(0, node.content.size, "", "\ufffc");
    for (const match of text.matchAll(expression)) {
      if (!match[0].includes("\ufffc")) matches.push({ from: pos + 1 + match.index, to: pos + 1 + match.index + match[0].length });
    }
    return false;
  });
  return matches;
}

export const documentSearchPlugin = new Plugin<DocumentSearch>({
  key,
  state: {
    init: () => emptySearch,
    apply(tr, previous) {
      const meta = tr.getMeta(key) as Partial<DocumentSearch> | undefined;
      if (!meta && !tr.docChanged) return previous;
      const query = meta?.query ?? previous.query;
      const matches = tr.docChanged || query !== previous.query ? findMatches(tr.doc, query) : previous.matches;
      return { query, matches, index: matches.length ? Math.max(0, Math.min(meta?.index ?? previous.index, matches.length - 1)) : -1 };
    }
  },
  props: {
    decorations(state) {
      const search = key.getState(state) ?? emptySearch;
      return DecorationSet.create(state.doc, search.matches.map((match, index) => Decoration.inline(match.from, match.to, {
        class: index === search.index ? "document-search-match is-current" : "document-search-match"
      })));
    }
  }
});

export const documentSearch = (view: EditorView) => key.getState(view.state) ?? emptySearch;
export function searchDocument(view: EditorView, query: string) {
  view.dispatch(view.state.tr.setMeta(key, { query, index: 0 }));
  revealMatch(view);
}
export function stepSearch(view: EditorView, direction: number) {
  const { index, matches } = documentSearch(view);
  if (!matches.length) return;
  view.dispatch(view.state.tr.setMeta(key, { index: (index + direction + matches.length) % matches.length }));
  revealMatch(view);
}
function revealMatch(view: EditorView) {
  const search = documentSearch(view);
  const match = search.matches[search.index];
  if (!match) return;
  // Don't move the editing selection or focus away from the search field.
  const dom = view.domAtPos(match.from).node;
  (dom instanceof HTMLElement ? dom : dom.parentElement)?.scrollIntoView?.({ block: "nearest" });
}
export function replaceSearch(view: EditorView, replacement: string, all: boolean) {
  if (!view.editable) return false;
  const search = documentSearch(view);
  const matches = all ? search.matches : search.matches.slice(search.index, search.index + 1);
  if (!matches.length) return false;
  const tr = view.state.tr;
  for (const match of [...matches].reverse()) tr.insertText(replacement, match.from, match.to);
  view.dispatch(closeHistory(tr));
  view.dispatch(closeHistory(view.state.tr));
  revealMatch(view);
  return true;
}
export function jumpToHeading(view: EditorView, pos: number) {
  if (view.state.doc.nodeAt(pos)?.type.name !== "heading") return;
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos + 1))).scrollIntoView());
  view.focus();
}

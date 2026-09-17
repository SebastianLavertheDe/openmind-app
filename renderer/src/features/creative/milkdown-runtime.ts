import { Crepe } from "@milkdown/crepe";
import { commandsCtx, editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { $prose, callCommand, insert, replaceAll } from "@milkdown/kit/utils";
import { toggleLinkCommand } from "@milkdown/kit/component/link-tooltip";
import { imageBlockSchema } from "@milkdown/kit/component/image-block";
import { addBlockTypeCommand } from "@milkdown/kit/preset/commonmark";
import { createTable } from "@milkdown/kit/preset/gfm";
import { Plugin, TextSelection, type SelectionBookmark } from "@milkdown/kit/prose/state";
import { setBlockType, toggleMark } from "@milkdown/kit/prose/commands";
import { undo, redo } from "@milkdown/kit/prose/history";
import { toggleCode, toggleList, toggleQuote } from "./document-commands";
import { documentBlockMenu, documentMenuPosition } from "./document-block-menu";
import { documentHeadings, documentSearch, documentSearchPlugin, jumpToHeading, replaceSearch, searchDocument, stepSearch, type DocumentHeading, type DocumentSearch } from "./document-navigation";
import type { EditorSelectionSnapshot } from "./MilkdownEditor";

export type EditorAction = "bold" | "italic" | "strike" | "inlineCode" | "bullet" | "ordered" | "todo" | "quote" | "link" | "image" | "table" | "code" | "undo" | "redo";
export type EditorFormat = { heading: number; active: EditorAction[]; canUndo: boolean; canRedo: boolean };
type Callbacks = { onChange(value: string): void; onSelectionChange(selection: EditorSelectionSnapshot): void; onFormat(format: EditorFormat): void; onHeadings?(headings: DocumentHeading[]): void; onSearch?(search: DocumentSearch): void };
type TrackedRange = { from: number; to: number; text: string };

/** Persist uploads inside Markdown instead of saving temporary blob URLs. */
export function uploadImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("图片读取失败"));
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export async function createMarkdownEditor(host: HTMLElement, value: string, label: string, callbacks: Callbacks, floatingRoot?: HTMLElement) {
  let ready = false;
  let syncing = false;
  let source = value;
  let serialized = "";
  let nextBookmark = 0;
  let lastFormat = "";
  let editSelection: SelectionBookmark | undefined;
  const ranges = new Map<number, TrackedRange>();
  let lastSelection: EditorSelectionSnapshot = { start: 0, end: 0, text: "" };
  const crepe = new Crepe({ root: host, defaultValue: value, featureConfigs: {
    [Crepe.Feature.Placeholder]: { text: "输入正文，或输入 / 插入内容", mode: "block" },
    [Crepe.Feature.Toolbar]: { boldLabel: "加粗", italicLabel: "斜体", codeLabel: "行内代码", linkLabel: "链接", strikethroughLabel: "删除线", latexLabel: "公式" },
    [Crepe.Feature.LinkTooltip]: { inputPlaceholder: "粘贴或输入链接" },
    [Crepe.Feature.CodeMirror]: { searchPlaceholder: "搜索代码语言", copyText: "复制代码", noResultText: "没有匹配的语言", previewToggleText: preview => preview ? "编辑" : "收起预览" },
    [Crepe.Feature.ImageBlock]: { onUpload: uploadImage, inlineUploadButton: "上传图片", blockUploadButton: "上传图片", blockConfirmButton: "确认", inlineUploadPlaceholderText: "或粘贴图片链接", blockUploadPlaceholderText: "或粘贴图片链接", blockCaptionPlaceholderText: "添加图片说明" },
    [Crepe.Feature.BlockEdit]: {
      ...documentBlockMenu,
      blockHandle: { getOffset: () => 4 },
      // Slash menus must render outside the scrolling host or overflow hides them.
      slashMenu: documentMenuPosition(floatingRoot)
    }
  } });
  const view = () => crepe.editor.action(ctx => ctx.get(editorViewCtx));
  const getSelection = (): EditorSelectionSnapshot => {
    const { state } = view();
    const { from: start, to: end } = state.selection;
    const text = state.doc.textBetween(start, end, "\n");
    const old = lastSelection.bookmark ? ranges.get(lastSelection.bookmark) : undefined;
    if (lastSelection.start === start && lastSelection.end === end && lastSelection.text === text && (!old || old.from === start && old.to === end)) return lastSelection;
    const bookmark = text ? ++nextBookmark : undefined;
    if (bookmark) {
      ranges.set(bookmark, { from: start, to: end, text });
      // Old, unused selections should not grow the editor's memory indefinitely.
      if (ranges.size > 512) ranges.delete(ranges.keys().next().value!);
    }
    return lastSelection = { start, end, text, bookmark };
  };
  const notifySelection = () => {
    if (!ready) return;
    const { state } = view();
    callbacks.onSelectionChange(getSelection());
    const marks = state.storedMarks ?? state.selection.$from.marks();
    const active: EditorAction[] = [];
    const markActions: Record<string, EditorAction> = { strong: "bold", emphasis: "italic", strikethrough: "strike", inlineCode: "inlineCode", link: "link" };
    for (const mark of marks) if (markActions[mark.type.name]) active.push(markActions[mark.type.name]);
    for (let depth = state.selection.$from.depth; depth > 0; depth--) {
      const name = state.selection.$from.node(depth).type.name;
      if (name === "bullet_list") active.push(state.selection.$from.node(depth + 1)?.attrs.checked != null ? "todo" : "bullet");
      if (name === "ordered_list") active.push("ordered");
      if (name === "blockquote") active.push("quote");
    }
    if (state.selection.$from.parent.type.name === "code_block") active.push("code");
    const format: EditorFormat = { heading: state.selection.$from.parent.type.name === "heading" ? state.selection.$from.parent.attrs.level : 0, active, canUndo: undo(state), canRedo: redo(state) };
    const signature = JSON.stringify(format);
    if (signature !== lastFormat) { lastFormat = signature; callbacks.onFormat(format); }
  };
  crepe.editor.use($prose(() => documentSearchPlugin));
  crepe.editor.use($prose(ctx => new Plugin({
    filterTransaction: transaction => !crepe.readonly || syncing || !transaction.docChanged,
    state: {
      init: () => null,
      apply: transaction => {
        if (transaction.docChanged) for (const range of ranges.values()) {
          range.from = transaction.mapping.map(range.from, 1);
          range.to = transaction.mapping.map(range.to, -1);
        }
        return null;
      }
    },
    view: () => ({ update: (current, previous) => {
      if (!ready) return;
      if (!current.state.doc.eq(previous.doc)) {
        callbacks.onHeadings?.(documentHeadings(current.state.doc));
        const next = ctx.get(serializerCtx)(current.state.doc);
        if (next !== serialized) {
          serialized = next;
          if (!syncing) { source = serialized; callbacks.onChange(serialized); }
        }
      }
      callbacks.onSearch?.(documentSearch(current));
      notifySelection();
    } })
  })));
  try { await crepe.create(); } catch (error) { await crepe.destroy(); throw error; }
  // The toolbar and link/latex tooltips hardcode the editor parent as their append
  // root; providers never re-append, so relocating them once after create is enough.
  if (floatingRoot) for (const el of host.querySelectorAll<HTMLElement>(".milkdown-toolbar, .milkdown-link-preview, .milkdown-link-edit, .milkdown-latex-inline-edit")) floatingRoot.append(el);
  serialized = crepe.getMarkdown();
  ready = true;
  const closeBlockMenu = () => {
    if (!ready) return;
    // Crepe exposes BlockEdit but not its menu API symbol. Resolve its named
    // context to close the real menu, including its capture-phase key handler.
    crepe.editor.action(ctx => ctx.get<{ hide(): void }, "menuAPICtx">("menuAPICtx").hide());
  };
  const onOutsidePointerDown = (event: PointerEvent) => {
    const target = event.target as Node;
    const menu = (floatingRoot ?? host).querySelector('.milkdown-slash-menu[data-show="true"]');
    if (menu && !host.contains(target) && !menu.contains(target)) closeBlockMenu();
  };
  const onFocusOut = () => queueMicrotask(() => {
    const menu = (floatingRoot ?? host).querySelector(".milkdown-slash-menu");
    if (!host.contains(document.activeElement) && !menu?.contains(document.activeElement)) closeBlockMenu();
  });
  document.addEventListener("pointerdown", onOutsidePointerDown, true);
  host.addEventListener("focusout", onFocusOut);
  const setLabel = (next: string) => {
    const dom = view().dom;
    dom.setAttribute("role", "textbox"); dom.setAttribute("aria-multiline", "true"); dom.setAttribute("aria-label", next);
  };
  setLabel(label); notifySelection();
  callbacks.onHeadings?.(documentHeadings(view().state.doc));
  const setHeading = (level: number) => {
    if (crepe.readonly) return;
    const editorView = view();
    setBlockType(editorView.state.schema.nodes[level ? "heading" : "paragraph"], level ? { level } : undefined)(editorView.state, editorView.dispatch);
    editorView.focus();
  };
  const run = (action: EditorAction): boolean => {
    if (crepe.readonly) return false;
    const editorView = view();
    const { state, dispatch } = editorView;
    const { schema } = state;
    let applied = false;
    const marks = { bold: "strong", italic: "emphasis", strike: "strikethrough", inlineCode: "inlineCode" };
    if (action in marks) applied = toggleMark(schema.marks[marks[action as keyof typeof marks]])(state, dispatch);
    else if (action === "bullet" || action === "ordered" || action === "todo") {
      applied = toggleList(action)(state, dispatch);
    } else if (action === "quote") applied = toggleQuote(state, dispatch);
    else if (action === "code") applied = toggleCode(state, dispatch);
    else if (action === "undo" || action === "redo") applied = (action === "undo" ? undo : redo)(state, dispatch);
    else if (action === "link") applied = crepe.editor.action(callCommand(toggleLinkCommand.key));
    else if (action === "table") { crepe.editor.action(ctx => dispatch(state.tr.replaceSelectionWith(createTable(ctx, 3, 3)).scrollIntoView())); applied = true; }
    else if (action === "image") applied = crepe.editor.action(ctx => ctx.get(commandsCtx).call(addBlockTypeCommand.key, { nodeType: imageBlockSchema.type(ctx) }));
    editorView.focus(); return applied;
  };
  return {
    editor: crepe.editor,
    focus: () => view().focus(), setLabel, getSelection, run, setHeading, closeBlockMenu,
    setReadOnly: (readOnly: boolean) => {
      if (crepe.readonly === readOnly) return;
      const editorView = view();
      if (readOnly) editSelection = editorView.state.selection.getBookmark();
      crepe.setReadonly(readOnly);
      editorView.dom.setAttribute("aria-readonly", String(readOnly));
      if (!readOnly && editSelection) {
        editorView.dispatch(editorView.state.tr.setSelection(editSelection.resolve(editorView.state.doc)));
        editSelection = undefined;
        editorView.focus();
      }
    },
    search: (query: string) => searchDocument(view(), query),
    stepSearch: (direction: number) => stepSearch(view(), direction),
    replaceSearch: (replacement: string, all = false) => replaceSearch(view(), replacement, all),
    jumpToHeading: (pos: number) => jumpToHeading(view(), pos),
    getMarkdown: () => crepe.getMarkdown(),
    setValue: (next: string) => {
      if (next === source || next === serialized) return;
      syncing = true;
      try { crepe.editor.action(replaceAll(next, true)); source = next; serialized = crepe.getMarkdown(); editSelection = undefined; ranges.clear(); lastSelection = { start: 0, end: 0, text: "" }; }
      finally { syncing = false; }
      notifySelection();
    },
    insert: (before: string, after = "", placeholder = "") => {
      if (crepe.readonly) return false;
      const editorView = view();
      const selection = editorView.state.selection;
      if (selection.empty && placeholder) {
        const tr = editorView.state.tr.insertText(placeholder);
        editorView.dispatch(tr.setSelection(TextSelection.create(tr.doc, selection.from, selection.from + placeholder.length)));
      }
      const actions: Record<string, EditorAction> = { "**": "bold", "*": "italic", "`": "inlineCode", "- ": "bullet", "1. ": "ordered", "> ": "quote", "\n```\n": "code" };
      if (actions[before]) return run(actions[before]);
      if (before === "## ") { setHeading(2); return true; }
      if (before === "[") {
        const href = after.startsWith("](") && after.endsWith(")") ? after.slice(2, -1) : "https://";
        toggleMark(editorView.state.schema.marks.link, { href })(editorView.state, editorView.dispatch);
      } else crepe.editor.action(insert(`${before}${editorView.state.doc.textBetween(editorView.state.selection.from, editorView.state.selection.to, "\n")}${after}`, true));
      editorView.focus(); return true;
    },
    replaceRange: (start: number, end: number, replacement: string, bookmark?: number) => {
      if (crepe.readonly) return false;
      const editorView = view();
      if (start < 0 || end < start || !bookmark && end > editorView.state.doc.content.size) return false;
      const range = bookmark ? ranges.get(bookmark) : { from: start, to: end, text: editorView.state.doc.textBetween(start, end, "\n") };
      if (!range || range.from >= range.to || range.to > editorView.state.doc.content.size || editorView.state.doc.textBetween(range.from, range.to, "\n") !== range.text) return false;
      editorView.dispatch(editorView.state.tr.setSelection(TextSelection.create(editorView.state.doc, range.from, range.to)));
      crepe.editor.action(insert(replacement, true));
      editorView.focus(); return true;
    },
    destroy: async () => {
      ready = false;
      document.removeEventListener("pointerdown", onOutsidePointerDown, true);
      host.removeEventListener("focusout", onFocusOut);
      ranges.clear(); await crepe.destroy();
    }
  };
}
export type MilkdownRuntime = Awaited<ReturnType<typeof createMarkdownEditor>>;

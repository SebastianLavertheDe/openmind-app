import { Crepe } from "@milkdown/crepe";
import { commandsCtx, editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { $prose, callCommand, insert, replaceAll } from "@milkdown/kit/utils";
import { toggleLinkCommand } from "@milkdown/kit/component/link-tooltip";
import { imageBlockSchema } from "@milkdown/kit/component/image-block";
import { addBlockTypeCommand } from "@milkdown/kit/preset/commonmark";
import { createTable } from "@milkdown/kit/preset/gfm";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { setBlockType, toggleMark, wrapIn } from "@milkdown/kit/prose/commands";
import { wrapInList } from "@milkdown/kit/prose/schema-list";
import { undo, redo } from "@milkdown/kit/prose/history";
import type { EditorSelectionSnapshot } from "./MilkdownEditor";

export type EditorAction = "bold" | "italic" | "strike" | "inlineCode" | "bullet" | "ordered" | "todo" | "quote" | "link" | "image" | "table" | "code" | "undo" | "redo";
type Format = { heading: number; active: EditorAction[] };
type Callbacks = { onChange(value: string): void; onSelectionChange(selection: EditorSelectionSnapshot): void; onFormat(format: Format): void };
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
  const ranges = new Map<number, TrackedRange>();
  let lastSelection: EditorSelectionSnapshot = { start: 0, end: 0, text: "" };
  const crepe = new Crepe({ root: host, defaultValue: value, featureConfigs: {
    [Crepe.Feature.Placeholder]: { text: "输入正文，或输入 / 插入内容", mode: "block" },
    [Crepe.Feature.Toolbar]: { boldLabel: "加粗", italicLabel: "斜体", codeLabel: "行内代码", linkLabel: "链接", strikethroughLabel: "删除线", latexLabel: "公式" },
    [Crepe.Feature.LinkTooltip]: { inputPlaceholder: "粘贴或输入链接" },
    [Crepe.Feature.CodeMirror]: { searchPlaceholder: "搜索代码语言", copyText: "复制代码", noResultText: "没有匹配的语言", previewToggleText: preview => preview ? "编辑" : "收起预览" },
    [Crepe.Feature.ImageBlock]: { onUpload: uploadImage, inlineUploadButton: "上传图片", blockUploadButton: "上传图片", blockConfirmButton: "确认", inlineUploadPlaceholderText: "或粘贴图片链接", blockUploadPlaceholderText: "或粘贴图片链接", blockCaptionPlaceholderText: "添加图片说明" },
    [Crepe.Feature.BlockEdit]: {
      blockHandle: { getOffset: () => 4 },
      // Slash menus must render outside the scrolling host or overflow hides them.
      slashMenu: { root: floatingRoot },
      textGroup: { label: "基础内容", text: { label: "正文" }, h1: { label: "标题 1" }, h2: { label: "标题 2" }, h3: { label: "标题 3" }, h4: { label: "标题 4" }, h5: { label: "标题 5" }, h6: { label: "标题 6" }, quote: { label: "引用" }, divider: { label: "分割线" } },
      listGroup: { label: "列表", bulletList: { label: "无序列表" }, orderedList: { label: "有序列表" }, taskList: { label: "待办列表" } },
      advancedGroup: { label: "插入", image: { label: "图片" }, codeBlock: { label: "代码块" }, table: { label: "表格" }, math: { label: "公式" } }
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
      if (name === "bullet_list") active.push("bullet");
      if (name === "ordered_list") active.push("ordered");
      if (name === "blockquote") active.push("quote");
    }
    callbacks.onFormat({ heading: state.selection.$from.parent.type.name === "heading" ? state.selection.$from.parent.attrs.level : 0, active });
  };
  crepe.editor.use($prose(ctx => new Plugin({
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
        const next = ctx.get(serializerCtx)(current.state.doc);
        if (next !== serialized) {
          serialized = next;
          if (!syncing) { source = serialized; callbacks.onChange(serialized); }
        }
      }
      notifySelection();
    } })
  })));
  try { await crepe.create(); } catch (error) { await crepe.destroy(); throw error; }
  // The toolbar and link/latex tooltips hardcode the editor parent as their append
  // root; providers never re-append, so relocating them once after create is enough.
  if (floatingRoot) for (const el of host.querySelectorAll<HTMLElement>(".milkdown-toolbar, .milkdown-link-preview, .milkdown-link-edit, .milkdown-latex-inline-edit")) floatingRoot.append(el);
  serialized = crepe.getMarkdown();
  ready = true;
  const setLabel = (next: string) => {
    const dom = view().dom;
    dom.setAttribute("role", "textbox"); dom.setAttribute("aria-multiline", "true"); dom.setAttribute("aria-label", next);
  };
  setLabel(label); notifySelection();
  const setHeading = (level: number) => {
    const editorView = view();
    setBlockType(editorView.state.schema.nodes[level ? "heading" : "paragraph"], level ? { level } : undefined)(editorView.state, editorView.dispatch);
    editorView.focus();
  };
  const run = (action: EditorAction): boolean => {
    const editorView = view();
    const { state, dispatch } = editorView;
    const { schema } = state;
    let applied = false;
    const marks = { bold: "strong", italic: "emphasis", strike: "strikethrough", inlineCode: "inlineCode" };
    if (action in marks) applied = toggleMark(schema.marks[marks[action as keyof typeof marks]])(state, dispatch);
    else if (action === "bullet" || action === "ordered" || action === "todo") {
      applied = wrapInList(schema.nodes[action === "ordered" ? "ordered_list" : "bullet_list"])(state, dispatch);
      if (applied && action === "todo") {
        const tr = editorView.state.tr;
        editorView.state.doc.nodesBetween(editorView.state.selection.from, editorView.state.selection.to, (node, pos) => {
          if (node.type.name === "list_item") tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
        });
        dispatch(tr);
      }
    } else if (action === "quote") applied = wrapIn(schema.nodes.blockquote)(state, dispatch);
    else if (action === "code") applied = setBlockType(schema.nodes.code_block)(state, dispatch);
    else if (action === "undo" || action === "redo") applied = (action === "undo" ? undo : redo)(state, dispatch);
    else if (action === "link") applied = crepe.editor.action(callCommand(toggleLinkCommand.key));
    else if (action === "table") { crepe.editor.action(ctx => dispatch(state.tr.replaceSelectionWith(createTable(ctx, 3, 3)).scrollIntoView())); applied = true; }
    else if (action === "image") applied = crepe.editor.action(ctx => ctx.get(commandsCtx).call(addBlockTypeCommand.key, { nodeType: imageBlockSchema.type(ctx) }));
    editorView.focus(); return applied;
  };
  return {
    editor: crepe.editor,
    focus: () => view().focus(), setLabel, getSelection, run, setHeading,
    getMarkdown: () => crepe.getMarkdown(),
    setValue: (next: string) => {
      if (next === source || next === serialized) return;
      syncing = true;
      try { crepe.editor.action(replaceAll(next, true)); source = next; serialized = crepe.getMarkdown(); ranges.clear(); lastSelection = { start: 0, end: 0, text: "" }; }
      finally { syncing = false; }
      notifySelection();
    },
    insert: (before: string, after = "", placeholder = "") => {
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
      const editorView = view();
      if (start < 0 || end < start || !bookmark && end > editorView.state.doc.content.size) return false;
      const range = bookmark ? ranges.get(bookmark) : { from: start, to: end, text: editorView.state.doc.textBetween(start, end, "\n") };
      if (!range || range.from >= range.to || range.to > editorView.state.doc.content.size || editorView.state.doc.textBetween(range.from, range.to, "\n") !== range.text) return false;
      editorView.dispatch(editorView.state.tr.setSelection(TextSelection.create(editorView.state.doc, range.from, range.to)));
      crepe.editor.action(insert(replacement, true));
      editorView.focus(); return true;
    },
    destroy: async () => { ready = false; ranges.clear(); await crepe.destroy(); }
  };
}
export type MilkdownRuntime = Awaited<ReturnType<typeof createMarkdownEditor>>;

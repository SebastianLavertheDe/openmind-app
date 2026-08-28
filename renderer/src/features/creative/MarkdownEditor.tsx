import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, foldGutter, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { messages as m } from "@shared/messages";
import { useAnchoredPopover } from "../../design-system/use-anchored-popover";

export type EditorSelectionSnapshot = {
  start: number;
  end: number;
  text: string;
};

export type MarkdownEditorHandle = {
  focus(): void;
  insert(before: string, after?: string, placeholder?: string): boolean;
  replaceRange(start: number, end: number, replacement: string): boolean;
  getSelection(): EditorSelectionSnapshot;
};

type SlashCommand = {
  id: string;
  title: string;
  detail: string;
  keywords: string[];
  insert: string;
  cursorOffset: number;
};

const SLASH_COMMANDS: SlashCommand[] = [
  { id: "heading", title: m.creativeUi.editor.slash.heading, detail: "##", keywords: [...m.creativeUi.editor.slash.keywords.heading], insert: `## ${m.creativeUi.editor.headingPlaceholder}\n\n`, cursorOffset: 3 },
  { id: "bullet", title: m.creativeUi.editor.slash.bullet, detail: "-", keywords: [...m.creativeUi.editor.slash.keywords.bullet], insert: `- ${m.creativeUi.editor.listPlaceholder}\n`, cursorOffset: 2 },
  { id: "ordered", title: m.creativeUi.editor.slash.ordered, detail: "1.", keywords: [...m.creativeUi.editor.slash.keywords.ordered], insert: `1. ${m.creativeUi.editor.listPlaceholder}\n`, cursorOffset: 3 },
  { id: "todo", title: m.creativeUi.editor.slash.todo, detail: "- [ ]", keywords: [...m.creativeUi.editor.slash.keywords.todo], insert: `- [ ] ${m.creativeUi.editor.slash.todoPlaceholder}\n`, cursorOffset: 6 },
  { id: "quote", title: m.creativeUi.editor.slash.quote, detail: ">", keywords: [...m.creativeUi.editor.slash.keywords.quote], insert: `> ${m.creativeUi.editor.quotePlaceholder}\n\n`, cursorOffset: 2 },
  { id: "code", title: m.creativeUi.editor.slash.code, detail: "```", keywords: [...m.creativeUi.editor.slash.keywords.code], insert: `\`\`\`\n${m.creativeUi.editor.codePlaceholder}\n\`\`\`\n`, cursorOffset: 4 },
  { id: "image", title: m.creativeUi.editor.slash.image, detail: "![alt]", keywords: [...m.creativeUi.editor.slash.keywords.image], insert: `![${m.creativeUi.editor.imagePlaceholder}](https://)\n`, cursorOffset: 2 },
  { id: "divider", title: m.creativeUi.editor.slash.divider, detail: "---", keywords: [...m.creativeUi.editor.slash.keywords.divider], insert: "\n---\n\n", cursorOffset: 5 }
];

export const MARKDOWN_FORMATS = {
  heading: { before: "## ", after: "", placeholder: m.creativeUi.editor.headingPlaceholder },
  bold: { before: "**", after: "**", placeholder: m.creativeUi.editor.boldPlaceholder },
  italic: { before: "*", after: "*", placeholder: m.creativeUi.editor.italicPlaceholder },
  list: { before: "- ", after: "", placeholder: m.creativeUi.editor.listPlaceholder },
  orderedList: { before: "1. ", after: "", placeholder: m.creativeUi.editor.listPlaceholder },
  quote: { before: "> ", after: "", placeholder: m.creativeUi.editor.quotePlaceholder },
  inlineCode: { before: "`", after: "`", placeholder: m.creativeUi.editor.inlineCodePlaceholder },
  code: { before: "\n```\n", after: "\n```\n", placeholder: m.creativeUi.editor.codePlaceholder },
  link: { before: "[", after: "](https://)", placeholder: m.creativeUi.editor.linkPlaceholder },
  image: { before: "![", after: "](https://)", placeholder: m.creativeUi.editor.imagePlaceholder }
} as const;

export const MARKDOWN_FORMAT_KEYS = Object.keys(MARKDOWN_FORMATS) as Array<keyof typeof MARKDOWN_FORMATS>;

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, {
  value: string;
  ariaLabel: string;
  onChange(value: string): void;
  onSelectionChange(selection: EditorSelectionSnapshot): void;
}>(({ value, ariaLabel, onChange, onSelectionChange }, ref) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const syncingRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const slashRef = useRef<SlashMenuState | null>(null);
  const slashAnchorRef = useRef<HTMLSpanElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
  const exposeTestProxy = import.meta.env.MODE === "test";
  const slashPopover = useAnchoredPopover({
    open: Boolean(slashMenu),
    anchorRef: slashAnchorRef,
    floatingRef: slashMenuRef,
    preferredSide: "bottom",
    align: "start",
    gap: 6
  });

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);
  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { slashRef.current = slashMenu; }, [slashMenu]);

  const filteredCommands = useMemo(() => filterSlashCommands(slashMenu?.query || ""), [slashMenu?.query]);

  const syncSelection = useCallback((view: EditorView) => {
    onSelectionChangeRef.current(readSelection(view.state));
  }, []);

  const updateSlashMenu = useCallback((view: EditorView) => {
    const next = detectSlashMenu(view, slashRef.current?.active || 0);
    setSlashMenu(next);
  }, []);

  const replaceWholeDocument = useCallback((next: string) => {
    const view = viewRef.current;
    if (!view) {
      valueRef.current = next;
      onChangeRef.current(next);
      return;
    }
    const length = view.state.doc.length;
    valueRef.current = next;
    view.dispatch({ changes: { from: 0, to: length, insert: next } });
    onChangeRef.current(next);
    syncSelection(view);
  }, [syncSelection]);

  const insertAroundSelection = useCallback((before: string, after = "", fallback = "") => {
    const view = viewRef.current;
    if (!view) return false;
    const range = view.state.selection.main;
    const from = Math.min(range.from, range.to);
    const to = Math.max(range.from, range.to);
    const selected = from === to ? fallback : view.state.sliceDoc(from, to);
    const insert = `${before}${selected}${after}`;
    const anchor = from + before.length;
    view.dispatch({
      changes: { from, to, insert },
      selection: EditorSelection.range(anchor, anchor + selected.length),
      scrollIntoView: true
    });
    view.focus();
    return true;
  }, []);

  const replaceRange = useCallback((start: number, end: number, replacement: string) => {
    const view = viewRef.current;
    if (!view) return false;
    const from = Math.max(0, Math.min(start, end, view.state.doc.length));
    const to = Math.max(0, Math.min(Math.max(start, end), view.state.doc.length));
    const pos = from + replacement.length;
    view.dispatch({
      changes: { from, to, insert: replacement },
      selection: EditorSelection.cursor(pos),
      scrollIntoView: true
    });
    view.focus();
    return true;
  }, []);

  const applySlashCommand = useCallback(() => {
    const view = viewRef.current;
    const menu = slashRef.current;
    if (!view || !menu) return false;
    const commands = filterSlashCommands(menu.query);
    const command = commands[Math.min(menu.active, commands.length - 1)];
    if (!command) return false;
    const cursor = menu.from + command.cursorOffset;
    view.dispatch({
      changes: { from: menu.from, to: menu.to, insert: command.insert },
      selection: EditorSelection.cursor(Math.min(cursor, menu.from + command.insert.length)),
      scrollIntoView: true
    });
    setSlashMenu(null);
    view.focus();
    return true;
  }, []);

  const moveSlashActive = useCallback((delta: 1 | -1) => {
    const menu = slashRef.current;
    if (!menu) return false;
    const count = filterSlashCommands(menu.query).length;
    if (!count) return false;
    setSlashMenu({ ...menu, active: (menu.active + delta + count) % count });
    return true;
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    insert: insertAroundSelection,
    replaceRange,
    getSelection: () => viewRef.current ? readSelection(viewRef.current.state) : { start: 0, end: 0, text: "" }
  }), [insertAroundSelection, replaceRange]);

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;
    const visualSelectionExtensions: Extension[] = exposeTestProxy ? [] : [drawSelection(), dropCursor()];
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      foldGutter(),
      ...visualSelectionExtensions,
      indentOnInput(),
      bracketMatching(),
      markdown(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      highlightSelectionMatches(),
      highlightActiveLine(),
      EditorState.tabSize.of(2),
      EditorView.lineWrapping,
      placeholder(m.creativeUi.editor.placeholder),
      keymap.of([
        { key: "Mod-b", run: () => insertAroundSelection("**", "**", m.creativeUi.editor.boldPlaceholder) },
        { key: "Mod-i", run: () => insertAroundSelection("*", "*", m.creativeUi.editor.italicPlaceholder) },
        { key: "Mod-k", run: () => insertAroundSelection("[", "](https://)", m.creativeUi.editor.linkPlaceholder) },
        { key: "Mod-e", run: () => insertAroundSelection("`", "`", m.creativeUi.editor.inlineCodePlaceholder) },
        { key: "Tab", run: (view) => slashRef.current ? applySlashCommand() : indentMore(view) },
        { key: "Shift-Tab", run: (view) => slashRef.current ? (setSlashMenu(null), true) : indentLess(view) },
        { key: "ArrowDown", run: () => moveSlashActive(1) },
        { key: "ArrowUp", run: () => moveSlashActive(-1) },
        { key: "Enter", run: () => applySlashCommand() },
        { key: "Escape", run: () => slashRef.current ? (setSlashMenu(null), true) : false },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const next = update.state.doc.toString();
          valueRef.current = next;
          if (!syncingRef.current) onChangeRef.current(next);
        }
        if (update.docChanged || update.selectionSet) {
          syncSelection(update.view);
          updateSlashMenu(update.view);
        }
      })
    ];
    const view = new EditorView({
      state: EditorState.create({ doc: valueRef.current, extensions }),
      parent: hostRef.current
    });
    view.contentDOM.setAttribute("role", "textbox");
    view.contentDOM.setAttribute("aria-multiline", "true");
    view.contentDOM.setAttribute("aria-label", exposeTestProxy ? `${ariaLabel} CodeMirror` : ariaLabel);
    viewRef.current = view;
    syncSelection(view);
    const onEditorScroll = () => updateSlashMenu(view);
    view.scrollDOM.addEventListener("scroll", onEditorScroll, { passive: true });
    return () => {
      view.scrollDOM.removeEventListener("scroll", onEditorScroll);
      view.destroy();
      viewRef.current = null;
    };
  }, [applySlashCommand, ariaLabel, exposeTestProxy, insertAroundSelection, moveSlashActive, syncSelection, updateSlashMenu]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value === current) return;
    syncingRef.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    syncingRef.current = false;
    syncSelection(view);
  }, [syncSelection, value]);

  return (
    <div className="markdown-editor-shell">
      {exposeTestProxy ? (
        <textarea
          className="markdown-editor-test-proxy"
          aria-label={ariaLabel}
          value={value}
          onChange={(event) => replaceWholeDocument(event.target.value)}
        />
      ) : null}
      <div ref={hostRef} className="markdown-codemirror" />
      {slashMenu && filteredCommands.length && typeof document !== "undefined" ? createPortal(<>
        <span
          ref={slashAnchorRef}
          className="markdown-slash-anchor"
          aria-hidden="true"
          style={{
            position: "fixed",
            left: slashMenu.anchor.left,
            top: slashMenu.anchor.top,
            width: Math.max(1, slashMenu.anchor.width),
            height: Math.max(1, slashMenu.anchor.height)
          }}
        />
        <div
          ref={slashMenuRef}
          className="markdown-slash-menu"
          role="listbox"
          aria-label={m.creativeUi.editor.slash.menu}
          data-side={slashPopover.side}
          style={{
            ...slashPopover.style,
            maxHeight: typeof slashPopover.style.maxHeight === "number"
              ? Math.min(320, slashPopover.style.maxHeight)
              : 320
          }}
        >
          {filteredCommands.map((command, index) => (
              <button
                key={command.id}
                type="button"
                data-motion="selection"
                role="option"
                aria-selected={slashMenu.active === index}
                className={slashMenu.active === index ? "active" : ""}
                onMouseEnter={() => setSlashMenu({ ...slashMenu, active: index })}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setSlashMenu({ ...slashMenu, active: index });
                  requestAnimationFrame(() => applySlashCommand());
                }}
              >
                <span>{command.detail}</span>
                <div>
                  <strong>{command.title}</strong>
                  <small>{command.keywords.join(" · ")}</small>
                </div>
              </button>
          ))}
        </div>
      </>, document.body) : null}
    </div>
  );
});

type SlashMenuState = {
  from: number;
  to: number;
  query: string;
  active: number;
  anchor: { left: number; top: number; width: number; height: number };
};

function readSelection(state: EditorState): EditorSelectionSnapshot {
  const range = state.selection.main;
  const start = Math.min(range.from, range.to);
  const end = Math.max(range.from, range.to);
  return { start, end, text: start === end ? "" : state.sliceDoc(start, end) };
}

function detectSlashMenu(view: EditorView, active: number): SlashMenuState | null {
  const state = view.state;
  const range = state.selection.main;
  if (!range.empty) return null;
  const line = state.doc.lineAt(range.head);
  const before = line.text.slice(0, range.head - line.from);
  const slash = before.lastIndexOf("/");
  if (slash < 0) return null;
  if (slash > 0 && !/\s/.test(before[slash - 1])) return null;
  const query = before.slice(slash + 1);
  if (/\s/.test(query) || query.length > 32) return null;
  const matches = filterSlashCommands(query);
  if (!matches.length) return null;
  const caret = view.coordsAtPos(range.head);
  const fallback = view.contentDOM.getBoundingClientRect();
  return {
    from: line.from + slash,
    to: range.head,
    query,
    active: Math.min(active, matches.length - 1),
    anchor: caret
      ? { left: caret.left, top: caret.top, width: Math.max(1, caret.right - caret.left), height: Math.max(1, caret.bottom - caret.top) }
      : { left: fallback.left, top: fallback.top, width: 1, height: Math.max(1, Number.parseFloat(getComputedStyle(view.contentDOM).lineHeight) || 20) }
  };
}

function filterSlashCommands(query: string): SlashCommand[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((command) => [command.title, command.detail, ...command.keywords].join(" ").toLocaleLowerCase().includes(needle));
}

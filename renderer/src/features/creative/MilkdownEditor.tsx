import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { DocumentToolbar } from "./DocumentToolbar";
import { DocumentFindbar } from "./DocumentFindbar";
import type { DocumentHeading, DocumentSearch } from "./document-navigation";
import type { MilkdownRuntime, EditorFormat } from "./milkdown-runtime";
import "@milkdown/crepe/theme/common/style.css";
import "../../styles/features/markdown-editor.css";

/** Positions refer to the rendered document. Bookmarks follow subsequent edits. */
export type EditorSelectionSnapshot = { start: number; end: number; text: string; bookmark?: number };
export type MarkdownEditorHandle = {
  focus(): void;
  insert(before: string, after?: string, placeholder?: string): boolean;
  replaceRange(start: number, end: number, replacement: string, bookmark?: number): boolean;
  getSelection(): EditorSelectionSnapshot;
};
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, {
  value: string; ariaLabel: string;
  onChange(value: string): void;
  onSelectionChange(selection: EditorSelectionSnapshot): void;
  onInsertLocalFile?(): Promise<void>;
  autoFocus?: boolean;
  readOnly?: boolean;
  documentHeader?: ReactNode;
  accessory?: ReactNode;
}>((props, ref) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<MilkdownRuntime | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const focusPending = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [format, setFormat] = useState<EditorFormat>({ heading: 0, active: [], canUndo: false, canRedo: false });
  const [headings, setHeadings] = useState<DocumentHeading[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [search, setSearch] = useState<DocumentSearch>({ query: "", matches: [], index: -1 });
  const shellRef = useRef<HTMLDivElement>(null);
  const openSearch = () => {
    setFindOpen(true); setOutlineOpen(false);
    const selected = runtimeRef.current?.getSelection().text;
    if (selected && !selected.includes("\n")) runtimeRef.current?.search(selected);
  };
  const closeSearch = () => { setFindOpen(false); runtimeRef.current?.search(""); runtimeRef.current?.focus(); };
  useImperativeHandle(ref, () => ({
    focus: () => { if (runtimeRef.current) runtimeRef.current.focus(); else focusPending.current = true; },
    insert: (before, after, placeholder) => runtimeRef.current?.insert(before, after, placeholder) ?? false,
    replaceRange: (start, end, replacement, bookmark) => runtimeRef.current?.replaceRange(start, end, replacement, bookmark) ?? false,
    getSelection: () => runtimeRef.current?.getSelection() ?? { start: 0, end: 0, text: "" }
  }), []);
  useEffect(() => {
    if (!hostRef.current) return;
    // Separate hosts prevent StrictMode's overlapping async mounts sharing a DOM.
    const host = document.createElement("div");
    hostRef.current.append(host);
    let disposed = false;
    let runtime: MilkdownRuntime | undefined;
    setReady(false); setFailed(false);
    const creation = (async () => {
      const { createMarkdownEditor } = await import("./milkdown-runtime");
      if (disposed) return;
      runtime = await createMarkdownEditor(host, propsRef.current.value, propsRef.current.ariaLabel, {
        onChange: value => { if (!disposed) propsRef.current.onChange(value); },
        onSelectionChange: selection => { if (!disposed) propsRef.current.onSelectionChange(selection); },
        onFormat: format => { if (!disposed) setFormat(format); },
        onHeadings: headings => { if (!disposed) setHeadings(headings); },
        onSearch: search => { if (!disposed) setSearch(search); }
      }, floatingRef.current ?? undefined);
      if (disposed) return;
      runtimeRef.current = runtime;
      runtime.setValue(propsRef.current.value); runtime.setLabel(propsRef.current.ariaLabel); runtime.setReadOnly(Boolean(propsRef.current.readOnly)); setReady(true);
      if (!propsRef.current.readOnly && (focusPending.current || propsRef.current.autoFocus)) { runtime.focus(); focusPending.current = false; }
    })();
    void creation.catch(error => { if (!disposed) { console.error("Markdown editor initialization failed", error); setFailed(true); } });
    return () => {
      disposed = true; runtimeRef.current = null; host.remove();
      void creation.catch(() => {}).then(() => runtime?.destroy());
    };
  }, []);
  useEffect(() => { runtimeRef.current?.setValue(props.value); }, [props.value]);
  useEffect(() => { runtimeRef.current?.setLabel(props.ariaLabel); }, [props.ariaLabel]);
  useEffect(() => { runtimeRef.current?.setReadOnly(Boolean(props.readOnly)); }, [props.readOnly]);
  useEffect(() => { if (props.autoFocus && !props.readOnly && ready) runtimeRef.current?.focus(); }, [props.autoFocus, props.readOnly, ready]);
  return <div ref={shellRef} className={`markdown-editor-shell${props.readOnly ? " is-readonly" : ""}${props.documentHeader ? " has-document-header" : ""}`} aria-busy={!ready && !failed}
    onKeyDown={event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") { event.preventDefault(); event.stopPropagation(); openSearch(); }
      if (event.key === "Escape" && outlineOpen) { setOutlineOpen(false); shellRef.current?.querySelector<HTMLButtonElement>('[aria-label="文档大纲"]')?.focus(); }
    }}>
    <DocumentToolbar ready={ready} readOnly={props.readOnly} format={format} outlineOpen={outlineOpen}
      onOutline={() => { setOutlineOpen(open => !open); setFindOpen(false); runtimeRef.current?.search(""); }} onSearch={openSearch}
      onMenuOpen={() => { runtimeRef.current?.closeBlockMenu(); setOutlineOpen(false); }}
      onAction={action => runtimeRef.current?.run(action)} onHeading={level => runtimeRef.current?.setHeading(level)} onInsertLocalFile={props.onInsertLocalFile} />
    {findOpen ? <DocumentFindbar search={search} readOnly={props.readOnly} onQuery={query => runtimeRef.current?.search(query)}
      onStep={direction => runtimeRef.current?.stepSearch(direction)} onReplace={(value, all) => runtimeRef.current?.replaceSearch(value, all)} onClose={closeSearch} /> : null}
    {outlineOpen ? <nav className="document-editor-outline" aria-label="文档章节">
      <header><strong>文档大纲</strong><button type="button" data-motion="icon" aria-label="关闭大纲" onClick={() => { setOutlineOpen(false); shellRef.current?.querySelector<HTMLButtonElement>('[aria-label="文档大纲"]')?.focus(); }}><X size={16} /></button></header>
      {headings.length ? headings.map(heading => <button type="button" data-motion="selection" key={heading.pos} style={{ paddingInlineStart: 12 + (heading.level - 1) * 12 }} title={heading.text}
        onClick={() => { runtimeRef.current?.jumpToHeading(heading.pos); setOutlineOpen(false); }}>{heading.text}</button>) : <p>添加章节标题后，会显示在这里。</p>}
    </nav> : null}
    <div className="document-editor-scroll">
      {props.documentHeader ? <div className="document-editor-heading">{props.documentHeader}</div> : null}
      {!ready && !failed ? <p className="document-editor-loading" role="status">正在打开文档…</p> : null}
      <div ref={hostRef} className="markdown-milkdown" />
      {failed ? <div className="document-editor-fallback"><p role="alert">文档编辑器加载失败，可以继续编辑 Markdown 源文。</p>
        <textarea aria-label={props.ariaLabel} value={props.value} readOnly={props.readOnly} onChange={event => props.onChange(event.target.value)} />
      </div> : null}
    </div>
    <div ref={floatingRef} className="milkdown milkdown-floating-layer" />
    {props.accessory ? <div className="document-editor-accessory">{props.accessory}</div> : null}
  </div>;
});

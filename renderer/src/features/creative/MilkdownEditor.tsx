import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Bold, Code, Code2, FolderOpen, Image, Italic, Link, List, ListOrdered, ListTodo, Quote, Strikethrough, Table2, Undo2, Redo2 } from "lucide-react";
import type { MilkdownRuntime, EditorAction } from "./milkdown-runtime";
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
const tools: Array<{ action: EditorAction; label: string; icon: typeof Bold }> = [
  { action: "bold", label: "加粗", icon: Bold }, { action: "italic", label: "斜体", icon: Italic },
  { action: "strike", label: "删除线", icon: Strikethrough }, { action: "inlineCode", label: "行内代码", icon: Code },
  { action: "bullet", label: "无序列表", icon: List }, { action: "ordered", label: "有序列表", icon: ListOrdered },
  { action: "todo", label: "待办列表", icon: ListTodo }, { action: "quote", label: "引用", icon: Quote },
  { action: "link", label: "链接", icon: Link }, { action: "image", label: "图片", icon: Image },
  { action: "table", label: "表格", icon: Table2 }, { action: "code", label: "代码块", icon: Code2 },
  { action: "undo", label: "撤销", icon: Undo2 }, { action: "redo", label: "重做", icon: Redo2 }
];

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, {
  value: string; ariaLabel: string;
  onChange(value: string): void;
  onSelectionChange(selection: EditorSelectionSnapshot): void;
  onInsertLocalFile?(): Promise<void>;
  autoFocus?: boolean;
}>((props, ref) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<MilkdownRuntime | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const focusPending = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [format, setFormat] = useState<{ heading: number; active: EditorAction[] }>({ heading: 0, active: [] });
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
        onFormat: format => { if (!disposed) setFormat(format); }
      }, floatingRef.current ?? undefined);
      if (disposed) return;
      runtimeRef.current = runtime;
      runtime.setValue(propsRef.current.value); runtime.setLabel(propsRef.current.ariaLabel); setReady(true);
      if (focusPending.current || propsRef.current.autoFocus) { runtime.focus(); focusPending.current = false; }
    })();
    void creation.catch(error => { if (!disposed) { console.error("Markdown editor initialization failed", error); setFailed(true); } });
    return () => {
      disposed = true; runtimeRef.current = null; host.remove();
      void creation.catch(() => {}).then(() => runtime?.destroy());
    };
  }, []);
  useEffect(() => { runtimeRef.current?.setValue(props.value); }, [props.value]);
  useEffect(() => { runtimeRef.current?.setLabel(props.ariaLabel); }, [props.ariaLabel]);
  useEffect(() => { if (props.autoFocus && ready) runtimeRef.current?.focus(); }, [props.autoFocus, ready]);
  return <div className="markdown-editor-shell" aria-busy={!ready && !failed}>
    <div className="document-editor-toolbar" role="toolbar" aria-label="文档格式">
      <select aria-label="段落格式" value={format.heading} disabled={!ready}
        onChange={event => runtimeRef.current?.setHeading(Number(event.target.value))}>
        <option value={0}>正文</option>
        {[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>标题 {level}</option>)}
      </select>
      <span className="document-toolbar-divider" aria-hidden="true" />
      {tools.map(({ action, label, icon: Icon }, index) => <span className="document-toolbar-item" key={action}>
        {index === 4 || index === 8 || index === 12 ? <span className="document-toolbar-divider" aria-hidden="true" /> : null}
        <button type="button" title={label} aria-label={label} disabled={!ready}
          aria-pressed={format.active.includes(action)} onMouseDown={event => event.preventDefault()}
          onClick={() => runtimeRef.current?.run(action)}><Icon size={16} /></button>
      </span>)}
      {props.onInsertLocalFile ? <button type="button" title="本地文件" aria-label="本地文件" disabled={!ready}
        onMouseDown={event => event.preventDefault()} onClick={() => void props.onInsertLocalFile?.()}><FolderOpen size={16} /></button> : null}
    </div>
    <div className="document-editor-scroll">
      {!ready && !failed ? <p className="document-editor-loading" role="status">正在打开文档…</p> : null}
      <div ref={hostRef} className="markdown-milkdown" />
      {failed ? <div className="document-editor-fallback"><p role="alert">文档编辑器加载失败，可以继续编辑 Markdown 源文。</p>
        <textarea aria-label={props.ariaLabel} value={props.value} onChange={event => props.onChange(event.target.value)} />
      </div> : null}
    </div>
    <div ref={floatingRef} className="milkdown milkdown-floating-layer" />
  </div>;
});

import { Bold, Code, Code2, FolderOpen, Image, Italic, Link, List, ListOrdered, ListTodo, Quote, Strikethrough, Table2, Undo2, Redo2, MoreHorizontal, Search, ListTree } from "lucide-react";
import { DropdownMenu } from "../../design-system/controls";
import type { EditorAction, EditorFormat } from "./milkdown-runtime";

const tools: Array<{ action: EditorAction; label: string; icon: typeof Bold }> = [
  { action: "bold", label: "加粗", icon: Bold }, { action: "italic", label: "斜体", icon: Italic },
  { action: "strike", label: "删除线", icon: Strikethrough }, { action: "inlineCode", label: "行内代码", icon: Code },
  { action: "bullet", label: "无序列表", icon: List }, { action: "ordered", label: "有序列表", icon: ListOrdered },
  { action: "todo", label: "待办列表", icon: ListTodo }, { action: "quote", label: "引用", icon: Quote },
  { action: "link", label: "链接", icon: Link }, { action: "image", label: "图片", icon: Image },
  { action: "table", label: "表格", icon: Table2 }, { action: "code", label: "代码块", icon: Code2 },
  { action: "undo", label: "撤销", icon: Undo2 }, { action: "redo", label: "重做", icon: Redo2 }
];
const primary = new Set<EditorAction>(["bold", "italic", "bullet", "ordered", "todo", "undo", "redo"]);
const responsive = new Set<EditorAction>(["italic", "ordered", "todo", "redo"]);

export function DocumentToolbar({ ready, readOnly, format, outlineOpen, onOutline, onSearch, onAction, onHeading, onInsertLocalFile }: {
  ready: boolean; readOnly?: boolean; format: EditorFormat; outlineOpen: boolean;
  onOutline(): void; onSearch(): void; onAction(action: EditorAction): void; onHeading(level: number): void;
  onInsertLocalFile?(): Promise<void>;
}) {
  const disabled = (action: EditorAction) => !ready || action === "undo" && !format.canUndo || action === "redo" && !format.canRedo;
  return <div className="document-editor-toolbar" role="toolbar" aria-label={readOnly ? "文档导航" : "文档格式"}>
    <button type="button" title="文档大纲" aria-label="文档大纲" aria-pressed={outlineOpen} data-motion="selection" onClick={onOutline}><ListTree size={16} /></button>
    <button type="button" title="查找与替换（Ctrl/⌘+F）" aria-label="查找与替换" data-motion="selection" disabled={!ready} onClick={onSearch}><Search size={16} /></button>
    <span className="document-toolbar-divider" aria-hidden="true" />
    {readOnly ? <span className="document-reading-label">阅读模式</span> : <>
      <select aria-label="段落格式" value={format.heading} disabled={!ready} onChange={event => onHeading(Number(event.target.value))}>
        <option value={0}>正文</option>
        {[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>标题 {level}</option>)}
      </select>
      {tools.filter(tool => primary.has(tool.action)).map(({ action, label, icon: Icon }) => <button key={action} type="button" title={label} aria-label={label}
        className={responsive.has(action) ? "document-tool-responsive" : undefined}
        data-motion="selection" disabled={disabled(action)} aria-pressed={action === "undo" || action === "redo" ? undefined : format.active.includes(action)}
        onMouseDown={event => event.preventDefault()} onClick={() => onAction(action)}><Icon size={16} /></button>)}
      <DropdownMenu label={<MoreHorizontal size={16} />} ariaLabel="更多格式" menuLabel="更多格式" disabled={!ready} menuClassName="document-format-menu" restoreFocusOnSelect={false}>
        {tools.filter(tool => !primary.has(tool.action) || responsive.has(tool.action)).map(({ action, label, icon: Icon }) => <button key={action} type="button" data-motion="selection" role="menuitem"
          className={responsive.has(action) ? "document-menu-responsive" : undefined} disabled={disabled(action)}
          data-active={format.active.includes(action) || undefined} onClick={() => onAction(action)}><Icon size={16} />{label}</button>)}
        {onInsertLocalFile ? <button type="button" data-motion="selection" role="menuitem" onClick={() => void onInsertLocalFile()}><FolderOpen size={16} />本地文件</button> : null}
      </DropdownMenu>
    </>}
  </div>;
}

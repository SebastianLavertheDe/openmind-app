import { useEffect, useState } from "react";
import { Bold, Code, Code2, Image, Italic, Link, List, ListOrdered, ListTodo, Quote, Strikethrough, Table2, Undo2, Redo2, MoreHorizontal, Search, ListTree, ChevronDown } from "lucide-react";
import { DocumentMenu, DocumentMenuHeading, DocumentMenuItem } from "./DocumentMenu";
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
const moreGroups: Array<{ label: string; actions: EditorAction[] }> = [
  { label: "文字样式", actions: ["italic", "strike", "inlineCode"] },
  { label: "列表与引用", actions: ["ordered", "todo", "quote"] },
  { label: "插入内容", actions: ["link", "image", "table", "code"] },
  { label: "编辑历史", actions: ["redo"] }
];

export function DocumentToolbar({ ready, readOnly, format, outlineOpen, onOutline, onSearch, onAction, onHeading, onInsertLocalFile, onMenuOpen }: {
  ready: boolean; readOnly?: boolean; format: EditorFormat; outlineOpen: boolean;
  onOutline(): void; onSearch(): void; onAction(action: EditorAction): void; onHeading(level: number): void;
  onInsertLocalFile?(): Promise<void>;
  onMenuOpen?(): void;
}) {
  const [menu, setMenu] = useState<"paragraph" | "more" | null>(null);
  useEffect(() => { if (readOnly || !ready) setMenu(null); }, [readOnly, ready]);
  const changeMenu = (name: "paragraph" | "more", open: boolean) => {
    if (open) onMenuOpen?.();
    setMenu(current => open ? name : current === name ? null : current);
  };
  const disabled = (action: EditorAction) => !ready || action === "undo" && !format.canUndo || action === "redo" && !format.canRedo;
  return <div className="document-editor-toolbar" role="toolbar" aria-label={readOnly ? "文档导航" : "文档格式"}>
    <button type="button" title="文档大纲" aria-label="文档大纲" aria-pressed={outlineOpen} data-motion="selection" onClick={onOutline}><ListTree size={16} /></button>
    <button type="button" title="查找与替换（Ctrl/⌘+F）" aria-label="查找与替换" data-motion="selection" disabled={!ready} onClick={onSearch}><Search size={16} /></button>
    <span className="document-toolbar-divider" aria-hidden="true" />
    {readOnly ? <span className="document-reading-label">阅读模式</span> : <>
      <DocumentMenu label={<><span>{format.heading ? `标题 ${format.heading}` : "正文"}</span><ChevronDown size={14} /></>}
        name="段落格式" open={menu === "paragraph"} disabled={!ready} triggerClassName="document-paragraph-trigger"
        onOpenChange={open => changeMenu("paragraph", open)}>
        <div className="document-menu-group">
          <DocumentMenuHeading>段落格式</DocumentMenuHeading>
          {[0, 1, 2, 3].map(level => <DocumentMenuItem key={level} icon={level ? `h${level}` : "text"}
            label={level ? `标题 ${level}` : "正文"} radio active={format.heading === level} onClick={() => onHeading(level)} />)}
        </div>
        <div className="document-menu-group">
          <DocumentMenuHeading>更多标题</DocumentMenuHeading>
          {[4, 5, 6].map(level => <DocumentMenuItem key={level} icon={`h${level}`} label={`标题 ${level}`}
            radio active={format.heading === level} onClick={() => onHeading(level)} />)}
        </div>
      </DocumentMenu>
      {tools.filter(tool => primary.has(tool.action)).map(({ action, label, icon: Icon }) => <button key={action} type="button" title={label} aria-label={label}
        className={responsive.has(action) ? "document-tool-responsive" : undefined}
        data-motion="selection" disabled={disabled(action)} aria-pressed={action === "undo" || action === "redo" ? undefined : format.active.includes(action)}
        onMouseDown={event => event.preventDefault()} onClick={() => onAction(action)}><Icon size={16} /></button>)}
      <DocumentMenu label={<MoreHorizontal size={16} />} name="更多格式" open={menu === "more"} disabled={!ready}
        align="end" onOpenChange={open => changeMenu("more", open)}>
        {moreGroups.map(group => <div key={group.label} className="document-menu-group">
          <DocumentMenuHeading>{group.label}</DocumentMenuHeading>
          {group.actions.map(action => {
            const tool = tools.find(tool => tool.action === action)!;
            return <DocumentMenuItem key={action} icon={action} label={tool.label} disabled={disabled(action)}
              active={format.active.includes(action)} onClick={() => onAction(action)} />;
          })}
          {group.label === "插入内容" && onInsertLocalFile ? <DocumentMenuItem icon="file" label="本地文件" onClick={() => void onInsertLocalFile()} /> : null}
        </div>)}
      </DocumentMenu>
    </>}
  </div>;
}

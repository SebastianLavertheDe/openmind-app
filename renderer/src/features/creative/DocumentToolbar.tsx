import { useLocale } from "../../i18n";
import { messages } from "@shared/messages";
import { useEffect, useState } from "react";
import { Bold, Code, Code2, Image, Italic, Link, List, ListOrdered, ListTodo, Quote, Strikethrough, Table2, Undo2, Redo2, MoreHorizontal, Search, ListTree, ChevronDown } from "lucide-react";
import { DocumentMenu, DocumentMenuHeading, DocumentMenuItem } from "./DocumentMenu";
import type { EditorAction, EditorFormat } from "./milkdown-runtime";

const getTools = (): Array<{ action: EditorAction; label: string; icon: typeof Bold }> => [
  { action: "bold", label: messages.editor.bold, icon: Bold }, { action: "italic", label: messages.editor.italic, icon: Italic },
  { action: "strike", label: messages.editor.strikethrough, icon: Strikethrough }, { action: "inlineCode", label: messages.editor.inlineCode, icon: Code },
  { action: "bullet", label: messages.editor.bulletList, icon: List }, { action: "ordered", label: messages.editor.orderedList, icon: ListOrdered },
  { action: "todo", label: messages.editor.taskList, icon: ListTodo }, { action: "quote", label: messages.editor.quote, icon: Quote },
  { action: "link", label: messages.editor.link, icon: Link }, { action: "image", label: messages.editor.image, icon: Image },
  { action: "table", label: messages.editor.table, icon: Table2 }, { action: "code", label: messages.editor.codeBlock, icon: Code2 },
  { action: "undo", label: messages.editor.undo, icon: Undo2 }, { action: "redo", label: messages.editor.redo, icon: Redo2 }
];
const primary = new Set<EditorAction>(["bold", "italic", "bullet", "ordered", "todo", "undo", "redo"]);
const responsive = new Set<EditorAction>(["italic", "ordered", "todo", "redo"]);
const getMoreGroups = (): Array<{ label: string; actions: EditorAction[] }> => [
  { label: messages.editor.textStyle, actions: ["italic", "strike", "inlineCode"] },
  { label: messages.editor.listsAndQuotes, actions: ["ordered", "todo", "quote"] },
  { label: messages.editor.insertContent, actions: ["link", "image", "table", "code"] },
  { label: messages.editor.editHistory, actions: ["redo"] }
];

export function DocumentToolbar({ ready, readOnly, format, outlineOpen, onOutline, onSearch, onAction, onHeading, onInsertLocalFile, onMenuOpen }: {
  ready: boolean; readOnly?: boolean; format: EditorFormat; outlineOpen: boolean;
  onOutline(): void; onSearch(): void; onAction(action: EditorAction): void; onHeading(level: number): void;
  onInsertLocalFile?(): Promise<void>;
  onMenuOpen?(): void;
}) {
  useLocale();
  const tools = getTools();
  const moreGroups = getMoreGroups();
  const [menu, setMenu] = useState<"paragraph" | "more" | null>(null);
  useEffect(() => { if (readOnly || !ready) setMenu(null); }, [readOnly, ready]);
  const changeMenu = (name: "paragraph" | "more", open: boolean) => {
    if (open) onMenuOpen?.();
    setMenu(current => open ? name : current === name ? null : current);
  };
  const disabled = (action: EditorAction) => !ready || action === "undo" && !format.canUndo || action === "redo" && !format.canRedo;
  return <div className="document-editor-toolbar" role="toolbar" aria-label={readOnly ? messages.editor.documentNavigation : messages.editor.documentFormatting}>
    <button type="button" title={messages.editor.outline} aria-label={messages.editor.outline} aria-pressed={outlineOpen} data-document-outline-trigger data-motion="selection" onClick={onOutline}><ListTree size={16} /></button>
    <button type="button" title={messages.editor.findShortcut} aria-label={messages.editor.findAndReplace} data-motion="selection" disabled={!ready} onClick={onSearch}><Search size={16} /></button>
    <span className="document-toolbar-divider" aria-hidden="true" />
    {readOnly ? <span className="document-reading-label">{messages.editor.readingMode}</span> : <>
      <DocumentMenu label={<><span>{format.heading ? messages.editor.heading(format.heading) : messages.editor.paragraph}</span><ChevronDown size={14} /></>}
        name={messages.editor.paragraphFormat} open={menu === "paragraph"} disabled={!ready} triggerClassName="document-paragraph-trigger"
        onOpenChange={open => changeMenu("paragraph", open)}>
        <div className="document-menu-group">
          <DocumentMenuHeading>{messages.editor.paragraphFormat}</DocumentMenuHeading>
          {[0, 1, 2, 3].map(level => <DocumentMenuItem key={level} icon={level ? `h${level}` : "text"}
            label={level ? messages.editor.heading(level) : messages.editor.paragraph} radio active={format.heading === level} onClick={() => onHeading(level)} />)}
        </div>
        <div className="document-menu-group">
          <DocumentMenuHeading>{messages.editor.moreHeadings}</DocumentMenuHeading>
          {[4, 5, 6].map(level => <DocumentMenuItem key={level} icon={`h${level}`} label={messages.editor.heading(level)}
            radio active={format.heading === level} onClick={() => onHeading(level)} />)}
        </div>
      </DocumentMenu>
      {tools.filter(tool => primary.has(tool.action)).map(({ action, label, icon: Icon }) => <button key={action} type="button" title={label} aria-label={label}
        className={responsive.has(action) ? "document-tool-responsive" : undefined}
        data-motion="selection" disabled={disabled(action)} aria-pressed={action === "undo" || action === "redo" ? undefined : format.active.includes(action)}
        onMouseDown={event => event.preventDefault()} onClick={() => onAction(action)}><Icon size={16} /></button>)}
      <DocumentMenu label={<MoreHorizontal size={16} />} name={messages.editor.moreFormatting} open={menu === "more"} disabled={!ready}
        align="end" onOpenChange={open => changeMenu("more", open)}>
        {moreGroups.map(group => <div key={group.label} className="document-menu-group">
          <DocumentMenuHeading>{group.label}</DocumentMenuHeading>
          {group.actions.map(action => {
            const tool = tools.find(tool => tool.action === action)!;
            return <DocumentMenuItem key={action} icon={action} label={tool.label} disabled={disabled(action)}
              active={format.active.includes(action)} onClick={() => onAction(action)} />;
          })}
          {group.label === messages.editor.insertContent && onInsertLocalFile ? <DocumentMenuItem icon="file" label={messages.editor.localFile} onClick={() => void onInsertLocalFile()} /> : null}
        </div>)}
      </DocumentMenu>
    </>}
  </div>;
}

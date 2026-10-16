import { useLocale } from "../../i18n";
import { messages } from "@shared/messages";
import { Input } from "../../design-system/components";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { DocumentSearch } from "./document-navigation";

export function DocumentFindbar({ search, readOnly, onQuery, onStep, onReplace, onClose }: {
  search: DocumentSearch; readOnly?: boolean; onQuery(query: string): void; onStep(direction: number): void;
  onReplace(value: string, all: boolean): void; onClose(): void;
}) {
  useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [replacement, setReplacement] = useState("");
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <section className="document-editor-findbar" aria-label={messages.editor.findAndReplaceAria} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <div className="document-find-row">
      <Input size="sm" ref={input} aria-label={messages.editor.findText} placeholder={messages.editor.findText} value={search.query} onChange={event => onQuery(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); onStep(event.shiftKey ? -1 : 1); }
      }} />
      <span role="status">{search.matches.length ? search.index + 1 : 0} / {search.matches.length}</span>
      <button type="button" data-motion="icon" aria-label={messages.editor.previousMatch} disabled={!search.matches.length} onClick={() => onStep(-1)}><ChevronUp size={16} /></button>
      <button type="button" data-motion="icon" aria-label={messages.editor.nextMatch} disabled={!search.matches.length} onClick={() => onStep(1)}><ChevronDown size={16} /></button>
      <button type="button" data-motion="icon" aria-label={messages.editor.closeFind} onClick={onClose}><X size={16} /></button>
    </div>
    {!readOnly ? <div className="document-find-row">
      <Input size="sm" aria-label={messages.editor.replaceWith} placeholder={messages.editor.replaceWith} value={replacement} onChange={event => setReplacement(event.target.value)} />
      <button type="button" data-motion="action" disabled={!search.matches.length} onClick={() => onReplace(replacement, false)}>{messages.editor.replace}</button>
      <button type="button" data-motion="action" disabled={!search.matches.length} onClick={() => onReplace(replacement, true)}>{messages.editor.replaceAll}</button>
    </div> : null}
  </section>;
}

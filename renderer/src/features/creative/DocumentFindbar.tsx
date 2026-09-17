import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { DocumentSearch } from "./document-navigation";

export function DocumentFindbar({ search, readOnly, onQuery, onStep, onReplace, onClose }: {
  search: DocumentSearch; readOnly?: boolean; onQuery(query: string): void; onStep(direction: number): void;
  onReplace(value: string, all: boolean): void; onClose(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [replacement, setReplacement] = useState("");
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <section className="document-editor-findbar" aria-label="文档查找与替换" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <div className="document-find-row">
      <input ref={input} aria-label="查找正文" placeholder="查找正文" value={search.query} onChange={event => onQuery(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); onStep(event.shiftKey ? -1 : 1); }
      }} />
      <span role="status">{search.matches.length ? search.index + 1 : 0} / {search.matches.length}</span>
      <button type="button" data-motion="icon" aria-label="上一个匹配" disabled={!search.matches.length} onClick={() => onStep(-1)}><ChevronUp size={16} /></button>
      <button type="button" data-motion="icon" aria-label="下一个匹配" disabled={!search.matches.length} onClick={() => onStep(1)}><ChevronDown size={16} /></button>
      <button type="button" data-motion="icon" aria-label="关闭查找" onClick={onClose}><X size={16} /></button>
    </div>
    {!readOnly ? <div className="document-find-row">
      <input aria-label="替换为" placeholder="替换为" value={replacement} onChange={event => setReplacement(event.target.value)} />
      <button type="button" data-motion="action" disabled={!search.matches.length} onClick={() => onReplace(replacement, false)}>替换</button>
      <button type="button" data-motion="action" disabled={!search.matches.length} onClick={() => onReplace(replacement, true)}>全部替换</button>
    </div> : null}
  </section>;
}

import { Fragment, createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import type { Element } from "hast";
import { jsx, jsxs } from "react/jsx-runtime";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { DocumentBlock, DocumentMatch } from "@shared/document-view";
import { useReadingDocument } from "./use-reading-document";
import { documentPoint, readingSelectionText, registerReadingDocument, textPoint } from "./document-selection";
import { useVirtualFlow } from "./use-virtual-flow";

export type ReaderComponents = NonNullable<Parameters<typeof toJsxRuntime>[1]["components"]>;
const emptyBlocks: DocumentBlock[] = [];
const emptyCode: Record<string, string> = {};
const CodeTextContext = createContext(emptyCode);
export function useDocumentCodeText(node?: Element): string | undefined {
  const code = useContext(CodeTextContext);
  return code[String(node?.properties.dataDocumentCodeId)];
}

export function ReaderImage({ src, alt }: ComponentProps<"img">) {
  const value = typeof src === "string" ? src.trim() : "";
  return /^data:image\/(?:png|gif|jpe?g|webp|avif);base64,/i.test(value)
    ? <img src={value} alt={alt || ""}/>
    : value ? <a href={value} target="_blank" rel="noreferrer">{alt || "远程图片（未自动加载）"}</a> : <span>{alt || "图片"}</span>;
}
const components: ReaderComponents = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer"/>,
  img: ({ node: _node, ...props }) => <ReaderImage {...props}/>,
  table: ({ node: _node, ...props }) => <div className="markdown-table-scroll"><table {...props}/></div>
};
const BlockView = memo(function BlockView({ block, custom }: { block: DocumentBlock; custom?: ReaderComponents }) {
  return useMemo(() => toJsxRuntime(block.tree, {
    Fragment, jsx, jsxs, components: custom ? { ...components, ...custom } : components, passNode: true
  }), [block, custom]);
});

export const DocumentReader = memo(function DocumentReader({ content, className = "", math = false, plain = false, customComponents }: {
  content: string; className?: string; math?: boolean; plain?: boolean; customComponents?: ReaderComponents;
}) {
  const { document: model, error, find } = useReadingDocument(content, math, plain);
  const blocks = model?.blocks || emptyBlocks;
  const root = useRef<HTMLElement>(null);
  const [pinned, setPinned] = useState<number[]>([]);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<DocumentMatch[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [target, setTarget] = useState<{ from: number; to: number; start: number; end: number } | null>(null);
  const keyAt = useCallback((index: number) => blocks[index]?.id || String(index), [blocks]);
  const flow = useVirtualFlow({
    count: blocks.length, keyAt, pinned,
    estimate: (index, width) => {
      const block = blocks[index];
      const lines = Math.max(1, Math.ceil((block?.text.length || 0) / Math.max(16, width / 9)));
      return lines * 26 + (block?.kind === "table" ? 42 : 20);
    }
  });
  useLayoutEffect(() => {
    if (root.current && model) return registerReadingDocument(root.current, model);
  }, [model]);
  useEffect(() => { setPinned([]); setTarget(null); setQuery(""); setMatches([]); }, [content]);
  useEffect(() => {
    let active = true;
    if (!query) { setMatches([]); return; }
    const timer = window.setTimeout(() => { void find(query).then(result => {
      if (!active) return;
      setMatches(result); setMatchIndex(0);
      if (result[0]) jump(result[0]);
    }); }, 100);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, find]);

  // Keep native selection endpoints mounted, not the intervening document.
  // The copy/quote bridge retrieves omitted text from the document model.
  useEffect(() => {
    const onSelection = () => {
      const selection = window.getSelection();
      const a = documentPoint(selection?.anchorNode || null, selection?.anchorOffset || 0);
      const b = documentPoint(selection?.focusNode || null, selection?.focusOffset || 0);
      if (a?.host === root.current && b?.host === root.current) {
        setPinned(current => current[0] === a!.index && current[1] === b!.index ? current : [a!.index, b!.index]);
      }
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, []);

  function jump(match: DocumentMatch) {
    let endBlock = match.block;
    while (endBlock + 1 < blocks.length && blocks[endBlock + 1].start < match.end) endBlock++;
    setPinned([match.block, endBlock]);
    setTarget({ from: match.block, to: endBlock, start: match.start - blocks[match.block].start, end: match.end - blocks[endBlock].start });
    if (flow.enabled) flow.virtualizer.scrollToIndex(match.block, { align: "start" });
    else root.current?.querySelector(`[data-document-block="${match.block}"]`)?.scrollIntoView({ block: "nearest" });
  }
  useLayoutEffect(() => {
    if (!target || !root.current) return;
    const from = root.current.querySelector<HTMLElement>(`[data-document-block="${target.from}"]`);
    const to = root.current.querySelector<HTMLElement>(`[data-document-block="${target.to}"]`);
    if (!from || !to) return;
    const range = document.createRange();
    range.setStart(...textPoint(from, target.start)); range.setEnd(...textPoint(to, target.end));
    const selection = window.getSelection();
    selection?.removeAllRanges(); selection?.addRange(range);
    setTarget(null);
  }, [target, pinned, model]);

  const visible = flow.enabled ? flow.virtualizer.getVirtualItems() : blocks.map((block, index) => ({ index, key: block.id, start: 0 }));
  return <article ref={root} className={`${className} document-reader${plain ? " document-plain" : ""}`} data-reading-document="" tabIndex={0}
    onPointerDownCapture={event => {
      const index = Number((event.target as HTMLElement).closest<HTMLElement>("[data-document-block]")?.dataset.documentBlock);
      if (Number.isFinite(index)) setPinned([index]);
    }}
    onCopy={event => {
      const text = readingSelectionText(window.getSelection(), event.currentTarget);
      if (text !== null) { event.preventDefault(); event.clipboardData.setData("text/plain", text); }
    }}
    onKeyDown={event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "Escape") setFindOpen(false);
      if (!(event.ctrlKey || event.metaKey) || !model) return;
      if (event.key.toLowerCase() === "f") { event.preventDefault(); event.stopPropagation(); setFindOpen(true); }
      if (event.key.toLowerCase() === "a" && blocks.length) {
        event.preventDefault(); event.stopPropagation();
        setPinned([0, blocks.length - 1]);
        setTarget({ from: 0, to: blocks.length - 1, start: 0, end: blocks.at(-1)!.text.length });
      }
    }}
    onClick={event => {
      const href = (event.target as HTMLElement).closest("a")?.getAttribute("href");
      if (!href?.startsWith("#") || !model) return;
      let id: string;
      try { id = decodeURIComponent(href.slice(1)); } catch { return; }
      const block = model.anchors[id];
      if (typeof block === "number") { event.preventDefault(); jump({ block, start: blocks[block].start, end: blocks[block].start + blocks[block].text.length }); }
    }}>
    {findOpen ? <div className="document-reader-tools">
      <div className="document-findbar">
        <input autoFocus aria-label="搜索文档内容" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.key === "Escape") { event.stopPropagation(); setFindOpen(false); root.current?.focus(); }
          if (event.key === "Enter" && matches.length) {
            const next = (matchIndex + (event.shiftKey ? -1 : 1) + matches.length) % matches.length;
            setMatchIndex(next); jump(matches[next]);
          }
        }}/>
        <span>{matches.length ? matchIndex + 1 : 0} / {matches.length}</span>
        <button aria-label="上一个匹配" data-motion="icon" disabled={!matches.length} onClick={() => { const next = (matchIndex - 1 + matches.length) % matches.length; setMatchIndex(next); jump(matches[next]); }}><ChevronLeft size={14}/></button>
        <button aria-label="下一个匹配" data-motion="icon" disabled={!matches.length} onClick={() => { const next = (matchIndex + 1) % matches.length; setMatchIndex(next); jump(matches[next]); }}><ChevronRight size={14}/></button>
        <button aria-label="关闭搜索" data-motion="icon" onClick={() => setFindOpen(false)}><X size={14}/></button>
      </div>
    </div> : null}
    {error ? <p role="alert">{error}</p> : !model ? <p role="status">正在打开文档…</p> : null}
    <CodeTextContext.Provider value={model?.code || emptyCode}>
    <div ref={flow.ref} className={`document-flow${flow.enabled ? " is-virtual" : ""}`} style={flow.enabled ? { height: flow.virtualizer.getTotalSize() } : undefined}>
      {visible.map(item => <div key={item.key} data-index={item.index} data-document-block={item.index}
        ref={flow.enabled ? flow.measureElement : undefined}
        className={`document-block${blocks[item.index].continuation ? " is-continuation" : ""}${blocks[item.index + 1]?.continuation ? " has-continuation" : ""}`}
        style={flow.enabled ? { position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start - flow.margin}px)` } : undefined}>
        <BlockView block={blocks[item.index]} custom={customComponents}/>
      </div>)}
    </div>
    </CodeTextContext.Provider>
  </article>;
});

import { SearchInput } from "./inputs";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { messages as m } from "@shared/messages";

/**
 * P0-OFL: 统一"动态长内容"溢出容器。
 *
 * 三步原则（"脚注优于正文"）：
 * 1. 硬限高（max-height + overflow:auto）——防止撑爆；
 * 2. 渐变遮罩——暗示"还有内容"，避免突然截断；
 * 3. 逃逸路径（展开全文 / ⌘F 搜索 / 跳转）——需要时能拉出来。
 *
 * 用在：工具输出（P0-OFL-1/2）、patch（P0-OFL-3）、代码块（P0-OFL-4）、
 * sent-contexts（P0-OFL-5）、审批详情 paths/risks、推理面板。
 *
 * `searchable` + `lines` 启用 in-output 搜索（⌘F）：高亮匹配行 + 上/下跳转 + 计数。
 * 子内容渲染时每行带 `data-line={index}` 即可被搜索跳转定位。
 */
export interface OverflowBoxHandle {
  scrollContent: (top: number) => void;
  scrollToBottom: () => void;
}

const overflowResizeCallbacks = new Map<Element, () => void>();
let sharedOverflowResizeObserver: ResizeObserver | null = null;

function observeOverflowResize(element: HTMLElement, callback: () => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => undefined;
  if (!sharedOverflowResizeObserver) {
    sharedOverflowResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) overflowResizeCallbacks.get(entry.target)?.();
    });
  }
  overflowResizeCallbacks.set(element, callback);
  sharedOverflowResizeObserver.observe(element);
  return () => {
    overflowResizeCallbacks.delete(element);
    sharedOverflowResizeObserver?.unobserve(element);
    if (!overflowResizeCallbacks.size) {
      sharedOverflowResizeObserver?.disconnect();
      sharedOverflowResizeObserver = null;
    }
  };
}

function setDataVisible(element: HTMLElement | null, visible: boolean): void {
  if (!element) return;
  if (visible) element.setAttribute("data-visible", "");
  else element.removeAttribute("data-visible");
}

export const OverflowBox = forwardRef<OverflowBoxHandle, {
  children: ReactNode;
  className?: string;
  maxHeight?: number;
  /** 可展开到全部内容（渐变遮罩 + 展开按钮） */
  expandable?: boolean;
  /** 展开按钮自定义文案 */
  expandLabel?: string;
  /** 启用 in-output 搜索（需配合 lines） */
  searchable?: boolean;
  /** 按行文本，用于搜索匹配；不传则搜索不可用 */
  lines?: string[];
  /** 强制展示底部进度（如"已 8000 / 共 48000 字符"） */
  progress?: { shown: number; total: number };
  /** 进度提示渲染 */
  progressLabel?: (shown: number, total: number) => string;
  /** 展开时回调（用于增量加载） */
  onExpand?: () => void;
  /** "全部展开"独立按钮 */
  expandAllLabel?: string;
  onExpandAll?: () => void;
  "data-testid"?: string;
}>(function OverflowBox({
  children,
  className = "",
  maxHeight = 320,
  expandable = false,
  expandLabel,
  searchable = false,
  lines = [],
  progress,
  progressLabel,
  onExpand,
  expandAllLabel,
  onExpandAll,
  "data-testid": testId
}, ref) {
  const contentRef = useRef<HTMLDivElement>(null);
  const topShadowRef = useRef<HTMLDivElement>(null);
  const bottomShadowRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);

  useImperativeHandle(ref, () => ({
    scrollContent: (top: number) => { if (contentRef.current) contentRef.current.scrollTop = top; },
    scrollToBottom: () => { if (contentRef.current) contentRef.current.scrollTop = contentRef.current.scrollHeight; }
  }), []);

  const updateShadows = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    setDataVisible(topShadowRef.current, el.scrollTop > 4);
    setDataVisible(bottomShadowRef.current, el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    return observeOverflowResize(el, updateShadows);
  }, [updateShadows]);
  // Children, expansion, or search controls can change scrollHeight without
  // changing the viewport's observed border box. Sync once after each commit;
  // native scrolling and shared resize delivery stay entirely outside React.
  useLayoutEffect(updateShadows);

  // 搜索状态
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const caseSensitive = query !== query.toLocaleLowerCase();
  const normalizedQuery = caseSensitive ? query : query.toLocaleLowerCase();

  const matches = useMemo(() => {
    if (!query || !lines.length) return [] as number[];
    return lines
      .map((line, index) => {
        const hay = caseSensitive ? line : line.toLocaleLowerCase();
        return hay.includes(normalizedQuery) ? index : -1;
      })
      .filter((index): index is number => index >= 0);
  }, [lines, query, caseSensitive, normalizedQuery]);

  const matchCount = matches.length;
  const activeLineIndex = matchCount ? matches[activeMatch] : -1;

  const scrollToLine = (lineIndex: number) => {
    const el = contentRef.current?.querySelector<HTMLElement>(`[data-line="${lineIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  };

  const nextMatch = () => {
    if (!matchCount) return;
    setActiveMatch((current) => {
      const updated = (current + 1) % matchCount;
      scrollToLine(matches[updated]);
      return updated;
    });
  };

  const prevMatch = () => {
    if (!matchCount) return;
    setActiveMatch((current) => {
      const updated = (current - 1 + matchCount) % matchCount;
      scrollToLine(matches[updated]);
      return updated;
    });
  };

  useEffect(() => {
    setActiveMatch(0);
    if (matchCount) scrollToLine(matches[0]);
  }, [matches]);

  // ⌘F / Ctrl+F 开搜索（仅在容器聚焦范围内）
  useEffect(() => {
    if (!searchable) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "f") {
        const el = contentRef.current;
        if (!el || !el.contains(event.target as Node)) return;
        event.preventDefault();
        openSearch();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchable]);

  const openSearch = () => {
    setSearchOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { event.preventDefault(); closeSearch(); return; }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) prevMatch();
      else nextMatch();
    }
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    setActiveMatch(0);
  };

  const handleExpand = () => {
    setExpanded(true);
    onExpand?.();
  };

  const showExpandButton = expandable && !expanded;
  const effectiveMaxHeight = expanded ? undefined : maxHeight;
  const ov = m.ai.overflow;
  const showFooter = showExpandButton || Boolean(progress) || (searchable && !searchOpen) || Boolean(onExpandAll);

  return (
    <div className={`overflow-box${className ? ` ${className}` : ""}`} data-testid={testId} data-expanded={expanded || undefined}>
      <div className="overflow-box-viewport-wrap">
        {searchOpen && searchable ? (
          <div className="overflow-box-search">
            <SearchInput size="sm" variant="outlined"
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder={ov.searchPlaceholder}
              aria-label={ov.searchPlaceholder}
            />
            <span className="overflow-box-search-count" aria-live="polite">
              {matchCount ? ov.searchCount(activeMatch, matchCount) : ov.searchNoMatch}
            </span>
            <button data-motion="icon" type="button" aria-label={ov.searchPrev} title={ov.searchPrev} disabled={!matchCount} onClick={prevMatch}><ChevronUp size={13} /></button>
            <button data-motion="icon" type="button" aria-label={ov.searchNext} title={ov.searchNext} disabled={!matchCount} onClick={nextMatch}><ChevronDown size={13} /></button>
            <button data-motion="icon" type="button" aria-label={ov.searchClose} title={ov.searchClose} onClick={closeSearch}><X size={13} /></button>
          </div>
        ) : null}
        <div
          ref={contentRef}
          className="overflow-box-content"
          style={{ maxHeight: effectiveMaxHeight }}
          onScroll={updateShadows}
          data-active-line={activeLineIndex >= 0 ? activeLineIndex : undefined}
        >
          {children}
        </div>
        {!expanded ? (
          <>
            <div ref={topShadowRef} className="overflow-box-shadow top" aria-hidden="true" />
            <div ref={bottomShadowRef} className="overflow-box-shadow bottom" aria-hidden="true" />
          </>
        ) : null}
      </div>
      {showFooter ? (
        <footer className="overflow-box-footer">
          {progress && progressLabel ? (
            <span className="overflow-box-progress">{progressLabel(progress.shown, progress.total)}</span>
          ) : null}
          {searchable && !searchOpen ? (
            <button type="button" className="overflow-box-action" onClick={openSearch}>
              <Search size={12} />⌘F
            </button>
          ) : null}
          {onExpandAll ? (
            <button type="button" className="overflow-box-action" onClick={onExpandAll}>{expandAllLabel || ov.expandAll}</button>
          ) : null}
          {showExpandButton ? (
            <button type="button" className="overflow-box-action primary" onClick={handleExpand}>
              <ChevronDown size={12} />{expandLabel || ov.expandAll}
            </button>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
});

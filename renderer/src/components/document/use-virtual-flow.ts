import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { defaultRangeExtractor, measureElement as measureVirtualElement, useVirtualizer } from "@tanstack/react-virtual";

export function scrollContainer(element: HTMLElement): HTMLElement {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return document.documentElement;
}

function isColumnResizeActive(element: Element | null): boolean {
  return Boolean(element?.closest(".app-shell.ai-sidebar-resizing, .app-shell[data-nav-transitioning], .ai-workbench.is-resizing-preview"));
}

type MountedVirtualItem = {
  index: number;
  key: string | number | bigint;
  start: number;
  size: number;
};

/**
 * Keep the mounted part of a virtual document in visual flow while its column
 * is being resized. The virtualizer deliberately keeps its cached measurements
 * during a drag, but the browser still rewraps the text. Repositioning only the
 * mounted rows avoids both stale gaps/overlaps and a document-wide React update.
 */
export function reflowMountedVirtualRows({
  container,
  items,
  cachedSizes,
  scrollMargin,
  totalSize
}: {
  container: HTMLElement;
  items: readonly MountedVirtualItem[];
  cachedSizes: ReadonlyMap<MountedVirtualItem["key"], number>;
  scrollMargin: number;
  totalSize: number;
}): void {
  const itemByIndex = new Map(items.map(item => [item.index, item]));
  // Read all sizes before writing any positions so one drag frame causes at
  // most one synchronous layout, regardless of the number of mounted blocks.
  const rows = Array.from(container.children).flatMap(node => {
    if (!(node instanceof HTMLElement)) return [];
    const index = Number(node.dataset.index);
    const item = itemByIndex.get(index);
    return item ? [{ node, item, height: node.getBoundingClientRect().height }] : [];
  }).sort((a, b) => a.item.index - b.item.index);

  let precedingDelta = 0;
  for (const row of rows) {
    const top = row.item.start - scrollMargin + precedingDelta;
    row.node.style.transform = `translate3d(0, ${top}px, 0)`;
    precedingDelta += row.height - (cachedSizes.get(row.item.key) ?? row.item.size);
  }
  container.style.height = `${Math.max(0, totalSize + precedingDelta)}px`;
}

/** A virtual flow can live inside an existing file or chat scroll surface. */
export function useVirtualFlow({ count, keyAt, estimate, pinned = [], enabled = count > 40 }: {
  count: number; keyAt(index: number): string; estimate(index: number, width: number): number;
  pinned?: number[]; enabled?: boolean;
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [geometry, setGeometry] = useState({ width: 720, margin: 0 });
  const scroll = useRef<HTMLElement | null>(null);
  const estimateRef = useRef(estimate);
  estimateRef.current = estimate;
  const widthRef = useRef(geometry.width);
  widthRef.current = geometry.width;
  const anchor = useRef<{ key: string; delta: number } | null>(null);
  const resizeAnchor = useRef<typeof anchor.current>(null);
  const widthChanging = useRef(false);
  // 拖拽分隔条期间挂载块宽度逐帧变化：块级 ResizeObserver→resizeItem→重渲染
  // 的级联是拖拽卡顿的主凶，此标记让 measureElement 拖拽中静默（松手后由
  // settle 一次性校正全部尺寸）。
  const draggingRef = useRef(false);
  const pinnedKey = pinned.join(",");
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) =>
    [...new Set([...defaultRangeExtractor(range), ...pinned])].filter(i => i >= 0 && i < count).sort((a, b) => a - b), [count, pinnedKey]);
  const virtualizer = useVirtualizer({
    count, getScrollElement: () => scroll.current, getItemKey: keyAt,
    estimateSize: index => estimateRef.current(index, widthRef.current),
    // The virtualizer's item ResizeObserver remains attached after the ref is
    // registered. Guarding the ref callback therefore does not stop existing
    // rows from feeding every width-induced height change back into resizeItem.
    // Return the cached height while a column drag is active; the settle pass
    // below measures the final geometry once the pointer stops.
    measureElement: (node, entry, instance) => {
      if (!draggingRef.current && !isColumnResizeActive(node)) {
        return measureVirtualElement(node, entry, instance);
      }
      const index = instance.indexFromElement(node);
      const key = instance.options.getItemKey(index);
      return instance.itemSizeCache.get(key) ?? instance.options.estimateSize(index);
    },
    scrollMargin: geometry.margin, overscan: 3, rangeExtractor,
    enabled, initialRect: { width: 720, height: 800 },
    useFlushSync: false, directDomUpdates: true,
    onChange: instance => {
      if (!scroll.current) return;
      // Item ResizeObservers may run before our container observer. Do not
      // mistake their width-induced corrections for the reader scrolling.
      if (widthChanging.current) return;
      if (elementRef.current && Math.max(1, elementRef.current.clientWidth) !== widthRef.current) {
        resizeAnchor.current = anchor.current;
        widthChanging.current = true;
        return;
      }
      const top = scroll.current.scrollTop;
      const item = instance.getVirtualItems().find(item => item.start + item.size > top && item.start <= top);
      if (item) anchor.current = { key: String(item.key), delta: top - item.start };
    }
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) => item.end <= (scroll.current?.scrollTop || 0);
  const instanceRef = useRef(virtualizer);
  instanceRef.current = virtualizer;
  useLayoutEffect(() => {
    // Short documents use normal flow and never consume virtual geometry.
    // Observing them would read every historical message's bounding box on
    // each resize, defeating content-visibility for offscreen conversations.
    if (!element || !enabled) return;
    scroll.current = scrollContainer(element);
    const scroller = scroll.current;
    let frame = 0;
    let settle = 0;
    let previousWidth = 0;
    const restoreAnchor = () => {
      const saved = resizeAnchor.current;
      if (!saved) return;
      let index = 0;
      while (index < count && keyAt(index) !== saved.key) index++;
      if (index >= count) return;
      const instance = instanceRef.current;
      const offset = instance.getOffsetForIndex(index, "start");
      const size = instance.getVirtualItems().find(item => item.index === index)?.size || estimateRef.current(index, widthRef.current);
      if (offset) scroller.scrollTop = Math.max(0, offset[0] + Math.min(saved.delta, size - 1));
    };
    // 把挂载块的实测高度喂回虚拟化缓存。读取本身会触发布局，只能在布局干净
    // 的时机调用（见 update 的拖拽分支）。
    const correct = () => {
      const sizes = Array.from(element.children, node => ({ index: Number((node as HTMLElement).dataset.index), height: node.getBoundingClientRect().height }));
      instanceRef.current.measure();
      for (const size of sizes) if (Number.isFinite(size.index)) instanceRef.current.resizeItem(size.index, size.height);
      // Drag reflow writes positions outside the virtualizer's DOM cache. Even
      // if the final sizes match that cache, restore every mounted position.
      const instance = instanceRef.current;
      reflowMountedVirtualRows({
        container: element,
        items: instance.getVirtualItems(),
        cachedSizes: instance.itemSizeCache,
        scrollMargin: instance.options.scrollMargin,
        totalSize: instance.getTotalSize()
      });
    };
    const update = () => {
      frame = 0;
      const resizing = isColumnResizeActive(scroller);
      if (resizing) draggingRef.current = true;
      const dragging = draggingRef.current;
      const rect = element.getBoundingClientRect();
      const margin = rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop - scroller.clientTop;
      // A pane's FLIP transform changes its painted box, not text wrapping.
      // Cache the layout width so opening a preview cannot leave virtual rows
      // estimated at an intermediate animation scale.
      const width = Math.max(1, element.clientWidth);
      if (previousWidth && previousWidth !== width && enabled) {
        widthChanging.current = true;
        resizeAnchor.current ||= anchor.current;
        widthRef.current = width;
        // 拖拽分隔条期间宽度逐帧变化：跳过逐帧校正级联（measure + 逐块重测 +
        // 重渲染）和几何状态提交，文本换行交由 CSS 布局自行完成，松手 120ms
        // 后由 settle 一次性校正。
        if (!dragging) {
          correct();
          restoreAnchor();
        }
        window.clearTimeout(settle);
        settle = window.setTimeout(() => {
          draggingRef.current = false;
          correct();
          restoreAnchor();
          anchor.current = resizeAnchor.current;
          resizeAnchor.current = null;
          widthChanging.current = false;
        }, 120);
      }
      if (!previousWidth) widthChanging.current = false;
      previousWidth = width;
      if (!dragging) setGeometry(current => current.width === width && Math.abs(current.margin - margin) < 1 ? current : { width, margin });
    };
    update();
    const schedule = () => {
      if (enabled && isColumnResizeActive(element)) {
        draggingRef.current = true;
        const instance = instanceRef.current;
        // ResizeObserver runs after the new column width has been laid out but
        // before paint. Correct the mounted block positions here so even the
        // in-progress drag frame cannot show overlaps or stale vertical gaps.
        reflowMountedVirtualRows({
          container: element,
          items: instance.getVirtualItems(),
          cachedSizes: instance.itemSizeCache,
          scrollMargin: instance.options.scrollMargin,
          totalSize: instance.getTotalSize()
        });
      }
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    // Nested readers can move when another message changes height. Observe the
    // containing flows, and refresh scrollMargin after virtual row movement.
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      observer.observe(node);
      if (node === scroller) break;
    }
    scroller.addEventListener("scroll", schedule, { passive: true });
    const userScroll = () => { window.clearTimeout(settle); resizeAnchor.current = null; widthChanging.current = false; };
    scroller.addEventListener("wheel", userScroll, { passive: true });
    scroller.addEventListener("touchstart", userScroll, { passive: true });
    return () => {
      observer.disconnect(); scroller.removeEventListener("scroll", schedule);
      scroller.removeEventListener("wheel", userScroll); scroller.removeEventListener("touchstart", userScroll);
      cancelAnimationFrame(frame); window.clearTimeout(settle); resizeAnchor.current = null; widthChanging.current = false;
    };
  }, [element, enabled, count, keyAt]);
  const ref = useCallback((node: HTMLDivElement | null) => {
    elementRef.current = node; setElement(node);
    // The virtualizer exclusively owns inline geometry in virtual mode.
    // Returning to normal flow must also clear geometry on reused DOM nodes.
    virtualizer.containerRef(enabled ? node : null);
    if (node && !enabled) {
      node.style.removeProperty("height");
      for (const child of node.children) if (child instanceof HTMLElement) child.style.removeProperty("transform");
    }
  }, [enabled, virtualizer]);
  return { ref, element, virtualizer, measureElement: virtualizer.measureElement, enabled, width: geometry.width, margin: geometry.margin, scroll };
}

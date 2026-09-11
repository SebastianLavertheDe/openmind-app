import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";

export function scrollContainer(element: HTMLElement): HTMLElement {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return document.documentElement;
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
  const pinnedKey = pinned.join(",");
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) =>
    [...new Set([...defaultRangeExtractor(range), ...pinned])].filter(i => i >= 0 && i < count).sort((a, b) => a - b), [count, pinnedKey]);
  const virtualizer = useVirtualizer({
    count, getScrollElement: () => scroll.current, getItemKey: keyAt,
    estimateSize: index => estimateRef.current(index, widthRef.current),
    scrollMargin: geometry.margin, overscan: 3, rangeExtractor,
    enabled, initialRect: { width: 720, height: 800 },
    useFlushSync: false, directDomUpdates: true,
    onChange: instance => {
      if (!scroll.current) return;
      // Item ResizeObservers may run before our container observer. Do not
      // mistake their width-induced corrections for the reader scrolling.
      if (widthChanging.current) return;
      if (elementRef.current && Math.round(elementRef.current.getBoundingClientRect().width) !== widthRef.current) {
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
    if (!element) return;
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
    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const margin = rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop - scroller.clientTop;
      const width = Math.max(1, Math.round(rect.width));
      if (previousWidth && previousWidth !== width && enabled) {
        widthChanging.current = true;
        resizeAnchor.current ||= anchor.current;
        // Some rows (notably tables/headings) retain the same height at the new
        // width, so their ResizeObserver will not fire after measure() clears
        // the cache. Read every mounted size before performing geometry writes.
        const sizes = Array.from(element.children, node => ({ index: Number((node as HTMLElement).dataset.index), height: node.getBoundingClientRect().height }));
        widthRef.current = width;
        instanceRef.current.measure();
        for (const size of sizes) if (Number.isFinite(size.index)) instanceRef.current.resizeItem(size.index, size.height);
        restoreAnchor();
        window.clearTimeout(settle);
        settle = window.setTimeout(() => { restoreAnchor(); anchor.current = resizeAnchor.current; resizeAnchor.current = null; widthChanging.current = false; }, 120);
      }
      if (!previousWidth) widthChanging.current = false;
      previousWidth = width;
      setGeometry(current => current.width === width && Math.abs(current.margin - margin) < 1 ? current : { width, margin });
    };
    update();
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
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
    elementRef.current = node; setElement(node); virtualizer.containerRef(node);
  }, [virtualizer]);
  return { ref, element, virtualizer, enabled, width: geometry.width, margin: geometry.margin, scroll };
}

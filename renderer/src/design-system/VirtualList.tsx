import { useEffect, useRef, useState, type CSSProperties, type KeyboardEventHandler, type ReactNode } from "react";

export function VirtualList<T>({
  items,
  rowHeight,
  renderItem,
  getKey,
  className = "",
  overscan = 6,
  role,
  ariaLabel,
  tabIndex,
  onKeyDown,
  selectedKey,
  onReachEnd
}: {
  items: T[];
  rowHeight: number;
  renderItem(item: T, index: number): ReactNode;
  getKey(item: T, index: number): string;
  className?: string;
  overscan?: number;
  role?: string;
  ariaLabel?: string;
  tabIndex?: number;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  selectedKey?: string | null;
  onReachEnd?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setViewport({ scrollTop: element.scrollTop, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = ref.current;
    if (!element || !selectedKey) return;
    const index = items.findIndex((item, itemIndex) => getKey(item, itemIndex) === selectedKey);
    if (index < 0) return;
    const top = index * rowHeight;
    const bottom = top + rowHeight;
    const height = element.clientHeight || viewport.height || rowHeight * 8;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + height) element.scrollTop = Math.max(0, bottom - height);
    setViewport({ scrollTop: element.scrollTop, height });
  }, [getKey, items, rowHeight, selectedKey, viewport.height]);

  const start = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil((viewport.height || rowHeight * 8) / rowHeight) + overscan * 2;
  const end = Math.min(items.length, start + visibleCount);
  const visible = items.slice(start, end);
  return (
    <div
      ref={ref}
      className={`ui-virtual-list ${className}`}
      role={role}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      onScroll={(event) => {
        const target = event.currentTarget;
        if (frame.current) cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          setViewport({ scrollTop: target.scrollTop, height: target.clientHeight });
          if (onReachEnd && target.scrollTop + target.clientHeight >= target.scrollHeight - rowHeight * 4) onReachEnd();
        });
      }}
    >
      <div className="ui-virtual-list-spacer" style={{ height: items.length * rowHeight }}>
        {visible.map((item, offset) => {
          const index = start + offset;
          return <div className="ui-virtual-row" style={{ "--virtual-row-y": `${index * rowHeight}px`, height: rowHeight } as CSSProperties} key={getKey(item, index)}>{renderItem(item, index)}</div>;
        })}
      </div>
    </div>
  );
}

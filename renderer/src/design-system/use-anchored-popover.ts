import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

export type AnchoredPopoverSide = "top" | "bottom";
export type AnchoredPopoverAlign = "start" | "center" | "end";

type Rect = Pick<DOMRect, "top" | "right" | "bottom" | "left" | "width" | "height">;

export type AnchoredPopoverPosition = {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  side: AnchoredPopoverSide;
};

export function computeAnchoredPopoverPosition({
  anchor,
  floating,
  viewportWidth,
  viewportHeight,
  preferredSide = "bottom",
  align = "start",
  gap = 6,
  viewportPadding = 8
}: {
  anchor: Rect;
  floating: Pick<Rect, "width" | "height">;
  viewportWidth: number;
  viewportHeight: number;
  preferredSide?: AnchoredPopoverSide;
  align?: AnchoredPopoverAlign;
  gap?: number;
  viewportPadding?: number;
}): AnchoredPopoverPosition {
  const maxWidth = Math.max(0, viewportWidth - viewportPadding * 2);
  const maxViewportHeight = Math.max(0, viewportHeight - viewportPadding * 2);
  const width = Math.min(floating.width || anchor.width, maxWidth);
  const height = Math.min(floating.height, maxViewportHeight);
  const availableBelow = Math.max(0, viewportHeight - viewportPadding - anchor.bottom - gap);
  const availableAbove = Math.max(0, anchor.top - viewportPadding - gap);
  const preferredAvailable = preferredSide === "bottom" ? availableBelow : availableAbove;
  const alternateAvailable = preferredSide === "bottom" ? availableAbove : availableBelow;
  const side: AnchoredPopoverSide = height <= preferredAvailable || preferredAvailable >= alternateAvailable
    ? preferredSide
    : preferredSide === "bottom" ? "top" : "bottom";
  const availableHeight = side === "bottom" ? availableBelow : availableAbove;

  let left = anchor.left;
  if (align === "end") left = anchor.right - width;
  else if (align === "center") left = anchor.left + (anchor.width - width) / 2;
  left = clamp(left, viewportPadding, Math.max(viewportPadding, viewportWidth - viewportPadding - width));

  const unclampedTop = side === "bottom"
    ? anchor.bottom + gap
    : anchor.top - gap - Math.min(height, availableHeight);
  const top = clamp(
    unclampedTop,
    viewportPadding,
    Math.max(viewportPadding, viewportHeight - viewportPadding - Math.min(height, availableHeight))
  );

  return {
    left,
    top,
    maxWidth,
    maxHeight: Math.max(0, availableHeight),
    side
  };
}

export function useAnchoredPopover<A extends HTMLElement, F extends HTMLElement>({
  open,
  anchorRef,
  floatingRef,
  preferredSide = "bottom",
  align = "start",
  gap = 6,
  viewportPadding = 8,
  matchAnchorWidth = false
}: {
  open: boolean;
  anchorRef: RefObject<A | null>;
  floatingRef: RefObject<F | null>;
  preferredSide?: AnchoredPopoverSide;
  align?: AnchoredPopoverAlign;
  gap?: number;
  viewportPadding?: number;
  matchAnchorWidth?: boolean;
}) {
  const [position, setPosition] = useState<AnchoredPopoverPosition | null>(null);
  const frameRef = useRef<number | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!open || !anchor || !floating) return;
    const visualViewport = window.visualViewport;
    const next = computeAnchoredPopoverPosition({
      anchor: anchor.getBoundingClientRect(),
      floating: floating.getBoundingClientRect(),
      viewportWidth: visualViewport?.width || window.innerWidth,
      viewportHeight: visualViewport?.height || window.innerHeight,
      preferredSide,
      align,
      gap,
      viewportPadding
    });
    setPosition((current) => positionsEqual(current, next) ? current : next);
  }, [align, anchorRef, floatingRef, gap, open, preferredSide, viewportPadding]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const scheduleUpdate = () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        updatePosition();
      });
    };
    updatePosition();
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleUpdate);

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    if (anchorRef.current) observer?.observe(anchorRef.current);
    if (floatingRef.current) observer?.observe(floatingRef.current);

    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      observer?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("scroll", scheduleUpdate);
    };
  }, [anchorRef, floatingRef, open, updatePosition]);

  const style: CSSProperties = {
    position: "fixed",
    left: position?.left ?? viewportPadding,
    top: position?.top ?? viewportPadding,
    maxWidth: position?.maxWidth,
    maxHeight: position?.maxHeight,
    minWidth: matchAnchorWidth && position
      ? Math.min(anchorRef.current?.getBoundingClientRect().width || 0, position.maxWidth)
      : undefined,
    visibility: position ? "visible" : "hidden"
  };

  return { style, side: position?.side ?? preferredSide, updatePosition };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function positionsEqual(current: AnchoredPopoverPosition | null, next: AnchoredPopoverPosition): boolean {
  return Boolean(current
    && current.left === next.left
    && current.top === next.top
    && current.maxWidth === next.maxWidth
    && current.maxHeight === next.maxHeight
    && current.side === next.side);
}

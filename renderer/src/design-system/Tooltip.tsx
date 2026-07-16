import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { useExitPresence } from "./use-exit-presence";

type TooltipSide = "top" | "right" | "bottom" | "left";
type TooltipPosition = {
  left: number;
  top: number;
  arrowLeft: number;
  arrowTop: number;
  side: TooltipSide;
};
type TooltipTriggerProps = {
  title?: string;
  "aria-describedby"?: string;
  onMouseEnter?: MouseEventHandler<HTMLElement>;
  onMouseLeave?: MouseEventHandler<HTMLElement>;
  onFocus?: FocusEventHandler<HTMLElement>;
  onBlur?: FocusEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onPointerDown?: PointerEventHandler<HTMLElement>;
};

export function Tooltip({
  content,
  children,
  side = "top",
  delayMs = 300
}: {
  content: ReactNode;
  children: ReactElement<TooltipTriggerProps>;
  side?: TooltipSide;
  delayMs?: number;
}) {
  const tooltipId = useId();
  const trigger = children;
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const focusedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const presence = useExitPresence(open, 140);

  const clearTimer = useCallback(() => {
    if (timerRef.current == null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const show = useCallback((element: HTMLElement, immediate = false) => {
    triggerRef.current = element;
    clearTimer();
    if (immediate) {
      setOpen(true);
      return;
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setOpen(true);
    }, delayMs);
  }, [clearTimer, delayMs]);

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  const updatePosition = useCallback(() => {
    const anchor = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor?.isConnected || !tooltip) {
      if (open) setOpen(false);
      return;
    }
    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const edge = 8;
    const gap = 8;
    const canUseTop = anchorRect.top - gap - tooltipRect.height >= edge;
    const canUseBottom = anchorRect.bottom + gap + tooltipRect.height <= viewportHeight - edge;
    const canUseLeft = anchorRect.left - gap - tooltipRect.width >= edge;
    const canUseRight = anchorRect.right + gap + tooltipRect.width <= viewportWidth - edge;
    const resolvedSide: TooltipSide = side === "top"
      ? canUseTop || !canUseBottom ? "top" : "bottom"
      : side === "bottom"
        ? canUseBottom || !canUseTop ? "bottom" : "top"
        : side === "left"
          ? canUseLeft || !canUseRight ? "left" : "right"
          : canUseRight || !canUseLeft ? "right" : "left";
    const idealLeft = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;
    const maxLeft = Math.max(edge, viewportWidth - tooltipRect.width - edge);
    const idealTop = anchorRect.top + anchorRect.height / 2 - tooltipRect.height / 2;
    const maxTop = Math.max(edge, viewportHeight - tooltipRect.height - edge);
    const horizontal = resolvedSide === "left" || resolvedSide === "right";
    const left = horizontal
      ? resolvedSide === "left"
        ? Math.max(edge, anchorRect.left - gap - tooltipRect.width)
        : Math.min(maxLeft, anchorRect.right + gap)
      : Math.min(Math.max(edge, idealLeft), maxLeft);
    const top = horizontal
      ? Math.min(Math.max(edge, idealTop), maxTop)
      : resolvedSide === "top"
        ? Math.max(edge, anchorRect.top - gap - tooltipRect.height)
        : Math.min(maxTop, anchorRect.bottom + gap);
    const anchorCenter = anchorRect.left + anchorRect.width / 2;
    const arrowLeft = Math.min(Math.max(8, anchorCenter - left), Math.max(8, tooltipRect.width - 8));
    const anchorMiddle = anchorRect.top + anchorRect.height / 2;
    const arrowTop = Math.min(Math.max(8, anchorMiddle - top), Math.max(8, tooltipRect.height - 8));
    setPosition({ left, top, arrowLeft, arrowTop, side: resolvedSide });
  }, [open, side]);

  useLayoutEffect(() => {
    if (!presence.visible) return;
    updatePosition();
    const update = () => updatePosition();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer = typeof ResizeObserver === "function" && triggerRef.current
      ? new ResizeObserver(update)
      : null;
    if (observer && triggerRef.current) observer.observe(triggerRef.current);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [presence.visible, updatePosition]);

  useEffect(() => {
    if (!presence.visible) setPosition(null);
  }, [presence.visible]);
  useEffect(() => () => clearTimer(), [clearTimer]);

  const describedBy = [trigger.props["aria-describedby"], presence.visible ? tooltipId : ""].filter(Boolean).join(" ") || undefined;
  const renderedTrigger = cloneElement(trigger, {
    title: undefined,
    "aria-describedby": describedBy,
    onMouseEnter: (event) => {
      trigger.props.onMouseEnter?.(event);
      if (!event.defaultPrevented) show(event.currentTarget);
    },
    onMouseLeave: (event) => {
      trigger.props.onMouseLeave?.(event);
      if (!focusedRef.current) hide();
    },
    onFocus: (event) => {
      trigger.props.onFocus?.(event);
      if (event.defaultPrevented) return;
      focusedRef.current = true;
      show(event.currentTarget, true);
    },
    onBlur: (event) => {
      trigger.props.onBlur?.(event);
      focusedRef.current = false;
      hide();
    },
    onKeyDown: (event) => {
      trigger.props.onKeyDown?.(event);
      if (event.key === "Escape") hide();
    },
    onPointerDown: (event) => {
      trigger.props.onPointerDown?.(event);
      hide();
    }
  });

  return (
    <>
      {renderedTrigger}
      {presence.visible && typeof document !== "undefined" ? createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          className="ui-tooltip"
          role="tooltip"
          data-positioned={position ? "" : undefined}
          data-side={position?.side || side}
          data-leaving={presence.leaving || undefined}
          style={{
            left: position?.left ?? 0,
            top: position?.top ?? 0,
            "--tooltip-arrow-left": `${position?.arrowLeft ?? 8}px`,
            "--tooltip-arrow-top": `${position?.arrowTop ?? 8}px`
          } as CSSProperties}
        >
          {content}
        </div>,
        document.body
      ) : null}
    </>
  );
}

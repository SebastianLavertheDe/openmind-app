import { useEffect, useRef } from "react";
import { messages as m } from "@shared/messages";

export type ColumnSplitterProps = {
  side: "left" | "right";
  collapsed: boolean;
  ariaLabel: string;
  ariaValueMin?: number;
  ariaValueMax?: number;
  ariaValueNow?: number;
  toggle(): void;
  /** Move the separator by a physical horizontal delta. Left is negative, right is positive. */
  resize(delta: number): void;
  reset(): void;
  /** Capture the consumer's real value before a pointer resize starts. */
  onResizeStart(): void;
  /** Restore the value captured by onResizeStart. */
  onResizeCancel(): void;
  onResizeActiveChange?(active: boolean): void;
};

export function ColumnSplitter({
  side,
  collapsed,
  ariaLabel,
  ariaValueMin,
  ariaValueMax,
  ariaValueNow,
  toggle,
  resize,
  reset,
  onResizeStart,
  onResizeCancel,
  onResizeActiveChange
}: ColumnSplitterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelDrag = useRef<(() => void) | null>(null);
  const callbacks = useRef({ resize, onResizeStart, onResizeCancel, onResizeActiveChange });
  callbacks.current = { resize, onResizeStart, onResizeCancel, onResizeActiveChange };
  useEffect(() => () => cancelDrag.current?.(), []);
  return (
    <div
      ref={ref}
      className={`column-splitter${collapsed ? " is-collapsed" : ""}`}
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemin={ariaValueMin}
      aria-valuemax={ariaValueMax}
      aria-valuenow={ariaValueNow}
      tabIndex={0}
      onDoubleClick={reset}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
          return;
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          resize(-16);
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          resize(16);
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          reset();
        }
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button") || collapsed || event.button > 0 || event.isPrimary === false) return;
        event.preventDefault();
        cancelDrag.current?.();
        const element = ref.current;
        element?.setPointerCapture(event.pointerId);
        callbacks.current.onResizeStart();
        callbacks.current.onResizeActiveChange?.(true);
        let previous = event.clientX;
        let latest = previous;
        let frame = 0;
        let finished = false;
        const commit = () => {
          frame = 0;
          const delta = latest - previous;
          previous = latest;
          if (delta) callbacks.current.resize(delta);
        };
        const move = (moveEvent: PointerEvent) => {
          if (moveEvent.pointerId !== event.pointerId) return;
          latest = moveEvent.clientX;
          if (!frame) frame = window.requestAnimationFrame(commit);
        };
        const finish = (cancelled: boolean) => {
          if (finished) return;
          finished = true;
          if (frame) window.cancelAnimationFrame(frame);
          if (!cancelled) commit();
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", pointerUp);
          window.removeEventListener("pointercancel", pointerCancel);
          window.removeEventListener("keydown", key);
          window.removeEventListener("blur", pointerCancel);
          element?.removeEventListener("lostpointercapture", pointerCancel);
          cancelDrag.current = null;
          if (cancelled) callbacks.current.onResizeCancel();
          try {
            element?.releasePointerCapture(event.pointerId);
          } catch {
            // Pointer capture may already be released by the browser.
          }
          callbacks.current.onResizeActiveChange?.(false);
        };
        const key = (keyEvent: KeyboardEvent) => {
          if (keyEvent.key !== "Escape") return;
          keyEvent.preventDefault();
          finish(true);
        };
        const pointerUp = (upEvent: PointerEvent) => {
          if (upEvent.pointerId !== event.pointerId) return;
          latest = upEvent.clientX;
          finish(false);
        };
        const pointerCancel = (cancelEvent?: Event) => {
          if (cancelEvent && "pointerId" in cancelEvent && cancelEvent.pointerId !== event.pointerId) return;
          finish(true);
        };
        cancelDrag.current = pointerCancel;
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", pointerUp);
        window.addEventListener("pointercancel", pointerCancel);
        window.addEventListener("keydown", key);
        window.addEventListener("blur", pointerCancel);
        element?.addEventListener("lostpointercapture", pointerCancel);
      }}
    >
      <button data-motion="icon" aria-label={collapsed ? m.designSystem.expandPanel : m.designSystem.collapsePanel} title={collapsed ? m.designSystem.expandPanel : m.designSystem.collapsePanel} onClick={toggle}>{side === "left" ? (collapsed ? "›" : "‹") : (collapsed ? "‹" : "›")}</button>
    </div>
  );
}

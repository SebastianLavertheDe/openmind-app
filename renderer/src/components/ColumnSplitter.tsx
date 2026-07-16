import { useRef } from "react";

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
        if ((event.target as HTMLElement).closest("button") || collapsed) return;
        event.preventDefault();
        const element = ref.current;
        element?.setPointerCapture(event.pointerId);
        onResizeStart();
        onResizeActiveChange?.(true);
        let previous = event.clientX;
        let finished = false;
        const move = (moveEvent: PointerEvent) => {
          const delta = moveEvent.clientX - previous;
          resize(delta);
          previous = moveEvent.clientX;
        };
        const finish = (cancelled: boolean) => {
          if (finished) return;
          finished = true;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", pointerUp);
          window.removeEventListener("pointercancel", pointerCancel);
          window.removeEventListener("keydown", key);
          if (cancelled) onResizeCancel();
          try {
            element?.releasePointerCapture(event.pointerId);
          } catch {
            // Pointer capture may already be released by the browser.
          }
          onResizeActiveChange?.(false);
        };
        const key = (keyEvent: KeyboardEvent) => {
          if (keyEvent.key !== "Escape") return;
          keyEvent.preventDefault();
          finish(true);
        };
        const pointerUp = () => finish(false);
        const pointerCancel = () => finish(true);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", pointerUp, { once: true });
        window.addEventListener("pointercancel", pointerCancel, { once: true });
        window.addEventListener("keydown", key);
      }}
    >
      <button data-motion="icon" aria-label={collapsed ? "展开面板" : "收起面板"} title={collapsed ? "展开面板" : "收起面板"} onClick={toggle}>{side === "left" ? (collapsed ? "›" : "‹") : (collapsed ? "‹" : "›")}</button>
    </div>
  );
}

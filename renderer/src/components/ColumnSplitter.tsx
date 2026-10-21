import { IconButton } from "../design-system/IconButton";
import { usePointerResize } from "../design-system/use-pointer-resize";
import { useLocale } from "../i18n";
import { useRef } from "react";
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
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ resize, onResizeStart, onResizeCancel, onResizeActiveChange });
  callbacks.current = { resize, onResizeStart, onResizeCancel, onResizeActiveChange };
  const startResize = usePointerResize(() => {
    callbacks.current.onResizeStart();
    callbacks.current.onResizeActiveChange?.(true);
    return {
      move: delta => callbacks.current.resize(delta),
      end(cancelled) {
        if (cancelled) callbacks.current.onResizeCancel();
        callbacks.current.onResizeActiveChange?.(false);
      }
    };
  }, !collapsed);
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
      onPointerDown={event => {
        if (!(event.target as HTMLElement).closest("button")) startResize(event);
      }}
    >
      <IconButton className="" label={collapsed ? m.designSystem.expandPanel : m.designSystem.collapsePanel} onClick={toggle}>{side === "left" ? (collapsed ? "›" : "‹") : (collapsed ? "‹" : "›")}</IconButton>
    </div>
  );
}

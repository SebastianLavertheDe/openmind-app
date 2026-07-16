import { useRef } from "react";

export function ColumnSplitter({ side, collapsed, ariaLabel, toggle, resize, reset, onResizeActiveChange }: {
  side: "left" | "right";
  collapsed: boolean;
  ariaLabel: string;
  toggle(): void;
  resize(delta: number): void;
  reset(): void;
  onResizeActiveChange?(active: boolean): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={`column-splitter${collapsed ? " is-collapsed" : ""}`}
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      tabIndex={0}
      onDoubleClick={reset}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
        if (event.key === "ArrowLeft") resize(side === "left" ? -16 : 16);
        if (event.key === "ArrowRight") resize(side === "left" ? 16 : -16);
        if (event.key === "Home") reset();
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button") || collapsed) return;
        const element = ref.current;
        element?.setPointerCapture(event.pointerId);
        onResizeActiveChange?.(true);
        let previous = event.clientX;
        let accumulated = 0;
        let finished = false;
        const move = (moveEvent: PointerEvent) => {
          const delta = moveEvent.clientX - previous;
          resize(delta);
          accumulated += delta;
          previous = moveEvent.clientX;
        };
        const key = (keyEvent: KeyboardEvent) => {
          if (keyEvent.key !== "Escape") return;
          resize(-accumulated);
          up();
        };
        const up = () => {
          if (finished) return;
          finished = true;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          window.removeEventListener("keydown", key);
          onResizeActiveChange?.(false);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up, { once: true });
        window.addEventListener("pointercancel", up, { once: true });
        window.addEventListener("keydown", key);
      }}
    >
      <button data-motion="icon" aria-label={collapsed ? "展开面板" : "收起面板"} title={collapsed ? "展开面板" : "收起面板"} onClick={toggle}>{side === "left" ? (collapsed ? "›" : "‹") : (collapsed ? "‹" : "›")}</button>
    </div>
  );
}

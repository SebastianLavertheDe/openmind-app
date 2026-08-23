import type { ReactNode } from "react";
import { messages as m } from "@shared/messages";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="ui-page-header">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="ui-page-actions">{actions}</div> : null}
    </header>
  );
}

export function ResizablePane({
  children,
  width,
  minWidth = 180,
  maxWidth = 720,
  side = "right",
  onResize
}: {
  children: ReactNode;
  width: number;
  minWidth?: number;
  maxWidth?: number;
  side?: "left" | "right";
  onResize(width: number): void;
}) {
  return (
    <section className="ui-resizable-pane" style={{ width }}>
      {children}
      <div
        className={`ui-resize-handle ${side}`}
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        onDoubleClick={() => onResize(Math.round((minWidth + maxWidth) / 2))}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const direction = event.key === "ArrowRight" ? 1 : -1;
          onResize(Math.min(maxWidth, Math.max(minWidth, width + direction * 16)));
        }}
        onPointerDown={(event) => {
          const start = event.clientX;
          const initial = width;
          const move = (moveEvent: PointerEvent) => {
            const delta = (moveEvent.clientX - start) * (side === "right" ? 1 : -1);
            onResize(Math.min(maxWidth, Math.max(minWidth, initial + delta)));
          };
          const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", stop, { once: true });
          window.addEventListener("pointercancel", stop, { once: true });
        }}
      />
    </section>
  );
}

export function CollapsiblePane({
  collapsed,
  label,
  children,
  onToggle
}: {
  collapsed: boolean;
  label: string;
  children: ReactNode;
  onToggle(): void;
}) {
  return collapsed
    ? <button className="ui-collapsed-pane" aria-label={m.designSystem.expand(label)} title={m.designSystem.expand(label)} onClick={onToggle}><span>{label}</span></button>
    : <section className="ui-collapsible-pane">{children}</section>;
}

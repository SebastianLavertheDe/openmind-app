import { createElement, useEffect, useRef, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useExitPresence } from "./use-exit-presence";
import { useModalFocusScope } from "./use-modal-focus-scope";
import type { DialogLayout, DialogSize } from "./control-contract";

type Presence = ReturnType<typeof useExitPresence>;

export type DialogProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  open: boolean;
  onClose(): void;
  children: ReactNode;
  backdropClassName?: string;
  containerRef?: RefObject<HTMLElement | null>;
  triggerRef?: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Used when there is no explicit ref; falls back to the first focusable child. */
  initialFocusSelector?: string;
  layer?: "drawer" | "modal" | "global";
  dismissDisabled?: boolean;
  exitMs?: number;
  /** Owners retaining data snapshots can share their presence with the shell. */
  presence?: Presence;
  portal?: boolean;
  as?: "div" | "section";
  onExited?(): void;
  retainFocusDuringExit?: boolean;
  size?: DialogSize;
  /** Fixed shells keep their geometry while their body content changes. */
  layout?: DialogLayout;
  /** ImageViewer owns a media canvas rather than form chrome. */
  surface?: "panel" | "media";
};

/** Exactly one presence owner. Retained feature snapshots add no second timer/subscription. */
export function Dialog(props: DialogProps) {
  return props.presence ? <DialogSurface {...props} presence={props.presence} /> : <DialogWithPresence {...props} />;
}

function DialogWithPresence(props: DialogProps) {
  const presence = useExitPresence(props.open, props.exitMs ?? 160);
  return <DialogSurface {...props} presence={presence} />;
}

function DialogSurface({
  open, onClose, children, backdropClassName = "", className = "", size = "md", layout = "content", surface = "panel",
  containerRef, triggerRef, initialFocusRef, initialFocusSelector, layer = "global", dismissDisabled = false,
  exitMs: _exitMs, presence, portal = true, as = "div", onExited, retainFocusDuringExit = false, ...attributes
}: DialogProps & { presence: Presence }) {
  const localRef = useRef<HTMLElement>(null);
  const ref = containerRef || localRef;
  const content = useRef(children);
  if (open) content.current = children;
  const dismiss = () => { if (!dismissDisabled) onClose(); };
  useModalFocusScope({ open: open || (retainFocusDuringExit && presence.visible), containerRef: ref, triggerRef, initialFocusRef, initialFocusSelector, onDismiss: dismiss, layer });
  const wasVisible = useRef(false);
  const dismissedOnMouseDown = useRef(false);
  useEffect(() => {
    if (presence.visible) wasVisible.current = true;
    else if (wasVisible.current) { wasVisible.current = false; onExited?.(); }
  }, [onExited, presence.visible]);
  if (!presence.visible) return null;
  const dialog = <div className={`ui-dialog-backdrop ${backdropClassName}`.trim()} data-focus-scope-backdrop data-ui-dialog data-layer={layer}
    data-leaving={presence.leaving || undefined} aria-hidden={!open || undefined} inert={!open || undefined}
    onMouseDown={event => { dismissedOnMouseDown.current = event.target === event.currentTarget; if (dismissedOnMouseDown.current) dismiss(); }}
    onClick={event => { if (event.target === event.currentTarget && !dismissedOnMouseDown.current) dismiss(); dismissedOnMouseDown.current = false; }}>
    {createElement(as, {
      ...attributes, ref, className: `${surface === "panel" ? "ui-dialog" : "ui-dialog-media"} ${className}`.trim(),
      "data-ui-control": "dialog",
      "data-size": size, "data-layout": layout, role: attributes.role || "dialog", "aria-modal": true,
      tabIndex: attributes.tabIndex ?? -1,
      onMouseDown: (event: React.MouseEvent<HTMLElement>) => { event.stopPropagation(); attributes.onMouseDown?.(event); },
      onClick: (event: React.MouseEvent<HTMLElement>) => { event.stopPropagation(); attributes.onClick?.(event); }
    }, open ? children : content.current)}
  </div>;
  return portal ? createPortal(dialog, document.body) : dialog;
}

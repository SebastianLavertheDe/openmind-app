import { createElement, useEffect, useRef, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useExitPresence } from "./use-exit-presence";
import { useModalFocusScope } from "./use-modal-focus-scope";

type Presence = ReturnType<typeof useExitPresence>;

/** Common modal shell; feature code owns its header, form, footer and layout. */
export function Dialog({
  open, onClose, children, backdropClassName = "modal-scrim ui-overlay", className = "modal-card",
  containerRef, triggerRef, initialFocusRef, layer = "global", dismissDisabled = false,
  exitMs = 160, presence: retainedPresence, portal = true, as = "div", onExited, retainFocusDuringExit = false, ...attributes
}: Omit<HTMLAttributes<HTMLElement>, "children"> & {
  open: boolean;
  onClose(): void;
  children: ReactNode;
  backdropClassName?: string;
  containerRef?: RefObject<HTMLElement | null>;
  triggerRef?: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  layer?: "drawer" | "modal" | "global";
  dismissDisabled?: boolean;
  exitMs?: number;
  /** Owners retaining data snapshots can share their presence with the shell. */
  presence?: Presence;
  portal?: boolean;
  as?: "div" | "section";
  onExited?(): void;
  retainFocusDuringExit?: boolean;
}) {
  const localRef = useRef<HTMLElement>(null);
  const ref = containerRef || localRef;
  const ownPresence = useExitPresence(open && !retainedPresence, exitMs);
  const presence = retainedPresence || ownPresence;
  const content = useRef(children);
  if (open) content.current = children;
  const dismiss = () => { if (!dismissDisabled) onClose(); };
  useModalFocusScope({ open: open || (retainFocusDuringExit && presence.visible), containerRef: ref, triggerRef, initialFocusRef, onDismiss: dismiss, layer });
  const wasVisible = useRef(false);
  const dismissedOnMouseDown = useRef(false);
  useEffect(() => {
    if (presence.visible) wasVisible.current = true;
    else if (wasVisible.current) { wasVisible.current = false; onExited?.(); }
  }, [onExited, presence.visible]);
  if (!presence.visible) return null;
  const dialog = <div className={backdropClassName} data-focus-scope-backdrop data-ui-dialog
    data-leaving={presence.leaving || undefined} aria-hidden={!open || undefined} inert={!open || undefined}
    onMouseDown={event => { dismissedOnMouseDown.current = event.target === event.currentTarget; if (dismissedOnMouseDown.current) dismiss(); }}
    onClick={event => { if (event.target === event.currentTarget && !dismissedOnMouseDown.current) dismiss(); dismissedOnMouseDown.current = false; }}>
    {createElement(as, {
      ...attributes, ref, className, role: attributes.role || "dialog", "aria-modal": true,
      tabIndex: attributes.tabIndex ?? -1,
      onMouseDown: (event: React.MouseEvent<HTMLElement>) => { event.stopPropagation(); attributes.onMouseDown?.(event); },
      onClick: (event: React.MouseEvent<HTMLElement>) => { event.stopPropagation(); attributes.onClick?.(event); }
    }, open ? children : content.current)}
  </div>;
  return portal ? createPortal(dialog, document.body) : dialog;
}

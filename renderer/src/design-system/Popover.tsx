import { forwardRef, useRef, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover, type AnchoredPopoverAlign, type AnchoredPopoverSide } from "./use-anchored-popover";
import { useDismissableLayer } from "./use-dismissable-layer";
import { useExitPresence } from "./use-exit-presence";
import { useModalFocusScope } from "./use-modal-focus-scope";
import type { PopoverVariant } from "./control-contract";

type Position = Pick<CSSProperties, "position" | "left" | "top" | "right" | "bottom" | "width" | "minWidth" | "maxWidth" | "maxHeight" | "transform" | "zIndex">;

export interface PopoverSurfaceProps extends Omit<ComponentPropsWithoutRef<"div">, "style" | "role"> {
  role?: "dialog" | "menu" | "listbox";
  /** Menus use a compact inset; anchor layers wrap another shared surface. */
  variant?: PopoverVariant;
  position?: Position;
}

/** For owners with optimized positioning/keyboard logic, share the surface without duplicating observers. */
export const PopoverSurface = forwardRef<HTMLDivElement, PopoverSurfaceProps>(function PopoverSurface({
  className = "", role = "dialog", variant = "panel", position, ...props
}, ref) {
  return <div {...props} ref={ref} role={role} style={position} data-ui-control="popover" data-variant={variant}
    className={`ui-popover-surface ${className}`.trim()} />;
});

export function Popover({ open, anchorRef, onClose, children, modal = false, side = "bottom", align = "end", ...props }: Omit<PopoverSurfaceProps, "position"> & {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose(): void;
  children: ReactNode;
  modal?: boolean;
  side?: AnchoredPopoverSide;
  align?: AnchoredPopoverAlign;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const presence = useExitPresence(open, 160);
  const snapshot = useRef(children);
  if (open) snapshot.current = children;
  const placement = useAnchoredPopover({ open: presence.visible, anchorRef, floatingRef: ref, preferredSide: side, align });
  useDismissableLayer({ open: open && !modal, contentRefs: [ref], triggerRef: anchorRef, onDismiss: onClose });
  useModalFocusScope({ open: open && modal, containerRef: ref, triggerRef: anchorRef, onDismiss: onClose, dismissOnOutside: true, layer: "global" });
  return presence.visible ? createPortal(<PopoverSurface {...props} ref={ref} position={placement.style}
    aria-modal={modal || undefined} data-side={placement.side} data-leaving={presence.leaving || undefined}
    aria-hidden={!open || undefined} inert={!open}>{open ? children : snapshot.current}</PopoverSurface>, document.body) : null;
}

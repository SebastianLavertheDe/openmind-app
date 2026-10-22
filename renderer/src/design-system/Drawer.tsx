import { useRef, type HTMLAttributes, type RefObject } from "react";
import { useModalFocusScope } from "./use-modal-focus-scope";

/** App chrome supplies its geometry; a drawer owns its modal semantics and focus scope. */
export function Drawer({ modal, open, onClose, containerRef, triggerRef, layer = "modal", ...props }: Omit<HTMLAttributes<HTMLElement>, "role"> & {
  modal: boolean;
  open: boolean;
  onClose(): void;
  containerRef?: RefObject<HTMLElement | null>;
  triggerRef?: RefObject<HTMLElement | null>;
  layer?: "drawer" | "modal" | "global";
}) {
  const ownRef = useRef<HTMLElement>(null);
  const ref = containerRef || ownRef;
  useModalFocusScope({ open: modal && open, containerRef: ref, triggerRef, onDismiss: onClose, layer });
  return <aside {...props} ref={ref} role={modal ? "dialog" : undefined} aria-modal={modal && open || undefined} />;
}

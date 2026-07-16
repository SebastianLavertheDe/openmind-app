import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "details > summary:first-of-type",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

type InertSnapshot = { element: HTMLElement; inert: boolean; ariaHidden: string | null };

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((element) => !element.closest("[inert]") && element.getAttribute("aria-hidden") !== "true");
}

/**
 * Modal focus scope shared by drawers and dialogs.
 *
 * It owns the complete interaction contract: focus enters the surface, Tab is
 * contained, Escape dismisses, background siblings become inert, and focus is
 * restored to the original trigger when the surface closes.
 */
export function useModalFocusScope({
  open,
  containerRef,
  triggerRef,
  onDismiss
}: {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  triggerRef?: RefObject<HTMLElement | null>;
  onDismiss(): void;
}): void {
  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const returnTarget = triggerRef?.current
      || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const parent = container.parentElement;
    const inertSnapshots: InertSnapshot[] = [];
    if (parent) {
      Array.from(parent.children).forEach((child) => {
        if (!(child instanceof HTMLElement) || child === container || child.dataset.focusScopeBackdrop != null) return;
        inertSnapshots.push({
          element: child,
          inert: Boolean(child.inert),
          ariaHidden: child.getAttribute("aria-hidden")
        });
        child.inert = true;
        child.setAttribute("aria-hidden", "true");
      });
    }

    const frame = window.requestAnimationFrame(() => {
      const targets = focusableElements(container);
      (targets[0] || container).focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (event.key !== "Tab") return;
      const targets = focusableElements(container);
      if (!targets.length) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = targets[0];
      const last = targets.at(-1) || first;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      inertSnapshots.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden == null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      // The trigger may be conditionally rendered (for example, an AI rail
      // button that replaces a modal canvas). Read it again after the close
      // commit so focus can return to the newly mounted trigger instance.
      window.requestAnimationFrame(() => (triggerRef?.current || returnTarget)?.focus());
    };
  }, [containerRef, onDismiss, open, triggerRef]);
}

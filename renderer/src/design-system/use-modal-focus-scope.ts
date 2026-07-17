import { useEffect, useRef, type RefObject } from "react";

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

type ModalLayer = "drawer" | "modal" | "global";

type ActiveModalScope = {
  id: symbol;
  container: HTMLElement;
  layer: ModalLayer;
  sequence: number;
};

type InertState = {
  owners: number;
  inert: boolean;
  ariaHidden: string | null;
};

const LAYER_PRIORITY: Record<ModalLayer, number> = {
  drawer: 0,
  modal: 1,
  global: 2
};
const activeModalScopes: ActiveModalScope[] = [];
const inertStates = new WeakMap<HTMLElement, InertState>();
let modalScopeSequence = 0;

function topModalScope(): ActiveModalScope | undefined {
  return activeModalScopes.reduce<ActiveModalScope | undefined>((top, scope) => {
    if (!top || LAYER_PRIORITY[scope.layer] > LAYER_PRIORITY[top.layer]) return scope;
    if (scope.layer === top.layer && scope.sequence > top.sequence) return scope;
    return top;
  }, undefined);
}

function acquireInert(element: HTMLElement): void {
  const current = inertStates.get(element);
  if (current) {
    current.owners += 1;
    return;
  }
  inertStates.set(element, {
    owners: 1,
    inert: Boolean(element.inert),
    ariaHidden: element.getAttribute("aria-hidden")
  });
  element.inert = true;
  element.setAttribute("aria-hidden", "true");
}

function releaseInert(element: HTMLElement): void {
  const current = inertStates.get(element);
  if (!current) return;
  current.owners -= 1;
  if (current.owners > 0) return;
  inertStates.delete(element);
  if (element.inert) element.inert = current.inert;
  if (element.getAttribute("aria-hidden") === "true") {
    if (current.ariaHidden == null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", current.ariaHidden);
  }
}

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
  onDismiss,
  layer = "modal"
}: {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  triggerRef?: RefObject<HTMLElement | null>;
  onDismiss(): void;
  layer?: ModalLayer;
}): void {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const scope: ActiveModalScope = {
      id: Symbol("modal-focus-scope"),
      container,
      layer,
      sequence: modalScopeSequence += 1
    };
    activeModalScopes.push(scope);

    const returnTarget = triggerRef?.current
      || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const parent = container.parentElement;
    const inertElements: HTMLElement[] = [];
    if (parent) {
      Array.from(parent.children).forEach((child) => {
        if (!(child instanceof HTMLElement) || child === container || child.dataset.focusScopeBackdrop != null) return;
        inertElements.push(child);
        acquireInert(child);
      });
    }

    const frame = window.requestAnimationFrame(() => {
      if (topModalScope()?.id !== scope.id) return;
      const targets = focusableElements(container);
      (targets[0] || container).focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || topModalScope()?.id !== scope.id) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onDismissRef.current();
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
      const wasTop = topModalScope()?.id === scope.id;
      const scopeIndex = activeModalScopes.findIndex((candidate) => candidate.id === scope.id);
      if (scopeIndex >= 0) activeModalScopes.splice(scopeIndex, 1);
      const nextTop = topModalScope();
      inertElements.forEach(releaseInert);
      if (!wasTop) return;
      // The trigger may be conditionally rendered (for example, an AI rail
      // button that replaces a modal canvas). Read it again after the close
      // commit so focus can return to the newly mounted trigger instance. A
      // newer modal may mount in the same commit, so restore only if the stack
      // is unchanged when this frame runs.
      window.requestAnimationFrame(() => {
        if (topModalScope()?.id !== nextTop?.id) return;
        const preferredTarget = triggerRef?.current || returnTarget;
        if (!nextTop) {
          preferredTarget?.focus();
          return;
        }
        const target = preferredTarget && nextTop.container.contains(preferredTarget)
          ? preferredTarget
          : focusableElements(nextTop.container)[0] || nextTop.container;
        target.focus();
      });
    };
  }, [containerRef, layer, open, triggerRef]);
}

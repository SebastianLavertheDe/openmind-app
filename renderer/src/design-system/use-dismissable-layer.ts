import { useEffect, useRef, type RefObject } from "react";

type ElementRef = RefObject<HTMLElement | null>;
export type DismissReason = "escape" | "outside";
type Layer = {
  contentRefs: ElementRef[];
  triggerRef?: ElementRef;
  modalPriority?: number;
  outside?: boolean;
  onDismiss(reason: DismissReason, event: KeyboardEvent | PointerEvent): void;
};
const layers: Layer[] = [];
const subscribers = new Set<() => void>();
const contains = (layer: Layer, node: Node | null) => Boolean(node && layer.contentRefs.some(ref => ref.current?.contains(node)));

function belongsTo(layer: Layer, container: HTMLElement, visited = new Set<Layer>()): boolean {
  if (visited.has(layer)) return false;
  visited.add(layer);
  const ownerPriority = layers.find(candidate => candidate.contentRefs.some(ref => ref.current === container))?.modalPriority;
  // Responsive chrome can become modal while focus remains in a global dialog.
  // Its captured return target is not evidence that the lower modal (or its
  // menus) belongs to the higher dialog's interactive branch.
  if (ownerPriority != null && layer.modalPriority != null && layer.modalPriority < ownerPriority) return false;
  const origin = layer.triggerRef?.current;
  if (origin && container.contains(origin)) return true;
  if (layer.contentRefs.some(ref => ref.current && container.contains(ref.current))) return true;
  return Boolean(origin && layers.some(parent => parent !== layer && contains(parent, origin) && belongsTo(parent, container, visited)));
}

function topLayer(): Layer | undefined {
  const modal = layers.filter(layer => layer.modalPriority != null).reduce<Layer | undefined>((top, layer) =>
    !top || layer.modalPriority! >= top.modalPriority! ? layer : top, undefined);
  const container = modal?.contentRefs[0]?.current;
  const eligible = layers.filter(layer => layer === modal || (layer.modalPriority == null && (!container || belongsTo(layer, container))));
  return eligible.reduce<Layer | undefined>((top, layer) => {
    if (!top) return layer;
    const topContainer = top.contentRefs[0]?.current;
    const nextContainer = layer.contentRefs[0]?.current;
    if (topContainer && belongsTo(layer, topContainer)) return layer;
    if (nextContainer && belongsTo(top, nextContainer)) return top;
    return layer;
  }, undefined);
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const top = topLayer();
  if (!top) return;
  event.preventDefault();
  event.stopPropagation();
  top.onDismiss("escape", event);
}
function onPointerDown(event: PointerEvent) {
  const top = topLayer();
  const target = event.target as Node | null;
  if (!top?.outside || contains(top, target) || top.triggerRef?.current?.contains(target)) return;
  top.onDismiss("outside", event);
}

/** Shared registry lets nested portals dismiss before their enclosing modal. */
export function registerDismissableLayer(layer: Layer): () => void {
  if (!layers.length) {
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown);
  }
  layers.push(layer);
  subscribers.forEach(notify => notify());
  return () => {
    const index = layers.indexOf(layer);
    if (index >= 0) layers.splice(index, 1);
    if (!layers.length) {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown);
    }
    subscribers.forEach(notify => notify());
  };
}

export function subscribeDismissableLayers(notify: () => void): () => void {
  subscribers.add(notify);
  return () => { subscribers.delete(notify); };
}

export function isDismissableBranch(element: HTMLElement, container: HTMLElement): boolean {
  return layers.some(layer => belongsTo(layer, container) && layer.contentRefs.some(ref => ref.current && element.contains(ref.current)));
}

export function hasLayerAbove(container: HTMLElement): boolean {
  const top = topLayer();
  return Boolean(top && !top.contentRefs.some(ref => ref.current === container));
}

export function useDismissableLayer({ open, contentRefs, triggerRef, onDismiss, outside = true, restoreFocus = true }: Layer & {
  open: boolean;
  restoreFocus?: boolean;
}): void {
  const latest = useRef({ contentRefs, triggerRef, onDismiss, outside, restoreFocus });
  latest.current = { contentRefs, triggerRef, onDismiss, outside, restoreFocus };
  useEffect(() => {
    if (!open) return;
    return registerDismissableLayer({
      get contentRefs() { return latest.current.contentRefs; },
      get triggerRef() { return latest.current.triggerRef; },
      get outside() { return latest.current.outside; },
      onDismiss(reason, event) {
        latest.current.onDismiss(reason, event);
        if (reason === "escape" && latest.current.restoreFocus) latest.current.triggerRef?.current?.focus();
      }
    });
  }, [open]);
}

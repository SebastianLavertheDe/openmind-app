import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { registerDismissableLayer } from "./use-dismissable-layer";

type ResizeSession = {
  move(delta: number, total: number): void;
  end(cancelled: boolean): void;
};

/** Shared pointer lifetime, frame batching and cancellation; consumers own geometry. */
export function usePointerResize(prepare: (event: ReactPointerEvent<HTMLElement>) => ResizeSession, enabled = true) {
  const latest = useRef(prepare);
  latest.current = prepare;
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), [enabled]);
  return (event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button > 0 || event.isPrimary === false) return;
    event.preventDefault();
    cancel.current?.();
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    const start = event.clientX;
    let previous = start;
    let position = start;
    let frame = 0;
    let finished = false;
    try { element.setPointerCapture?.(pointerId); } catch { /* Capture can be unavailable after cancellation. */ }
    const session = latest.current(event);
    const commit = () => {
      frame = 0;
      const delta = position - previous;
      previous = position;
      if (delta) session.move(delta, position - start);
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      position = next.clientX;
      if (!frame) frame = window.requestAnimationFrame(commit);
    };
    const finish = (cancelled: boolean) => {
      if (finished) return;
      finished = true;
      if (frame) window.cancelAnimationFrame(frame);
      if (!cancelled) commit();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      element.removeEventListener("lostpointercapture", stop);
      unregister();
      cancel.current = null;
      try { element.releasePointerCapture?.(pointerId); } catch { /* The browser may already have released it. */ }
      session.end(cancelled);
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      position = next.clientX;
      finish(false);
    };
    const stop = (next?: Event) => {
      if (next && "pointerId" in next && next.pointerId !== pointerId) return;
      finish(true);
    };
    const unregister = registerDismissableLayer({ contentRefs: [{ current: element }], triggerRef: { current: element }, onDismiss: () => stop() });
    cancel.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    element.addEventListener("lostpointercapture", stop);
  };
}

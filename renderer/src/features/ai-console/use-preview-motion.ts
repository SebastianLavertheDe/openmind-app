import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { FilePreviewLayoutMode } from "./file-preview-layout";

/** Lay out each pane once, then carry the conversation between those two boxes. */
export function usePreviewMotion(conversation: RefObject<HTMLElement | null>, open: boolean, visible: boolean, mode: FilePreviewLayoutMode) {
  const first = useRef<DOMRect | null>(null);
  const animation = useRef<Animation | null>(null);
  const capture = useCallback(() => {
    first.current = conversation.current?.getBoundingClientRect() || null;
  }, [conversation]);
  const cancel = useCallback(() => {
    first.current = null;
    animation.current?.cancel();
    animation.current = null;
  }, []);

  useLayoutEffect(() => {
    // Exit presence mounts the preview on the commit after open changes.
    // Keep the old box until that commit has installed the final split layout.
    if (open && !visible) return;
    const from = first.current;
    first.current = null;
    animation.current?.cancel();
    animation.current = null;
    const element = conversation.current;
    if (!from || !element || mode !== "split" || !element.animate
      || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const to = element.getBoundingClientRect();
    if (!from.width || !to.width) return;
    const dx = from.left - to.left;
    const scale = from.width / to.width;
    if (Math.abs(dx) < .5 && Math.abs(from.width - to.width) < .5) return;
    const active = element.animate([
      { transformOrigin: "top left", transform: `translateX(${dx}px) scaleX(${scale})` },
      { transformOrigin: "top left", transform: "translateX(0) scaleX(1)" }
    ], { duration: 240, easing: "cubic-bezier(.3, 0, 0, 1)", fill: "both" });
    animation.current = active;
    void active.finished.catch(() => {}).finally(() => {
      if (animation.current !== active) return;
      animation.current = null;
      active.cancel();
    });
  }, [conversation, mode, open, visible]);

  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const reduce = () => { if (preference?.matches) cancel(); };
    preference?.addEventListener("change", reduce);
    window.addEventListener("resize", cancel);
    return () => {
      preference?.removeEventListener("change", reduce);
      window.removeEventListener("resize", cancel);
      cancel();
    };
  }, [cancel]);

  return { capture, cancel };
}

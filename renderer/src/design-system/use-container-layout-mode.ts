import { useCallback, useLayoutEffect, useRef, useState, type RefCallback, type RefObject } from "react";

export type ContainerLayoutMode = "split" | "stacked";

/**
 * Owns a component breakpoint from the component's measured inline size.
 * A zero measurement is ignored because jsdom and hidden Electron views can
 * transiently report zero before their first real layout.
 */
export function useContainerLayoutMode<T extends HTMLElement = HTMLElement>({
  splitMinInlineSize,
  initialMode = "split"
}: {
  splitMinInlineSize: number;
  initialMode?: ContainerLayoutMode;
}): { ref: RefCallback<T>; elementRef: RefObject<T | null>; mode: ContainerLayoutMode; inlineSize: number | null } {
  const elementRef = useRef<T>(null);
  const [element, setElement] = useState<T | null>(null);
  const [inlineSize, setInlineSize] = useState<number | null>(null);
  const ref = useCallback<RefCallback<T>>((nextElement) => {
    elementRef.current = nextElement;
    setElement((current) => current === nextElement ? current : nextElement);
  }, []);

  useLayoutEffect(() => {
    if (!element) return;
    let frame = 0;
    const commit = (width: number) => {
      if (!Number.isFinite(width) || width <= 0) return;
      setInlineSize((current) => current === width ? current : width);
    };
    const measure = () => {
      frame = 0;
      commit(element.getBoundingClientRect().width);
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === element);
      if (!entry) return;
      const borderBox = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize;
      commit(borderBox?.inlineSize || element.getBoundingClientRect().width);
    });
    observer?.observe(element, { box: "border-box" });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [element]);

  return {
    ref,
    elementRef,
    inlineSize,
    mode: inlineSize === null ? initialMode : inlineSize >= splitMinInlineSize ? "split" : "stacked"
  };
}

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** Limit live layout animation to an explicit toggle, and share the document
 * resize path so virtual rows do not invalidate their entire cache each frame. */
export function useNavigationMotion(nav: RefObject<HTMLElement | null>, collapsed: boolean, setCollapsed: (value: boolean) => void, enabled: boolean, page: string) {
  const desired = useRef(collapsed);
  const timer = useRef<number | undefined>(undefined);
  const shell = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { desired.current = collapsed; }, [collapsed]);
  const stop = useCallback(() => {
    window.clearTimeout(timer.current);
    shell.current?.removeAttribute("data-nav-transitioning");
    shell.current = null;
  }, []);

  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const reduce = () => { if (preference?.matches) stop(); };
    const finish = (event: TransitionEvent) => {
      if (event.target === shell.current && event.propertyName === "grid-template-columns") stop();
    };
    window.addEventListener("resize", stop);
    preference?.addEventListener("change", reduce);
    document.addEventListener("transitionend", finish);
    return () => {
      window.removeEventListener("resize", stop);
      preference?.removeEventListener("change", reduce);
      document.removeEventListener("transitionend", finish);
      stop();
    };
  }, [enabled, page, stop]);

  return useCallback(() => {
    const element = nav.current?.closest<HTMLElement>(".app-shell");
    if (enabled && element && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      shell.current = element;
      // A data attribute survives React updating the shell's responsive class
      // when a companion switches between an attached panel and an overlay.
      element.setAttribute("data-nav-transitioning", "");
      // Read the design token before committing the new width. Reversals keep
      // the current interpolated width; CSS retargets the running transition.
      const duration = getComputedStyle(element).getPropertyValue("--dur-slow").trim();
      const milliseconds = parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000) || 240;
      window.clearTimeout(timer.current);
      // A pair of clicks batched into the same commit can leave no transition
      // to end. Always release the resize guard, including hidden windows.
      timer.current = window.setTimeout(stop, milliseconds + 80);
    } else stop();
    desired.current = !desired.current;
    setCollapsed(desired.current);
  }, [enabled, nav, setCollapsed, stop]);
}

import { useEffect, useRef, useState } from "react";
import { useMotionPreference } from "./use-motion-preference";

/**
 * Keeps a conditionally-rendered overlay mounted briefly so it can play a CSS
 * exit animation before unmount. Pair with `[data-leaving]` styling.
 *
 * - open=true  -> visible immediately, leaving=false
 * - open=false -> leaving=true for exitMs (skipped under prefers-reduced-motion),
 *                 then visible=false (the consumer stops rendering)
 *
 * The consumer renders while `visible`, applies `data-leaving={leaving || undefined}`,
 * and on close just sets its own open state to false — the hook handles the delayed unmount.
 */
export function useExitPresence(open: boolean, exitMs: number): { visible: boolean; leaving: boolean } {
  const reduced = useMotionPreference();
  const [visible, setVisible] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    if (open) {
      setLeaving(false);
      if (!visibleRef.current) setVisible(true);
      return;
    }
    if (!visibleRef.current) return;
    if (reduced || exitMs <= 0) { setVisible(false); setLeaving(false); return; }
    setLeaving(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setLeaving(false);
      setVisible(false);
    }, exitMs);
    // visibleRef is read intentionally to avoid re-triggering on visible changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exitMs, reduced]);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  return { visible: open || (visible && !reduced), leaving: !open && !reduced && leaving };
}

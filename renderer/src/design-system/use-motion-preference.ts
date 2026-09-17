import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";
function subscribe(change: () => void) {
  const media = window.matchMedia?.(query);
  media?.addEventListener?.("change", change);
  return () => media?.removeEventListener?.("change", change);
}
const snapshot = () => Boolean(typeof window !== "undefined" && window.matchMedia?.(query).matches);

/** React to live preference changes too, including an in-flight exit. */
export function useMotionPreference() {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}

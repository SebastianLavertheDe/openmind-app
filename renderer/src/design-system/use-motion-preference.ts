import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";
const subscribers = new Set<() => void>();
let media: MediaQueryList | null = null;
const notify = () => subscribers.forEach(change => change());
function subscribe(change: () => void) {
  if (!subscribers.size) {
    media ||= window.matchMedia?.(query) || null;
    media?.addEventListener?.("change", notify);
  }
  subscribers.add(change);
  return () => {
    subscribers.delete(change);
    if (!subscribers.size) {
      media?.removeEventListener?.("change", notify);
      media = null;
    }
  };
}
const snapshot = () => {
  if (typeof window === "undefined") return false;
  media ||= window.matchMedia?.(query) || null;
  return Boolean(media?.matches);
};

/** One OS listener for all controls, including live preference changes during exit. */
export function useMotionPreference() {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMotionPreference } from "./use-motion-preference";

/**
 * List presence: keeps removed items mounted briefly so each can play a CSS
 * exit animation before unmount — IN PLACE (no jump to the end of the list).
 * Pair with `[data-leaving]` styling per item.
 *
 * Design (concurrent-render safe):
 * - `committedRef` holds the last COMMITTED display list (present + exiting
 *   entries). It is written only in a layout effect (post-commit), so discarded
 *   or interrupted renders never pollute it.
 * - Render is PURE: it reads committedRef and the current items, and outputs
 *   present items plus any committed item no longer present (rendered as
 *   `leaving`). Because a removed item is already in committedRef, it appears in
 *   this render's output the moment it leaves `items` — so React never unmounts
 *   and remounts it (which would replay its enter animation). No setState, no
 *   ref writes happen during render.
 * - The layout effect snapshots the new display list into committedRef and
 *   schedules exit timers (idempotent via timersRef) there.
 *
 * Present items always follow the current input order. Removed items are woven
 * back beside their nearest surviving neighbour from the committed order so
 * they can leave in place without pinning live items to a stale order.
 */
export function useExitingList<T>(items: T[], getKey: (item: T) => string, exitMs: number): { item: T; leaving: boolean }[] {
  type Entry = { item: T; leaving: boolean };
  const skipExit = useMotionPreference() || exitMs <= 0;
  const committedRef = useRef<Entry[]>(items.map((item) => ({ item, leaving: false })));
  const timersRef = useRef<Map<string, number>>(new Map());
  const [, setVersion] = useState(0);

  const presentByKey = new Map(items.map((i) => [getKey(i), i]));

  const committed = skipExit ? [] : committedRef.current;
  const renderList: Entry[] = items.map((item) => ({ item, leaving: false }));
  const committedKeys = committed.map((entry) => getKey(entry.item));
  const trailingCounts = new Map<string, number>();

  for (let committedIndex = 0; committedIndex < committed.length; committedIndex++) {
    const entry = committed[committedIndex];
    const key = committedKeys[committedIndex];
    if (presentByKey.has(key)) continue;

    const nextPresentKey = committedKeys
      .slice(committedIndex + 1)
      .find((candidate) => presentByKey.has(candidate));
    if (nextPresentKey) {
      const nextIndex = renderList.findIndex((candidate) => getKey(candidate.item) === nextPresentKey);
      renderList.splice(nextIndex < 0 ? renderList.length : nextIndex, 0, { item: entry.item, leaving: true });
      continue;
    }

    const previousPresentKey = committedKeys
      .slice(0, committedIndex)
      .reverse()
      .find((candidate) => presentByKey.has(candidate));
    if (previousPresentKey) {
      const previousIndex = renderList.findIndex((candidate) => getKey(candidate.item) === previousPresentKey);
      const trailingCount = trailingCounts.get(previousPresentKey) || 0;
      renderList.splice(previousIndex + trailingCount + 1, 0, { item: entry.item, leaving: true });
      trailingCounts.set(previousPresentKey, trailingCount + 1);
      continue;
    }

    renderList.push({ item: entry.item, leaving: true });
  }

  useLayoutEffect(() => {
    committedRef.current = renderList;

    if (skipExit) {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current.clear();
      return;
    }

    // Cancel any pending exit timer for items that are present again (revived)
    // before scheduling new exits. Revived items render as leaving:false, so the
    // scheduling loop below would otherwise skip them and leave a stale timer to
    // fire and reorder/remove the revived item.
    for (const item of items) {
      const key = getKey(item);
      const timer = timersRef.current.get(key);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timersRef.current.delete(key);
      }
    }

    for (const entry of renderList) {
      if (!entry.leaving) continue;
      const key = getKey(entry.item);
      if (timersRef.current.has(key)) continue;
      const timer = window.setTimeout(() => {
        timersRef.current.delete(key);
        committedRef.current = committedRef.current.filter((entry) => getKey(entry.item) !== key);
        setVersion((value) => value + 1);
      }, exitMs);
      timersRef.current.set(key, timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  useEffect(() => () => timersRef.current.forEach((t) => window.clearTimeout(t)), []);

  return renderList;
}

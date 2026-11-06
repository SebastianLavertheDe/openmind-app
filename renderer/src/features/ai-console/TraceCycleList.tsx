import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualFlow } from "../../components/document/use-virtual-flow";
import type { TraceStep } from "./timeline";
import { messages as m } from "@shared/messages";
import { useLocale } from "../../i18n";

export type TraceCycle = { key: string; steps: TraceStep[] };

/** Window complete process cycles inside the existing conversation scroller. */
export function TraceCycleList({ cycles, currentKey, renderCycle }: {
  cycles: TraceCycle[];
  currentKey: string | null;
  renderCycle(cycle: TraceCycle): ReactNode;
}) {
  useLocale();
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const pendingFocus = useRef<{ key: string; last: boolean } | null>(null);
  const keyAt = useCallback((index: number) => cycles[index].key, [cycles]);
  const pinned = useMemo(() => cycles.flatMap((cycle, index) =>
    cycle.key === currentKey || cycle.key === focusedKey || expandedKeys.has(cycle.key) ? [index] : []),
  [cycles, currentKey, focusedKey, expandedKeys]);
  const flow = useVirtualFlow({ count: cycles.length, keyAt, estimate: () => 100, pinned });
  const rows = flow.enabled ? flow.virtualizer.getVirtualItems() : cycles.map((cycle, index) => ({ key: cycle.key, index }));

  useLayoutEffect(() => {
    const element = flow.element;
    if (!element) return;
    // Disclosure state belongs to each existing control. Observe its public
    // ARIA contract so any expanded tool/reasoning/approval stays mounted,
    // without moving that feature state into the virtual list.
    const update = () => {
      setExpandedKeys(current => {
        const next = new Set(current);
        for (const row of element.children) {
          const key = (row as HTMLElement).dataset.traceKey;
          if (!key) continue;
          const expanded = [...row.querySelectorAll<HTMLElement>('[aria-expanded="true"], details[open]')]
            .some(control => !control.closest("[inert]"));
          if (expanded) next.add(key);
          else next.delete(key);
        }
        return current.size === next.size && [...current].every(key => next.has(key)) ? current : next;
      });
    };
    const observer = new MutationObserver(update);
    observer.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-expanded", "open"] });
    update();
    return () => observer.disconnect();
  }, [flow.element]);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const index = cycles.findIndex(cycle => cycle.key === pending.key);
    const row = flow.element?.querySelector<HTMLElement>(`[data-trace-index="${index}"]`);
    const controls = row ? focusableControls(row) : [];
    const target = (pending.last ? controls.at(-1) : controls[0]) || row;
    if (!target) return;
    pendingFocus.current = null;
    target.focus({ preventScroll: true });
  }, [cycles, flow.element, rows]);

  const focusCycle = (index: number, last = false) => {
    const cycle = cycles[index];
    if (!cycle) return;
    pendingFocus.current = { key: cycle.key, last };
    setFocusedKey(cycle.key);
    flow.virtualizer.scrollToIndex(index, { align: "auto" });
  };

  return <div ref={flow.ref} className={`trace-cycle-list${flow.enabled ? " is-virtual" : ""}`}
    role="list" aria-label={m.ai.chat.processed} tabIndex={flow.enabled ? 0 : undefined}
    onFocusCapture={event => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-trace-key]");
      if (row) setFocusedKey(row.dataset.traceKey || null);
    }}
    onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedKey(null);
    }}
    onKeyDownCapture={event => {
      if (!flow.enabled) return;
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>("[data-trace-index]");
      const index = row ? Number(row.dataset.traceIndex) : -1;
      if (event.key === "Tab" && row) {
        const controls = focusableControls(row);
        const edge = event.shiftKey ? controls[0] : controls.at(-1);
        const next = index + (event.shiftKey ? -1 : 1);
        if ((target === edge || target === row) && cycles[next] && !flow.element?.querySelector(`[data-trace-index="${next}"]`)) {
          event.preventDefault();
          focusCycle(next, event.shiftKey);
        }
        return;
      }
      // Nested command lists retain their own arrow navigation.
      if (target.closest(".command-group-list.is-virtual")) return;
      if (target !== event.currentTarget && target !== row && (!row || target !== focusableControls(row)[0])) return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      focusCycle(event.key === "Home" ? 0 : event.key === "End" ? cycles.length - 1
        : Math.min(cycles.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1))));
    }}>
    {rows.map(row => <div key={row.key} ref={flow.enabled ? flow.measureElement : undefined}
      data-index={row.index} data-trace-index={row.index} data-trace-key={cycles[row.index].key}
      className={`trace-cycle ${cycles[row.index].key === currentKey ? "current" : "completed"}`}
      data-trace-cycle={cycles[row.index].key === currentKey ? "current" : "completed"}
      role="listitem" tabIndex={flow.enabled ? -1 : undefined} aria-posinset={row.index + 1} aria-setsize={cycles.length}>
      {renderCycle(cycles[row.index])}
    </div>)}
  </div>;
}

function focusableControls(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
    .filter(element => !element.closest("[inert]"));
}

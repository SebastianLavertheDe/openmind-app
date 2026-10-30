import { useEffect, useState } from "react";
import { messages as m } from "@shared/messages";
import { Button } from "../../design-system/components";

export const SOURCE_PAGE_SIZE = 30;

/** IPC creates new objects even when nothing changed. Preserve card identities. */
export function reconcileSources<T extends { id: string }>(previous: T[], incoming: T[]): T[] {
  const byId = new Map(previous.map(row => [row.id, row]));
  const rows = incoming.map(row => {
    const old = byId.get(row.id);
    return old && JSON.stringify(old) === JSON.stringify(row) ? old : row;
  });
  return rows.length === previous.length && rows.every((row, index) => row === previous[index]) ? previous : rows;
}

export function useSourcePage<T>(rows: T[], scope: string) {
  const [state, setState] = useState({ scope, page: 1 });
  const pages = Math.max(1, Math.ceil(rows.length / SOURCE_PAGE_SIZE));
  const page = state.scope === scope ? Math.min(state.page, pages) : 1;
  // Commit a clamp/reset so later additions cannot unexpectedly restore an old page.
  useEffect(() => { if (state.scope !== scope || state.page !== page) setState({ scope, page }); }, [scope, page, state]);
  return { rows: rows.slice((page - 1) * SOURCE_PAGE_SIZE, page * SOURCE_PAGE_SIZE), page, pages,
    setPage: (next: number) => setState({ scope, page: Math.min(pages, Math.max(1, next)) }) };
}

export function SourcePagination({ page, pages, total, onChange }: { page: number; pages: number; total: number; onChange(page: number): void }) {
  if (pages <= 1) return null;
  return <div className="rss-pagination"><Button disabled={page === 1} onClick={() => onChange(page - 1)}>{m.rss.previous}</Button><span role="status">{m.rss.sourcePage(page, pages, total)}</span><Button disabled={page === pages} onClick={() => onChange(page + 1)}>{m.rss.next}</Button></div>;
}

/** Visible polling also covers CLI runs; events promptly refresh desktop runs. */
export function useSourceRefresh(load: () => Promise<void>, skillId: string, { initial = true, enabled = true }: { initial?: boolean; enabled?: boolean } = {}) {
  useEffect(() => {
    if (!enabled) return;
    let disposed = false, running = false, again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let eventTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (disposed) return;
      if (running) { again = true; return; }
      clearTimeout(timer); running = true;
      try { await load(); }
      catch { /* The owner presents read errors and keeps the previous rows. */ }
      finally {
        running = false;
        if (!disposed) {
          if (again) { again = false; void refresh(); }
          else timer = setTimeout(() => { if (document.visibilityState !== "hidden") void refresh(); }, 5000);
        }
      }
    };
    const changed = () => { clearTimeout(eventTimer); eventTimer = setTimeout(() => { if (document.visibilityState !== "hidden") void refresh(); }, 100); };
    const visibility = () => { if (document.visibilityState !== "hidden") changed(); };
    const offLegacy = window.openmind.onSkillEvent?.(event => { if (event.skillId === skillId && event.type === "status") changed(); });
    const offBroker = window.openmind.onSkillRunEvent?.(event => { if (!event.stream) changed(); });
    document.addEventListener("visibilitychange", visibility);
    if (initial) void refresh();
    else timer = setTimeout(() => { if (document.visibilityState !== "hidden") void refresh(); }, 5000);
    return () => { disposed = true; clearTimeout(timer); clearTimeout(eventTimer); offLegacy?.(); offBroker?.(); document.removeEventListener("visibilitychange", visibility); };
  }, [load, skillId, initial, enabled]);
}

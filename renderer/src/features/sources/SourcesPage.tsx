import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { RssDocumentView, RssRunInput, RssSourceView } from "@shared/rss-contracts";
import { messages as m } from "@shared/messages";
import { Button, EmptyState, ErrorState, IconButton, LoadingState, SearchInput, Tabs } from "../../design-system/components";
import { readWithDeadline } from "../../request-deadline";
import { useFeedback } from "../../feedback-context";
import { useLocale } from "../../i18n";
import { DailyPreferences } from "./DailyPreferences";
import { RssSourceCard } from "./RssSourceCard";
import { RssCategoryIcon } from "./RssCategoryIcon";
import { RssSourceDetails, type SourceSelection } from "./RssSourceDetails";
import { reconcileSources, SourcePagination, useSourcePage, useSourceRefresh } from "./source-list-state";
import { ALL_CATEGORY, selectSources } from "./rss-source-presentation";

export function SourcesPage({ presentation = "page" }: { presentation?: "page" | "embedded" | "settings" }) {
  const locale = useLocale();
  const feedback = useFeedback();
  const [document, setDocument] = useState<RssDocumentView | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORY);
  const [error, setError] = useState("");
  const [requests, setRequests] = useState<Record<string, string>>({});
  const pending = useRef(new Set<string>());
  const [selection, setSelection] = useState<SourceSelection | null>(null);
  const alive = useRef(true), loadSequence = useRef(0), selectionSequence = useRef(0);
  const documentRef = useRef(document); documentRef.current = document;
  const triggerRef = useRef<HTMLElement | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const result = await readWithDeadline(window.openmind.getRssSources(), m.settings.collectorSourcesLoadTimeout);
      if (!alive.current || sequence !== loadSequence.current) return;
      if (documentRef.current?.rootKey !== result.rootKey && documentRef.current) { setSelection(null); setCategory(ALL_CATEGORY); }
      const previous = documentRef.current;
      const sources = previous && previous.rootKey === result.rootKey ? reconcileSources(previous.sources, result.sources) : result.sources;
      const next = { ...result, sources };
      const unchanged = previous && sources === previous.sources && JSON.stringify({ ...previous, sources: [] }) === JSON.stringify({ ...next, sources: [] });
      if (!unchanged) { documentRef.current = next; setDocument(next); }
      setError("");
    } catch (cause) { if (alive.current && sequence === loadSequence.current) setError(String(cause instanceof Error ? cause.message : cause)); }
  }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; loadSequence.current++; }; }, []);
  useSourceRefresh(load, "rss-article-saver");
  const action = useCallback(async (key: string, label: string, work: () => Promise<unknown>) => {
    if (pending.current.has(key)) return false;
    pending.current.add(key); setRequests(current => ({ ...current, [key]: label })); setError("");
    try { await work(); if (alive.current) await load(); return true; }
    catch (cause) { if (alive.current) { const message = String(cause instanceof Error ? cause.message : cause); setError(message); feedback.notify(message, "error"); } return false; }
    finally { pending.current.delete(key); if (alive.current) setRequests(current => { const next = { ...current }; delete next[key]; return next; }); }
  }, [load, feedback]);
  const run = useCallback((mode: RssRunInput["mode"], sourceId: string) => void action(`source:${sourceId}`, mode, async () => {
    await window.openmind.runRss({ mode, sourceId });
    if (alive.current) feedback.notify(m.rss.queued, "success");
  }), [action, feedback]);
  const remove = useCallback(async (row: RssSourceView) => {
    const root = documentRef.current?.rootKey;
    if (!await feedback.confirm({ title: m.rss.remove, body: m.rss.removeBody, confirmText: m.rss.remove, danger: true }) || !alive.current || root !== documentRef.current?.rootKey) return;
    const removed = await action(`source:${row.id}`, "delete", () => window.openmind.removeRssSource({ id: row.id, revision: row.revision }));
    if (removed && alive.current) { triggerRef.current = resultsRef.current; setSelection(current => current?.id === row.id ? null : current); resultsRef.current?.focus(); }
  }, [action, feedback]);
  const { tabs, rows, selected } = useMemo(() => selectSources(document?.sources || [], query, "all", category, "default"), [document, query, category, locale]);
  const pagination = useSourcePage(rows, `${document?.rootKey}:${query}:${selected}`);
  useEffect(() => { if (category !== selected) setCategory(selected); }, [category, selected]);
  useLayoutEffect(() => { if (selection?.id && !pagination.rows.some(row => row.id === selection.id)) triggerRef.current = resultsRef.current; }, [pagination.rows, selection]);
  const open = useCallback((id: string | null, mode: SourceSelection["mode"], trigger: HTMLElement, error = false) => {
    triggerRef.current = trigger;
    setSelection({ id, mode, error, token: ++selectionSequence.current });
  }, []);
  const edit = useCallback((id: string, trigger: HTMLElement) => open(id, "edit", trigger), [open]);
  const details = useCallback((id: string, trigger: HTMLElement, error?: boolean) => open(id, "details", trigger, error), [open]);
  const pipeline = useCallback((id: string) => run("pipeline", id), [run]);
  const clear = () => { setQuery(""); setCategory(ALL_CATEGORY); };
  return <section className={presentation === "settings" ? "rss-sources rss-sources-settings" : presentation === "embedded" ? "rss-sources rss-sources-embedded" : "rss-sources"}>
    {presentation !== "settings" ? <header className="rss-header"><div><h1>{m.rss.title}</h1><p>{m.rss.description}</p></div></header> : null}
    <div className="rss-toolbar"><SearchInput value={query} onChange={event => setQuery(event.target.value)} aria-label={m.rss.search} placeholder={m.rss.search} /><div className="rss-actions">
      <Button onClick={event => open(null, "edit", event.currentTarget)} variant="primary">{m.rss.add}</Button>
      <Button loading={requests.import === "import"} disabled={Boolean(requests.import)} onClick={() => void action("import", "import", () => window.openmind.importRssOpml())}>{m.rss.import}</Button>
      <DailyPreferences />
      <IconButton label={m.rss.refresh} onClick={() => void load()}><RefreshCw size={16} /></IconButton>
    </div></div>
    <div className="rss-category-scroll" onFocusCapture={event => { if (event.target.getAttribute("role") === "tab") event.target.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }}><Tabs variant="pill" value={selected} tabs={tabs.map(tab => ({ ...tab, icon: <RssCategoryIcon category={tab.value.startsWith("group:") ? tab.value.slice(6) : tab.value} />, label: <span className="rss-category-label" title={tab.label}>{tab.label}</span> }))} onChange={setCategory} label={m.rss.categories} /></div>
    {error ? <ErrorState message={error} retry={() => void load()} /> : null}
    {document?.migrationWarnings.map(warning => <p key={warning}>{warning}</p>)}
    {!document && !error ? <LoadingState /> : null}
    {document && !rows.length ? <EmptyState title={m.rss.noSources} action={<Button onClick={clear}>{m.rss.clearFilters}</Button>} /> : null}
    <div ref={resultsRef} tabIndex={-1} role="region" aria-label={m.rss.title} className="rss-source-grid">{pagination.rows.map(row => <RssSourceCard key={row.id} source={row} busy={requests[`source:${row.id}`]} selected={selection?.id === row.id} onOpen={details} onEdit={edit} onRun={pipeline} onRemove={remove} />)}</div>
    <SourcePagination page={pagination.page} pages={pagination.pages} total={rows.length} onChange={page => { pagination.setPage(page); resultsRef.current?.focus(); resultsRef.current?.scrollIntoView?.({ block: "start" }); }} />
    <RssSourceDetails selection={selection} document={document} triggerRef={triggerRef} busy={selection?.id ? requests[`source:${selection.id}`] : undefined} onClose={() => setSelection(null)} onSaved={load} onRun={run} />
  </section>;
}

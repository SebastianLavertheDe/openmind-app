import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { RssDocumentView, RssRunInput, RssSourceView } from "@shared/rss-contracts";
import { messages as m } from "@shared/messages";
import { Button, EmptyState, ErrorState, IconButton, LoadingState, SearchInput, Tabs } from "../../design-system/components";
import { useFeedback } from "../../feedback-context";
import { useLocale } from "../../i18n";
import { DailyPreferences } from "./DailyPreferences";
import { RssSourceCard } from "./RssSourceCard";
import { RssCategoryIcon } from "./RssCategoryIcon";
import { RssSourceDetails, type SourceSelection } from "./RssSourceDetails";
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
      const result = await window.openmind.getRssSources();
      if (!alive.current || sequence !== loadSequence.current) return;
      if (documentRef.current?.rootKey !== result.rootKey && documentRef.current) { setSelection(null); setCategory(ALL_CATEGORY); }
      documentRef.current = result; setDocument(result); setError("");
    } catch (cause) { if (alive.current && sequence === loadSequence.current) setError(String(cause instanceof Error ? cause.message : cause)); }
  }, []);
  useEffect(() => { alive.current = true; void load(); const timer = setInterval(() => void load(), 5000); return () => { alive.current = false; loadSequence.current++; clearInterval(timer); }; }, [load]);
  const action = async (key: string, label: string, work: () => Promise<unknown>) => {
    if (pending.current.has(key)) return false;
    pending.current.add(key); setRequests(current => ({ ...current, [key]: label })); setError("");
    try { await work(); if (alive.current) await load(); return true; }
    catch (cause) { if (alive.current) { const message = String(cause instanceof Error ? cause.message : cause); setError(message); feedback.notify(message, "error"); } return false; }
    finally { pending.current.delete(key); if (alive.current) setRequests(current => { const next = { ...current }; delete next[key]; return next; }); }
  };
  const run = (mode: RssRunInput["mode"], sourceId: string) => void action(`source:${sourceId}`, mode, async () => {
    await window.openmind.runRss({ mode, sourceId });
    if (alive.current) feedback.notify(m.rss.queued, "success");
  });
  const toggle = (row: RssSourceView) => void action(`source:${row.id}`, "toggle", () => window.openmind.editRssSource({ id: row.id, revision: row.revision, enabled: !row.enabled }));
  const remove = async (row: RssSourceView) => {
    const root = documentRef.current?.rootKey;
    if (!await feedback.confirm({ title: m.rss.remove, body: m.rss.removeBody, confirmText: m.rss.remove, danger: true }) || !alive.current || root !== documentRef.current?.rootKey) return;
    const removed = await action(`source:${row.id}`, "delete", () => window.openmind.removeRssSource({ id: row.id, revision: row.revision }));
    if (removed && alive.current) { triggerRef.current = resultsRef.current; setSelection(current => current?.id === row.id ? null : current); resultsRef.current?.focus(); }
  };
  const { tabs, rows, selected } = useMemo(() => selectSources(document?.sources || [], query, "all", category, "default"), [document, query, category, locale]);
  useEffect(() => { if (category !== selected) setCategory(selected); }, [category, selected]);
  useLayoutEffect(() => { if (selection?.id && !rows.some(row => row.id === selection.id)) triggerRef.current = resultsRef.current; }, [rows, selection]);
  const open = (id: string | null, mode: SourceSelection["mode"], trigger: HTMLElement, error = false) => {
    triggerRef.current = trigger;
    setSelection({ id, mode, error, token: ++selectionSequence.current });
  };
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
    <div ref={resultsRef} tabIndex={-1} role="region" aria-label={m.rss.title} className="rss-source-grid">{rows.map(row => <RssSourceCard key={row.id} source={row} busy={requests[`source:${row.id}`]} selected={selection?.id === row.id} onOpen={(trigger, error) => open(row.id, "details", trigger, error)} onEdit={trigger => open(row.id, "edit", trigger)} onToggle={() => toggle(row)} onRun={() => run("pipeline", row.id)} onRemove={() => void remove(row)} />)}</div>
    <RssSourceDetails selection={selection} document={document} triggerRef={triggerRef} busy={selection?.id ? requests[`source:${selection.id}`] : undefined} onClose={() => setSelection(null)} onSaved={load} onRun={run} onToggle={toggle} />
  </section>;
}

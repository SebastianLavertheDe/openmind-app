import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { RssDocumentView, RssRunInput, RssSourceView } from "@shared/rss-contracts";
import { messages as m } from "@shared/messages";
import { Button, EmptyState, ErrorState, FormDialog, IconButton, LoadingState, SearchInput, Select, Tabs } from "../../design-system/components";
import { useFeedback } from "../../feedback-context";
import { useLocale } from "../../i18n";
import { AutomationPage } from "../automation";
import { DailyPreferences } from "./DailyPreferences";
import { RssSourceCard } from "./RssSourceCard";
import { RssSourceDetails, type SourceSelection } from "./RssSourceDetails";
import { ALL_CATEGORY, selectSources, type SourceFilter, type SourceSort } from "./rss-source-presentation";

export function SourcesPage({ presentation = "page", onRuns }: { presentation?: "page" | "embedded" | "settings"; onRuns?(): void }) {
  const locale = useLocale();
  const feedback = useFeedback();
  const [document, setDocument] = useState<RssDocumentView | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [sort, setSort] = useState<SourceSort>("default");
  const [category, setCategory] = useState(ALL_CATEGORY);
  const [error, setError] = useState("");
  const [requests, setRequests] = useState<Record<string, string>>({});
  const pending = useRef(new Set<string>());
  const [selection, setSelection] = useState<SourceSelection | null>(null);
  const [tasks, setTasks] = useState(false);
  const alive = useRef(true), loadSequence = useRef(0), selectionSequence = useRef(0);
  const documentRef = useRef(document); documentRef.current = document;
  const triggerRef = useRef<HTMLElement | null>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);
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
  const run = (mode: RssRunInput["mode"], sourceId?: string) => void action(sourceId ? `source:${sourceId}` : "global", mode, async () => {
    await window.openmind.runRss({ mode, ...(sourceId ? { sourceId } : {}) });
    if (alive.current) feedback.notify(m.rss.queued, "success");
  });
  const toggle = (row: RssSourceView) => void action(`source:${row.id}`, "toggle", () => window.openmind.editRssSource({ id: row.id, revision: row.revision, enabled: !row.enabled }));
  const remove = async (row: RssSourceView) => {
    const root = documentRef.current?.rootKey;
    if (!await feedback.confirm({ title: m.rss.remove, body: m.rss.removeBody, confirmText: m.rss.remove, danger: true }) || !alive.current || root !== documentRef.current?.rootKey) return;
    const removed = await action(`source:${row.id}`, "delete", () => window.openmind.removeRssSource({ id: row.id, revision: row.revision }));
    if (removed && alive.current) { triggerRef.current = resultsRef.current; setSelection(current => current?.id === row.id ? null : current); resultsRef.current?.focus(); }
  };
  const { tabs, rows, selected } = useMemo(() => selectSources(document?.sources || [], query, filter, category, sort), [document, query, filter, category, sort, locale]);
  useEffect(() => { if (category !== selected) setCategory(selected); }, [category, selected]);
  useLayoutEffect(() => { if (selection?.id && !rows.some(row => row.id === selection.id)) triggerRef.current = resultsRef.current; }, [rows, selection]);
  const open = (id: string | null, mode: SourceSelection["mode"], trigger: HTMLElement, error = false) => {
    triggerRef.current = trigger;
    setSelection({ id, mode, fromDetails: false, error, token: ++selectionSequence.current });
  };
  const globalBusy = Boolean(requests.global);
  const clear = () => { setQuery(""); setFilter("all"); setCategory(ALL_CATEGORY); };
  return <section className={presentation === "settings" ? "rss-sources rss-sources-settings" : presentation === "embedded" ? "rss-sources rss-sources-embedded" : "rss-sources"}>
    {presentation !== "settings" ? <header className="rss-header"><div><h1>{m.rss.title}</h1><p>{m.rss.description}</p></div></header> : null}
    <div className="rss-toolbar"><SearchInput value={query} onChange={event => setQuery(event.target.value)} aria-label={m.rss.search} placeholder={m.rss.search} /><div className="rss-actions">
      <Button onClick={event => open(null, "edit", event.currentTarget)} variant="primary">{m.rss.add}</Button>
      <Button loading={requests.import === "import"} disabled={Boolean(requests.import)} onClick={() => void action("import", "import", () => window.openmind.importRssOpml())}>{m.rss.import}</Button>
      <IconButton label={m.rss.refresh} onClick={() => void load()}><RefreshCw size={16} /></IconButton>
    </div></div>
    <div className="rss-category-scroll" onFocusCapture={event => { if (event.target.getAttribute("role") === "tab") event.target.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }}><Tabs variant="pill" value={selected} tabs={tabs} onChange={setCategory} label={m.rss.categories} /></div>
    <div className="rss-results-toolbar"><h2 ref={resultsRef} tabIndex={-1} className="rss-results-title">{m.rss.results(rows.length, document?.sources.length || 0)}</h2><div className="rss-actions">
      <Select<SourceFilter> value={filter} onChange={setFilter} ariaLabel={m.rss.status} options={[{ value: "all", label: m.rss.all }, { value: "enabled", label: m.rss.enabled }, { value: "disabled", label: m.rss.disabled }, { value: "failed", label: m.rss.failed }, { value: "pending", label: m.rss.pending }]} />
      <Select<SourceSort> value={sort} onChange={setSort} ariaLabel={m.rss.sort} options={[{ value: "default", label: m.rss.defaultOrder }, { value: "name", label: m.rss.nameOrder }, { value: "recent", label: m.rss.recentOrder }]} />
    </div></div>
    <div className="rss-global-actions"><p className="rss-muted">{m.rss.globalScope}</p><div className="rss-actions">
      <Button loading={requests.global === "sync"} disabled={globalBusy} onClick={() => run("sync")}>{m.rss.sync}</Button><Button loading={requests.global === "collect"} disabled={globalBusy} onClick={() => run("collect")}>{m.rss.collect}</Button><Button loading={requests.global === "pipeline"} disabled={globalBusy} onClick={() => run("pipeline")}>{m.rss.pipeline}</Button>
      <Button disabled={Boolean(requests.tasks)} onClick={() => void action("tasks", "tasks", async () => { if (!await window.openmind.getDefaultSkillsEnabled()) await window.openmind.setDefaultSkillsEnabled(true); if (alive.current) setTasks(true); })}>{m.rss.tasks}</Button>
      {onRuns ? <Button onClick={onRuns}>{m.rss.runs}</Button> : null}<DailyPreferences />
    </div></div>
    {error ? <ErrorState message={error} retry={() => void load()} /> : null}
    {document?.migrationWarnings.map(warning => <p key={warning}>{warning}</p>)}
    {!document && !error ? <LoadingState /> : null}
    {document && !rows.length ? <EmptyState title={m.rss.noSources} action={<Button onClick={clear}>{m.rss.clearFilters}</Button>} /> : null}
    <div className="rss-source-grid">{rows.map(row => <RssSourceCard key={row.id} source={row} busy={requests[`source:${row.id}`]} selected={selection?.id === row.id} onOpen={(trigger, error) => open(row.id, "details", trigger, error)} onEdit={trigger => open(row.id, "edit", trigger)} onToggle={() => toggle(row)} onRun={() => run("pipeline", row.id)} onRemove={() => void remove(row)} />)}</div>
    <RssSourceDetails selection={selection} document={document} triggerRef={triggerRef} busy={selection?.id ? requests[`source:${selection.id}`] : undefined} onSelection={setSelection} onClose={() => setSelection(null)} onSaved={load} onRun={run} onToggle={toggle} onRemove={row => void remove(row)} />
    <FormDialog open={tasks} title={m.rss.tasks} description={m.rss.taskHint} confirmLabel={m.rss.save} showFooter={false} onConfirm={() => {}} onClose={() => setTasks(false)} size="lg"><AutomationPage confirmAction={feedback.confirm} /></FormDialog>
  </section>;
}

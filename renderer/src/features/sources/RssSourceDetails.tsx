import { createContext, useContext, useEffect, useId, useRef, useState, type RefObject } from "react";
import type { RssDocumentView, RssEntriesPage, RssRunInput, RssSourceView } from "@shared/rss-contracts";
import { messages as m } from "@shared/messages";
import { AnimatedDisclosure, Button, CopyButton, Dialog, DialogBody, DialogHeader, EmptyState, ErrorState, LoadingState, StatusBadge, Tabs, ToggleSwitch } from "../../design-system/components";
import { categoryLabel, errorSummary, feedLabel, sourceGroups, sourceTime } from "./rss-source-presentation";
import { SourceEditor } from "./SourceEditor";
import { SourceRuns } from "./SourceRuns";

const DetailsActive = createContext(false);
const ENTRIES_PAGE_SIZE = 30;
export type SourceSelection = { id: string | null; mode: "details" | "edit"; error?: boolean; token: number };
export function RssSourceDetails({ selection, document, triggerRef, busy, onClose, onSaved, onRun, onToggle }: {
  selection: SourceSelection | null; document: RssDocumentView | null; triggerRef: RefObject<HTMLElement | null>; busy?: string;
  onClose(): void; onSaved(): Promise<void>;
  onRun(mode: RssRunInput["mode"], id: string): void; onToggle(source: RssSourceView): void;
}) {
  const source = document?.sources.find(row => row.id === selection?.id);
  const titleId = useId();
  const guard = useRef<() => Promise<boolean>>(async () => true);
  const [editorBusy, setEditorBusy] = useState(false);
  const current = useRef(selection); current.current = selection;
  const close = async () => { const selected = selection; if (await guard.current() && current.current === selected) onClose(); };
  const editing = selection?.mode === "edit";
  return <DetailsActive.Provider value={Boolean(selection)}><Dialog open={Boolean(selection)} onClose={() => void close()} triggerRef={triggerRef} size="lg" layout="fixed" className="rss-detail-dialog" aria-labelledby={titleId} dismissDisabled={editorBusy} initialFocusSelector={editing ? "input" : '[role="tab"][aria-selected="true"]'}>
    <DialogHeader titleId={titleId} title={editing ? selection?.id === null ? m.rss.add : m.rss.edit : source?.name || m.rss.title} description={!editing && source ? `${categoryLabel(source.group)} · ${source.enabled ? m.rss.enabled : m.rss.disabled}` : undefined} onClose={() => void close()} closeDisabled={editorBusy} />
    {selection?.id && !source ? <DialogBody><EmptyState title={m.rss.deleted} /></DialogBody> : editing ? <SourceEditor key={selection?.token} source={source || null} groups={sourceGroups(document?.sources || [])} guard={guard} onBusy={setEditorBusy} onCancel={() => void close()} onSaved={async () => { const selected = selection; await onSaved(); if (current.current === selected) onClose(); }} /> : source && selection ? <SourceDetailContent key={`${document?.rootKey || ""}:${selection.token}`} source={source} rootKey={document?.rootKey} showError={selection.error} busy={busy} onRun={mode => onRun(mode, source.id)} onToggle={() => onToggle(source)} /> : null}
  </Dialog></DetailsActive.Provider>;
}

function SourceDetailContent({ source, rootKey, showError, busy, onRun, onToggle }: {
  source: RssSourceView; rootKey?: string; showError?: boolean; busy?: string;
  onRun(mode: RssRunInput["mode"]): void; onToggle(): void;
}) {
  const [tab, setTab] = useState("overview");
  // Context also updates the Dialog's retained exit snapshot: queries stop on close.
  const open = useContext(DetailsActive);
  const id = useId();
  return <>
    <div className="rss-detail-tabs"><Tabs value={tab} onChange={setTab} label={source.name} tabs={[{ value: "overview", label: m.rss.overview }, { value: "entries", label: m.rss.entries }, { value: "runs", label: m.rss.runs }].map(item => ({ ...item, id: `${id}-${item.value}`, controls: `${id}-panel` }))} /></div>
    <DialogBody key={tab} className="rss-detail-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>
      {tab === "overview" ? <SourceOverview source={source} showError={showError} busy={busy} onRun={onRun} onToggle={onToggle} /> : tab === "entries" ? <SourceEntries key={`${source.localFeed.version || ""}:${source.feedRevision}:${source.revision}`} source={source} rootKey={rootKey} open={open} busy={busy} onSync={() => onRun("sync")} /> : <SourceRuns sourceId={source.id} rootKey={rootKey} open={open} />}
    </DialogBody>
  </>;
}

function SourceOverview({ source, showError, busy, onRun, onToggle }: { source: RssSourceView; showError?: boolean; busy?: string; onRun(mode: RssRunInput["mode"]): void; onToggle(): void }) {
  const [expanded, setExpanded] = useState(Boolean(showError));
  const [detect, setDetect] = useState({ busy: false, message: "", error: "" });
  const alive = useRef(true);
  const open = useContext(DetailsActive);
  const detectionSequence = useRef(0);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { alive.current = open; if (showError) errorRef.current?.scrollIntoView?.({ block: "nearest" }); return () => { alive.current = false; detectionSequence.current++; }; }, [showError, open]);
  useEffect(() => { detectionSequence.current++; setDetect({ busy: false, message: "", error: "" }); }, [source.inputUrl, source.revision]);
  const detectLink = async () => {
    const sequence = ++detectionSequence.current;
    setDetect({ busy: true, message: "", error: "" });
    try {
      const result = await window.openmind.detectRssSource({ inputUrl: source.inputUrl, ...(source.resolvedFeedUrl ? { selectedFeedUrl: source.resolvedFeedUrl } : {}) });
      if (alive.current && sequence === detectionSequence.current) setDetect({ busy: false, message: result.adapterId !== "feed" || result.resolvedFeedUrl ? m.rss.detected : m.rss.candidateHint, error: "" });
    } catch (cause) { if (alive.current && sequence === detectionSequence.current) setDetect({ busy: false, message: "", error: String(cause instanceof Error ? cause.message : cause) }); }
  };
  const attemptStage = source.lastAttemptStage || source.lastError?.stage;
  return <>
    <div className="rss-actions"><StatusBadge tone={source.localFeed.status === "ready" ? "success" : "warning"}>{feedLabel(source)}</StatusBadge><span>{m.rss.rssItems(source.itemCount)}</span><ToggleSwitch checked={source.enabled} disabled={Boolean(busy) || !source.inputUrl} label={`${source.name} — ${source.enabled ? m.rss.enabled : m.rss.disabled}`} onChange={onToggle} /></div>
    <dl className="rss-detail-facts"><div><dt>{m.rss.name}</dt><dd>{source.name}</dd></div><div><dt>{m.rss.category}</dt><dd>{categoryLabel(source.group)}</dd></div>{source.tags.length ? <div><dt>{m.rss.tags}</dt><dd>{source.tags.join(" · ")}</dd></div> : null}
      <Address label={m.rss.url} value={source.inputUrl} external />{source.resolvedFeedUrl ? <Address label={m.rss.resolvedUrl} value={source.resolvedFeedUrl} external /> : null}<Address label={m.rss.localFile} value={source.localFeed.path} />
      <div><dt>{m.rss.syncTime}</dt><dd>{sourceTime(source.lastSyncAt)}</dd></div><div><dt>{m.rss.collectTime}</dt><dd>{sourceTime(source.lastCollectAt)}</dd></div><div><dt>{m.rss.lastAttempt}</dt><dd>{sourceTime(source.lastAttemptAt)} · {attemptStage === "sync" ? m.rss.sync : attemptStage === "collect" ? m.rss.collect : attemptStage === "configuration" ? m.rss.pending : attemptStage === "detect" ? m.rss.detect : m.rss.unknown}</dd></div>
    </dl>
    {source.lastError ? <div ref={errorRef} className="rss-detail-error"><p className="rss-source-error">{m.rss.previousError}: {errorSummary(source.lastError)}</p><AnimatedDisclosure open={expanded} onOpenChange={setExpanded} summary={m.rss.technicalError}><p>{source.lastError.code}</p><p>{source.lastError.message}</p></AnimatedDisclosure></div> : null}
    {source.localFeed.status !== "ready" ? <p>{source.localFeed.status === "missing" ? m.rss.feedMissing : m.rss.oldEntries} {m.rss.collectHint}</p> : null}
    <div className="rss-actions"><Button loading={detect.busy} disabled={!source.inputUrl || detect.busy} onClick={() => void detectLink()}>{detect.busy ? m.rss.detecting : m.rss.detect}</Button><Button loading={busy === "sync"} disabled={Boolean(busy) || !source.enabled || !source.inputUrl} onClick={() => onRun("sync")}>{m.rss.sync}</Button><Button loading={busy === "collect"} disabled={Boolean(busy) || !source.enabled || !source.inputUrl || source.localFeed.status !== "ready"} onClick={() => onRun("collect")}>{m.rss.collect}</Button></div>
    <p className="rss-muted">{m.rss.detectHint}</p>{detect.message ? <p role="status">{detect.message}</p> : null}{detect.error ? <ErrorState message={detect.error} retry={() => void detectLink()} /> : null}
  </>;
}

function Address({ label, value, external }: { label: string; value: string; external?: boolean }) {
  return <div><dt>{label}</dt><dd className="rss-source-address">{value ? <>{external ? <a href={value} onClick={event => { event.preventDefault(); void window.openmind.openExternal(value); }}>{value}</a> : <code>{value}</code>}<CopyButton text={value} label={`${m.rss.copy}: ${label}`} /></> : m.rss.pending}</dd></div>;
}

function SourceEntries({ source, rootKey, open, busy, onSync }: { source: RssSourceView; rootKey?: string; open: boolean; busy?: string; onSync(): void }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [page, setPage] = useState<RssEntriesPage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const cursor = cursors.at(-1);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError("");
    void window.openmind.getRssSourceEntries({ sourceId: source.id, rootKey, cursor, limit: ENTRIES_PAGE_SIZE }).then(result => {
      if (!active) return;
      setPage(result); if (result.reset && cursor) setCursors([undefined]);
    }).catch(cause => { if (active) setError(String(cause instanceof Error ? cause.message : cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [source.id, rootKey, open, cursor, retry]);
  return <><p className="rss-muted">{m.rss.entriesHint}</p>{source.localFeed.status === "outdated" || page?.status === "outdated" ? <StatusBadge tone="warning">{m.rss.oldEntries}</StatusBadge> : null}
    {error ? <ErrorState message={error} retry={() => setRetry(value => value + 1)} /> : loading ? <LoadingState /> : page?.status === "missing" ? <EmptyState title={m.rss.feedMissing} action={<Button disabled={Boolean(busy) || !source.enabled || !source.inputUrl} onClick={onSync}>{m.rss.sync}</Button>} /> : page ? <>
      {!page.entries.length ? <EmptyState title={m.rss.emptyEntries} /> : <ol className="rss-entry-list" start={(cursors.length - 1) * ENTRIES_PAGE_SIZE + 1}>{page.entries.map((entry, index) => <li key={`${entry.url}:${index}`}><a href={entry.url} onClick={event => { event.preventDefault(); void window.openmind.openExternal(entry.url); }}>{entry.title}</a><time dateTime={entry.publishedAt || undefined}>{entry.publishedAt ? sourceTime(entry.publishedAt) : m.rss.unknownDate}</time></li>)}</ol>}
      <div className="rss-pagination"><Button disabled={cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}>{m.rss.previous}</Button><span>{m.rss.page(cursors.length, page.total)}</span><Button disabled={!page.nextCursor} onClick={() => setCursors(values => [...values, page.nextCursor!])}>{m.rss.next}</Button></div>
    </> : null}</>;
}

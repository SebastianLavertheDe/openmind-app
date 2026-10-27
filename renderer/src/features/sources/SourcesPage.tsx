import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import type { RssDocument, RssSource, RssDetection } from "@shared/rss-contracts";
import { messages as m } from "@shared/messages";
import { Button, IconButton, SearchInput, Input, Select, ToggleSwitch, FormField, FormDialog, EmptyState } from "../../design-system/components";
import { useFeedback } from "../../feedback-context";
import { useLocale } from "../../i18n";
import { AutomationPage } from "../automation";
import { DailyPreferences } from "./DailyPreferences";

export function SourcesPage({ embedded = false, onRuns }: { embedded?: boolean; onRuns?(): void }) {
  useLocale();
  const feedback = useFeedback();
  const [document, setDocument] = useState<RssDocument | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<RssSource | "new" | null>(null);
  const [tasks, setTasks] = useState(false);
  const alive = useRef(true);
  const loadSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try { const result = await window.openmind.getRssSources(); if (alive.current && sequence === loadSequence.current) setDocument(result); }
    catch (cause) { if (alive.current) setError(String(cause instanceof Error ? cause.message : cause)); }
  }, []);
  useEffect(() => { alive.current = true; void load(); const timer = setInterval(() => void load(), 5000); return () => { alive.current = false; clearInterval(timer); }; }, [load]);
  const action = async (work: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await work(); await load(); } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (alive.current) setBusy(false); }
  };
  const run = (mode: "sync" | "collect" | "pipeline", sourceId?: string) => action(async () => { await window.openmind.runRss({ mode, sourceId }); feedback.notify(m.rss.queued, "success"); });
  const rows = document?.sources.filter(row => {
    const text = `${row.name} ${row.inputUrl} ${row.tags.join(" ")} ${row.group}`.toLocaleLowerCase();
    return text.includes(query.trim().toLocaleLowerCase()) && (filter === "all" || filter === "enabled" && row.enabled || filter === "disabled" && !row.enabled || filter === "failed" && row.lastError);
  }) || [];
  const remove = (row: RssSource) => action(async () => {
    if (await feedback.confirm({ title: m.rss.remove, body: m.rss.removeBody, confirmText: m.rss.remove, danger: true })) await window.openmind.removeRssSource({ id: row.id, revision: row.revision });
  });
  return <section className={embedded ? "rss-sources rss-sources-embedded" : "rss-sources"}>
    <header className="rss-header"><div><h1>{m.rss.title}</h1><p>{m.rss.description}</p></div><div className="rss-actions">
      <Button onClick={() => setEditor("new")} disabled={busy} variant="primary">{m.rss.add}</Button>
      <Button onClick={() => void action(() => window.openmind.importRssOpml())} disabled={busy}>{m.rss.import}</Button>
      <IconButton label={m.rss.refresh} onClick={() => void load()}><RefreshCw size={16} /></IconButton>
    </div></header>
    <div className="rss-toolbar"><SearchInput value={query} onChange={event => setQuery(event.target.value)} aria-label={m.rss.search} placeholder={m.rss.search} />
      <Select value={filter} onChange={setFilter} ariaLabel={m.rss.status} options={[{ value: "all", label: m.rss.all }, { value: "enabled", label: m.rss.enabled }, { value: "disabled", label: m.rss.disabled }, { value: "failed", label: m.rss.failed }]} />
      <span>{m.rss.count(rows.length)}</span>
    </div>
    <div className="rss-actions"><Button disabled={busy} onClick={() => void run("sync")}>{m.rss.sync}</Button><Button disabled={busy} onClick={() => void run("collect")}>{m.rss.collect}</Button><Button disabled={busy} onClick={() => void run("pipeline")}>{m.rss.pipeline}</Button>
      <Button disabled={busy} onClick={() => void action(async () => { if (!await window.openmind.getDefaultSkillsEnabled()) await window.openmind.setDefaultSkillsEnabled(true); setTasks(true); })}>{m.rss.tasks}</Button>
      {onRuns ? <Button onClick={onRuns}>{m.rss.runs}</Button> : null}
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {document?.migrationWarnings.map(warning => <p key={warning} role="status">{warning}</p>)}
    <div className="rss-list" aria-busy={busy}>
      {document && !rows.length ? <EmptyState title={m.rss.noSources} /> : null}
      {rows.map(row => <article key={row.id} className="rss-source-row">
        <div className="rss-source-content"><strong>{row.name}</strong>{row.inputUrl ? <a href={row.inputUrl} onClick={event => { event.preventDefault(); void window.openmind.openExternal(row.inputUrl); }}>{row.inputUrl}</a> : <span>{m.rss.pending}</span>}
          <small>{m.rss.lastSuccess}: {row.lastSuccessAt ? new Date(row.lastSuccessAt).toLocaleString() : m.rss.never} · {m.rss.items(row.itemCount)}</small>
          {row.lastError ? <p className="rss-source-error">{row.lastError.code}: {row.lastError.message}</p> : null}
        </div><div className="rss-actions">
          <ToggleSwitch checked={row.enabled} disabled={busy || !row.inputUrl} label={`${row.name} — ${row.enabled ? m.rss.enabled : m.rss.disabled}`} onChange={() => void action(() => window.openmind.editRssSource({ id: row.id, revision: row.revision, enabled: !row.enabled }))} />
          <IconButton label={`${m.rss.pipeline}: ${row.name}`} disabled={busy || !row.enabled} onClick={() => void run("pipeline", row.id)}><RefreshCw size={16} /></IconButton>
          <IconButton label={`${m.rss.edit}: ${row.name}`} disabled={busy} onClick={() => setEditor(row)}><Pencil size={16} /></IconButton>
          <IconButton label={`${m.rss.remove}: ${row.name}`} disabled={busy} onClick={() => void remove(row)}><Trash2 size={16} /></IconButton>
        </div></article>)}
    </div>
    {!embedded ? <DailyPreferences /> : null}
    {editor ? <SourceEditor source={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void load(); }} /> : null}
    <FormDialog open={tasks} title={m.rss.tasks} description={m.rss.taskHint} confirmLabel={m.rss.save} showFooter={false} onConfirm={() => {}} onClose={() => setTasks(false)} size="lg"><AutomationPage confirmAction={feedback.confirm} /></FormDialog>
  </section>;
}

function SourceEditor({ source, onClose, onSaved }: { source: RssSource | null; onClose(): void; onSaved(): void }) {
  const feedback = useFeedback();
  const [name, setName] = useState(source?.name || "");
  const [url, setUrl] = useState(source?.inputUrl || "");
  const [candidate, setCandidate] = useState("");
  const [detected, setDetected] = useState<RssDetection | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dirty = name !== (source?.name || "") || url !== (source?.inputUrl || "") || Boolean(candidate);
  const close = async () => { if (!dirty || await feedback.confirm({ title: m.rss.discard, body: m.rss.discardBody, confirmText: m.rss.cancel, danger: true })) onClose(); };
  const detect = async () => { setBusy(true); setError(""); try { setDetected(await window.openmind.detectRssSource({ inputUrl: url })); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  const save = async () => {
    setBusy(true); setError("");
    try { const input = { name, inputUrl: url, ...(candidate ? { selectedFeedUrl: candidate } : {}) };
      if (source) await window.openmind.editRssSource({ id: source.id, revision: source.revision, name, ...(url !== source.inputUrl || candidate ? input : {}) });
      else await window.openmind.createRssSource({ ...input, enabled: true });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  };
  const needsDetection = !source || url !== source.inputUrl;
  return <FormDialog open title={source ? m.rss.edit : m.rss.add} confirmLabel={m.rss.save} busy={busy} onConfirm={save} onClose={() => void close()} confirmDisabled={!name.trim() || !url.trim() || needsDetection && (!detected || detected.candidates.length > 1 && !candidate)}>
    <FormField label={m.rss.name}><Input value={name} maxLength={200} onChange={event => setName(event.target.value)} required /></FormField>
    <FormField label={m.rss.url} error={error}><Input value={url} type="url" maxLength={4096} onChange={event => { setUrl(event.target.value); setDetected(null); setCandidate(""); }} required /></FormField>
    <Button disabled={busy || !url.trim()} onClick={() => void detect()}>{m.rss.detect}</Button>
    {detected?.candidates.length && detected.candidates.length > 1 ? <FormField label={m.rss.candidate} hint={m.rss.candidateHint}><Select value={candidate} onChange={setCandidate} placeholder={m.rss.candidate} options={detected.candidates.map(item => ({ value: item.url, label: item.title }))} /></FormField> : detected ? <p role="status">{m.rss.detected}</p> : null}
  </FormDialog>;
}

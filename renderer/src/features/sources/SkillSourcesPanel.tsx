import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import type { SourceDefinition } from "@shared/contracts";
import { getLocale, messages } from "@shared/messages";
import { Button, CopyButton, Dialog, DialogBody, DialogFooter, DialogHeader, FormField, IconButton, Input, SearchInput, Textarea, ToggleSwitch, Tooltip } from "../../design-system/components";
import { useLocale } from "../../i18n";
import { useExitPresence } from "../../design-system/use-exit-presence";
import { SourcesPage } from "./SourcesPage";
import { shortUrl } from "./rss-source-presentation";
import { SourcePagination, useSourcePage, useSourceRefresh } from "./source-list-state";
const m = messages.skillCenter;
type ManifestSummary = { id: string; title: string };
type SkillToggleFeedback = { tone: "success" | "error"; message: string };

type SourceEditorState = { token: number } & ({ mode: "add" } | { mode: "edit"; source: SourceDefinition });

export function SkillSourcesPanel({ summary, sources, onSourceUpdated, onReloadSources, refreshOnMount = true }: {
  summary: Pick<ManifestSummary, "id" | "title">;
  sources: SourceDefinition[];
  onSourceUpdated(source: SourceDefinition): void;
  onReloadSources(): Promise<void>;
  refreshOnMount?: boolean;
}) {
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<SourceEditorState | null>(null);
  const editorSequence = useRef(0);
  const pending = useRef(new Set<string>());
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, [summary.id]);
  const [feedback, setFeedback] = useState<SkillToggleFeedback | null>(null);
  const editorPresence = useExitPresence(Boolean(editor), 160);
  const lastEditor = useRef<SourceEditorState | null>(editor);
  if (editor) lastEditor.current = editor;
  const renderedEditor = editor ?? lastEditor.current;
  const isRss = summary.id === "rss-article-saver";
  const isReddit = summary.id === "reddit-fetcher";
  const refresh = useCallback(async () => {
    try { await onReloadSources(); }
    catch (cause) { setFeedback({ tone: "error", message: cause instanceof Error ? cause.message : String(cause) }); }
  }, [onReloadSources]);
  useSourceRefresh(refresh, summary.id, { initial: refreshOnMount, enabled: isReddit });
  const canEditSources = isReddit;
  const copy = skillSourceCopy(summary, sources.length);
  const visibleSources = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return sources.filter((source) => {
    return !needle || `${source.name} ${source.url || ""} ${source.tags.join(" ")}`.toLocaleLowerCase().includes(needle);
    });
  }, [sources, query, locale]);
  const pagination = useSourcePage(visibleSources, `${summary.id}:${query}`);
  const resultsRef = useRef<HTMLDivElement>(null);
  const editSource = useCallback((source: SourceDefinition) => setEditor({ mode: "edit", source, token: ++editorSequence.current }), []);
  const toggleSource = useCallback(async (source: SourceDefinition) => {
    if (pending.current.has(source.id)) return;
    const ticket = generation.current;
    pending.current.add(source.id); setBusyIds(new Set(pending.current));
    setFeedback(null);
    try {
      const updated = await window.openmind.updateSource(source.id, { enabled: !source.enabled });
      if (ticket === generation.current) onSourceUpdated(updated);
    } catch (cause) {
      if (ticket === generation.current) setFeedback({ tone: "error", message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      pending.current.delete(source.id);
      if (ticket === generation.current) setBusyIds(new Set(pending.current));
    }
  }, [onSourceUpdated]);

  if (isRss) return <SourcesPage presentation="embedded" />;

  if (summary.id === "x-following-fetcher") return <SkillXCurlPanel
    summary={summary}
    source={sources[0]}
    busy={Boolean(sources[0] && busyIds.has(sources[0].id))}
    feedback={feedback}
    onToggle={sources[0] ? () => void toggleSource(sources[0]) : undefined}
  />;

  return <section className="skills-owned-sources">
    <header className="skills-owned-sources-header">
      <div><h3>{copy.title}</h3><p>{copy.description}</p></div>
      <div className="skills-owned-sources-toolbar">
        {canEditSources ? <div className="skills-owned-sources-actions">
          <Button variant="ghost" type="button" data-motion="action" onClick={() => setEditor({ mode: "add", token: ++editorSequence.current })}><Plus size={14} aria-hidden />{m.ownedSources.addReddit}</Button>

        </div> : null}
        <SearchInput className="skills-source-search" variant="outlined" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} aria-label={copy.searchPlaceholder} />
      </div>
    </header>

    {feedback ? <p className={`skills-source-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.message}</p> : null}

    {!visibleSources.length ? <div className="skills-source-empty">
      <span>{query ? m.ownedSources.noMatch : copy.empty}</span>
      {!query && canEditSources ? <Button variant="ghost" type="button" data-motion="action" onClick={() => setEditor({ mode: "add", token: ++editorSequence.current })}>{m.ownedSources.addFirst(isReddit)}</Button> : null}
    </div> : isReddit ? <div ref={resultsRef} tabIndex={-1} className="collector-source-grid" role="list">
      {pagination.rows.map(source => <RedditSourceCard key={source.id} source={source} onEdit={editSource} />)}
    </div> : <div ref={resultsRef} tabIndex={-1} className="skills-source-list" role="list">
      <div className="skills-source-list-head" aria-hidden><span /><span>{m.ownedSources.nameAndAddress(isReddit)}</span><span>{m.ownedSources.statusAndLastRun}</span><span>{m.ownedSources.operation}</span></div>
      {pagination.rows.map((source) => <article key={source.id} className="skills-source-row" role="listitem">
        <span className={`skills-source-state ${sourceStatusTone(source)}`} aria-hidden />
        <div className="skills-source-main">
          <strong>{source.name}</strong>
          <small title={source.url || undefined}>{source.url || source.frequency}</small>
        </div>
        <div className="skills-source-meta"><span>{sourceStatusLabel(source)}</span><small>{sourceLastRun(source)}</small></div>
        <div className="skills-source-row-actions">
          {source.kind === "rss" || source.kind === "reddit" ? <IconButton type="button" className="skills-source-edit" data-motion="icon" onClick={() => editSource(source)} label={m.ownedSources.edit(source.name)}><Pencil size={14} aria-hidden /></IconButton> : null}
          <ToggleSwitch
            checked={source.enabled}
            disabled={busyIds.has(source.id)}
            label={m.ownedSources.toggle(source.enabled, source.name)}
            onChange={() => void toggleSource(source)}
          />
        </div>
      </article>)}
    </div>}

    <SourcePagination page={pagination.page} pages={pagination.pages} total={visibleSources.length} onChange={page => { pagination.setPage(page); resultsRef.current?.focus(); resultsRef.current?.scrollIntoView?.({ block: "start" }); }} />

    {editorPresence.visible && renderedEditor ? <SkillSourceEditor
      key={renderedEditor.token}
      state={renderedEditor}
      kind={isReddit ? "reddit" : "rss"}
      active={Boolean(editor)}
      leaving={editorPresence.leaving}
      onClose={() => setEditor(null)}
      onSaved={async () => {
        setEditor(null);
        await onReloadSources();
        setFeedback({ tone: "success", message: m.ownedSources.saved(isReddit, renderedEditor.mode === "add") });
      }}
    /> : null}
  </section>;
}

function SkillXCurlPanel({ summary, source, busy, feedback, onToggle }: {
  summary: Pick<ManifestSummary, "id" | "title">;
  source?: SourceDefinition;
  busy: boolean;
  feedback: SkillToggleFeedback | null;
  onToggle?: () => void;
}) {
  const locale = useLocale();
  const [curls, setCurls] = useState<string[]>([]);
  const [curlState, setCurlState] = useState<"loading" | "configured" | "missing">("loading");
  const [editorOpen, setEditorOpen] = useState(false);
  const editorPresence = useExitPresence(editorOpen, 160);
  const copy = skillSourceCopy(summary, source ? 1 : 0);

  const loadCurl = useCallback(async () => {
    setCurlState("loading");
    try {
      const next = (await window.openmind.getXFollowingCurls())
        .map((curl) => String(curl || "").trim())
        .filter((curl) => /^curl(?:\s|')/i.test(curl));
      setCurls(next);
      setCurlState(next.length ? "configured" : "missing");
    } catch {
      setCurls([]);
      setCurlState("missing");
    }
  }, []);

  useEffect(() => { void loadCurl(); }, [loadCurl]);

  return <section className="skills-owned-sources skills-x-curl-panel">
    <header className="skills-owned-sources-header">
      <div><h3>{copy.title}</h3><p>{copy.description}</p></div>
    </header>

    <article className="skills-x-curl-card">
      <span className={`skills-source-state ${curlState === "configured" ? "success" : "idle"}`} aria-hidden />
      <div className="skills-x-curl-copy">
        <strong>{m.xCurl.title}</strong>
        <span>{curlState === "loading" ? m.xCurl.loading : curlState === "configured" ? m.xCurl.configured(curls.length) : m.xCurl.missing}</span>
        <small>{m.xCurl.securitySummary}</small>
      </div>
      <div className="skills-x-curl-actions">
        <Button variant="ghost" type="button" data-motion="action" disabled={curlState === "loading"} onClick={() => setEditorOpen(true)}><Pencil size={14} aria-hidden />{curlState === "configured" ? m.xCurl.edit : m.xCurl.fill}</Button>
        {source && onToggle ? <ToggleSwitch
          checked={source.enabled}
          disabled={busy}
          label={m.ownedSources.toggle(source.enabled, summary.title)}
          onChange={onToggle}
        /> : null}
      </div>
    </article>

    {feedback ? <p className={`skills-source-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.message}</p> : null}

    <div className="skills-x-curl-help">
      <strong>{m.xCurl.helpTitle}</strong>
      <ol>{m.xCurl.helpSteps.map((step) => <li key={step}>{step}</li>)}</ol>
    </div>

    {editorPresence.visible ? <SkillXCurlEditor
      initialCurls={curls}
      active={editorOpen}
      leaving={editorPresence.leaving}
      onClose={() => setEditorOpen(false)}
      onSaved={async (next) => {
        setCurls(next);
        setCurlState("configured");
        setEditorOpen(false);
      }}
    /> : null}
  </section>;
}

function SkillXCurlEditor({ initialCurls, active, leaving, onClose, onSaved }: { initialCurls: string[]; active: boolean; leaving: boolean; onClose(): void; onSaved(curls: string[]): Promise<void> }) {
  useLocale();
  const [drafts, setDrafts] = useState(() => initialCurls.length ? initialCurls : [""]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dismiss = () => { if (!saving) onClose(); };
  const textareaRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!active) return;
    textareaRefs.current[0]?.focus();
  }, [active]);

  const save = async () => {
    const normalized = drafts.map((draft) => draft.trim());
    const invalidIndex = normalized.findIndex((curl) => !/^curl(?:\s|')/i.test(curl));
    if (invalidIndex >= 0) {
      setFailure(m.xCurl.invalidAt(invalidIndex + 1));
      return;
    }
    const next = [...new Set(normalized)];
    setSaving(true);
    setFailure(null);
    try {
      await window.openmind.saveXFollowingCurls(next);
      await onSaved(next);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return <Dialog size="lg" as="section" open={active} presence={{ visible: true, leaving }} onClose={dismiss} dismissDisabled={saving}  containerRef={dialogRef} className="skills-x-curl-editor" aria-labelledby="skills-x-curl-editor-title">
      <DialogHeader title={m.xCurl.editorTitle} titleId="skills-x-curl-editor-title" description={m.xCurl.editorDescription} onClose={dismiss} closeDisabled={saving} closeLabel={m.common.close} />
      <form className="ui-dialog-form" onSubmit={(event) => { event.preventDefault(); void save(); }}><DialogBody>
        <div className="skills-x-curl-list">
          {drafts.map((draft, index) => <section className="skills-x-curl-item" key={index}>
            <header>
              <label htmlFor={`skills-x-curl-${index}`}>{m.xCurl.fullCurl(index + 1)}</label>
              <Button variant="ghost" type="button" data-motion="action" disabled={drafts.length === 1} aria-label={m.xCurl.remove(index + 1)} onClick={() => {
                setDrafts((current) => current.filter((_, currentIndex) => currentIndex !== index));
                setFailure(null);
              }}><X size={13} aria-hidden />{m.common.delete}</Button>
            </header>
            <Textarea id={`skills-x-curl-${index}`} ref={(node) => { textareaRefs.current[index] = node; }} value={draft} onChange={(event) => {
              const value = event.target.value;
              setDrafts((current) => current.map((item, currentIndex) => currentIndex === index ? value : item));
              setFailure(null);
            }} spellCheck={false} placeholder={"curl 'https://x.com/i/api/graphql/…' \\\n  -H 'authorization: …'"} />
          </section>)}
        </div>
        <Button type="button" className="skills-x-curl-add" data-motion="action" disabled={drafts.length >= 20} onClick={() => {
          setDrafts((current) => [...current, ""]);
          setFailure(null);
        }}><Plus size={14} aria-hidden />{m.xCurl.add}</Button>
        <p className="skills-x-curl-security">{m.xCurl.securityDetail}</p>
        {failure ? <p className="skills-source-editor-error" role="alert">{failure}</p> : null}
        </DialogBody><DialogFooter><Button variant="ghost" type="button" data-motion="action" onClick={dismiss} disabled={saving}>{m.common.cancel}</Button><Button variant="primary" type="submit"  data-motion="action" disabled={saving || drafts.some((draft) => !draft.trim())} aria-busy={saving || undefined}>{saving ? m.common.saving : m.xCurl.saveAll}</Button></DialogFooter>
      </form>
    </Dialog>;
}

function SkillSourceEditor({ state, kind, active, leaving, onClose, onSaved }: { state: SourceEditorState; kind: "rss" | "reddit"; active: boolean; leaving: boolean; onClose(): void; onSaved(): Promise<void> }) {
  useLocale();
  const editing = state.mode === "edit" ? state.source : null;
  const isReddit = kind === "reddit";
  const [name, setName] = useState(editing?.name || "");
  const [url, setUrl] = useState(editing?.url || "");
  const [tags, setTags] = useState(editing?.tags.join(", ") || "");
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dismiss = () => { if (!saving) onClose(); };
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!active) return;
    inputRef.current?.focus();
  }, [active]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setFailure(null);
    const nextTags = tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
    try {
      if (editing) await window.openmind.updateSource(editing.id, { name: name.trim(), url: url.trim(), tags: nextTags, enabled });
      else await window.openmind.addRssSource({ name: name.trim(), url: url.trim(), kind, frequency: m.ownedSources.frequency, tags: nextTags });
      await onSaved();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return <Dialog size="md" as="section" open={active} presence={{ visible: true, leaving }} onClose={dismiss} dismissDisabled={saving}  containerRef={dialogRef}  aria-labelledby="skill-source-editor-title">
      <DialogHeader title={m.sourceEditor.title(Boolean(editing), isReddit)} titleId="skill-source-editor-title" description={m.sourceEditor.description(isReddit)} onClose={dismiss} closeDisabled={saving} closeLabel={m.common.close} />
      <form className="ui-dialog-form" onSubmit={(event) => { event.preventDefault(); void save(); }}><DialogBody>
        <FormField label={m.sourceEditor.name(isReddit)}><Input ref={inputRef} value={name} onChange={(event) => setName(event.target.value)} placeholder={m.sourceEditor.namePlaceholder(isReddit)} /></FormField>
        {editing ? <FormField label={messages.rss.enabled}><ToggleSwitch checked={enabled} disabled={saving} label={messages.rss.enabled} onChange={setEnabled} /></FormField> : null}
        <FormField label={m.sourceEditor.url(isReddit)}><Input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder={isReddit ? "https://www.reddit.com/r/LocalLLaMA/hot.json" : "https://example.com/feed.xml"} /></FormField>
        <FormField label={m.sourceEditor.tags}><Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder={m.sourceEditor.tagsPlaceholder(isReddit)} /></FormField>
        {failure ? <p className="skills-source-editor-error" role="alert">{failure}</p> : null}
        </DialogBody><DialogFooter><Button variant="ghost" type="button" data-motion="action" onClick={dismiss} disabled={saving}>{m.common.cancel}</Button><Button variant="primary" type="submit"  data-motion="action" disabled={saving || !name.trim() || !url.trim()} aria-busy={saving || undefined}>{saving ? m.common.saving : editing ? m.sourceEditor.saveChanges : m.sourceEditor.add(isReddit)}</Button></DialogFooter>
      </form>
    </Dialog>;
}

function skillSourceCopy(summary: Pick<ManifestSummary, "id" | "title">, count: number): { title: string; description: string; searchPlaceholder: string; empty: string } {
  if (summary.id === "rss-article-saver") return {
    title: m.sourceCopy.rss.title(summary.title),
    description: m.sourceCopy.rss.description(count),
    searchPlaceholder: m.sourceCopy.rss.search,
    empty: m.sourceCopy.rss.empty
  };
  if (summary.id === "reddit-fetcher") return {
    title: m.sourceCopy.reddit.title(summary.title),
    description: m.sourceCopy.reddit.description(count),
    searchPlaceholder: m.sourceCopy.reddit.search,
    empty: m.sourceCopy.reddit.empty
  };
  return {
    title: m.sourceCopy.x.title(summary.title),
    description: m.sourceCopy.x.description,
    searchPlaceholder: m.sourceCopy.x.search,
    empty: m.sourceCopy.x.empty
  };
}

function sourceStatusLabel(source: SourceDefinition): string {
  if (!source.enabled || source.status === "disabled") return m.sourceStatus.disabled;
  return ({ idle: m.sourceStatus.idle, running: m.sourceStatus.running, success: m.sourceStatus.success, warning: m.sourceStatus.warning, failed: m.sourceStatus.failed, disabled: m.sourceStatus.disabled } as const)[source.status];
}

function sourceStatusTone(source: SourceDefinition): string {
  if (!source.enabled || source.status === "disabled") return "idle";
  if (source.status === "failed") return "danger";
  if (source.status === "warning") return "warning";
  if (source.status === "running") return "running";
  return source.status === "success" ? "success" : "idle";
}

function sourceLastRun(source: SourceDefinition): string {
  if (!source.lastRunAt) return m.sourceStatus.never;
  const parsed = new Date(source.lastRunAt);
  if (Number.isNaN(parsed.getTime())) return source.lastRunAt;
  return m.sourceStatus.last(parsed.toLocaleString(getLocale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }));
}


export const RedditSourceCard = memo(function RedditSourceCard({ source, onEdit }: { source: SourceDefinition; onEdit(source: SourceDefinition): void }) {
  useLocale();
  const lastFailed = source.status === "failed" || source.status !== "success" && Boolean(source.recentError);
  return <article className="workspace-card collector-source-card" role="listitem" aria-label={source.name}>
        <div className="collector-source-heading">
          <strong className="collector-source-name" title={source.name}>{source.name}</strong>
          {lastFailed ? <Tooltip content={<>{m.sourceStatus.lastFailed}{source.recentError ? <span className="collector-source-error-detail">{source.recentError}</span> : null}</>}><span className="collector-source-failure-dot" role="img" aria-label={m.sourceStatus.lastFailed} tabIndex={0} /></Tooltip> : null}
        </div>
        <div className="collector-source-meta"><span>{sourceLastRun(source)}</span></div>
        <div className="collector-source-address">{source.url ? <>
          <a href={source.url} title={source.url} aria-label={source.url} onClick={event => { event.preventDefault(); void window.openmind.openExternal(event.currentTarget.href); }}>{shortUrl(source.url)}</a>
          <CopyButton text={source.url} label={`${messages.ai.message.copy}: ${source.name}`} />
        </> : <span>{source.frequency}</span>}</div>
        <div className="collector-source-edit"><IconButton label={m.ownedSources.edit(source.name)} onClick={() => onEdit(source)}><Pencil size={16} aria-hidden /></IconButton></div>
      </article>;
});

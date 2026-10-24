import { useCollectionMotion } from "../../design-system/use-collection-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileOutput, Plus, Search } from "lucide-react";
import { messages, getLocale } from "@shared/messages";
import { useLocale } from "../../i18n";
import { useFeedback } from "../../feedback-context";
import { EmptyState, ErrorState, IconButton, SearchInput } from "../../design-system/components";
import { ProjectListDetail } from "./ProjectListDetail";
import { projectsApi } from "./projects-api";
import type { ProjectDetail, ProjectOutput } from "./types";
import { ProjectOutputDetail, type ProjectOutputNavigationGuard } from "./ProjectOutputDetail";
export type { ProjectOutputNavigationGuard } from "./ProjectOutputDetail";
export function ProjectOutputsPanel({ project, initialOutputPath, createRequested, onCreateHandled, onChanged, onSelectionChange, onNavigationGuardChange, autoSelectFirst = true, listHost, detailHost }: {
  project: ProjectDetail; initialOutputPath?: string; createRequested: boolean; onCreateHandled(): void;
  onNavigationGuardChange?(guard: ProjectOutputNavigationGuard | null): void;
  onChanged(): void; onSelectionChange?(relativePath?: string): void; autoSelectFirst?: boolean;
  listHost?: HTMLElement | null; detailHost?: HTMLElement | null;
}) {
  const locale = useLocale();
  const feedback = useFeedback();
  const [items, setItems] = useState<ProjectOutput[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const selectedRef = useRef(selectedPath);
  const [query, setQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localCreate, setLocalCreate] = useState(false);
  const callbacks = useRef({ onSelectionChange, onChanged });
  callbacks.current = { onSelectionChange, onChanged };
  const select = useCallback((path?: string) => {
    selectedRef.current = path || "";
    setSelectedPath(path || "");
    callbacks.current.onSelectionChange?.(path);
  }, []);
  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const next = await projectsApi.listOutputs(project.name);
      if (id !== request.current) return;
      setItems(next); setError(null);
      if (!selectedRef.current) {
        const preferred = next.find(item => item.relativePath === initialOutputPath) || (autoSelectFirst ? next[0] : undefined);
        if (preferred) select(preferred.relativePath);
      }
    } catch (cause) { if (id === request.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (id === request.current) setLoading(false); }
  }, [project.name, initialOutputPath, autoSelectFirst, select]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);
  const changed = useCallback(async () => { await load(); callbacks.current.onChanged(); }, [load]);
  const guard = useRef<ProjectOutputNavigationGuard | null>(null);
  const setGuard = useCallback((value: ProjectOutputNavigationGuard | null) => { guard.current = value; onNavigationGuardChange?.(value); }, [onNavigationGuardChange]);
  const acceptOutput = useCallback((next: ProjectOutput) => setItems(current => current.some(item => item.relativePath === next.relativePath) ? current.map(item => item.relativePath === next.relativePath ? next : item) : [next, ...current]), []);
  const canNavigate = async () => {
    if (!guard.current?.isDirty() || await guard.current.flush()) return true;
    const discard = await feedback.confirm({ title: messages.projectUi.documentSaveFailed, body: messages.projectUi.discardUnsavedPrompt, confirmText: messages.projectUi.discardChanges, danger: true });
    if (discard) guard.current?.discard();
    return discard;
  };
  const outputs = items;
  const listMotion = useCollectionMotion(items.length, 40);
  const filtered = useMemo(() => items.filter(item => (!query.trim() || item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))), [items, query, locale]);
  const hosted = Boolean(listHost || detailHost);
  const list = (
    <>
      {!hosted ? <header className="project-local-list-header"><div><span className="eyebrow">{messages.projectUi.markdownWriting}</span><h2>{messages.projectUi.document}</h2></div><IconButton  onClick={() => { setLocalCreate(true); }} label={messages.projectUi.newDocument}><Plus size={16} /></IconButton></header> : null}
      <SearchInput className="project-pane-filter" leadingIcon={null} trailingIcon={<Search aria-hidden />} aria-label={messages.projectUi.searchOutputs} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={messages.projectUi.searchOutputs} />
      <div className="project-local-count">{messages.projectUi.allOutputs}<span>{filtered.length}</span></div>
      <div className="project-item-list project-output-list" data-project-list-motion={listMotion.enabled || undefined} aria-busy={loading || undefined}>
        {loading ? Array.from({ length: 5 }, (_, index) => <div className="project-item-skeleton" key={index} />) : null}
        {!loading && !error && !filtered.length ? <EmptyState title={outputs.length ? messages.projectUi.noMatchingOutputs : messages.projectUi.noOutputs} description={outputs.length ? messages.projectUi.tryAnotherTitle : messages.projectUi.outputsHint} /> : null}
        {filtered.map((item) => <button aria-pressed={Boolean(item.relativePath === selectedPath)} key={item.relativePath} className={`project-content-row${item.relativePath === selectedPath ? " active" : ""}`} data-motion="selection" onClick={() => {
          void canNavigate().then(allowed => { if (allowed) select(item.relativePath); });
        }}><FileOutput size={15} /><span><strong>{item.title}</strong><small>{item.sourceTaskId ? messages.projectUi.fromProjectTask(formatTime(item.updatedAt)) : formatTime(item.updatedAt)}</small></span></button>)}
      </div>
    </>
  );
  const detail = <ProjectOutputDetail renderDetail={!hosted || Boolean(detailHost)} project={project} outputPath={selectedPath} onOutputChange={acceptOutput} onNavigationGuardChange={setGuard} createRequested={createRequested || localCreate} onCreateHandled={() => { setLocalCreate(false); onCreateHandled(); }} onSelectionChange={select} onChanged={changed} />;
  if (hosted) return <>{listHost ? createPortal(list, listHost) : null}{detailHost ? createPortal(detail, detailHost) : detail}</>;
  return <ProjectListDetail storageKey={"openmind:projects:outputs-layout:" + project.name} detailOpen={Boolean(selectedPath)} list={list} detail={detail} detailLabel={messages.projectUi.document} onBack={() => { void canNavigate().then(allowed => { if (allowed) select(); }); }} />;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(getLocale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

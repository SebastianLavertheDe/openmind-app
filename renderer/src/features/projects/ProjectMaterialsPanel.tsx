import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Plus, Video, Globe2 } from "lucide-react";
import { messages } from "@shared/messages";
import { useLocale } from "../../i18n";
import { EmptyState, ErrorState, IconButton, SearchInput, SegmentedControl } from "../../design-system/components";
import { ProjectListDetail } from "./ProjectListDetail";
import { projectsApi } from "./projects-api";
import type { ProjectDetail, ProjectMaterial, ProjectMaterialKind } from "./types";
import type { ProjectTaskSeed } from "./ProjectTasksPanel";
import { ProjectMaterialDetail } from "./ProjectMaterialDetail";

type MaterialFilter = "all" | ProjectMaterialKind;

export function ProjectMaterialsPanel({ project, initialMaterialPath, createRequested, onCreateHandled, onCreateTask, onChanged, onSelectionChange, autoSelectFirst = true, listHost, detailHost }: {
  project: ProjectDetail; initialMaterialPath?: string; createRequested: boolean; onCreateHandled(): void;
  onCreateTask(seed: ProjectTaskSeed): void;
  onChanged(): void; onSelectionChange?(relativePath?: string): void; autoSelectFirst?: boolean;
  listHost?: HTMLElement | null; detailHost?: HTMLElement | null;
}) {
  const locale = useLocale();
  const [items, setItems] = useState<ProjectMaterial[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const selectedRef = useRef(selectedPath);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | ProjectMaterialKind>("all");
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
      const next = await projectsApi.listMaterials(project.name);
      if (id !== request.current) return;
      setItems(next); setError(null);
      if (!selectedRef.current) {
        const preferred = next.find(item => item.relativePath === initialMaterialPath) || (autoSelectFirst ? next[0] : undefined);
        if (preferred) select(preferred.relativePath);
      }
    } catch (cause) { if (id === request.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (id === request.current) setLoading(false); }
  }, [project.name, initialMaterialPath, autoSelectFirst, select]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);
  const changed = useCallback(async () => { await load(); callbacks.current.onChanged(); }, [load]);

  const materials = items;
  const filtered = useMemo(() => items.filter(item => (!query.trim() || item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && (filter === "all" || item.kind === filter)), [items, query, locale, filter]);
  const hosted = Boolean(listHost || detailHost);
  const list = (
    <>
      {!hosted ? <header className="project-local-list-header"><div><span className="eyebrow">{messages.projectUi.projectMaterials}</span><h2>{messages.projectUi.materials}</h2></div><IconButton  onClick={() => setLocalCreate(true)} label={messages.projectUi.addMaterials}><Plus size={16} /></IconButton></header> : null}
      <SearchInput className="project-local-search" variant="outlined" aria-label={messages.projectUi.searchMaterials} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={messages.projectUi.searchMaterials} />
      <SegmentedControl value={filter} onChange={setFilter} label={messages.projectUi.materialType}
        options={(["all", "document", "web", "video"] as MaterialFilter[]).map(value => ({ value, label: materialFilterLabel(value) }))} />
      <div className="project-local-count">{materialFilterLabel(filter)} <span>{filtered.length}</span></div>
      <div className="project-item-list">
        {loading ? Array.from({ length: 5 }, (_, index) => <div className="project-item-skeleton" key={index} />) : null}
        {!loading && !error && !filtered.length ? <EmptyState title={materials.length ? messages.projectUi.noMatchingMaterials : messages.projectUi.noMaterials} description={materials.length ? messages.projectUi.adjustMaterialSearch : messages.projectUi.addMaterialsHint} /> : null}
        {filtered.map((item) => {
          const Icon = materialIcon(item.kind);
          return <button aria-pressed={Boolean(item.relativePath === selectedPath)} key={item.relativePath} className={item.relativePath === selectedPath ? "active" : ""} data-motion="selection" onClick={() => void select(item.relativePath)}><Icon size={15} /><span><strong>{item.title}</strong><small>{materialKindLabel(item.kind)} · {materialStatusLabel(item.status)}</small></span></button>;
        })}
        {!loading && error ? <ErrorState message={error} retry={() => void load()} /> : null}
      </div>
    </>
  );

  const detail = <ProjectMaterialDetail renderDetail={!hosted || Boolean(detailHost)} project={project} materialPath={selectedPath} material={items.find(item => item.relativePath === selectedPath)} createRequested={createRequested || localCreate} onCreateHandled={() => { setLocalCreate(false); onCreateHandled(); }} onSelectionChange={select} onChanged={changed} />;
  if (hosted) return <>{listHost ? createPortal(list, listHost) : null}{detailHost ? createPortal(detail, detailHost) : detail}</>;
  return <ProjectListDetail storageKey={"openmind:projects:materials-layout:" + project.name} detailOpen={Boolean(selectedPath)} list={list} detail={detail} detailLabel={messages.projectUi.materials} onBack={() => { select(); }} />;
}

function materialIcon(kind: ProjectMaterialKind) {
  return kind === "video" ? Video : kind === "web" ? Globe2 : FileText;
}

function materialFilterLabel(kind: MaterialFilter): string {
  return kind === "document" ? messages.projectUi.document : kind === "web" ? messages.projectUi.webpage : kind === "video" ? messages.projectUi.video : messages.projectUi.all;
}

function materialKindLabel(kind: ProjectMaterialKind): string {
  return materialFilterLabel(kind);
}

function materialStatusLabel(status: ProjectMaterial["status"]): string {
  return status === "importing" ? messages.projectUi.importingStatus : status === "converting" ? messages.projectUi.convertingStatus : status === "failed" ? messages.projectUi.conversionFailedStatus : messages.projectUi.readyStatus;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FilePenLine, FileText, Files, Globe2, Search, Video } from "lucide-react";
import { useAi } from "../../ai-context";
import { EmptyState, ErrorState } from "../../design-system/components";
import { ProjectMaterialsPanel } from "./ProjectMaterialsPanel";
import { ProjectOutputsPanel, type ProjectOutputNavigationGuard } from "./ProjectOutputsPanel";
import type { ProjectTaskSeed } from "./ProjectTasksPanel";
import { projectsApi } from "./projects-api";
import type { ProjectCreateAction, ProjectDetail, ProjectMaterial, ProjectOutput, ProjectSection } from "./types";

type ProjectFileKind = "material" | "output";
type ProjectFileSelection = { kind: ProjectFileKind; relativePath: string };
type ProjectFileEntry = ProjectFileSelection & {
  title: string;
  materialKind?: ProjectMaterial["kind"];
  updatedAt: string;
};

export function ProjectFilesPanel({
  project,
  initialSection,
  initialItem,
  createRequested,
  onCreateHandled,
  onCreateTask,
  onChanged,
  onNavigationGuardChange,
  listHost,
  detailHost
}: {
  project: ProjectDetail;
  initialSection: ProjectSection;
  initialItem?: string;
  createRequested: Extract<ProjectCreateAction, "materials" | "outputs"> | null;
  onCreateHandled(): void;
  onCreateTask(seed: ProjectTaskSeed): void;
  onChanged(): void;
  onNavigationGuardChange?(guard: ProjectOutputNavigationGuard | null): void;
  listHost: HTMLElement;
  detailHost: HTMLElement;
}) {
  const ai = useAi();
  const [materials, setMaterials] = useState<ProjectMaterial[]>([]);
  const [outputs, setOutputs] = useState<ProjectOutput[]>([]);
  const [selection, setSelection] = useState<ProjectFileSelection | null>(() => initialItem ? {
    kind: initialSection === "outputs" ? "output" : "material",
    relativePath: initialItem
  } : null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectionRef = useRef(selection);
  const guardRef = useRef<ProjectOutputNavigationGuard | null>(null);
  const confirmRef = useRef(ai.confirm);
  confirmRef.current = ai.confirm;

  const updateSelection = useCallback((next: ProjectFileSelection | null) => {
    selectionRef.current = next;
    setSelection(next);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextMaterials, nextOutputs] = await Promise.all([
        projectsApi.listMaterials(project.name),
        projectsApi.listOutputs(project.name)
      ]);
      setMaterials(nextMaterials);
      setOutputs(nextOutputs);
      setError(null);
      const entries = projectFileEntries(nextMaterials, nextOutputs);
      const current = selectionRef.current;
      const currentStillExists = current && entries.some((item) => sameSelection(item, current));
      const currentIsCreateTarget = current?.relativePath === "";
      if (!currentStillExists && !currentIsCreateTarget) {
        const initialKind: ProjectFileKind = initialSection === "outputs" ? "output" : "material";
        const preferred = initialItem
          ? entries.find((item) => item.kind === initialKind && item.relativePath === initialItem)
          : undefined;
        updateSelection(preferred || entries[0] || null);
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [initialItem, initialSection, project.name, updateSelection]);

  useEffect(() => { void load(); }, [load]);
  const completeCreateRequest = useCallback((kind: ProjectFileKind) => {
    // Keep the create-only child mounted after ProjectsPage clears its one-shot
    // request. Without this sentinel, switching from Tasks directly into a
    // create dialog can immediately unmount that dialog again.
    updateSelection({ kind, relativePath: "" });
    onCreateHandled();
  }, [onCreateHandled, updateSelection]);

  const entries = useMemo(() => projectFileEntries(materials, outputs), [materials, outputs]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return entries.filter((item) => !needle || item.title.toLocaleLowerCase().includes(needle));
  }, [entries, query]);

  const handleNavigationGuard = useCallback((guard: ProjectOutputNavigationGuard | null) => {
    guardRef.current = guard;
    onNavigationGuardChange?.(guard);
  }, [onNavigationGuardChange]);

  const canChangeFile = useCallback(async () => {
    const guard = guardRef.current;
    if (!guard?.isDirty()) return true;
    if (await guard.flush()) return true;
    const discard = await confirmRef.current({
      title: "文档保存失败",
      body: "修改仍未保存。要放弃这些修改并继续吗？",
      confirmText: "放弃修改",
      danger: true
    });
    if (discard) guard.discard();
    return discard;
  }, []);

  const openFile = useCallback(async (next: ProjectFileSelection) => {
    if (selectionRef.current && sameSelection(selectionRef.current, next)) return;
    if (!await canChangeFile()) return;
    updateSelection(next);
  }, [canChangeFile, updateSelection]);

  const handleChanged = useCallback(() => {
    void load();
    onChanged();
  }, [load, onChanged]);

  const list = (
    <>
      <label className="project-pane-filter">
        <input aria-label="搜索文件" value={query} placeholder="你的文件" onChange={(event) => setQuery(event.target.value)} />
        <Search aria-hidden="true" />
      </label>
      <div className="project-item-list project-file-list" aria-live="polite">
        {loading ? Array.from({ length: 6 }, (_, index) => <div className="project-item-skeleton" key={index} />) : null}
        {!loading && error ? <ErrorState message={error} retry={() => void load()} /> : null}
        {!loading && !error && !filtered.length ? <EmptyState title={entries.length ? "没有匹配的文件" : "还没有文件"} description={entries.length ? "换一个关键词后再试。" : "可通过右上角加号新建文档或添加资料。"} /> : null}
        {!loading && !error ? filtered.map((item) => {
          const Icon = fileIcon(item);
          return (
            <button
              key={`${item.kind}:${item.relativePath}`}
              type="button"
              className={selection && sameSelection(selection, item) ? "active" : ""}
              onClick={() => void openFile(item)}
            >
              <Icon aria-hidden="true" />
              <span><strong>{item.title}</strong></span>
            </button>
          );
        }) : null}
      </div>
    </>
  );

  const activeKind: ProjectFileKind | null = createRequested === "outputs"
    ? "output"
    : createRequested === "materials"
      ? "material"
      : selection?.kind || null;
  const activePath = createRequested
    ? ""
    : selection?.kind === activeKind ? selection.relativePath : "";
  const detail = activeKind === "material" ? (
    <ProjectMaterialsPanel
      key={`material:${activePath || "create"}`}
      project={project}
      initialMaterialPath={activePath || undefined}
      createRequested={createRequested === "materials"}
      onCreateHandled={() => completeCreateRequest("material")}
      onCreateTask={onCreateTask}
      onChanged={handleChanged}
      autoSelectFirst={Boolean(activePath)}
      onSelectionChange={(relativePath) => {
        updateSelection(relativePath ? { kind: "material", relativePath } : null);
      }}
      detailHost={detailHost}
    />
  ) : activeKind === "output" ? (
    <ProjectOutputsPanel
      key={`output:${activePath || "create"}`}
      project={project}
      initialOutputPath={activePath || undefined}
      createRequested={createRequested === "outputs"}
      onCreateHandled={() => completeCreateRequest("output")}
      onChanged={handleChanged}
      onNavigationGuardChange={handleNavigationGuard}
      autoSelectFirst={Boolean(activePath)}
      onSelectionChange={(relativePath) => {
        updateSelection(relativePath ? { kind: "output", relativePath } : null);
      }}
      detailHost={detailHost}
    />
  ) : createPortal(
    <EmptyState icon={<Files size={30} />} title="选择或新建文件" description="从左侧选择文件，或通过加号新建文档、添加资料。" />,
    detailHost
  );

  return (
    <>
      {createPortal(list, listHost)}
      {detail}
    </>
  );
}

function projectFileEntries(materials: ProjectMaterial[], outputs: ProjectOutput[]): ProjectFileEntry[] {
  return [...materials.map(materialEntry), ...outputs.map(outputEntry)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title));
}

function materialEntry(item: ProjectMaterial): ProjectFileEntry {
  return {
    kind: "material",
    relativePath: item.relativePath,
    title: item.title,
    materialKind: item.kind,
    updatedAt: item.updatedAt || item.createdAt || ""
  };
}

function outputEntry(item: ProjectOutput): ProjectFileEntry {
  return {
    kind: "output",
    relativePath: item.relativePath,
    title: item.title,
    updatedAt: item.updatedAt || item.createdAt || ""
  };
}

function sameSelection(left: ProjectFileSelection, right: ProjectFileSelection): boolean {
  return left.kind === right.kind && left.relativePath === right.relativePath;
}

function fileIcon(item: ProjectFileEntry): typeof FileText {
  if (item.kind === "output") return FilePenLine;
  if (item.materialKind === "web") return Globe2;
  if (item.materialKind === "video") return Video;
  return FileText;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

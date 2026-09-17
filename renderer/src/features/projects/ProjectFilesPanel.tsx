import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clapperboard, Download, FileText, Files, FolderInput, Globe2, LoaderCircle, MoreHorizontal, PencilLine, Search, Trash2 } from "lucide-react";
import { useAiUi } from "../../ai-context";
import { DropdownMenu, EmptyState, ErrorState } from "../../design-system/components";
import { useCollectionMotion } from "../../design-system/use-collection-motion";
import { ProjectDialog, ProjectTextField } from "./ProjectDialog";
import { ProjectMaterialsPanel } from "./ProjectMaterialsPanel";
import { ProjectOutputsPanel, type ProjectOutputNavigationGuard } from "./ProjectOutputsPanel";
import type { ProjectTaskSeed } from "./ProjectTasksPanel";
import { projectsApi } from "./projects-api";
import type { ProjectCreateAction, ProjectDetail, ProjectMaterial, ProjectOutput, ProjectSection, ProjectSummary } from "./types";

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
  onSelectionChange,
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
  onSelectionChange?(selected: boolean): void;
  onNavigationGuardChange?(guard: ProjectOutputNavigationGuard | null): void;
  listHost: HTMLElement;
  detailHost: HTMLElement;
}) {
  const ui = useAiUi();
  const [materials, setMaterials] = useState<ProjectMaterial[]>([]);
  const [outputs, setOutputs] = useState<ProjectOutput[]>([]);
  const [selection, setSelection] = useState<ProjectFileSelection | null>(() => initialItem ? {
    kind: initialSection === "outputs" ? "output" : "material",
    relativePath: initialItem
  } : null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const loadSequence = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ProjectFileEntry | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [moveTarget, setMoveTarget] = useState<ProjectFileEntry | null>(null);
  const [moveOptions, setMoveOptions] = useState<ProjectSummary[]>([]);
  const [moveDestination, setMoveDestination] = useState("");
  const [moveOptionsLoading, setMoveOptionsLoading] = useState(false);
  const selectionRef = useRef(selection);
  const guardRef = useRef<ProjectOutputNavigationGuard | null>(null);
  const confirmRef = useRef(ui.confirm);
  confirmRef.current = ui.confirm;

  const updateSelection = useCallback((next: ProjectFileSelection | null) => {
    const current = selectionRef.current;
    if ((!current && !next) || (current && next && sameSelection(current, next))) return;
    selectionRef.current = next;
    setSelection(next);
    onSelectionChange?.(Boolean(next));
  }, [onSelectionChange]);

  const load = useCallback(async () => {
    const request = ++loadSequence.current;
    setLoading(true);
    try {
      const [nextMaterials, nextOutputs] = await Promise.all([
        projectsApi.listMaterials(project.name),
        projectsApi.listOutputs(project.name)
      ]);
      if (request !== loadSequence.current) return;
      setMaterials(nextMaterials);
      setOutputs(nextOutputs);
      setHasLoaded(true);
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
      if (request === loadSequence.current) setError(errorText(cause));
    } finally {
      if (request === loadSequence.current) setLoading(false);
    }
  }, [initialItem, initialSection, project.name, updateSelection]);

  useEffect(() => {
    void load();
    return () => { loadSequence.current += 1; };
  }, [load]);
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
  const listMotion = useCollectionMotion(filtered.length, 40);

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
    if (selectionRef.current && sameSelection(selectionRef.current, next)) {
      onSelectionChange?.(true);
      return;
    }
    if (!await canChangeFile()) return;
    updateSelection(next);
  }, [canChangeFile, updateSelection, onSelectionChange]);

  const handleChanged = useCallback(() => {
    void load();
    onChanged();
  }, [load, onChanged]);

  const handleMaterialSelection = useCallback((relativePath?: string) => {
    updateSelection(relativePath ? { kind: "material", relativePath } : null);
  }, [updateSelection]);

  const handleOutputSelection = useCallback((relativePath?: string) => {
    updateSelection(relativePath ? { kind: "output", relativePath } : null);
  }, [updateSelection]);

  const isSelected = (entry: ProjectFileSelection) => Boolean(selectionRef.current && sameSelection(selectionRef.current, entry));

  const submitRename = async () => {
    const target = renameTarget;
    const title = renameTitle.trim();
    if (!target || !title || actionBusy) return;
    setActionBusy("rename");
    setActionError(null);
    try {
      const next = target.kind === "material"
        ? await projectsApi.renameMaterial(project.name, target.relativePath, title)
        : await projectsApi.renameOutput(project.name, target.relativePath, title);
      setRenameTarget(null);
      if (isSelected(target)) updateSelection({ kind: target.kind, relativePath: next.relativePath });
      await load();
      onChanged();
      ui.notify(`已重命名为“${next.title}”。`, "success");
    } catch (cause) {
      setActionError(errorText(cause));
      ui.notify(errorText(cause), "error");
    } finally {
      setActionBusy(null);
    }
  };

  const beginMove = async (entry: ProjectFileEntry) => {
    setMoveTarget(entry);
    setActionError(null);
    setMoveOptionsLoading(true);
    try {
      const all = await projectsApi.listProjects();
      const options = all.filter((item) => item.status === "active" && item.name !== project.name);
      setMoveOptions(options);
      setMoveDestination(options[0]?.name || "");
    } catch (cause) {
      ui.notify(errorText(cause), "error");
      setMoveTarget(null);
    } finally {
      setMoveOptionsLoading(false);
    }
  };

  const submitMove = async () => {
    const target = moveTarget;
    if (!target || !moveDestination || actionBusy) return;
    setActionBusy("move");
    setActionError(null);
    try {
      if (target.kind === "material") await projectsApi.moveMaterial(project.name, target.relativePath, moveDestination);
      else await projectsApi.moveOutput(project.name, target.relativePath, moveDestination);
      setMoveTarget(null);
      if (isSelected(target)) updateSelection(null);
      await load();
      onChanged();
      ui.notify(`已移动到项目“${moveDestination}”。`, "success");
    } catch (cause) {
      setActionError(errorText(cause));
      ui.notify(errorText(cause), "error");
    } finally {
      setActionBusy(null);
    }
  };

  const downloadEntry = async (entry: ProjectFileEntry) => {
    if (actionBusy) return;
    setActionBusy(`${entry.kind}:${entry.relativePath}`);
    try {
      const result = await projectsApi.downloadFile(project.name, entry.kind, entry.relativePath);
      if (!result.canceled && result.savedPath) ui.notify(`文件已保存到 ${result.savedPath}`, "success");
    } catch (cause) {
      ui.notify(errorText(cause), "error");
    } finally {
      setActionBusy(null);
    }
  };

  const deleteEntry = async (entry: ProjectFileEntry) => {
    if (actionBusy) return;
    const confirmed = await confirmRef.current({
      title: "删除文件",
      body: `确定删除“${entry.title}”吗？该文件将从项目中移除。`,
      confirmText: "删除",
      danger: true
    });
    if (!confirmed) return;
    setActionBusy(`${entry.kind}:${entry.relativePath}`);
    try {
      if (entry.kind === "material") await projectsApi.removeMaterial(project.name, entry.relativePath);
      else await projectsApi.removeOutput(project.name, entry.relativePath);
      if (isSelected(entry)) updateSelection(null);
      await load();
      onChanged();
      ui.notify("文件已删除。", "success");
    } catch (cause) {
      ui.notify(errorText(cause), "error");
    } finally {
      setActionBusy(null);
    }
  };

  const list = (
    <>
      <label className="project-pane-filter">
        <input aria-label="搜索文件" value={query} placeholder="你的文件" onChange={(event) => setQuery(event.target.value)} />
        {loading && hasLoaded ? <LoaderCircle className="spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
      </label>
      <div className="project-item-list project-file-list" data-project-list-motion={listMotion.enabled || undefined} aria-live="polite" aria-busy={loading || undefined}>
        {loading && !hasLoaded ? Array.from({ length: 6 }, (_, index) => <div className="project-item-skeleton" key={index} />) : null}
        {!loading && !error && !filtered.length ? <EmptyState title={entries.length ? "没有匹配的文件" : "还没有文件"} description={entries.length ? "换一个关键词后再试。" : "可通过右上角加号新建文档或添加资料。"} /> : null}
        {hasLoaded ? filtered.map((item) => {
          const Icon = fileIcon(item);
          const active = Boolean(selection && sameSelection(selection, item));
          return (
            <div
              key={`${item.kind}:${item.relativePath}`}
              className={`project-file-row project-content-row${active ? " active" : ""}`}
            >
              <button
                type="button"
                className={active ? "active" : ""}
                data-motion="selection"
                onClick={() => void openFile(item)}
              >
                <Icon className="project-file-icon" size={16} strokeWidth={2} aria-hidden="true" />
                <span><strong>{item.title}</strong></span>
              </button>
              <DropdownMenu
                className="project-file-more"
                ariaLabel={`文件操作：${item.title}`}
                menuLabel={`${item.title}的文件操作`}
                disabled={actionBusy === `${item.kind}:${item.relativePath}`}
                label={<MoreHorizontal size={15} aria-hidden="true" />}
              >
                <button type="button" role="menuitem" data-motion="action" onClick={() => { setRenameTitle(item.title); setActionError(null); setRenameTarget(item); }}>
                  <PencilLine size={15} aria-hidden="true" /><span>重命名</span>
                </button>
                <button type="button" role="menuitem" data-motion="action" onClick={() => void beginMove(item)}>
                  <FolderInput size={15} aria-hidden="true" /><span>移动到其他项目</span>
                </button>
                {item.materialKind !== "video" ? (
                  <button type="button" role="menuitem" data-motion="action" onClick={() => void downloadEntry(item)}>
                    <Download size={15} aria-hidden="true" /><span>下载</span>
                  </button>
                ) : null}
                <button type="button" role="menuitem" data-motion="action" onClick={() => void deleteEntry(item)}>
                  <Trash2 size={15} aria-hidden="true" /><span>删除</span>
                </button>
              </DropdownMenu>
            </div>
          );
        }) : null}
        {!loading && error ? <ErrorState message={error} retry={() => void load()} /> : null}
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
      onSelectionChange={handleMaterialSelection}
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
      onSelectionChange={handleOutputSelection}
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
      <ProjectDialog
        open={Boolean(renameTarget)}
        title="重命名"
        confirmLabel="确认"
        busy={actionBusy === "rename"}
        className="project-dialog-compact"
        backdropClassName="project-dialog-backdrop-clear"
        onClose={() => setRenameTarget(null)}
        onConfirm={() => void submitRename()}
      >
        <ProjectTextField label="名称" value={renameTitle} autoFocus onChange={setRenameTitle} />
        {actionError ? <p className="project-dialog-error" role="alert">{actionError}</p> : null}
      </ProjectDialog>
      <ProjectDialog
        open={Boolean(moveTarget)}
        title={moveTarget ? `移动“${moveTarget.title}”` : "移动文件"}
        description="文件将从当前项目移动到目标项目。"
        confirmLabel="移动"
        busy={actionBusy === "move"}
        className="project-dialog-compact"
        backdropClassName="project-dialog-backdrop-clear"
        onClose={() => setMoveTarget(null)}
        onConfirm={() => void submitMove()}
      >
        <label className="project-field">
          <span>目标项目</span>
          <select
            aria-label="目标项目"
            value={moveDestination}
            disabled={moveOptionsLoading}
            onChange={(event) => setMoveDestination(event.target.value)}
          >
            {moveOptions.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </label>
        {actionError ? <p className="project-dialog-error" role="alert">{actionError}</p> : null}
      </ProjectDialog>
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
  if (item.materialKind === "web") return Globe2;
  if (item.materialKind === "video") return Clapperboard;
  return FileText;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

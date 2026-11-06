import { useFeedback } from "../../feedback-context";
import { FormField } from "../../design-system/components";
import { MenuItem } from "../../design-system/components";
import { useLocale } from "../../i18n";
import { messages } from "@shared/messages";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Clapperboard, Download, FileText, Files, FolderInput, Globe2, LoaderCircle, MoreHorizontal, PencilLine, Search, Trash2 } from "lucide-react";
import { Button, DropdownMenu, EmptyState, ErrorState, SearchInput, Select } from "../../design-system/components";
import { useCollectionMotion } from "../../design-system/use-collection-motion";
import { ProjectDialog, ProjectTextField } from "./ProjectDialog";
import { ProjectMaterialDetail } from "./ProjectMaterialDetail";
import { ProjectOutputDetail, type ProjectOutputNavigationGuard } from "./ProjectOutputDetail";
import type { ProjectTaskSeed } from "./ProjectTasksPanel";
import { projectsApi } from "./projects-api";
import { useMaterialProcessingRefresh } from "./use-material-processing-refresh";
import type { ProjectCreateAction, ProjectDetail, ProjectMaterial, ProjectOutput, ProjectSection, ProjectSummary } from "./types";

type ProjectFileKind = "material" | "output";
const FILES_PER_PAGE = 50;
type ProjectFileSelection = { kind: ProjectFileKind; relativePath: string };
type ProjectFileEntry = ProjectFileSelection & {
  title: string;
  materialKind?: ProjectMaterial["kind"];
  materialStatus?: ProjectMaterial["status"];
  updatedAt: string;
};

export function ProjectFilesPanel({
  project,
  initialSection,
  initialItem,
  initialFileKind,
  restoreSelection = false,
  onFileChange,
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
  initialFileKind?: ProjectFileKind;
  restoreSelection?: boolean;
  onFileChange?(selection: ProjectFileSelection | null): void;
  createRequested: Extract<ProjectCreateAction, "materials" | "outputs"> | null;
  onCreateHandled(): void;
  onCreateTask(seed: ProjectTaskSeed): void;
  onChanged(): void;
  onSelectionChange?(selected: boolean): void;
  onNavigationGuardChange?(guard: ProjectOutputNavigationGuard | null): void;
  listHost: HTMLElement;
  detailHost: HTMLElement;
}) {
  const locale = useLocale();
  const feedback = useFeedback();
  const [materials, setMaterials] = useState<ProjectMaterial[]>([]);
  const [outputs, setOutputs] = useState<ProjectOutput[]>([]);
  const [selection, setSelection] = useState<ProjectFileSelection | null>(() => initialItem ? {
    kind: initialFileKind || (initialSection === "outputs" ? "output" : "material"),
    relativePath: initialItem
  } : null);
  useEffect(() => { onFileChange?.(selection); }, [selection, onFileChange]);
  const [query, setQuery] = useState("");
  const [pagination, setPagination] = useState({ query: "", page: 1 });
  const fileListRef = useRef<HTMLDivElement>(null);
  const pagedSelectionRef = useRef("");
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
  const confirmRef = useRef(feedback.confirm);
  confirmRef.current = feedback.confirm;

  const updateSelection = useCallback((next: ProjectFileSelection | null) => {
    const current = selectionRef.current;
    if ((!current && !next) || (current && next && sameSelection(current, next))) return;
    selectionRef.current = next;
    setSelection(next);
    onSelectionChange?.(Boolean(next));
  }, [onSelectionChange]);

  const load = useCallback(async (background = false) => {
    const request = ++loadSequence.current;
    if (!background) setLoading(true);
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
        const initialKind: ProjectFileKind = initialFileKind || (initialSection === "outputs" ? "output" : "material");
        const preferred = initialItem
          ? entries.find((item) => item.kind === initialKind && item.relativePath === initialItem)
          : undefined;
        updateSelection(preferred || (restoreSelection ? null : entries[0]) || null);
      }
    } catch (cause) {
      if (request === loadSequence.current) setError(errorText(cause));
    } finally {
      if (request === loadSequence.current) setLoading(false);
    }
  }, [initialItem, initialFileKind, initialSection, restoreSelection, project.name, updateSelection]);

  useMaterialProcessingRefresh(project.name, materials, () => load(true));

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

  const entries = useMemo(() => projectFileEntries(materials, outputs), [materials, outputs, locale]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return entries.filter((item) => !needle || item.title.toLocaleLowerCase().includes(needle));
  }, [entries, query, locale]);
  const listMotion = useCollectionMotion(filtered.length, 40);
  const pageCount = Math.max(1, Math.ceil(filtered.length / FILES_PER_PAGE));
  const page = pagination.query === query ? Math.min(pagination.page, pageCount) : 1;
  const pageRows = filtered.slice((page - 1) * FILES_PER_PAGE, page * FILES_PER_PAGE);
  useEffect(() => {
    if (pagination.query !== query || pagination.page !== page) setPagination({ query, page });
  }, [page, pagination, query]);
  useEffect(() => {
    if (!hasLoaded || !selection) return;
    const key = `${selection.kind}:${selection.relativePath}`;
    if (pagedSelectionRef.current === key) return;
    pagedSelectionRef.current = key;
    const index = filtered.findIndex(item => sameSelection(item, selection));
    if (index >= 0) setPagination({ query, page: Math.floor(index / FILES_PER_PAGE) + 1 });
  }, [hasLoaded, selection, filtered, query]);
  const changePage = (next: number) => {
    setPagination({ query, page: next });
    if (fileListRef.current) { fileListRef.current.scrollTop = 0; fileListRef.current.focus(); }
  };

  const handleNavigationGuard = useCallback((guard: ProjectOutputNavigationGuard | null) => {
    guardRef.current = guard;
    onNavigationGuardChange?.(guard);
  }, [onNavigationGuardChange]);

  const canChangeFile = useCallback(async () => {
    const guard = guardRef.current;
    if (!guard?.isDirty()) return true;
    if (await guard.flush()) return true;
    const discard = await confirmRef.current({
      title: messages.projectUi.documentSaveFailed,
      body: messages.projectUi.discardUnsavedPrompt,
      confirmText: messages.projectUi.discardChanges,
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

  const handleChanged = useCallback(async () => {
    await load();
    onChanged();
  }, [load, onChanged]);

  const handleMaterialSelection = useCallback((relativePath?: string) => {
    updateSelection(relativePath ? { kind: "material", relativePath } : null);
  }, [updateSelection]);

  const acceptOutput = useCallback((next: ProjectOutput) => {
    setOutputs(current => current.some(item => item.relativePath === next.relativePath)
      ? current.map(item => item.relativePath === next.relativePath ? next : item)
      : [next, ...current]);
  }, []);

  const handleOutputSelection = useCallback((relativePath?: string) => {
    updateSelection(relativePath ? { kind: "output", relativePath } : null);
  }, [updateSelection]);

  const clearMissingFile = useCallback(() => updateSelection(null), [updateSelection]);
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
      feedback.notify(messages.projectUi.renamedFile(next.title), "success");
    } catch (cause) {
      setActionError(errorText(cause));
      feedback.notify(errorText(cause), "error");
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
      feedback.notify(errorText(cause), "error");
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
      feedback.notify(messages.projectUi.movedToProject(moveDestination), "success");
    } catch (cause) {
      setActionError(errorText(cause));
      feedback.notify(errorText(cause), "error");
    } finally {
      setActionBusy(null);
    }
  };

  const downloadEntry = async (entry: ProjectFileEntry) => {
    if (actionBusy) return;
    setActionBusy(`${entry.kind}:${entry.relativePath}`);
    try {
      const result = await projectsApi.downloadFile(project.name, entry.kind, entry.relativePath);
      if (!result.canceled && result.savedPath) feedback.notify(messages.projectUi.fileSavedTo(result.savedPath), "success");
    } catch (cause) {
      feedback.notify(errorText(cause), "error");
    } finally {
      setActionBusy(null);
    }
  };

  const deleteEntry = async (entry: ProjectFileEntry) => {
    if (actionBusy) return;
    const confirmed = await confirmRef.current({
      title: messages.projectUi.deleteFile,
      body: messages.projectUi.deleteFilePrompt(entry.title),
      confirmText: messages.projectUi.delete,
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
      feedback.notify(messages.projectUi.fileDeleted, "success");
    } catch (cause) {
      feedback.notify(errorText(cause), "error");
    } finally {
      setActionBusy(null);
    }
  };

  const list = (
    <>
      <SearchInput className="project-pane-filter" leadingIcon={null} trailingIcon={loading && hasLoaded ? <LoaderCircle className="spin" aria-hidden /> : <Search aria-hidden />}
        aria-label={messages.projectUi.searchFiles} value={query} placeholder={messages.projectUi.yourFiles} onChange={(event) => setQuery(event.target.value)} />
      <div ref={fileListRef} tabIndex={-1} className="project-item-list project-file-list" data-project-list-motion={listMotion.enabled || undefined} aria-live="polite" aria-busy={loading || undefined}>
        {loading && !hasLoaded ? Array.from({ length: 6 }, (_, index) => <div className="project-item-skeleton" key={index} />) : null}
        {!loading && !error && !filtered.length ? <EmptyState title={entries.length ? messages.projectUi.noMatchingFiles : messages.projectUi.noFiles} description={entries.length ? messages.projectUi.tryAnotherKeyword : messages.projectUi.addFilesHint} /> : null}
        {hasLoaded ? pageRows.map((item) => {
          const processing = item.materialStatus === "importing" || item.materialStatus === "converting";
          const Icon = processing ? LoaderCircle : item.materialStatus === "failed" ? AlertTriangle : fileIcon(item);
          const active = Boolean(selection && sameSelection(selection, item));
          return (
            <div
              key={`${item.kind}:${item.relativePath}`}
              className={`project-file-row project-content-row${active ? " active" : ""}`}
            >
              <button aria-pressed={Boolean(active)}
                type="button"
                className={active ? "active" : ""}
                data-motion="selection"
                onClick={() => void openFile(item)}
              >
                <Icon className={`project-file-icon${processing ? " spin" : ""}`} size={16} strokeWidth={2} aria-hidden="true" />
                <span><strong>{item.title}</strong>{item.materialStatus && item.materialStatus !== "ready" ? <small>{item.materialStatus === "failed" ? messages.projectUi.conversionFailedStatus : item.materialStatus === "importing" ? messages.projectUi.importingStatus : messages.projectUi.convertingStatus}</small> : null}</span>
              </button>
              <DropdownMenu
                className="project-file-more"
                ariaLabel={messages.projectUi.fileActions(item.title)}
                menuLabel={messages.projectUi.fileActionsMenu(item.title)}
                disabled={actionBusy === `${item.kind}:${item.relativePath}`}
                label={<MoreHorizontal size={15} aria-hidden="true" />}
              >
                <MenuItem type="button" role="menuitem" data-motion="action" onClick={() => { setRenameTitle(item.title); setActionError(null); setRenameTarget(item); }}>
                  <PencilLine size={15} aria-hidden="true" /><span>{messages.projectUi.rename}</span>
                </MenuItem>
                <MenuItem type="button" role="menuitem" data-motion="action" onClick={() => void beginMove(item)}>
                  <FolderInput size={15} aria-hidden="true" /><span>{messages.projectUi.moveToAnotherProject}</span>
                </MenuItem>
                {item.materialKind !== "video" ? (
                  <MenuItem type="button" role="menuitem" data-motion="action" onClick={() => void downloadEntry(item)}>
                    <Download size={15} aria-hidden="true" /><span>{messages.projectUi.download}</span>
                  </MenuItem>
                ) : null}
                <MenuItem type="button" role="menuitem" data-motion="action" onClick={() => void deleteEntry(item)}>
                  <Trash2 size={15} aria-hidden="true" /><span>{messages.projectUi.delete}</span>
                </MenuItem>
              </DropdownMenu>
            </div>
          );
        }) : null}
        {!loading && error ? <ErrorState message={error} retry={() => void load()} /> : null}
      </div>
      {pageCount > 1 ? <div className="project-file-pagination">
        <Button size="sm" disabled={page === 1} onClick={() => changePage(page - 1)}>{messages.interface.previousPage}</Button>
        <span aria-label={messages.interface.currentPage} role="status">{page} / {pageCount}</span>
        <Button size="sm" disabled={page === pageCount} onClick={() => changePage(page + 1)}>{messages.interface.nextPage}</Button>
      </div> : null}
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
  const detailContent = activeKind === "material" ? (
    <ProjectMaterialDetail
      onMissing={restoreSelection && selection?.relativePath === initialItem ? clearMissingFile : undefined}
      project={project}
      materialPath={activePath || undefined}
      material={materials.find(item => item.relativePath === activePath)}
      createRequested={createRequested === "materials"}
      onCreateHandled={() => completeCreateRequest("material")}
      onChanged={handleChanged}
      onSelectionChange={handleMaterialSelection}
    />
  ) : activeKind === "output" ? (
    <ProjectOutputDetail
      onMissing={restoreSelection && selection?.relativePath === initialItem ? clearMissingFile : undefined}
      project={project}
      outputPath={activePath || undefined}
      onOutputChange={acceptOutput}
      createRequested={createRequested === "outputs"}
      onCreateHandled={() => completeCreateRequest("output")}
      onChanged={handleChanged}
      onNavigationGuardChange={handleNavigationGuard}
      onSelectionChange={handleOutputSelection}
    />
  ) : (
    <EmptyState icon={<Files size={30} />} title={messages.projectUi.selectOrCreateFile} description={messages.projectUi.selectOrCreateFileHint} />
  );
  const detail = createPortal(detailContent, detailHost);

  return (
    <>
      {createPortal(list, listHost)}
      {detail}
      <ProjectDialog
        open={Boolean(renameTarget)}
        title={messages.projectUi.rename}
        confirmLabel={messages.projectUi.confirm}
        busy={actionBusy === "rename"}
        size="sm"

        onClose={() => setRenameTarget(null)}
        onConfirm={() => void submitRename()}
      >
        <ProjectTextField label={messages.projectUi.name} value={renameTitle} autoFocus onChange={setRenameTitle} />
        {actionError ? <p className="project-dialog-error" role="alert">{actionError}</p> : null}
      </ProjectDialog>
      <ProjectDialog
        open={Boolean(moveTarget)}
        title={moveTarget ? messages.projectUi.moveNamedFile(moveTarget.title) : messages.projectUi.moveFile}
        description={messages.projectUi.moveFileHint}
        confirmLabel={messages.projectUi.move}
        busy={actionBusy === "move"}
        size="sm"

        onClose={() => setMoveTarget(null)}
        onConfirm={() => void submitMove()}
      >
        <FormField label={messages.projectUi.destinationProject}><Select
            size="rect"
            ariaLabel={messages.projectUi.destinationProject}
            value={moveDestination}
            disabled={moveOptionsLoading}
            onChange={setMoveDestination}
            options={moveOptions.map(item => ({ value: item.name, label: item.name }))}
          /></FormField>
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
    materialStatus: item.status,
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

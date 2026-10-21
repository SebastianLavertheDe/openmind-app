import { IconButton } from "../../design-system/IconButton";
import { Tabs } from "../../design-system/controls";
import { useLocale } from "../../i18n";
import { messages } from "@shared/messages";
import { type CSSProperties, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LayoutGroup, motion } from "motion/react";
import { useCollectionMotion } from "../../design-system/use-collection-motion";
import { useExitingList } from "../../design-system/use-exiting-list";
import { useExitPresence } from "../../design-system/use-exit-presence";
import {
  ArrowLeft,
  Archive,
  Files,
  FileOutput,
  FolderKanban,
  Library,
  ListTodo,
  LoaderCircle,
  MoreHorizontal,
  PanelLeftOpen,
  PencilLine,
  Plus,
  Search,
  Star
} from "lucide-react";
import { useAiUi } from "../../ai-context";
import { useResponsiveLayout } from "../../app/responsive-layout";
import { ColumnSplitter } from "../../components/ColumnSplitter";
import { LIST_WIDTH_MAX, LIST_WIDTH_MIN, useListDetailLayout } from "../../components/useListDetailLayout";
import { DropdownMenu, EmptyState, ErrorState, Skeleton, SearchInput } from "../../design-system/components";
import { ProjectEditDialog, ProjectIcon, projectColorValue } from "./ProjectAppearance";
import { ProjectDialog, ProjectTextField } from "./ProjectDialog";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { ProjectOutputsPanel, type ProjectOutputNavigationGuard } from "./ProjectOutputsPanel";
import { ProjectTasksPanel, type ProjectTaskSeed } from "./ProjectTasksPanel";
import { projectsApi } from "./projects-api";
import type { ProjectCreateAction, ProjectDetail, ProjectSection, ProjectSummary } from "./types";

type ProjectView = "tasks" | "files" | "outputs";
const VIEW_META: Record<ProjectView, { label: string; icon: typeof ListTodo }> = {
  tasks: { get label() { return messages.projectUi.tasks; }, icon: ListTodo },
  files: { get label() { return messages.projectUi.files; }, icon: Files },
  outputs: { get label() { return messages.projectUi.outputs; }, icon: FileOutput }
};
const PROJECT_VIEWS = Object.keys(VIEW_META) as ProjectView[];
const projectViewForSection = (section: ProjectSection): ProjectView => section === "outputs" ? "outputs" : section === "tasks" ? "tasks" : "files";

export function ProjectsPage({
  initialProjectName,
  initialSection = "tasks",
  initialItem
}: {
  initialProjectName?: string;
  initialSection?: ProjectSection;
  initialItem?: string;
}) {
  const locale = useLocale();
  const ui = useAiUi();
  const responsiveLayout = useResponsiveLayout();
  const compactWorkspace = responsiveLayout.workspace === "single";
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectDetail | null>(null);
  const [view, setView] = useState<ProjectView>(projectViewForSection(initialSection));
  const [createAction, setCreateAction] = useState<ProjectCreateAction | null>(null);
  const [taskSeed, setTaskSeed] = useState<ProjectTaskSeed | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [editProject, setEditProject] = useState<ProjectSummary | null>(null);
  const [projectActionBusy, setProjectActionBusy] = useState<string | null>(null);
  const [projectMotion, setProjectMotion] = useState({ revision: 0, relocatedId: "" });
  const projectListRef = useRef<HTMLDivElement>(null);
  const restoreProjectFocus = useRef(false);
  useLayoutEffect(() => {
    if (!restoreProjectFocus.current) return;
    restoreProjectFocus.current = false;
    const row = Array.from(projectListRef.current?.querySelectorAll<HTMLElement>("[data-project-motion]") || [])
      .find(element => element.dataset.projectMotion === projectMotion.relocatedId);
    row?.querySelector<HTMLButtonElement>(".ui-dropdown-trigger")?.focus({ preventScroll: true });
  }, [projectMotion]);
  const [openingProjectName, setOpeningProjectName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [compactListOpen, setCompactListOpen] = useState(true);
  const [sectionListHost, setSectionListHost] = useState<HTMLDivElement | null>(null);
  const [detailHost, setDetailHost] = useState<HTMLDivElement | null>(null);
  const layout = useListDetailLayout("openmind.list-detail.projects.v1", { listWidth: 264, listCollapsed: false });
  const outputNavigationGuardRef = useRef<ProjectOutputNavigationGuard | null>(null);
  const restoreCompactFocusRef = useRef(false);
  const restoreListFocusRef = useRef(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef(ui.confirm);
  confirmRef.current = ui.confirm;
  const listVisible = compactWorkspace ? compactListOpen : !layout.layout.listCollapsed;
  const hasActiveProject = Boolean(activeProject);
  const showCompactPane = useCallback((showList: boolean) => {
    if (compactWorkspace) {
      workspaceRef.current?.setAttribute("data-compact-motion", "true");
      if (showList) restoreListFocusRef.current = true;
      else restoreCompactFocusRef.current = true;
    }
    setCompactListOpen(showList);
  }, [compactWorkspace]);

  useEffect(() => {
    const cancel = () => workspaceRef.current?.removeAttribute("data-compact-motion");
    window.addEventListener("resize", cancel);
    return () => window.removeEventListener("resize", cancel);
  }, []);

  useEffect(() => {
    workspaceRef.current?.removeAttribute("data-compact-motion");
  }, [compactWorkspace]);

  useEffect(() => {
    if (!compactWorkspace) return;
    setCompactListOpen(!hasActiveProject);
  }, [compactWorkspace, hasActiveProject]);

  useEffect(() => {
    if (compactListOpen || !restoreCompactFocusRef.current) return;
    restoreCompactFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(".project-list-reopen")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [compactListOpen]);

  useEffect(() => {
    if (!compactWorkspace || !compactListOpen || !restoreListFocusRef.current) return;
    restoreListFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      const list = workspaceRef.current?.querySelector(".project-list-pane");
      const target = list?.querySelector<HTMLButtonElement>(".project-file-row.active > button, .project-task-row.active .project-task-select, .project-item-list > button.active")
        || list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"], input');
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [compactWorkspace, compactListOpen]);

  // 项目详情打开期间，把「新对话归属项目」告知全局 AI 侧栏：
  // 在项目页发起的新对话会自动创建为当前项目的任务，而不是工作区会话。
  const setProjectComposeTarget = ui.setProjectComposeTarget;
  useEffect(() => {
    setProjectComposeTarget(activeProject ? { projectId: activeProject.id, projectName: activeProject.name } : null);
    return () => setProjectComposeTarget(null);
  }, [activeProject?.id, activeProject?.name, setProjectComposeTarget]);

  const handleOutputNavigationGuard = useCallback((guard: ProjectOutputNavigationGuard | null) => {
    outputNavigationGuardRef.current = guard;
  }, []);

  const canLeaveCurrentOutput = useCallback(async () => {
    const guard = outputNavigationGuardRef.current;
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

  const navigateProject = useCallback(async (action: () => void) => {
    if (!await canLeaveCurrentOutput()) return false;
    action();
    return true;
  }, [canLeaveCurrentOutput]);

  const presentProjectView = useCallback((next: ProjectView) => {
    setView(next);
    if (next !== "tasks") {
      if (ui.panelMode === "collapsed") ui.setPanelMode("default");
    } else if (ui.panelMode !== "collapsed") {
      ui.setPanelMode("collapsed");
    }
  }, [ui.panelMode, ui.setPanelMode]);

  const requestCreate = useCallback((action: ProjectCreateAction) => {
    void navigateProject(() => {
      presentProjectView(projectViewForSection(action));
      setCreateAction(action);
    });
  }, [navigateProject, presentProjectView]);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const next = await projectsApi.listProjects();
      setProjects(next);
      setError(null);
      if (activeProject) {
        const match = next.find((item) => item.name === activeProject.name);
        if (match) setActiveProject(match);
      }
      return next;
    } catch (cause) {
      setError(errorText(cause));
      return [];
    } finally {
      setLoading(false);
    }
  }, [activeProject?.name]);

  useEffect(() => { void loadProjects(); }, []);
  useEffect(() => {
    if (!initialProjectName || activeProject?.name === initialProjectName) return;
    void (async () => {
      if (!await canLeaveCurrentOutput()) return;
      setOpeningProjectName(initialProjectName);
      try {
        setActiveProject(await projectsApi.getProject(initialProjectName));
        presentProjectView(projectViewForSection(initialSection));
      } catch (cause) {
        setError(errorText(cause));
      } finally {
        setOpeningProjectName(null);
      }
    })();
  }, [activeProject?.name, canLeaveCurrentOutput, initialProjectName, initialSection, presentProjectView]);

  const openCreateDialog = () => {
    setName("");
    setCreateProjectOpen(true);
  };

  const openProject = async (project: ProjectSummary) => {
    if (openingProjectName) return;
    if (outputNavigationGuardRef.current?.isDirty() && !await canLeaveCurrentOutput()) return;
    setError(null);
    setOpeningProjectName(project.name);
    try {
      setActiveProject(await projectsApi.getProject(project.name));
      presentProjectView("tasks");
      if (compactWorkspace) showCompactPane(false);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setOpeningProjectName(null);
    }
  };

  const createProject = async () => {
    const projectName = name.trim();
    if (!projectName || busy) return;
    setBusy(true);
    try {
      const next = await projectsApi.createProject(projectName, "");
      setProjects((current) => [next, ...current.filter((item) => item.name !== next.name)]);
      setActiveProject(next);
      presentProjectView("tasks");
      setCreateProjectOpen(false);
      setName("");
      ui.notify(messages.projectUi.projectCreated(next.name), "success");
    } catch (cause) {
      ui.notify(errorText(cause), "error");
    } finally {
      setBusy(false);
    }
  };

  const replaceProject = useCallback((previousName: string, next: ProjectDetail) => {
    setProjects((current) => current.map((item) => item.name === previousName ? next : item));
    setActiveProject((current) => current?.name === previousName ? next : current);
  }, []);

  const saveProjectEdits = async (input: { name: string; icon: string; color: ProjectSummary["color"] }) => {
    const current = editProject;
    if (!current || busy || !input.name) return;
    setBusy(true);
    try {
      let next = current;
      if (input.name !== current.name) next = await projectsApi.renameProject(current.name, input.name);
      next = await projectsApi.updateProject(next.name, { icon: input.icon, color: input.color });
      replaceProject(current.name, next);
      setEditProject(null);
      ui.notify(messages.projectUi.projectUpdated(next.name), "success");
    } catch (cause) {
      ui.notify(errorText(cause), "error");
      void loadProjects();
    } finally {
      setBusy(false);
    }
  };

  const toggleFavorite = async (project: ProjectSummary) => {
    if (projectActionBusy) return;
    setProjectActionBusy(project.name);
    try {
      const next = await projectsApi.updateProject(project.name, { favorite: !project.favorite });
      const focused = document.activeElement;
      restoreProjectFocus.current = focused instanceof HTMLElement && Boolean(
        focused.closest(".project-project-menu")?.getAttribute("aria-label") === messages.projectUi.projectActionsMenu(project.name)
        || focused.closest("[data-project-motion]")?.getAttribute("data-project-motion") === project.id
      );
      setProjectMotion(current => ({ revision: current.revision + 1, relocatedId: project.id }));
      replaceProject(project.name, next);
      ui.notify(next.favorite ? messages.projectUi.projectFavorited(next.name) : messages.projectUi.projectUnfavorited(next.name), "success");
    } catch (cause) {
      ui.notify(errorText(cause), "error");
    } finally {
      setProjectActionBusy(null);
    }
  };

  const archiveProject = async (project: ProjectSummary) => {
    if (projectActionBusy) return;
    setProjectActionBusy(project.name);
    try {
      const next = await projectsApi.archiveProject(project.name, true);
      // Move keyboard focus before the retained row becomes inert. A delayed
      // response must not steal focus if the user has moved elsewhere meanwhile.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && (
        focused.closest("[data-project-motion]")?.getAttribute("data-project-motion") === project.id
        || focused.closest(".project-project-menu")?.getAttribute("aria-label") === messages.projectUi.projectActionsMenu(project.name)
      )) {
        const rows = Array.from(projectListRef.current?.querySelectorAll<HTMLElement>("[data-project-motion]") || []);
        const index = rows.findIndex(row => row.dataset.projectMotion === project.id);
        const target = rows.slice(index + 1).find(row => !row.querySelector("[inert]"))
          || rows.slice(0, index).reverse().find(row => !row.querySelector("[inert]"));
        (target?.querySelector<HTMLElement>(".ui-dropdown-trigger")
          || workspaceRef.current?.querySelector<HTMLElement>('[data-project-search]'))?.focus({ preventScroll: true });
      }
      replaceProject(project.name, next);
      ui.notify(messages.projectUi.projectArchived(project.name), "success");
    } catch (cause) {
      ui.notify(errorText(cause), "error");
    } finally {
      setProjectActionBusy(null);
    }
  };

  const refreshActive = useCallback(async () => {
    if (!activeProject) return;
    try {
      const [detail] = await Promise.all([projectsApi.getProject(activeProject.name), loadProjects()]);
      setActiveProject(detail);
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [activeProject?.name, loadProjects]);

  const selectView = useCallback((next: ProjectView) => {
    if (!activeProject) return;
    setCreateAction(null);
    presentProjectView(next);
  }, [activeProject?.name, presentProjectView]);

  const handleTaskSelectionChange = useCallback((taskId?: string) => {
    if (compactWorkspace && taskId) {
      restoreCompactFocusRef.current = true;
      showCompactPane(false);
    }
  }, [compactWorkspace, showCompactPane]);

  const handleFileSelectionChange = useCallback((selected: boolean) => {
    if (compactWorkspace && selected) {
      restoreCompactFocusRef.current = true;
      showCompactPane(false);
    }
  }, [compactWorkspace, showCompactPane]);

  const handleOutputSelectionChange = useCallback((relativePath?: string) => {
    handleFileSelectionChange(Boolean(relativePath));
  }, [handleFileSelectionChange]);

  const activeProjectName = activeProject?.name;
  const activeProjects = useMemo(() => projects.filter(project => project.status === "active")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [projects, locale]);
  const collectionMotion = useCollectionMotion(activeProjects.length, 40);
  // Retain removals before grouping: the final archived row keeps its group
  // mounted through CSS exit. Filtering and favorite moves are not removals.
  const displayedProjects = useExitingList(activeProjects, project => project.id, collectionMotion.tokens.exitMs);
  const leavingProjectIds = new Set(displayedProjects.filter(entry => entry.leaving).map(entry => entry.item.id));
  const filteredProjects = (() => {
    const needle = query.trim().toLocaleLowerCase();
    return displayedProjects.map(entry => entry.item)
      .filter(project => !needle || `${project.name}\n${project.description}`.toLocaleLowerCase().includes(needle));
  })();
  const favoriteProjects = filteredProjects.filter((project) => project.favorite);
  const recentProjects = filteredProjects.filter((project) => !project.favorite);
  const projectMotionGroup = useId();
  const listMotion = { ...collectionMotion, ...projectMotion, leavingProjectIds,
    revision: `${projectMotion.revision}:${filteredProjects.map(project => project.id).join(",")}`,
    enabled: collectionMotion.enabled && displayedProjects.length <= 40 && !layout.isResizing && !query.trim() };
  // Preserve portal hosts, but remove the hidden pane from layout after CSS
  // opacity/transform finish, without interpolating a layout property.
  const compactListPresence = useExitPresence(!compactWorkspace || compactListOpen, collectionMotion.tokens.exitMs);
  const compactDetailPresence = useExitPresence(!compactWorkspace || !compactListOpen, collectionMotion.tokens.exitMs);
  const attachedPanelsReady = Boolean(activeProject && sectionListHost && detailHost);

  return (
    <div className="projects-page">
      {error ? <ErrorState message={error} retry={() => void loadProjects()} /> : null}
      <div
        ref={workspaceRef}
        className={`project-workspace${compactWorkspace ? compactListOpen ? " compact-list-open" : " compact-detail-open" : ""}${layout.isResizing ? " is-resizing-list" : ""}`}
        style={{ "--list-detail-columns": layout.columns } as CSSProperties}
      >
        <aside className={`project-list-pane${listVisible ? "" : " collapsed"}`} data-view={activeProject ? "contents" : "projects"}
          data-compact-visible={compactListPresence.visible || undefined}
          aria-hidden={compactWorkspace && !listVisible || undefined} inert={compactWorkspace && !listVisible || undefined}>
          {activeProject ? (
            <>
              <header className="project-pane-project">
                <IconButton type="button" className="project-pane-back" data-motion="icon" onClick={() => void navigateProject(() => { setActiveProject(null); ui.setPanelMode("collapsed"); })} label={messages.projectUi.backToProjects}><ArrowLeft size={15} /></IconButton>
                <div className="project-pane-title" title={activeProject.name}><strong>{activeProject.name}</strong></div>
                <DropdownMenu
                  className="project-pane-create"
                  ariaLabel={messages.projectUi.newProjectContent}
                  menuLabel={messages.projectUi.newProjectContent}
                  label={<Plus size={16} aria-hidden="true" />}
                >
                  <button type="button" role="menuitem" data-motion="action" onClick={() => requestCreate("tasks")}><ListTodo size={14} aria-hidden="true" /><span>{messages.projectUi.newTask}</span></button>
                  <button type="button" role="menuitem" data-motion="action" onClick={() => requestCreate("materials")}><Library size={14} aria-hidden="true" /><span>{messages.projectUi.addMaterials}</span></button>
                  <button type="button" role="menuitem" data-motion="action" onClick={() => requestCreate("outputs")}><FileOutput size={14} aria-hidden="true" /><span>{messages.projectUi.newOutput}</span></button>
                </DropdownMenu>
              </header>
              <Tabs value={view} className="project-pane-tabs" label={messages.projectUi.projectContentType}
                onChange={next => navigateProject(() => selectView(next))}
                tabs={PROJECT_VIEWS.map(value => {
                  const meta = VIEW_META[value];
                  const Icon = meta.icon;
                  return { value, label: <span>{meta.label}</span>, icon: <Icon aria-hidden="true" />,
                    id: `project-view-tab-${value}`, controls: "project-section-panel", attributes: { "data-project-view": value } };
                })} />
              <div className="project-pane-section" id="project-section-panel" role="tabpanel" aria-labelledby={`project-view-tab-${view}`} ref={setSectionListHost} />
            </>
          ) : (
            <>
              <SearchInput className="project-pane-filter" leadingIcon={null} trailingIcon={<Search aria-hidden />} data-project-search aria-label={messages.projectUi.searchProjects} value={query} placeholder={messages.projectUi.yourProjects} onChange={(event) => setQuery(event.target.value)} />
              {loading ? (
                <div className="project-list-scroll" aria-busy="true" aria-label={messages.projectUi.loadingProjects}>
                  {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} variant="row" lines={3} label={messages.projectUi.loadingProjects} />)}
                </div>
              ) : (
                <LayoutGroup id={projectMotionGroup}>
                <motion.div ref={projectListRef} className="project-list-scroll" aria-live="polite" layoutScroll>
                  {favoriteProjects.length ? (
                    <ProjectListGroup
                      listMotion={listMotion}
                      label={messages.projectUi.favorites}
                      projects={favoriteProjects}
                      activeProjectName={activeProjectName}
                      busyProjectName={projectActionBusy}
                      openingProjectName={openingProjectName}
                      onOpen={(project) => void openProject(project)}
                      onEdit={setEditProject}
                      onToggleFavorite={(project) => void toggleFavorite(project)}
                      onArchive={(project) => void archiveProject(project)}
                    />
                  ) : null}
                  {recentProjects.length ? (
                    <ProjectListGroup
                      listMotion={listMotion}
                      label={messages.projectUi.recentProjects}
                      projects={recentProjects}
                      activeProjectName={activeProjectName}
                      busyProjectName={projectActionBusy}
                      openingProjectName={openingProjectName}
                      indexOffset={favoriteProjects.length}
                      onOpen={(project) => void openProject(project)}
                      onEdit={setEditProject}
                      onToggleFavorite={(project) => void toggleFavorite(project)}
                      onArchive={(project) => void archiveProject(project)}
                    />
                  ) : null}
                  {!filteredProjects.length ? <p className="project-list-empty">{query ? messages.projectUi.noMatchingProjects : messages.projectUi.noProjects}</p> : null}
                </motion.div>
                </LayoutGroup>
              )}
            </>
          )}
        </aside>
        <ColumnSplitter
          side="left"
          collapsed={!listVisible}
          ariaLabel={messages.projectUi.projectListWidth}
          ariaValueMin={LIST_WIDTH_MIN}
          ariaValueMax={LIST_WIDTH_MAX}
          ariaValueNow={layout.layout.listWidth}
          toggle={layout.toggleList}
          resize={layout.resizeList}
          reset={layout.reset}
          onResizeStart={layout.beginListResize}
          onResizeCancel={layout.cancelListResize}
          onResizeActiveChange={layout.onResizeActiveChange}
        />
        <section className={`project-main-pane${compactWorkspace || !listVisible ? " list-collapsed" : ""}`} aria-busy={Boolean(openingProjectName) || undefined}
          data-compact-visible={compactDetailPresence.visible || undefined}
          aria-hidden={compactWorkspace && listVisible || undefined} inert={compactWorkspace && listVisible || undefined}>
          {!listVisible ? (
            <IconButton type="button" className="project-list-reopen" data-motion="icon" onClick={() => compactWorkspace ? showCompactPane(true) : layout.toggleList()} label={messages.projectUi.expandProjectList}><PanelLeftOpen size={17} /></IconButton>
          ) : null}
          {activeProject ? <div className={`project-detail-fill${openingProjectName ? " is-opening-project" : ""}`} ref={setDetailHost} aria-hidden={Boolean(openingProjectName) || undefined} inert={Boolean(openingProjectName) || undefined} /> : openingProjectName ? (
            <div className="project-detail-loading project-opening-state" role="status"><LoaderCircle size={18} className="spin" />{messages.projectUi.openingProject(openingProjectName)}</div>
          ) : (
            <EmptyState
              icon={<FolderKanban size={30} />}
              title={query ? messages.projectUi.noMatchingProjects : messages.projectUi.selectProject}
              description={query ? messages.projectUi.tryAnotherProjectSearch : messages.projectUi.selectProjectHint}
              action={!query ? <button className="primary-button" onClick={openCreateDialog}><Plus size={15} />{messages.projectUi.createProject}</button> : undefined}
            />
          )}
          {activeProject && openingProjectName ? <div className="project-opening-overlay" role="status"><LoaderCircle size={18} className="spin" />{messages.projectUi.openingProject(openingProjectName)}</div> : null}
        </section>
      </div>
      {attachedPanelsReady ? (
        <>
          {view === "tasks" ? <ProjectTasksPanel key={`tasks:${activeProject!.name}`} project={activeProject!} initialTaskId={initialSection === "tasks" ? initialItem : undefined} createRequested={createAction === "tasks"} seed={taskSeed} onCreateHandled={() => { setCreateAction(null); setTaskSeed(null); }} onChanged={() => void refreshActive()} onSelectionChange={handleTaskSelectionChange} listHost={sectionListHost} detailHost={detailHost} /> : null}
          {view === "outputs" ? <ProjectOutputsPanel key={`outputs:${activeProject!.name}`} project={activeProject!} initialOutputPath={initialSection === "outputs" ? initialItem : undefined} createRequested={createAction === "outputs"} onCreateHandled={() => setCreateAction(null)} onChanged={() => void refreshActive()} onSelectionChange={handleOutputSelectionChange} onNavigationGuardChange={handleOutputNavigationGuard} listHost={sectionListHost} detailHost={detailHost} /> : null}
          {view === "files" ? <ProjectFilesPanel key={`files:${activeProject!.name}`} project={activeProject!} initialSection={initialSection} initialItem={initialItem} createRequested={createAction === "materials" || createAction === "outputs" ? createAction : null} onCreateHandled={() => setCreateAction(null)} onCreateTask={(seed) => { void navigateProject(() => { setTaskSeed(seed); setCreateAction("tasks"); presentProjectView("tasks"); }); }} onChanged={() => void refreshActive()} onSelectionChange={handleFileSelectionChange} onNavigationGuardChange={handleOutputNavigationGuard} listHost={sectionListHost!} detailHost={detailHost!} /> : null}
        </>
      ) : null}
      <ProjectDialog open={createProjectOpen} title={messages.projectUi.createProject} description={messages.projectUi.projectNameHint} confirmLabel={messages.projectUi.createProject} busy={busy} onClose={() => setCreateProjectOpen(false)} onConfirm={createProject}>
        <ProjectTextField label={messages.projectUi.projectName} value={name} placeholder={messages.projectUi.projectNamePlaceholder} autoFocus onChange={setName} />
      </ProjectDialog>
      <ProjectEditDialog project={editProject} busy={busy} onClose={() => setEditProject(null)} onSave={saveProjectEdits} />
    </div>
  );
}

function ProjectListGroup({
  listMotion,
  label,
  projects,
  activeProjectName,
  busyProjectName,
  openingProjectName,
  indexOffset = 0,
  onOpen,
  onEdit,
  onToggleFavorite,
  onArchive
}: {
  listMotion: ReturnType<typeof useCollectionMotion> & { revision: string; relocatedId: string; leavingProjectIds: Set<string> };
  label: string;
  projects: ProjectSummary[];
  activeProjectName?: string;
  busyProjectName: string | null;
  openingProjectName: string | null;
  indexOffset?: number;
  onOpen(project: ProjectSummary): void;
  onEdit(project: ProjectSummary): void;
  onToggleFavorite(project: ProjectSummary): void;
  onArchive(project: ProjectSummary): void;
}) {
  useLocale();
  return (
    <motion.section className="project-list-group" aria-label={label} data-collection-motion
      layout={listMotion.enabled ? "position" : false} layoutDependency={listMotion.revision}
      transition={listMotion.tokens.layout}>
      <h2>{label}</h2>
      <div>
        {projects.map((project, index) => {
          const opening = openingProjectName === project.name;
          return (
          <motion.div key={project.id} data-project-motion={project.id} data-collection-motion
            layout={listMotion.enabled ? "position" : false}
            layoutId={listMotion.enabled ? project.id : undefined}
            layoutDependency={listMotion.revision}
            transition={listMotion.tokens.layout}>
          <div
            data-leaving={listMotion.leavingProjectIds.has(project.id) || undefined}
            inert={listMotion.leavingProjectIds.has(project.id) || undefined}
            aria-hidden={listMotion.leavingProjectIds.has(project.id) || undefined}
            data-project-relocated={listMotion.relocatedId === project.id || undefined}
            className={`project-list-row${activeProjectName === project.name ? " active" : ""}${opening ? " pending" : ""}`}
            style={{
              "--project-list-index": indexOffset + index,
              "--project-icon-color": projectColorValue(project.color)
            } as CSSProperties}
          >
            <button
              type="button"
              className="project-list-project"
              data-motion="selection"
              aria-current={activeProjectName === project.name || opening ? "true" : undefined}
              aria-busy={opening || undefined}
              disabled={Boolean(openingProjectName)}
              onClick={() => onOpen(project)}
            >
              {opening ? <LoaderCircle size={16} className="spin project-opening-spinner" aria-hidden="true" /> : <ProjectIcon name={project.icon} />}
              <span><strong>{project.name}</strong></span>
            </button>
            <DropdownMenu
              className="project-list-actions"
              menuClassName="project-project-menu"
              ariaLabel={messages.projectUi.projectActions(project.name)}
              menuLabel={messages.projectUi.projectActionsMenu(project.name)}
              menuInert={listMotion.leavingProjectIds.has(project.id)}
              disabled={Boolean(openingProjectName) || busyProjectName === project.name}
              label={<MoreHorizontal size={17} aria-hidden="true" />}
            >
              <button type="button" role="menuitem" data-motion="action" onClick={() => onEdit(project)}><PencilLine size={18} aria-hidden="true" />{messages.projectUi.edit}</button>
              <button type="button" role="menuitem" data-motion="action" onClick={() => onToggleFavorite(project)}><Star size={18} fill={project.favorite ? "currentColor" : "none"} aria-hidden="true" />{project.favorite ? messages.projectUi.removeFavorite : messages.projectUi.favorites}</button>
              <button type="button" role="menuitem" data-motion="action" onClick={() => onArchive(project)}><Archive size={18} aria-hidden="true" />{messages.projectUi.archive}</button>
            </DropdownMenu>
          </div>
          </motion.div>
          );
        })}
      </div>
    </motion.section>
  );
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

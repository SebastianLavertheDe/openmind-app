import { type CSSProperties, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Archive,
  Files,
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
import { DropdownMenu, EmptyState, ErrorState, Skeleton } from "../../design-system/components";
import { ProjectEditDialog, ProjectIcon, projectColorValue } from "./ProjectAppearance";
import { ProjectDialog, ProjectTextField } from "./ProjectDialog";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import type { ProjectOutputNavigationGuard } from "./ProjectOutputsPanel";
import { ProjectTasksPanel, type ProjectTaskSeed } from "./ProjectTasksPanel";
import { projectsApi } from "./projects-api";
import type { ProjectCreateAction, ProjectDetail, ProjectSection, ProjectSummary } from "./types";

type ProjectView = "tasks" | "files";
const VIEW_META: Record<ProjectView, { label: string; icon: typeof ListTodo }> = {
  tasks: { label: "任务", icon: ListTodo },
  files: { label: "文件", icon: Files }
};
const PROJECT_VIEWS = Object.keys(VIEW_META) as ProjectView[];

export function ProjectsPage({
  initialProjectName,
  initialSection = "tasks",
  initialItem
}: {
  initialProjectName?: string;
  initialSection?: ProjectSection;
  initialItem?: string;
}) {
  const ui = useAiUi();
  const responsiveLayout = useResponsiveLayout();
  const compactWorkspace = responsiveLayout.workspace === "single";
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectDetail | null>(null);
  const [view, setView] = useState<ProjectView>(initialSection === "tasks" ? "tasks" : "files");
  const [createAction, setCreateAction] = useState<ProjectCreateAction | null>(null);
  const [taskSeed, setTaskSeed] = useState<ProjectTaskSeed | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [editProject, setEditProject] = useState<ProjectSummary | null>(null);
  const [projectActionBusy, setProjectActionBusy] = useState<string | null>(null);
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
  const confirmRef = useRef(ui.confirm);
  confirmRef.current = ui.confirm;
  const listVisible = compactWorkspace ? compactListOpen : !layout.layout.listCollapsed;
  const hasActiveProject = Boolean(activeProject);

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
      title: "文档保存失败",
      body: "修改仍未保存。要放弃这些修改并继续吗？",
      confirmText: "放弃修改",
      danger: true
    });
    if (discard) guard.discard();
    return discard;
  }, []);

  const navigateProject = useCallback(async (action: () => void) => {
    if (!await canLeaveCurrentOutput()) return;
    action();
  }, [canLeaveCurrentOutput]);

  const presentProjectView = useCallback((next: ProjectView) => {
    setView(next);
    if (next === "files") {
      if (ui.panelMode === "collapsed") ui.setPanelMode("default");
    } else if (ui.panelMode !== "collapsed") {
      ui.setPanelMode("collapsed");
    }
  }, [ui.panelMode, ui.setPanelMode]);

  const requestCreate = useCallback((action: ProjectCreateAction) => {
    void navigateProject(() => {
      presentProjectView(action === "tasks" ? "tasks" : "files");
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
        presentProjectView(initialSection === "tasks" ? "tasks" : "files");
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
      if (compactWorkspace) setCompactListOpen(false);
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
      ui.notify(`项目“${next.name}”已创建。`, "success");
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
      ui.notify(`项目“${next.name}”已更新。`, "success");
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
      replaceProject(project.name, next);
      ui.notify(next.favorite ? `已收藏“${next.name}”。` : `已取消收藏“${next.name}”。`, "success");
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
      replaceProject(project.name, next);
      ui.notify(`项目“${project.name}”已归档。`, "success");
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

  const handleViewKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, current: ProjectView) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = PROJECT_VIEWS.indexOf(current);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? PROJECT_VIEWS.length - 1
        : event.key === "ArrowRight"
          ? (currentIndex + 1) % PROJECT_VIEWS.length
          : (currentIndex - 1 + PROJECT_VIEWS.length) % PROJECT_VIEWS.length;
    const next = PROJECT_VIEWS[nextIndex];
    void navigateProject(() => {
      selectView(next);
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>(`[data-project-view="${next}"]`)?.focus();
      });
    });
  }, [navigateProject, selectView]);

  const handleTaskSelectionChange = useCallback((taskId?: string) => {
    if (compactWorkspace && taskId) {
      restoreCompactFocusRef.current = true;
      setCompactListOpen(false);
    }
  }, [compactWorkspace]);

  const handleFileSelectionChange = useCallback((selected: boolean) => {
    if (compactWorkspace && selected) {
      restoreCompactFocusRef.current = true;
      setCompactListOpen(false);
    }
  }, [compactWorkspace]);

  const activeProjectName = activeProject?.name;
  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return projects
      .filter((project) => project.status === "active")
      .filter((project) => !needle || `${project.name}\n${project.description}`.toLocaleLowerCase().includes(needle))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [projects, query]);
  const favoriteProjects = useMemo(() => filteredProjects.filter((project) => project.favorite), [filteredProjects]);
  const recentProjects = useMemo(() => filteredProjects.filter((project) => !project.favorite), [filteredProjects]);
  const attachedPanelsReady = Boolean(activeProject && sectionListHost && detailHost);

  return (
    <div className="projects-page">
      {error ? <ErrorState message={error} retry={() => void loadProjects()} /> : null}
      <div
        className={`project-workspace${compactWorkspace ? compactListOpen ? " compact-list-open" : " compact-detail-open" : ""}${layout.isResizing ? " is-resizing-list" : ""}`}
        style={{ "--list-detail-columns": layout.columns } as CSSProperties}
      >
        <aside className={`project-list-pane${listVisible ? "" : " collapsed"}`} data-view={activeProject ? "contents" : "projects"}>
          {activeProject ? (
            <>
              <header className="project-pane-project">
                <button type="button" className="project-pane-back" aria-label="返回项目列表" data-motion="icon" onClick={() => void navigateProject(() => { setActiveProject(null); ui.setPanelMode("collapsed"); })}><ArrowLeft size={15} /></button>
                <div className="project-pane-title" title={activeProject.name}><strong>{activeProject.name}</strong></div>
                <DropdownMenu
                  className="project-pane-create"
                  ariaLabel="新建项目内容"
                  menuLabel="新建项目内容"
                  label={<Plus size={16} aria-hidden="true" />}
                >
                  <button type="button" role="menuitem" data-motion="action" onClick={() => requestCreate("tasks")}><ListTodo size={14} aria-hidden="true" /><span>新建任务</span></button>
                  <button type="button" role="menuitem" data-motion="action" onClick={() => requestCreate("materials")}><Library size={14} aria-hidden="true" /><span>添加资料</span></button>
                </DropdownMenu>
              </header>
              <div className="project-pane-tabs" role="tablist" aria-label="项目内容类型">
                {PROJECT_VIEWS.map((value) => {
                  const meta = VIEW_META[value];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      id={`project-view-tab-${value}`}
                      className={view === value ? "active" : ""}
                      aria-selected={view === value}
                      aria-controls="project-section-panel"
                      tabIndex={view === value ? 0 : -1}
                      data-project-view={value}
                      data-motion="selection"
                      onClick={() => void navigateProject(() => selectView(value))}
                      onKeyDown={(event) => handleViewKeyDown(event, value)}
                    >
                      <Icon aria-hidden="true" />
                      <span>{meta.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="project-pane-section" id="project-section-panel" role="tabpanel" aria-labelledby={`project-view-tab-${view}`} ref={setSectionListHost} />
            </>
          ) : (
            <>
              <label className="project-pane-filter">
                <input aria-label="搜索项目" value={query} placeholder="你的项目" onChange={(event) => setQuery(event.target.value)} />
                <Search aria-hidden="true" />
              </label>
              {loading ? (
                <div className="project-list-scroll" aria-busy="true" aria-label="正在加载项目">
                  {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} variant="row" lines={3} label="正在加载项目" />)}
                </div>
              ) : (
                <div className="project-list-scroll" aria-live="polite">
                  {favoriteProjects.length ? (
                    <ProjectListGroup
                      label="收藏"
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
                      label="近期项目"
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
                  {!filteredProjects.length ? <p className="project-list-empty">{query ? "没有匹配的项目" : "还没有项目"}</p> : null}
                </div>
              )}
            </>
          )}
        </aside>
        <ColumnSplitter
          side="left"
          collapsed={!listVisible}
          ariaLabel="项目列表宽度"
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
        <section className={`project-main-pane${listVisible ? "" : " list-collapsed"}`} aria-busy={Boolean(openingProjectName) || undefined}>
          {!listVisible ? (
            <button
              type="button"
              className="project-list-reopen"
              aria-label="展开项目列表"
              title="展开项目列表"
              data-motion="icon"
              onClick={() => compactWorkspace ? setCompactListOpen(true) : layout.toggleList()}
            ><PanelLeftOpen size={17} /></button>
          ) : null}
          {activeProject ? <div className={`project-detail-fill${openingProjectName ? " is-opening-project" : ""}`} ref={setDetailHost} aria-hidden={Boolean(openingProjectName) || undefined} inert={Boolean(openingProjectName) || undefined} /> : openingProjectName ? (
            <div className="project-detail-loading project-opening-state" role="status"><LoaderCircle size={18} className="spin" />正在打开“{openingProjectName}”…</div>
          ) : (
            <EmptyState
              icon={<FolderKanban size={30} />}
              title={query ? "没有匹配的项目" : "选择一个项目"}
              description={query ? "换一个名称或描述试试。" : "从左侧选择项目，或在同一个空间中组织文件与任务。"}
              action={!query ? <button className="primary-button" onClick={openCreateDialog}><Plus size={15} />创建项目</button> : undefined}
            />
          )}
          {activeProject && openingProjectName ? <div className="project-opening-overlay" role="status"><LoaderCircle size={18} className="spin" />正在打开“{openingProjectName}”…</div> : null}
        </section>
      </div>
      {attachedPanelsReady ? (
        <>
          {view === "tasks" ? <ProjectTasksPanel key={`tasks:${activeProject!.name}`} project={activeProject!} initialTaskId={initialSection === "tasks" ? initialItem : undefined} createRequested={createAction === "tasks"} seed={taskSeed} onCreateHandled={() => { setCreateAction(null); setTaskSeed(null); }} onChanged={() => void refreshActive()} onSelectionChange={handleTaskSelectionChange} listHost={sectionListHost} detailHost={detailHost} /> : null}
          {view === "files" ? <ProjectFilesPanel key={`files:${activeProject!.name}`} project={activeProject!} initialSection={initialSection} initialItem={initialItem} createRequested={createAction === "materials" || createAction === "outputs" ? createAction : null} onCreateHandled={() => setCreateAction(null)} onCreateTask={(seed) => { void navigateProject(() => { setTaskSeed(seed); setCreateAction("tasks"); presentProjectView("tasks"); }); }} onChanged={() => void refreshActive()} onSelectionChange={handleFileSelectionChange} onNavigationGuardChange={handleOutputNavigationGuard} listHost={sectionListHost!} detailHost={detailHost!} /> : null}
        </>
      ) : null}
      <ProjectDialog open={createProjectOpen} title="创建项目" description="项目名会作为本地目录名，请使用清晰且稳定的名称。" confirmLabel="创建项目" busy={busy} onClose={() => setCreateProjectOpen(false)} onConfirm={createProject}>
        <ProjectTextField label="项目名称" value={name} placeholder="例如：AI 安全研究" autoFocus onChange={setName} />
      </ProjectDialog>
      <ProjectEditDialog project={editProject} busy={busy} onClose={() => setEditProject(null)} onSave={saveProjectEdits} />
    </div>
  );
}

function ProjectListGroup({
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
  return (
    <section className="project-list-group" aria-label={label}>
      <h2>{label}</h2>
      <div>
        {projects.map((project, index) => {
          const opening = openingProjectName === project.name;
          return (
          <div
            key={project.name}
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
              ariaLabel={`项目操作：${project.name}`}
              menuLabel={`${project.name}的项目操作`}
              disabled={Boolean(openingProjectName) || busyProjectName === project.name}
              label={<MoreHorizontal size={17} aria-hidden="true" />}
            >
              <button type="button" role="menuitem" data-motion="action" onClick={() => onEdit(project)}><PencilLine size={18} aria-hidden="true" />编辑</button>
              <button type="button" role="menuitem" data-motion="action" onClick={() => onToggleFavorite(project)}><Star size={18} fill={project.favorite ? "currentColor" : "none"} aria-hidden="true" />{project.favorite ? "取消收藏" : "收藏"}</button>
              <button type="button" role="menuitem" data-motion="action" onClick={() => onArchive(project)}><Archive size={18} aria-hidden="true" />归档</button>
            </DropdownMenu>
          </div>
          );
        })}
      </div>
    </section>
  );
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

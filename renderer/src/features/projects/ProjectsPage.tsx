import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Files,
  FolderKanban,
  Library,
  ListTodo,
  PanelLeftOpen,
  Plus,
  Search
} from "lucide-react";
import { useAi } from "../../ai-context";
import { useResponsiveLayout } from "../../app/responsive-layout";
import { ColumnSplitter } from "../../components/ColumnSplitter";
import { LIST_WIDTH_MAX, LIST_WIDTH_MIN, useListDetailLayout } from "../../components/useListDetailLayout";
import { EmptyState, ErrorState, Skeleton } from "../../design-system/components";
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
  const ai = useAi();
  const responsiveLayout = useResponsiveLayout();
  const compactWorkspace = responsiveLayout.workspace === "single";
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectDetail | null>(null);
  const [view, setView] = useState<ProjectView>(initialSection === "tasks" ? "tasks" : "files");
  const [createAction, setCreateAction] = useState<ProjectCreateAction | null>(null);
  const [taskSeed, setTaskSeed] = useState<ProjectTaskSeed | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
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
  const confirmRef = useRef(ai.confirm);
  confirmRef.current = ai.confirm;
  const listVisible = compactWorkspace ? compactListOpen : !layout.layout.listCollapsed;
  const hasActiveProject = Boolean(activeProject);

  useEffect(() => {
    if (!compactWorkspace) return;
    setCompactListOpen(!hasActiveProject);
  }, [compactWorkspace, hasActiveProject]);

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

  const requestCreate = useCallback((action: ProjectCreateAction) => {
    void navigateProject(() => {
      setView(action === "tasks" ? "tasks" : "files");
      setCreateAction(action);
    });
  }, [navigateProject]);

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
      try {
        setActiveProject(await projectsApi.getProject(initialProjectName));
      } catch (cause) {
        setError(errorText(cause));
      }
    })();
  }, [activeProject?.name, canLeaveCurrentOutput, initialProjectName]);

  const openCreateDialog = () => {
    setName("");
    setCreateProjectOpen(true);
  };

  const openProject = async (project: ProjectSummary) => {
    if (!await canLeaveCurrentOutput()) return;
    setError(null);
    try {
      setActiveProject(await projectsApi.getProject(project.name));
      setView("tasks");
    } catch (cause) {
      setError(errorText(cause));
    }
    if (compactWorkspace) setCompactListOpen(false);
  };

  const createProject = async () => {
    const projectName = name.trim();
    if (!projectName || busy) return;
    setBusy(true);
    try {
      const next = await projectsApi.createProject(projectName, "");
      setProjects((current) => [next, ...current.filter((item) => item.name !== next.name)]);
      setActiveProject(next);
      setView("tasks");
      setCreateProjectOpen(false);
      setName("");
      ai.notify(`项目“${next.name}”已创建。`, "success");
    } catch (cause) {
      ai.notify(errorText(cause), "error");
    } finally {
      setBusy(false);
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
    setView(next);
  }, [activeProject?.name]);

  const activeProjectName = activeProject?.name;
  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return projects
      .filter((project) => !needle || `${project.name}\n${project.description}`.toLocaleLowerCase().includes(needle))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [projects, query]);
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
                <button type="button" className="project-pane-back" aria-label="返回项目列表" onClick={() => void navigateProject(() => { setActiveProject(null); })}><ArrowLeft size={15} /></button>
                <div className="project-pane-title" title={activeProject.name}><strong>{activeProject.name}</strong></div>
                <details className="project-create-menu">
                  <summary className="icon-button" aria-label="新建项目内容" title="新建"><Plus size={16} /></summary>
                  <div role="menu">
                    <button role="menuitem" onClick={(event) => { closeOwningMenu(event.currentTarget); requestCreate("tasks"); }}><ListTodo size={14} /><span>新建任务</span></button>
                    <button role="menuitem" onClick={(event) => { closeOwningMenu(event.currentTarget); requestCreate("materials"); }}><Library size={14} /><span>添加资料</span></button>
                  </div>
                </details>
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
                      className={view === value ? "active" : ""}
                      aria-selected={view === value}
                      onClick={() => void navigateProject(() => selectView(value))}
                    >
                      <Icon aria-hidden="true" />
                      <span>{meta.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="project-pane-section" ref={setSectionListHost} />
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
                  {filteredProjects.map((project, index) => (
                    <button
                      key={project.name}
                      type="button"
                      className={activeProjectName === project.name ? "active" : ""}
                      aria-current={activeProjectName === project.name ? "true" : undefined}
                      style={{ "--project-list-index": index } as CSSProperties}
                      onClick={() => void openProject(project)}
                    >
                      <FolderKanban aria-hidden="true" />
                      <span><strong>{project.name}</strong></span>
                    </button>
                  ))}
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
        <main className={`project-main-pane${listVisible ? "" : " list-collapsed"}`}>
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
          {activeProject ? <div className="project-detail-fill" ref={setDetailHost} /> : (
            <EmptyState
              icon={<FolderKanban size={30} />}
              title={query ? "没有匹配的项目" : "选择一个项目"}
              description={query ? "换一个名称或描述试试。" : "从左侧选择项目，或在同一个空间中组织文件与任务。"}
              action={!query ? <button className="primary-button" onClick={openCreateDialog}><Plus size={15} />创建项目</button> : undefined}
            />
          )}
        </main>
      </div>
      {attachedPanelsReady ? (
        <>
          {view === "tasks" ? <ProjectTasksPanel key={`tasks:${activeProject!.name}`} project={activeProject!} initialTaskId={initialSection === "tasks" ? initialItem : undefined} createRequested={createAction === "tasks"} seed={taskSeed} onCreateHandled={() => { setCreateAction(null); setTaskSeed(null); }} onChanged={() => void refreshActive()} listHost={sectionListHost} detailHost={detailHost} /> : null}
          {view === "files" ? <ProjectFilesPanel key={`files:${activeProject!.name}`} project={activeProject!} initialSection={initialSection} initialItem={initialItem} createRequested={createAction === "materials" || createAction === "outputs" ? createAction : null} onCreateHandled={() => setCreateAction(null)} onCreateTask={(seed) => { void navigateProject(() => { setTaskSeed(seed); setCreateAction("tasks"); setView("tasks"); }); }} onChanged={() => void refreshActive()} onNavigationGuardChange={handleOutputNavigationGuard} listHost={sectionListHost!} detailHost={detailHost!} /> : null}
        </>
      ) : null}
      <ProjectDialog open={createProjectOpen} title="创建项目" description="项目名会作为本地目录名，请使用清晰且稳定的名称。" confirmLabel="创建项目" busy={busy} onClose={() => setCreateProjectOpen(false)} onConfirm={createProject}>
        <ProjectTextField label="项目名称" value={name} placeholder="例如：AI 安全研究" autoFocus onChange={setName} />
      </ProjectDialog>
    </div>
  );
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function closeOwningMenu(target: HTMLElement): void {
  target.closest("details")?.removeAttribute("open");
}

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  ChevronRight,
  FileOutput,
  FolderKanban,
  Library,
  ListTodo,
  MoreHorizontal,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search
} from "lucide-react";
import { useAi } from "../../ai-context";
import { useResponsiveLayout } from "../../app/responsive-layout";
import { ColumnSplitter } from "../../components/ColumnSplitter";
import { LIST_WIDTH_MAX, LIST_WIDTH_MIN, useListDetailLayout } from "../../components/useListDetailLayout";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "../../design-system/components";
import { ProjectDialog, ProjectTextField } from "./ProjectDialog";
import { ProjectMaterialsPanel } from "./ProjectMaterialsPanel";
import { ProjectOutputsPanel, type ProjectOutputNavigationGuard } from "./ProjectOutputsPanel";
import { ProjectTasksPanel, type ProjectTaskSeed } from "./ProjectTasksPanel";
import { projectsApi } from "./projects-api";
import type { ProjectCreateAction, ProjectDetail, ProjectSection, ProjectSummary } from "./types";

const SECTION_META: Record<ProjectSection, { label: string; icon: typeof ListTodo; count: keyof Pick<ProjectDetail, "taskCount" | "materialCount" | "outputCount"> }> = {
  tasks: { label: "任务", icon: ListTodo, count: "taskCount" },
  materials: { label: "资料", icon: Library, count: "materialCount" },
  outputs: { label: "成品", icon: FileOutput, count: "outputCount" }
};
const PROJECT_SECTIONS = Object.keys(SECTION_META) as ProjectSection[];

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
  const [section, setSection] = useState<ProjectSection>(initialSection);
  const [createAction, setCreateAction] = useState<ProjectCreateAction | null>(null);
  const [taskSeed, setTaskSeed] = useState<ProjectTaskSeed | null>(null);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
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
      title: "成品保存失败",
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
    setDescription("");
    setCreateProjectOpen(true);
  };

  const openProject = async (project: ProjectSummary) => {
    if (!await canLeaveCurrentOutput()) return;
    setError(null);
    try {
      setActiveProject(await projectsApi.getProject(project.name));
      setSection("tasks");
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
      const next = await projectsApi.createProject(projectName, description.trim());
      setProjects((current) => [next, ...current.filter((item) => item.name !== next.name)]);
      setActiveProject(next);
      setSection("tasks");
      setCreateProjectOpen(false);
      setName("");
      setDescription("");
      ai.notify(`项目“${next.name}”已创建。`, "success");
    } catch (cause) {
      ai.notify(errorText(cause), "error");
    } finally {
      setBusy(false);
    }
  };

  const renameProject = async () => {
    if (!activeProject || !name.trim() || busy) return;
    if (!await canLeaveCurrentOutput()) return;
    setBusy(true);
    try {
      const next = await projectsApi.renameProject(activeProject.name, name.trim());
      setProjects((current) => current.map((item) => item.name === activeProject.name ? next : item));
      setActiveProject(next);
      setRenameOpen(false);
      ai.notify(`项目已重命名为“${next.name}”。`, "success");
    } catch (cause) {
      ai.notify(errorText(cause), "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async () => {
    if (!activeProject) return;
    if (!await canLeaveCurrentOutput()) return;
    const archive = activeProject.status !== "archived";
    const confirmed = await ai.confirm({
      title: archive ? "归档项目" : "恢复项目",
      body: archive ? `归档“${activeProject.name}”后，项目内容仍会保留。` : `将“${activeProject.name}”恢复到进行中。`,
      confirmText: archive ? "归档" : "恢复",
      danger: archive
    });
    if (!confirmed) return;
    try {
      const next = await projectsApi.archiveProject(activeProject.name, archive);
      setProjects((current) => current.map((item) => item.name === next.name ? next : item));
      setActiveProject(archive ? null : next);
      ai.notify(archive ? "项目已归档。" : "项目已恢复。", "success");
    } catch (cause) {
      ai.notify(errorText(cause), "error");
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

  const selectSection = useCallback((next: ProjectSection) => {
    if (!activeProject) return;
    setSection(next);
  }, [activeProject?.name]);

  const activeProjectName = activeProject?.name;
  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return projects
      .filter((project) => project.status === "active")
      .filter((project) => !needle || `${project.name}\n${project.description}`.toLocaleLowerCase().includes(needle))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [projects, query]);
  const archivedProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return projects
      .filter((project) => project.status === "archived")
      .filter((project) => !needle || `${project.name}\n${project.description}`.toLocaleLowerCase().includes(needle))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [projects, query]);
  const attachedPanelsReady = Boolean(activeProject && sectionListHost && detailHost);

  return (
    <div className="projects-page">
      <header className="projects-page-header">
        <PageHeader
          eyebrow="资料驱动创作"
          title="项目"
          description="在同一个空间中组织资料、完成 AI 任务并沉淀 Markdown 成品。"
          actions={<button className="primary-button" data-motion="action" onClick={openCreateDialog}><Plus size={15} />创建项目</button>}
        />
      </header>
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
                <button type="button" className="icon-button" data-motion="icon" aria-label={`新建${SECTION_META[section].label}`} title={`新建${SECTION_META[section].label}`} onClick={() => void navigateProject(() => setCreateAction(section))}><Plus size={16} /></button>
                <details className="project-more-menu">
                  <summary className="icon-button" aria-label="项目操作"><MoreHorizontal size={17} /></summary>
                  <div role="menu">
                    <button role="menuitem" onClick={() => void navigateProject(() => { setName(activeProject.name); setRenameOpen(true); })}><Pencil size={14} />重命名</button>
                    <button role="menuitem" className={activeProject.status === "archived" ? "" : "danger"} onClick={() => void toggleArchive()}><Archive size={14} />{activeProject.status === "archived" ? "恢复项目" : "归档项目"}</button>
                  </div>
                </details>
              </header>
              <div className="project-pane-tabs" role="tablist" aria-label="项目内容类型">
                {PROJECT_SECTIONS.map((value) => {
                  const meta = SECTION_META[value];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      className={section === value ? "active" : ""}
                      aria-selected={section === value}
                      onClick={() => void navigateProject(() => selectSection(value))}
                    >
                      <Icon aria-hidden="true" />
                      <span>{meta.label}</span>
                      <b>{activeProject[meta.count]}</b>
                    </button>
                  );
                })}
              </div>
              <div className="project-pane-section" ref={setSectionListHost} />
            </>
          ) : (
            <>
              <label className="project-list-search">
                <Search aria-hidden="true" />
                <input aria-label="搜索项目" value={query} placeholder="搜索项目" onChange={(event) => setQuery(event.target.value)} />
              </label>
              {loading ? (
                <div className="project-list-scroll" aria-busy="true" aria-label="正在加载项目">
                  {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} variant="row" lines={3} label="正在加载项目" />)}
                </div>
              ) : (
                <div className="project-list-scroll" aria-live="polite">
                  <div className="project-list-section"><span>进行中</span><b>{visibleProjects.length}</b></div>
                  {visibleProjects.map((project, index) => (
                    <button
                      key={project.name}
                      type="button"
                      className={activeProjectName === project.name ? "active" : ""}
                      aria-current={activeProjectName === project.name ? "true" : undefined}
                      style={{ "--project-list-index": index } as CSSProperties}
                      onClick={() => void openProject(project)}
                    >
                      <FolderKanban aria-hidden="true" />
                      <span><strong>{project.name}</strong><small>{project.description || "暂无描述"}</small></span>
                      <ChevronRight aria-hidden="true" />
                    </button>
                  ))}
                  {!visibleProjects.length ? <p className="project-list-empty">{query ? "没有匹配的项目" : "还没有进行中的项目"}</p> : null}
                  {archivedProjects.length ? (
                    <>
                      <div className="project-list-section archived"><span>已归档</span><b>{archivedProjects.length}</b></div>
                      {archivedProjects.map((project, index) => (
                        <button
                          key={project.name}
                          type="button"
                          className={activeProjectName === project.name ? "active" : ""}
                          style={{ "--project-list-index": index } as CSSProperties}
                          onClick={() => void openProject(project)}
                        >
                          <Archive aria-hidden="true" />
                          <span><strong>{project.name}</strong><small>{project.description || "暂无描述"}</small></span>
                          <ChevronRight aria-hidden="true" />
                        </button>
                      ))}
                    </>
                  ) : null}
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
              description={query ? "换一个名称或描述试试。" : "从左侧选择项目，或在同一个空间中组织资料、任务与成品。"}
              action={!query ? <button className="primary-button" onClick={openCreateDialog}><Plus size={15} />创建项目</button> : undefined}
            />
          )}
        </main>
      </div>
      {attachedPanelsReady ? (
        <>
          {section === "tasks" ? <ProjectTasksPanel key={`tasks:${activeProject!.name}`} project={activeProject!} initialTaskId={initialSection === "tasks" ? initialItem : undefined} createRequested={createAction === "tasks"} seed={taskSeed} onCreateHandled={() => { setCreateAction(null); setTaskSeed(null); }} onChanged={() => void refreshActive()} listHost={sectionListHost} detailHost={detailHost} /> : null}
          {section === "materials" ? <ProjectMaterialsPanel key={`materials:${activeProject!.name}`} project={activeProject!} initialMaterialPath={initialSection === "materials" ? initialItem : undefined} createRequested={createAction === "materials"} onCreateHandled={() => setCreateAction(null)} onCreateTask={(seed) => { void navigateProject(() => { setTaskSeed(seed); setCreateAction("tasks"); selectSection("tasks"); }); }} onChanged={() => void refreshActive()} listHost={sectionListHost} detailHost={detailHost} /> : null}
          {section === "outputs" ? <ProjectOutputsPanel key={`outputs:${activeProject!.name}`} project={activeProject!} initialOutputPath={initialSection === "outputs" ? initialItem : undefined} createRequested={createAction === "outputs"} onCreateHandled={() => setCreateAction(null)} onChanged={() => void refreshActive()} onNavigationGuardChange={handleOutputNavigationGuard} listHost={sectionListHost} detailHost={detailHost} /> : null}
        </>
      ) : null}
      <ProjectDialog open={createProjectOpen} title="创建项目" description="项目名会作为本地目录名，请使用清晰且稳定的名称。" confirmLabel="创建项目" busy={busy} onClose={() => setCreateProjectOpen(false)} onConfirm={createProject}>
        <ProjectTextField label="项目名称" value={name} placeholder="例如：AI 安全研究" autoFocus onChange={setName} />
        <ProjectTextField label="描述（可选）" value={description} placeholder="这个项目要研究和创作什么？" multiline onChange={setDescription} />
      </ProjectDialog>
      <ProjectDialog open={renameOpen} title="重命名项目" description="项目目录也会同步重命名；运行中的任务需要先结束。" confirmLabel="保存名称" busy={busy} onClose={() => setRenameOpen(false)} onConfirm={renameProject}>
        <ProjectTextField label="新名称" value={name} autoFocus onChange={setName} />
      </ProjectDialog>
    </div>
  );
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

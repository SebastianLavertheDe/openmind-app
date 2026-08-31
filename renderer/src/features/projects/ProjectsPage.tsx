import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ChevronDown, FileOutput, FilePlus2, MoreHorizontal, Pencil, Plus, Sparkles } from "lucide-react";
import { useAi } from "../../ai-context";
import { ProjectDialog, ProjectTextField } from "./ProjectDialog";
import { ProjectHub } from "./ProjectHub";
import { ProjectMaterialsPanel } from "./ProjectMaterialsPanel";
import { ProjectOutputsPanel, type ProjectOutputNavigationGuard } from "./ProjectOutputsPanel";
import { ProjectTasksPanel, type ProjectTaskSeed } from "./ProjectTasksPanel";
import { projectsApi } from "./projects-api";
import type { ProjectCreateAction, ProjectDetail, ProjectSection, ProjectSummary } from "./types";

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
  const outputNavigationGuardRef = useRef<ProjectOutputNavigationGuard | null>(null);
  const confirmRef = useRef(ai.confirm);
  confirmRef.current = ai.confirm;

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

  const openProject = async (project: ProjectSummary) => {
    setError(null);
    try {
      setActiveProject(await projectsApi.getProject(project.name));
      setSection("tasks");
    } catch (cause) {
      setError(errorText(cause));
    }
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
      setActiveProject(null);
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

  if (!activeProject) {
    return (
      <>
        <ProjectHub projects={projects} loading={loading} error={error} onRetry={() => void loadProjects()} onCreate={() => { setName(""); setDescription(""); setCreateProjectOpen(true); }} onOpen={(project) => void openProject(project)} />
        <ProjectDialog open={createProjectOpen} title="创建项目" description="项目名会作为本地目录名，请使用清晰且稳定的名称。" confirmLabel="创建项目" busy={busy} onClose={() => setCreateProjectOpen(false)} onConfirm={createProject}>
          <ProjectTextField label="项目名称" value={name} placeholder="例如：AI 安全研究" autoFocus onChange={setName} />
          <ProjectTextField label="描述（可选）" value={description} placeholder="这个项目要研究和创作什么？" multiline onChange={setDescription} />
        </ProjectDialog>
      </>
    );
  }

  return (
    <main className="project-workspace" data-section={section}>
      <header className="project-workspace-header">
        <div className="project-heading">
          <button className="project-back" onClick={() => void navigateProject(() => setActiveProject(null))}>← 所有项目</button>
          <div><h1>{activeProject.name}</h1>{activeProject.description ? <p>{activeProject.description}</p> : <p>资料、任务与成品都保存在当前项目中。</p>}</div>
        </div>
        <div className="project-header-actions">
          <details className="project-create-menu">
            <summary className="primary-button"><Plus size={15} />创建<ChevronDown size={14} /></summary>
            <div role="menu">
              <button role="menuitem" onClick={() => void navigateProject(() => { setSection("tasks"); setCreateAction("task"); })}><Sparkles size={15} /><span>新建任务<small>基于项目资料与 AI 创作</small></span></button>
              <button role="menuitem" onClick={() => void navigateProject(() => { setSection("materials"); setCreateAction("material"); })}><FilePlus2 size={15} /><span>添加资料<small>文件、网页或视频链接</small></span></button>
              <button role="menuitem" onClick={() => void navigateProject(() => { setSection("outputs"); setCreateAction("output"); })}><FileOutput size={15} /><span>新建成品<small>创建 Markdown 文档</small></span></button>
            </div>
          </details>
          <details className="project-more-menu">
            <summary className="icon-button" aria-label="项目操作"><MoreHorizontal size={17} /></summary>
            <div role="menu">
              <button role="menuitem" onClick={() => void navigateProject(() => { setName(activeProject.name); setRenameOpen(true); })}><Pencil size={14} />重命名</button>
              <button role="menuitem" className={activeProject.status === "archived" ? "" : "danger"} onClick={() => void toggleArchive()}><Archive size={14} />{activeProject.status === "archived" ? "恢复项目" : "归档项目"}</button>
            </div>
          </details>
        </div>
      </header>
      <nav className="project-section-tabs" aria-label="项目内容">
        <button className={section === "tasks" ? "active" : ""} aria-current={section === "tasks" ? "page" : undefined} onClick={() => void navigateProject(() => setSection("tasks"))}>任务 <span>{activeProject.taskCount}</span></button>
        <button className={section === "materials" ? "active" : ""} aria-current={section === "materials" ? "page" : undefined} onClick={() => void navigateProject(() => setSection("materials"))}>资料 <span>{activeProject.materialCount}</span></button>
        <button className={section === "outputs" ? "active" : ""} aria-current={section === "outputs" ? "page" : undefined} onClick={() => void navigateProject(() => setSection("outputs"))}>成品 <span>{activeProject.outputCount}</span></button>
      </nav>
      <section className="project-section-content">
        {section === "tasks" ? <ProjectTasksPanel key={`tasks:${activeProject.name}`} project={activeProject} initialTaskId={initialSection === "tasks" ? initialItem : undefined} createRequested={createAction === "task"} seed={taskSeed} onCreateHandled={() => { setCreateAction(null); setTaskSeed(null); }} onChanged={() => void refreshActive()} /> : null}
        {section === "materials" ? <ProjectMaterialsPanel key={`materials:${activeProject.name}`} project={activeProject} initialMaterialPath={initialSection === "materials" ? initialItem : undefined} createRequested={createAction === "material"} onCreateHandled={() => setCreateAction(null)} onCreateTask={(seed) => { void navigateProject(() => { setTaskSeed(seed); setCreateAction("task"); setSection("tasks"); }); }} onChanged={() => void refreshActive()} /> : null}
        {section === "outputs" ? <ProjectOutputsPanel key={`outputs:${activeProject.name}`} project={activeProject} initialOutputPath={initialSection === "outputs" ? initialItem : undefined} createRequested={createAction === "output"} onCreateHandled={() => setCreateAction(null)} onChanged={() => void refreshActive()} onNavigationGuardChange={handleOutputNavigationGuard} /> : null}
      </section>
      <ProjectDialog open={renameOpen} title="重命名项目" description="项目目录也会同步重命名；运行中的任务需要先结束。" confirmLabel="保存名称" busy={busy} onClose={() => setRenameOpen(false)} onConfirm={renameProject}>
        <ProjectTextField label="新名称" value={name} autoFocus onChange={setName} />
      </ProjectDialog>
    </main>
  );
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

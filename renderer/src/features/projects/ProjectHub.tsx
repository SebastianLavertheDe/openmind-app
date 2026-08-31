import { useMemo, useState } from "react";
import { Archive, ArrowDownAZ, FileOutput, FolderKanban, LayoutGrid, List, Plus, Search, Sparkles } from "lucide-react";
import { EmptyState, Skeleton } from "../../design-system/components";
import type { ProjectStatus, ProjectSummary } from "./types";

export function ProjectHub({
  projects,
  loading,
  error,
  onRetry,
  onCreate,
  onOpen
}: {
  projects: ProjectSummary[];
  loading: boolean;
  error: string | null;
  onRetry(): void;
  onCreate(): void;
  onOpen(project: ProjectSummary): void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return projects
      .filter((project) => project.status === status && (!needle || `${project.name} ${project.description}`.toLocaleLowerCase().includes(needle)))
      .sort((left, right) => sort === "name" ? left.name.localeCompare(right.name, "zh-CN") : right.updatedAt.localeCompare(left.updatedAt));
  }, [projects, query, sort, status]);
  const recent = useMemo(() => projects.filter((project) => project.status === "active").sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 6), [projects]);

  return (
    <main className="projects-hub feature-page">
      <header className="projects-hub-header">
        <div><span className="eyebrow">资料驱动创作</span><h1>项目</h1><p>在同一个空间中组织资料、完成 AI 任务并沉淀 Markdown 成品。</p></div>
        <button className="primary-button" onClick={onCreate}><Plus size={15} />创建项目</button>
      </header>

      {recent.length ? (
        <section className="projects-recent" aria-labelledby="projects-recent-title">
          <header><h2 id="projects-recent-title">最近访问</h2></header>
          <div className="projects-recent-strip">
            {recent.map((project) => <ProjectCard key={project.name} project={project} compact onOpen={() => onOpen(project)} />)}
          </div>
        </section>
      ) : null}

      <section className="projects-catalog" aria-labelledby="projects-catalog-title">
        <header className="projects-catalog-toolbar">
          <div className="project-status-tabs" role="tablist" aria-label="项目状态">
            <button role="tab" aria-selected={status === "active"} className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}>进行中 <span>{projects.filter((item) => item.status === "active").length}</span></button>
            <button role="tab" aria-selected={status === "archived"} className={status === "archived" ? "active" : ""} onClick={() => setStatus("archived")}>已归档 <span>{projects.filter((item) => item.status === "archived").length}</span></button>
          </div>
          <div className="projects-toolbar-actions">
            <label className="projects-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" /></label>
            <button className="icon-button" aria-label={sort === "recent" ? "当前按最近更新排序，切换为名称" : "当前按名称排序，切换为最近更新"} onClick={() => setSort((value) => value === "recent" ? "name" : "recent")}><ArrowDownAZ size={15} /></button>
            <div className="project-view-toggle" role="group" aria-label="项目视图">
              <button className={view === "grid" ? "active" : ""} aria-pressed={view === "grid"} aria-label="卡片视图" onClick={() => setView("grid")}><LayoutGrid size={15} /></button>
              <button className={view === "list" ? "active" : ""} aria-pressed={view === "list"} aria-label="列表视图" onClick={() => setView("list")}><List size={15} /></button>
            </div>
          </div>
        </header>
        <h2 id="projects-catalog-title" className="ui-visually-hidden">项目列表</h2>
        {error ? <div className="projects-inline-error"><p>{error}</p><button onClick={onRetry}>重试</button></div> : null}
        {loading ? <div className={`projects-grid ${view}`}>{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} variant="card" lines={3} label="正在加载项目" />)}</div> : null}
        {!loading && !error && !filtered.length ? (
          <EmptyState
            icon={status === "active" ? <FolderKanban size={30} /> : <Archive size={30} />}
            title={query ? "没有匹配的项目" : status === "active" ? "还没有项目" : "没有已归档项目"}
            description={query ? "换一个名称或描述试试。" : status === "active" ? "创建项目，把资料、任务与成品放在一起。" : "归档的项目会显示在这里。"}
            action={!query && status === "active" ? <button className="primary-button" onClick={onCreate}><Plus size={15} />创建项目</button> : undefined}
          />
        ) : null}
        {!loading && !error && filtered.length ? <div className={`projects-grid ${view}`}>{filtered.map((project) => <ProjectCard key={project.name} project={project} onOpen={() => onOpen(project)} />)}</div> : null}
      </section>
    </main>
  );
}

function ProjectCard({ project, compact = false, onOpen }: { project: ProjectSummary; compact?: boolean; onOpen(): void }) {
  return (
    <button className={`project-card${compact ? " compact" : ""}`} onClick={onOpen}>
      <span className="project-card-icon"><FolderKanban size={18} /></span>
      <span className="project-card-copy"><strong>{project.name}</strong>{project.description ? <small>{project.description}</small> : <small>暂无描述</small>}</span>
      <span className="project-card-metrics">
        <span><Sparkles size={13} />{project.taskCount} 任务</span>
        <span><FolderKanban size={13} />{project.materialCount} 资料</span>
        <span><FileOutput size={13} />{project.outputCount} 成品</span>
      </span>
      <time>{formatRelativeTime(project.updatedAt)}</time>
    </button>
  );
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "尚未更新";
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "刚刚更新";
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))} 分钟前`;
  if (delta < 86_400_000) return `${Math.max(1, Math.floor(delta / 3_600_000))} 小时前`;
  if (delta < 604_800_000) return `${Math.max(1, Math.floor(delta / 86_400_000))} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric" }).format(new Date(timestamp));
}

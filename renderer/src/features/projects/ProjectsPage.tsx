import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Copy, ExternalLink, FilePenLine, FileText, FolderOpen, LayoutGrid, List, Plus, RotateCcw, Search, Sparkles, Trash2 } from "lucide-react";
import type { CreativeProjectDetail, CreativeProjectManifest, CreativeProjectSummary, CreativePublishConfig, CreativeReviewReport } from "@shared/contracts";
import { dimensionLabel, stageLabel } from "@shared/display-labels";
import { messages } from "@shared/messages";
import { useAi } from "../../ai-context";
import type { Navigate } from "../../app/routes";
import { EmptyState, ErrorState, PageHeader, Select, Skeleton, StatusBadge } from "../../design-system/components";

const m = messages;

const MAIN_FILTERS = [
  { id: "active", label: m.projects.filters.active },
  { id: "archived", label: m.projects.filters.archived },
  { id: "all", label: m.common.all }
] as const;
type MainFilter = typeof MAIN_FILTERS[number]["id"];

export function ProjectsPage({ initialProjectDir, go }: { initialProjectDir?: string; go?: Navigate }) {
  const ai = useAi();
  const [projects, setProjects] = useState<CreativeProjectSummary[]>([]);
  const [selected, setSelected] = useState<CreativeProjectSummary | null>(null);
  const [detail, setDetail] = useState<CreativeProjectDetail | null>(null);
  const [search, setSearch] = useState("");
  const [mainFilter, setMainFilter] = useState<MainFilter>("active");
  const [stage, setStage] = useState("all");
  const [platform, setPlatform] = useState("all");
  const [tag, setTag] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [dateMode, setDateMode] = useState<"date" | "updatedAt">("date");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const items = await window.cctools.getCreativeProjects();
      setProjects(items);
      setSelected((current) => current && items.some((item) => item.dir === current.dir) ? items.find((item) => item.dir === current.dir) || null : items.find((item) => item.dir === initialProjectDir) || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [initialProjectDir]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    void window.cctools.getCreativeProject(selected.dir).then(setDetail).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [selected?.dir]);

  const visible = useMemo(() => projects.filter((project) => {
    const archived = project.stage === "archived" || Boolean(project.archived);
    if (mainFilter === "active" && archived) return false;
    if (mainFilter === "archived" && !archived) return false;
    if (stage !== "all" && project.stage !== stage) return false;
    if (platform !== "all" && !Object.keys(project.platforms || {}).includes(platform)) return false;
    if (tag !== "all" && !(project.tags || []).includes(tag)) return false;
    if (dateFilter && normalizeDate(dateMode === "updatedAt" ? project.updatedAt : project.date) !== normalizeDate(dateFilter)) return false;
    return !search || `${project.topic} ${project.dir}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  }), [projects, search, stage, mainFilter, platform, tag, dateFilter, dateMode]);
  const platformOptions = useMemo(() => [...new Set(projects.flatMap((project) => Object.keys(project.platforms || {})))].sort(), [projects]);
  const tagOptions = useMemo(() => [...new Set(projects.flatMap((project) => project.tags || []))].sort(), [projects]);

  const copyProject = async () => {
    if (!selected) return;
    setBusy("copy");
    try {
      const copy = await window.cctools.copyCreativeProject(selected.dir);
      await load();
      setSelected({ ...selected, dir: copy.dir, topic: `${selected.topic}${m.projects.create.copySuffix}` });
      ai.notify(m.projects.notify.copied, "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setBusy("");
    }
  };
  const archiveProject = async () => {
    if (!selected) return;
    setBusy("archive");
    try {
      await window.cctools.archiveCreativeProject(selected.dir);
      await load();
      ai.notify(m.projects.notify.archived, "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setBusy("");
    }
  };
  const restoreProject = async () => {
    if (!selected) return;
    setBusy("restore");
    try {
      await window.cctools.restoreCreativeProject(selected.dir);
      await load();
      ai.notify(m.projects.notify.restored, "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setBusy("");
    }
  };
  const bindSession = async () => {
    if (!selected) return;
    const sessionId = ai.activeSession?.id;
    if (!sessionId) { ai.notify(m.projects.notify.needSession, "info"); return; }
    try {
      setBusy("bind");
      const updated = await window.cctools.bindCreativeSession(selected.dir, sessionId);
      setDetail(updated);
      ai.notify(m.projects.notify.sessionBound, "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setBusy("");
    }
  };
  const createProject = async (template = false) => {
    setBusy(template ? "template" : "create");
    try {
      const datetime = new Date().toLocaleString("zh-CN");
      const title = template ? m.projects.create.templateTitle(datetime) : m.projects.create.emptyTitle(datetime);
      const created = await window.cctools.createCreativeProject({
        date: today(),
        topic: {
          title,
          platform: template ? m.projects.create.templatePlatform : m.common.unspecified,
          section: template ? "template" : "empty",
          body: template ? "## 目标读者\n\n待补充。\n\n## 核心观点\n\n待补充。\n\n## 大纲\n\n1. 开场\n2. 分析\n3. 结论\n" : "## 项目说明\n\n待补充。"
        }
      });
      await load();
      const summary: CreativeProjectSummary = {
        dir: created.dir,
        topic: String(created.manifest?.topic || title),
        stage: String(created.stage || "drafting"),
        completion: Number(created.manifest?.progress || 20),
        date: normalizeDate(String(created.manifest?.date || today()))
      };
      setSelected(summary);
      ai.notify(template ? m.projects.notify.createdFromTemplate : m.projects.notify.createdEmpty, "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setBusy("");
    }
  };
  const deleteProject = async () => {
    if (!selected || !detail) return;
    const files = Object.keys(detail.files || {});
    const fileLines = files.length ? files.map((name) => `• ${name}`).join("\n") : m.projects.delete.emptyDir;
    const confirmed = await ai.confirm({
      title: m.projects.delete.title(selected.topic),
      body: m.projects.delete.body(selected.dir, fileLines),
      confirmText: m.projects.delete.confirmText,
      danger: true
    });
    if (!confirmed) return;
    setBusy("delete");
    try {
      await window.cctools.deleteCreativeProject(selected.dir);
      setSelected(null);
      setDetail(null);
      await load();
      ai.notify(m.projects.notify.deleted, "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setBusy("");
    }
  };

  const manifest = (detail?.manifest || {}) as Partial<CreativeProjectManifest>;
  const publish = (manifest.publish ?? null) as CreativePublishConfig | null;
  const review = (detail?.reviewReport ?? manifest.reviewReport ?? null) as CreativeReviewReport | null;
  const sessionIds = (Array.isArray(manifest.aiSessionIds) ? manifest.aiSessionIds : []) as string[];
  const draftName = preferredDraftFile(detail?.files);
  const draftPreview = draftName ? firstParagraph(detail?.files?.[draftName]) : "";
  const materialFiles = Object.keys(detail?.files || {}).filter((name) => name !== draftName);
  const assetCollection = typeof manifest.asset_collection === "string" && manifest.asset_collection ? manifest.asset_collection : null;
  const sourceList = Array.isArray(manifest.sources) ? manifest.sources : [];
  const manifestGroups = useMemo(() => buildManifestGroups((detail?.manifest || {}) as Partial<CreativeProjectManifest>, detail), [detail]);
  const rawManifestText = useMemo(() => JSON.stringify(detail?.manifest || {}, null, 2), [detail?.manifest]);

  if (loading) return <ProjectsSkeleton />;
  if (error && !projects.length) return <ErrorState message={error} />;
  return (
    <div className="feature-page projects-page">
      <PageHeader
        eyebrow="Projects"
        title={m.projects.title}
        description={m.projects.description}
        actions={<><button data-motion="action" disabled={Boolean(busy)} onClick={() => void createProject(false)}><Plus size={14} />{m.projects.actions.newEmpty}</button><button data-motion="action" disabled={Boolean(busy)} onClick={() => void createProject(true)}><FilePenLine size={14} />{m.projects.actions.fromTemplate}</button></>}
      />
      <section className="projects-layout">
        <aside className="workspace-card project-list-card">
          <header>
            <label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={m.projects.searchPlaceholder} /></label>
            <Select
              size="rect"
              ariaLabel={m.projects.filters.stageAria}
              value={stage}
              onChange={setStage}
              options={[
                { value: "all", label: m.projects.filters.stageAll },
                { value: "drafting", label: stageLabel("drafting") },
                { value: "review", label: stageLabel("review") },
                { value: "ready", label: stageLabel("ready") },
                { value: "published", label: stageLabel("published") },
                { value: "archived", label: stageLabel("archived") }
              ]}
            />
          </header>
          <div className="project-filter-grid">
            <label>{m.projects.dateMode.label}<Select
              size="rect"
              ariaLabel={m.projects.dateMode.label}
              value={dateMode}
              onChange={(value) => setDateMode(value as "date" | "updatedAt")}
              options={[
                { value: "date", label: m.projects.dateMode.date },
                { value: "updatedAt", label: m.projects.dateMode.updatedAt }
              ]}
            /></label>
            <label>{m.projects.filters.date}<input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label>
            <label>{m.projects.fields.platform}<Select
              size="rect"
              ariaLabel={m.projects.filters.platformAria}
              value={platform}
              onChange={setPlatform}
              options={[{ value: "all", label: m.projects.filters.platformAll }, ...platformOptions.map((item) => ({ value: item, label: item }))]}
            /></label>
            <label>{m.projects.fields.tags}<Select
              size="rect"
              ariaLabel={m.projects.filters.tagAria}
              value={tag}
              onChange={setTag}
              options={[{ value: "all", label: m.projects.filters.tagAll }, ...tagOptions.map((item) => ({ value: item, label: item }))]}
            /></label>
            <div className="project-view-toggle" role="group" aria-label={m.projects.filters.projectViewAria}>
              <button className={view === "cards" ? "active" : ""} aria-pressed={view === "cards"} data-motion="selection" aria-label={m.projects.view.cards} title={m.projects.view.cards} onClick={() => setView("cards")}><LayoutGrid size={14} /></button>
              <button className={view === "table" ? "active" : ""} aria-pressed={view === "table"} data-motion="selection" aria-label={m.projects.view.table} title={m.projects.view.table} onClick={() => setView("table")}><List size={14} /></button>
            </div>
          </div>
          <div className="project-main-filters" role="tablist" aria-label={m.projects.filters.mainFiltersAria}>
            {MAIN_FILTERS.map((filter) => <button key={filter.id} role="tab" data-motion="selection" aria-selected={mainFilter === filter.id} className={mainFilter === filter.id ? "active" : ""} onClick={() => setMainFilter(filter.id)}>{filter.label}</button>)}
          </div>
          <div className={`project-list ${view}`}>{visible.length ? visible.map((project) => (
            <button className={selected?.dir === project.dir ? "active" : ""} data-motion="selection" key={project.dir} onClick={() => setSelected(project)}>
              <div><strong>{project.topic}</strong><small>{formatProjectDate(project.date)} · {stageLabel(project.stage)}</small>{view === "table" ? <em>{Object.keys(project.platforms || {}).join("、") || m.projects.detail.unconfiguredPlatform}</em> : null}</div>
              <span>{project.completion}%</span>
            </button>
          )) : <EmptyState title={m.projects.empty.title} description={m.projects.empty.description} />}</div>
        </aside>
        <main className="workspace-card project-detail-card">
          {!selected || !detail ? <EmptyState title={m.projects.detail.emptyTitle} description={m.projects.detail.emptyDescription} icon={<FolderOpen size={24} />} /> : (
            <>
              <header>
                <div><span className="eyebrow">Project Detail</span><h2>{selected.topic}</h2><p>{selected.dir}</p></div>
                <div className="project-detail-actions">
                  {go ? <button data-motion="icon" onClick={() => go("creative", { projectDir: selected.dir, stage: selected.stage as "drafting" | "review" | "ready" | "published" })}><RotateCcw size={14} />{m.projects.actions.backToCreative}</button> : null}
                  <button data-motion="icon" onClick={() => void window.cctools.openPath(selected.dir)}><ExternalLink size={14} />{m.projects.actions.openDir}</button>
                </div>
              </header>
              <div className="project-status-row"><StatusBadge tone={selected.stage === "published" ? "success" : selected.stage === "archived" ? "neutral" : "info"}>{stageLabel(selected.stage)}</StatusBadge><span>{m.projects.detail.completion} {selected.completion}%{manifest.updated_at ? ` · ${formatRelative(manifest.updated_at)}` : ""}</span></div>
              <section>
                <h3>{m.projects.sections.basicInfo}</h3>
                <dl className="project-info-grid">
                  <div><dt>{m.projects.fields.date}</dt><dd>{formatProjectDate(manifest.date)}</dd></div>
                  <div><dt>{m.projects.fields.stage}</dt><dd>{stageLabel(selected.stage)}</dd></div>
                  <div><dt>{m.projects.detail.completion}</dt><dd>{selected.completion}%</dd></div>
                  <div><dt>{m.projects.fields.owner}</dt><dd>{String(manifest.owner || m.projects.values.localUser)}</dd></div>
                  <div><dt>{m.projects.fields.platform}</dt><dd>{Object.keys(manifest.platforms || {}).join("、") || m.projects.values.unconfigured}</dd></div>
                  <div><dt>{m.projects.fields.tags}</dt><dd>{(manifest.tags || []).join("、") || m.projects.values.none}</dd></div>
                  <div><dt>{m.projects.fields.updatedAt}</dt><dd>{manifest.updated_at ? formatRelative(manifest.updated_at) : m.common.unknown}</dd></div>
                </dl>
              </section>
              <section>
                <h3>{m.projects.sections.materials}</h3>
                {materialFiles.length || assetCollection ? (
                  <div className="project-file-grid">
                    {materialFiles.map((name) => <button key={name} data-motion="icon" onClick={() => void window.cctools.openPath(`${selected.dir}/${name}`)}><span>{name}</span><ExternalLink size={13} /></button>)}
                    {assetCollection ? <button data-motion="icon" onClick={() => void window.cctools.openPath(assetCollection)}><span>{assetCollection}</span><ExternalLink size={13} /></button> : null}
                  </div>
                ) : <p className="project-section-empty">{m.projects.materials.empty}</p>}
                {sourceList.length ? <div className="project-source-chips">{sourceList.map((source) => <span key={source} className="project-source-chip">{source}</span>)}</div> : null}
              </section>
              <section>
                <h3>{m.projects.sections.draft}</h3>
                {draftName ? (
                  <div className="project-draft-card">
                    <div className="project-draft-head"><FileText size={14} /><strong>{draftName}</strong><button data-motion="icon" onClick={() => void window.cctools.openPath(`${selected.dir}/${draftName}`)}><ExternalLink size={13} />{m.common.open}</button></div>
                    {draftPreview ? <p className="project-draft-preview">{draftPreview}{draftPreview.length >= 220 ? "…" : ""}</p> : <p className="project-section-empty">{m.projects.draft.noBody}</p>}
                  </div>
                ) : <p className="project-section-empty">{m.projects.draft.noFile}</p>}
              </section>
              <section>
                <h3>{m.projects.sections.review}</h3>
                {review ? (
                  <div className="project-review">
                    <div className="project-review-score"><strong>{review.score}</strong><span>{reviewStatusLabel(review.status)}</span></div>
                    <div className="project-review-dimensions">{Object.entries(review.dimensions || {}).map(([key, value]) => <div key={key}><span>{dimensionLabel(key)}</span><strong>{value}</strong></div>)}</div>
                    {review.issues?.length ? <ul className="project-review-issues">{review.issues.map((issue) => <li key={issue.id}><em>{issue.severity}</em>{issue.title}</li>)}</ul> : <p className="project-section-empty">{m.projects.review.noIssues}</p>}
                  </div>
                ) : <p className="project-section-empty">{m.projects.review.notGenerated}</p>}
              </section>
              <section>
                <h3>{m.projects.sections.publish}</h3>
                {publish && (publish.platform || publish.status !== "draft" || publish.exportedPath) ? (
                  <dl className="project-info-grid">
                    <div><dt>{m.projects.fields.platform}</dt><dd>{publish.platform || m.projects.publish.platformUnset}</dd></div>
                    <div><dt>{m.common.status}</dt><dd>{publishStatusLabel(publish.status)}</dd></div>
                    <div><dt>{m.projects.publish.fields.scheduledAt}</dt><dd>{publish.scheduledAt ? formatRelative(publish.scheduledAt) : m.projects.publish.unscheduled}</dd></div>
                    <div><dt>{m.projects.publish.fields.exportedPath}</dt><dd>{publish.exportedPath || m.projects.publish.notExported}</dd></div>
                    <div><dt>{m.projects.publish.fields.publishedUrl}</dt><dd>{publish.publishedUrl || m.projects.publish.notPublished}</dd></div>
                  </dl>
                ) : <p className="project-section-empty">{m.projects.publish.empty}</p>}
              </section>
              <section>
                <h3>{m.projects.sections.aiSessions}</h3>
                {sessionIds.length ? (
                  <div className="project-session-list">
                    {sessionIds.map((id) => (
                      <button key={id} className="session-compact-meta" data-motion="selection" onClick={() => go?.("ai", { sessionId: id, projectDir: selected.dir })}>
                        <Sparkles size={13} />
                        <span>{id.length > 32 ? id.slice(0, 32) + "…" : id}</span>
                      </button>
                    ))}
                  </div>
                ) : <p className="project-section-empty">{m.projects.ai.noSessions}</p>}
                <div className="project-ai-actions">
                  {go ? <button data-motion="icon" onClick={() => go("ai", { projectDir: selected.dir })}><Sparkles size={14} />{m.projects.ai.newSession}</button> : null}
                  <button data-motion="action" disabled={Boolean(busy) || !ai.activeSession?.id} onClick={() => void bindSession()}>{busy === "bind" ? m.projects.ai.binding : m.projects.ai.bindCurrent}</button>
                </div>
              </section>
              <section>
                <h3>{m.projects.sections.manifest}</h3>
                <div className="project-manifest-grid">
                  {manifestGroups.map((group) => (
                    <article key={group.id} className="project-manifest-card">
                      <header>
                        <div>
                          <strong>{group.title}</strong>
                          <span>{group.description}</span>
                        </div>
                      </header>
                      <dl>
                        {group.items.map((item) => (
                          <div key={`${group.id}:${item.label}`}>
                            <dt>{item.label}</dt>
                            <dd title={item.value}>{item.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </article>
                  ))}
                </div>
                <details className="project-manifest-raw">
                  <summary>{m.projects.manifest.rawSummary(Object.keys(detail.manifest || {}).length)}</summary>
                  {rawManifestText.trim() ? <pre>{rawManifestText}</pre> : <p>{m.projects.manifest.emptyRaw}</p>}
                </details>
              </section>
              <section className="project-manage-actions">
                <h3>{m.projects.sections.manage}</h3>
                <div>
                  <button data-motion="action" disabled={Boolean(busy)} onClick={() => void copyProject()}><Copy size={14} />{busy === "copy" ? m.projects.manage.copying : m.projects.manage.copy}</button>
                  {selected.stage === "archived" ? <button data-motion="action" disabled={Boolean(busy)} onClick={() => void restoreProject()}><RotateCcw size={14} />{busy === "restore" ? m.projects.manage.restoring : m.projects.manage.restore}</button> : <button data-motion="action" disabled={Boolean(busy)} onClick={() => void archiveProject()}><Archive size={14} />{busy === "archive" ? m.projects.manage.archiving : m.projects.manage.archive}</button>}
                  <button className="danger-button" data-motion="action" disabled={Boolean(busy)} onClick={() => void deleteProject()}><Trash2 size={14} />{busy === "delete" ? m.projects.manage.deleting : m.projects.manage.delete}</button>
                </div>
              </section>
            </>
          )}
        </main>
      </section>
    </div>
  );
}

function ProjectsSkeleton() {
  return (
    <div className="feature-page projects-page" aria-busy="true" aria-label={m.projects.loading}>
      <PageHeader eyebrow="Projects" title={m.projects.title} description={m.projects.description} />
      <section className="projects-layout">
        <aside className="workspace-card project-list-card project-list-skeleton">
          <Skeleton variant="card" lines={3} label={m.projects.loading} />
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} variant="row" lines={3} label={m.projects.loading} />)}
        </aside>
        <main className="workspace-card project-detail-card">
          <Skeleton variant="card" lines={10} label={m.projects.loading} />
        </main>
      </section>
    </div>
  );
}

function formatProjectDate(value: string | undefined): string {
  const raw = normalizeDate(value);
  return raw.length >= 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : m.common.unknownDate;
}

function normalizeDate(value: string | undefined): string { return String(value || "").replace(/\D/g, "").slice(0, 8); }

function formatRelative(value: string | undefined): string {
  if (!value) return m.common.unknown;
  const then = Date.parse(value);
  if (Number.isNaN(then)) return m.common.unknown;
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (diff < 0 || min < 1) return m.common.justNow;
  if (min < 60) return m.common.minutesAgo(min);
  const hr = Math.round(min / 60);
  if (hr < 24) return m.common.hoursAgo(hr);
  const day = Math.round(hr / 24);
  if (day < 30) return m.common.daysAgo(day);
  return new Date(then).toLocaleDateString("zh-CN");
}

function preferredDraftFile(files: Record<string, string> | undefined): string | null {
  const names = Object.keys(files || {});
  if (!names.length) return null;
  return names.find((name) => /^draft\.(md|markdown|txt)$/i.test(name))
    || names.find((name) => /\.md$/i.test(name) && !/^topic-brief/i.test(name) && !/^materials/i.test(name))
    || names.find((name) => /\.md$/i.test(name))
    || names[0];
}

function firstParagraph(text: string | undefined): string {
  const body = String(text || "").replace(/^#{1,6}.*$/m, "").trim();
  const para = body.split(/\n{2,}/).map((segment) => segment.trim()).find(Boolean);
  return (para || "").replace(/\n/g, " ").slice(0, 220);
}

function reviewStatusLabel(value: string): string {
  return ({
    pending: m.projects.review.status.pending,
    "changes-requested": m.projects.review.status.changesRequested,
    approved: m.projects.review.status.approved
  } as Record<string, string>)[value] || value;
}

function publishStatusLabel(value: string): string {
  return ({
    draft: m.projects.publish.status.draft,
    scheduled: m.projects.publish.status.scheduled,
    exported: m.projects.publish.status.exported,
    cancelled: m.projects.publish.status.cancelled
  } as Record<string, string>)[value] || value;
}

type ManifestGroup = {
  id: string;
  title: string;
  description: string;
  items: Array<{ label: string; value: string }>;
};

function buildManifestGroups(
  manifest: Partial<CreativeProjectManifest>,
  detail: CreativeProjectDetail | null
): ManifestGroup[] {
  const publish = (manifest.publish ?? null) as CreativePublishConfig | null;
  const review = (detail?.reviewReport ?? manifest.reviewReport ?? null) as CreativeReviewReport | null;
  const platforms = manifest.platforms || {};
  const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
  const tags = Array.isArray(manifest.tags) ? manifest.tags : [];
  const sessions = Array.isArray(manifest.aiSessionIds) ? manifest.aiSessionIds : [];
  const files = Object.keys(detail?.files || {});
  return [
    {
      id: "workflow",
      title: m.projects.manifest.workflow,
      description: m.projects.manifest.workflowDesc,
      items: [
        { label: m.projects.fields.date, value: formatProjectDate(manifest.date) },
        { label: m.projects.fields.stage, value: stageLabel(String(manifest.stage || detail?.stage || "drafting")) },
        { label: m.common.status, value: manifestTextValue(manifest.status) },
        { label: m.projects.detail.completion, value: `${Number(manifest.progress ?? 0)}%` },
        { label: m.projects.fields.owner, value: manifestTextValue(manifest.owner || m.projects.values.localUser) },
        { label: m.projects.manifest.sourceTopicId, value: manifestTextValue(manifest.sourceTopicId) }
      ]
    },
    {
      id: "materials",
      title: m.projects.manifest.materials,
      description: m.projects.manifest.materialsDesc,
      items: [
        { label: m.projects.manifest.sourceCount, value: sources.length ? `${sources.length} · ${compactList(sources)}` : m.projects.values.none },
        { label: m.projects.fields.tags, value: compactList(tags) || m.projects.values.none },
        { label: m.projects.fields.platform, value: objectSummary(platforms) || m.projects.values.unconfigured },
        { label: m.projects.manifest.fileCount, value: `${files.length}` },
        { label: m.projects.manifest.draftFile, value: preferredDraftFile(detail?.files) || m.projects.draft.noFile },
        { label: m.projects.manifest.assetCollection, value: manifestTextValue(manifest.asset_collection) }
      ]
    },
    {
      id: "publish",
      title: m.projects.manifest.publish,
      description: m.projects.manifest.publishDesc,
      items: [
        { label: m.projects.fields.platform, value: publish?.platform || m.projects.publish.platformUnset },
        { label: m.projects.manifest.publishStatus, value: publishStatusLabel(publish?.status || "draft") },
        { label: m.projects.manifest.scheduledAt, value: publish?.scheduledAt ? formatRelative(publish.scheduledAt) : m.projects.publish.unscheduled },
        { label: m.projects.manifest.exportedPath, value: publish?.exportedPath || m.projects.publish.notExported },
        { label: m.projects.manifest.publishedUrl, value: publish?.publishedUrl || m.projects.publish.notPublished }
      ]
    },
    {
      id: "ai",
      title: m.projects.manifest.ai,
      description: m.projects.manifest.aiDesc,
      items: [
        { label: m.projects.manifest.aiSessions, value: sessions.length ? `${sessions.length}` : m.projects.values.none },
        { label: m.projects.manifest.reviewScore, value: review ? String(review.score) : m.projects.review.notGenerated },
        { label: m.projects.manifest.reviewStatus, value: review ? reviewStatusLabel(review.status) : m.projects.review.status.pending },
        { label: m.projects.manifest.notesLength, value: `${String(manifest.notes || "").length}` },
        { label: m.projects.manifest.createdAt, value: manifest.created_at ? formatRelative(manifest.created_at) : m.common.unknown },
        { label: m.projects.fields.updatedAt, value: manifest.updated_at ? formatRelative(manifest.updated_at) : m.common.unknown }
      ]
    }
  ];
}

function manifestTextValue(value: unknown): string {
  if (value == null || value === "") return m.projects.values.none;
  if (Array.isArray(value)) return compactList(value);
  if (typeof value === "object") return objectSummary(value as Record<string, unknown>) || m.projects.values.none;
  return String(value);
}

function compactList(values: unknown[]): string {
  const items = values.map((value) => String(value || "").trim()).filter(Boolean);
  if (!items.length) return "";
  return items.length > 4 ? `${items.slice(0, 4).join("、")} +${items.length - 4}` : items.join("、");
}

function objectSummary(value: Record<string, unknown>): string {
  const entries = Object.entries(value).filter(([, item]) => item != null && item !== "");
  if (!entries.length) return "";
  return entries.slice(0, 4).map(([key, item]) => `${key}: ${String(item)}`).join("、") + (entries.length > 4 ? ` +${entries.length - 4}` : "");
}

function today(): string { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }

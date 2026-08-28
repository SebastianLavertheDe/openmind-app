import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { PanelLeftOpen, RefreshCw } from "lucide-react";
import type { ContextReference, CreativeAnalytics, CreativeProjectDetail, CreativeProjectSummary, CreativeTopic, CreativeVersion } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { useAi } from "../../ai-context";
import { useResponsiveLayout } from "../../app/responsive-layout";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "../../design-system/components";
import { ColumnSplitter } from "../../components/ColumnSplitter";
import { LIST_WIDTH_MAX, LIST_WIDTH_MIN, useListDetailLayout } from "../../components/useListDetailLayout";
import { AnalyticsView } from "./history-release";
import { type EditorSelectionSnapshot, type MarkdownEditorHandle } from "./MarkdownEditor";
import { FunnelBar, TodayStream } from "./stream";
import { useTopicFileEditor } from "./use-topic-file-editor";
import { CreativeDetailPane } from "./CreativeDetailPane";
import {
  type Bucket,
  type PlatformOption,
  type Stage,
  type StreamFilter,
  type WorkspaceView,
  bucketForStage,
  displayDate,
  formatRelative,
  normalizeDate,
  platformLabel,
  preferredFile,
  stageLabel,
  today
} from "./types";

type TopicWithDate = CreativeTopic & { sourceDate: string; sourceLabel: string; sourceFile: string };

export function CreativeWorkspacePage({
  initialDate,
  initialStage,
  initialProjectDir
}: {
  initialDate?: string;
  initialStage?: Stage;
  initialProjectDir?: string;
}) {
  const ai = useAi();
  const responsiveLayout = useResponsiveLayout();
  const compactWorkspace = responsiveLayout.workspace === "single";
  const [date] = useState(() => displayDate(initialDate) || today());
  const [view, setView] = useState<WorkspaceView>("workflow");
  const [stage, setStage] = useState<Stage>(initialStage || "today");
  const [topics, setTopics] = useState<TopicWithDate[]>([]);
  const [projects, setProjects] = useState<CreativeProjectSummary[]>([]);
  const [analytics, setAnalytics] = useState<CreativeAnalytics | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<CreativeTopic | null>(null);
  const [selectedProject, setSelectedProject] = useState<CreativeProjectSummary | null>(null);
  const [detail, setDetail] = useState<CreativeProjectDetail | null>(null);
  const [activeFile, setActiveFile] = useState("");
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<CreativeVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("preview");
  const { selectedTopicFilePath, selectedTopicFile, topicFileDraft, topicFileMode, topicFileDirty, topicFileSaving, setTopicFileDraft, setTopicFileMode, setTopicFileDirty, resetTopicFile, openTopicFile, saveTopicFile } = useTopicFileEditor();
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [workflowPolicy, setWorkflowPolicy] = useState({
    autoSaveDraft: true,
    autoSaveIntervalMs: 1500,
    publishChecklistEnabled: true
  });
  const [search, setSearch] = useState("");
  const [streamFilter, setStreamFilter] = useState<StreamFilter>(() => (initialStage && initialStage !== "today" ? bucketForStage(initialStage) : "all"));
  const [exporting, setExporting] = useState(false);
  const [editorSelection, setEditorSelection] = useState<EditorSelectionSnapshot>({ start: 0, end: 0, text: "" });
  const [compactListOpen, setCompactListOpen] = useState(true);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const layout = useListDetailLayout(
    "openmind.list-detail.creative.v1",
    { listWidth: 280, listCollapsed: false },
    { legacyStorageKeys: ["openmind.three-pane.creative.v2"] }
  );
  const hasCompactDetail = Boolean(selectedTopicFilePath || selectedTopic || selectedProject);
  const listVisible = compactWorkspace ? compactListOpen : !layout.layout.listCollapsed;

  useEffect(() => {
    if (!compactWorkspace) return;
    setCompactListOpen(!hasCompactDetail);
  }, [compactWorkspace, hasCompactDetail, selectedProject?.dir, selectedTopic?.id, selectedTopic?.title, selectedTopicFilePath]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [topicDays, nextProjects, nextAnalytics] = await Promise.all([
        window.openmind.getAllCreativeTopics(),
        window.openmind.getCreativeProjects(),
        window.openmind.getCreativeAnalytics()
      ]);
      setTopics(topicDays.flatMap((day) => day.topics.map((topic, index) => ({
        ...topic,
        id: topic.id || `${day.date}:${index}:${topic.title || "topic"}`,
        sourceDate: day.date,
        sourceLabel: day.label || displayDate(day.date) || day.date,
        sourceFile: day.file || `openmind/daily-topic/${day.date}_daily_topic.md`
      }))));
      setProjects(nextProjects);
      setAnalytics(nextAnalytics);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    void window.openmind.getPreferences().then((preferences) => {
      if (!active) return;
      setWorkflowPolicy({
        autoSaveDraft: preferences.workflowAutoSaveDraft,
        autoSaveIntervalMs: preferences.autoSaveIntervalMs,
        publishChecklistEnabled: preferences.workflowPublishChecklistEnabled
      });
    }).catch(() => { /* 保留安全默认值；设置页会展示持久化错误。 */ });
    return () => { active = false; };
  }, []);
  const selectView = useCallback((nextView: WorkspaceView) => {
    if (nextView === view) return;
    setView(nextView);
    setSelectedProject(null);
    setDetail(null);
    setSelectedTopic(null);
    resetTopicFile();
    setActiveFile("");
    setDraft("");
    setDirty(false);
    setVersions([]);
  }, [resetTopicFile, view]);

  const activeProjects = useMemo(() => projects.filter((project) => !project.archived && project.stage !== "archived"), [projects]);
  const funnelCounts = useMemo(() => {
    const counts: Record<Bucket, number> = { topic: 0, drafting: 0, pending: 0, published: 0 };
    for (const topic of topics) if (!topic.ignored) counts.topic += 1;
    for (const project of activeProjects) counts[bucketForStage(project.stage)] += 1;
    return counts;
  }, [topics, activeProjects]);

  const openProject = useCallback(async (project: CreativeProjectSummary) => {
    if (compactWorkspace) setCompactListOpen(false);
    setSelectedTopic(null);
    resetTopicFile();
    setSelectedProject(project);
    setDetail(null);
    setDirty(false);
    const targetStage = (project.stage as Stage) || stage;
    setStage(targetStage);
    try {
      const next = await window.openmind.getCreativeProject(project.dir);
      setDetail(next);
      const firstFile = preferredFile(Object.keys(next.files || {}), targetStage);
      setActiveFile(firstFile);
      setDraft(next.files?.[firstFile] || "");
      if (view === "history" && firstFile) setVersions(await window.openmind.listCreativeVersions(next.dir, firstFile));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [compactWorkspace, stage, view, resetTopicFile]);

  useEffect(() => {
    if (!initialProjectDir || !projects.length) return;
    const requested = projects.find((project) => project.dir === initialProjectDir);
    if (!requested) return;
    setStage(requested.stage as Stage);
    void openProject(requested);
  }, [initialProjectDir, projects, openProject]);

  useEffect(() => {
    if (!workflowPolicy.autoSaveDraft || !detail || !activeFile || !dirty || stage === "published" || view !== "workflow" || detail.truncatedFiles?.includes(activeFile)) return;
    setAutoSaveStatus("saving");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const next = await window.openmind.saveCreativeFile({ projectDir: detail.dir, file: activeFile, content: draft, createVersion: false });
          setDetail(next);
          setDirty(false);
          setAutoSaveStatus("saved");
        } catch (cause) {
          setAutoSaveStatus("failed");
          ai.notify(m.creativeUi.workspace.autoSaveFailed(cause instanceof Error ? cause.message : String(cause)), "error");
        }
      })();
    }, workflowPolicy.autoSaveIntervalMs);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, activeFile, detail?.dir, stage, view, ai, workflowPolicy.autoSaveDraft, workflowPolicy.autoSaveIntervalMs]);

  const chooseFile = async (file: string) => {
    if (file === activeFile) return;
    if (dirty && !await ai.confirm({ title: m.creativeUi.workspace.switchFile.title, body: m.creativeUi.workspace.switchFile.body, confirmText: m.creativeUi.workspace.switchFile.confirm, danger: true })) return;
    setActiveFile(file);
    setDraft(detail?.files?.[file] || "");
    setDirty(false);
    setAutoSaveStatus("idle");
  };

  const save = async () => {
    if (!detail || !activeFile || !dirty) return;
    setSaving(true);
    try {
      const next = await window.openmind.saveCreativeFile({ projectDir: detail.dir, file: activeFile, content: draft, createVersion: true, versionNote: m.creativeUi.workspace.editorVersionNote });
      setDetail(next);
      setDirty(false);
      setVersions(await window.openmind.listCreativeVersions(next.dir, activeFile));
      ai.notify(m.creativeUi.workspace.savedWithVersion, "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setSaving(false);
    }
  };

  const createProject = async (platform?: PlatformOption, topicOverride?: CreativeTopic) => {
    const topic = topicOverride || selectedTopic;
    if (!topic) return;
    const topicDate = (topic as TopicWithDate).sourceDate || normalizeDate(date);
    try {
      const created = await window.openmind.createCreativeProject({ date: topicDate, topic, sourceTopicId: topic.id || undefined });
      const reused = Boolean((created as { reused?: boolean }).reused);
      await load();
      setStage("drafting");
      setView("workflow");
      const summary: CreativeProjectSummary = {
        dir: created.dir,
        topic: String(created.manifest?.topic || topic.title || m.creativeUi.workspace.untitledProject),
        stage: "drafting",
        completion: 20,
        date: normalizeDate(topicDate)
      };
      await openProject(summary);
      if (platform && created.files && !created.files[platform.file]) {
        try {
          const seeded = await window.openmind.saveCreativeFile({ projectDir: created.dir, file: platform.file, content: `# ${topic.title || m.creativeUi.workspace.draftTitle}\n\n`, createVersion: false });
          setDetail(seeded);
          setActiveFile(platform.file);
          setDraft(seeded.files?.[platform.file] || "");
          await window.openmind.updateCreativeManifest(created.dir, { platforms: { [platform.id]: "draft" } });
        } catch { /* platform seed optional */ }
      }
      ai.notify(reused ? m.creativeUi.workspace.reusedDraft : platform ? m.creativeUi.workspace.createdDraft(platform.label) : m.creativeUi.workspace.createdProject, reused ? "info" : "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    }
  };

  const advance = async () => {
    if (!detail || !selectedProject) return;
    const nextStage: Stage | undefined = ({ drafting: "review", review: "ready", ready: "published" } as Record<string, Stage | undefined>)[selectedProject.stage];
    if (!nextStage) return;
    if (dirty) await save();
    try {
      const moved = await window.openmind.advanceCreativeProject(detail.dir, nextStage);
      ai.notify(m.creativeUi.workspace.stageEntered(stageLabel(nextStage)), "success");
      await load();
      setStage(nextStage);
      setSelectedProject({ ...selectedProject, dir: moved.dir, stage: nextStage });
      setDetail(moved);
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    }
  };

  const exportDraft = async () => {
    if (!detail || !selectedProject) return;
    const publish = ((detail.manifest as Record<string, unknown> | undefined)?.publish as Record<string, unknown> | undefined) || {};
    if (!publish.platform) { ai.notify(m.creativeUi.workspace.platformRequired, "error"); return; }
    setExporting(true);
    try {
      const safeTopic = selectedProject.topic.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^[.-]+|[.-]+$/g, "") || "draft";
      const platform = String(detail.manifest?.publish?.platform || "");
      const file = await window.openmind.exportText(`${normalizeDate(selectedProject.date || date)}-${safeTopic.slice(0, 80)}${platform ? `.${platform}` : ""}.md`, draft);
      const updated = await window.openmind.updateCreativeManifest(detail.dir, { publish: { status: "exported", exportedPath: file || null } });
      setDetail(updated);
      ai.notify(file ? m.creativeUi.workspace.exportedTo(file) : m.creativeUi.workspace.exportCancelled, file ? "success" : "info");
      await load();
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setExporting(false);
    }
  };

  const copyProject = async () => {
    if (!detail) return;
    try { await window.openmind.copyCreativeProject(detail.dir); ai.notify(m.creativeUi.workspace.copied, "success"); await load(); }
    catch (cause) { ai.notify(cause instanceof Error ? cause.message : String(cause), "error"); }
  };
  const archiveProject = async () => {
    if (!detail) return;
    if (!await ai.confirm({ title: m.creativeUi.workspace.archive.title, body: m.creativeUi.workspace.archive.body, confirmText: m.creativeUi.workspace.archive.confirm, danger: true })) return;
    try { await window.openmind.archiveCreativeProject(detail.dir); ai.notify(m.creativeUi.workspace.archive.success, "success"); setSelectedProject(null); setDetail(null); await load(); }
    catch (cause) { ai.notify(cause instanceof Error ? cause.message : String(cause), "error"); }
  };

  const addContext = () => {
    const topicDate = selectedTopic ? ((selectedTopic as TopicWithDate).sourceDate || normalizeDate(date)) : normalizeDate(date);
    const context: ContextReference | null = detail ? {
      id: `creative:${detail.dir}`, kind: "creative", label: String(detail.manifest?.topic || m.creativeUi.workspace.contextProject), path: detail.dir,
      content: JSON.stringify({ manifest: detail.manifest, file: activeFile, content: draft }, null, 2)
    } : selectedTopic ? {
      id: `creative-topic:${topicDate}:${selectedTopic.title}`, kind: "creative", label: selectedTopic.title || m.creativeUi.workspace.contextTopic,
      content: JSON.stringify({ date: topicDate, topic: selectedTopic }, null, 2)
    } : null;
    if (!context) return;
    ai.addContext(context);
    ai.setPanelMode("wide");
    ai.notify(m.creativeUi.editor.addedContextNotify, "success");
  };

  const insertAtCursor = (before: string, after = "", placeholder = "") => {
    if (editorRef.current?.insert(before, after, placeholder)) {
      setDirty(true);
      return;
    }
    setDraft((value) => `${value}${before}${placeholder}${after}`);
    setDirty(true);
  };
  const replaceRange = (start: number, end: number, replacement: string) => {
    const applied = editorRef.current?.replaceRange(start, end, replacement);
    if (!applied) setDraft((value) => `${value.slice(0, start)}${replacement}${value.slice(end)}`);
    setDirty(true);
    setEditorMode("edit");
    window.requestAnimationFrame(() => editorRef.current?.focus());
  };
  const insertLocalFileLink = async () => {
    try {
      const files = await window.openmind.selectFiles();
      if (!files.length) return;
      const file = files[0];
      insertAtCursor("[", `](${file})`, file.split(/[\\/]/).at(-1) || file);
      ai.notify(m.creativeUi.editor.localFileNotify, "success");
    } catch (cause) { ai.notify(cause instanceof Error ? cause.message : String(cause), "error"); }
  };
  const updateManifest = async (patch: Record<string, unknown>) => {
    if (!detail) return;
    try {
      setDetail(await window.openmind.updateCreativeManifest(detail.dir, { publish: patch }));
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    }
  };
  const creativeDetailMotionKey = selectedTopicFilePath
    ? `topic-file:${selectedTopicFilePath}`
    : selectedTopic
      ? `topic:${selectedTopic.id || selectedTopic.title}`
      : selectedProject
        ? `project:${selectedProject.dir}:${view}`
        : `empty:${view}`;

  return (
    <div className="creative-workspace-page">
      <div className="creative-page-header">
        <PageHeader
          eyebrow={m.creativeUi.workspace.eyebrow}
          title={m.creativeUi.workspace.title}
          description={analytics ? m.creativeUi.workspace.analyticsDescription(topics.length, analytics.total, analytics.averageCompletion) : m.creativeUi.workspace.description}
          actions={<button data-motion="action" aria-busy={loading || undefined} disabled={loading} onClick={() => void load()}><RefreshCw size={15} className={loading ? "spin" : ""} />{m.creativeUi.workspace.refresh}</button>}
        />
        <nav className="creative-view-tabs" role="tablist" aria-label={m.creativeUi.workspace.tabsAria}>
          {([
            ["workflow", m.creativeUi.workspace.tabs.workflow],
            ["history", m.creativeUi.workspace.tabs.history],
            ["release", m.creativeUi.workspace.tabs.release],
            ["analytics", m.creativeUi.workspace.tabs.analytics]
          ] as const).map(([nextView, label]) => (
            <button
              key={nextView}
              type="button"
              role="tab"
              data-motion="selection"
              aria-selected={view === nextView}
              className={view === nextView ? "active" : ""}
              onClick={() => selectView(nextView)}
            >{label}</button>
          ))}
        </nav>
        {view === "workflow" ? (
          <FunnelBar counts={funnelCounts} active={streamFilter} onSelect={setStreamFilter} />
        ) : null}
      </div>
      {error ? <ErrorState message={error} retry={() => void load()} /> : null}
      {view === "analytics" ? (
        <AnalyticsView analytics={analytics} loading={loading} />
      ) : (
        <div
          className={`creative-workspace${compactWorkspace ? compactListOpen ? " compact-list-open" : " compact-detail-open" : ""}${layout.isResizing ? " is-resizing-list" : ""}`}
          style={{ "--list-detail-columns": layout.columns } as CSSProperties}
        >
          <aside className={`creative-list-pane${listVisible ? "" : " collapsed"}`}>
            {!listVisible ? null : (
              <>
                <label className="creative-search"><input aria-label={m.creativeUi.workspace.search} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={m.creativeUi.workspace.search} /></label>
                {view === "workflow" ? (
                  loading ? <CreativeStreamSkeleton /> : (
                    <TodayStream
                      topics={topics}
                      projects={activeProjects}
                      filter={streamFilter}
                      search={search}
                      selectedTopic={selectedTopic}
                      selectedProject={selectedProject}
                      selectedTopicFile={selectedTopicFilePath}
                      onOpenTopic={(topic) => { if (compactWorkspace) setCompactListOpen(false); resetTopicFile(); setSelectedProject(null); setDetail(null); setSelectedTopic(topic); }}
                      onOpenTopicFile={(path) => void openTopicFile(path).then((opened) => { if (opened) { if (compactWorkspace) setCompactListOpen(false); setSelectedProject(null); setDetail(null); setSelectedTopic(null); } })}
                      onOpenProject={(project) => void openProject(project)}
                    />
                  )
                ) : loading ? <CreativeStreamSkeleton /> : (
                  <div className="creative-item-list entrance-stagger">
                    {activeProjects.map((project) => (
                      <button key={project.dir} data-entrance-item data-motion="selection" className={`creative-item-row${selectedProject?.dir === project.dir ? " active" : ""}`} onClick={() => void openProject(project)}>
                        <div><strong>{project.topic}</strong><p>{stageLabel(project.stage)}{project.platforms && Object.keys(project.platforms).length ? ` · ${Object.keys(project.platforms).map(platformLabel).join("/")}` : ""}</p><small>{m.creativeUi.workspace.completion(project.completion)}{project.updatedAt ? ` · ${formatRelative(project.updatedAt)}` : ""}</small></div>
                        <span className="completion-ring">{project.completion}%</span>
                      </button>
                    ))}
                    {!activeProjects.length ? <EmptyState title={m.creativeUi.workspace.emptyProjects.title} description={m.creativeUi.workspace.emptyProjects.description} /> : null}
                  </div>
                )}
              </>
            )}
          </aside>
          <ColumnSplitter
            side="left"
            collapsed={!listVisible}
            ariaLabel={m.creativeUi.workspace.streamWidth}
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
          <main className={`creative-main-pane${listVisible ? "" : " list-collapsed"}`}>
            {!listVisible ? (
              <button
                type="button"
                className="creative-list-reopen"
                aria-label={m.creativeUi.workspace.expandList}
                title={m.creativeUi.workspace.expandList}
                data-motion="icon"
                onClick={() => compactWorkspace ? setCompactListOpen(true) : layout.toggleList()}
              ><PanelLeftOpen size={17} /></button>
            ) : null}
            <div key={creativeDetailMotionKey} className={`creative-detail-transition stage-${stage}`} data-stage={stage}>
              <CreativeDetailPane
                view={view}
                stage={stage}
                detail={detail}
                selectedProject={selectedProject}
                selectedTopic={selectedTopic}
                selectedTopicDate={selectedTopic ? (selectedTopic as TopicWithDate).sourceLabel || (selectedTopic as TopicWithDate).sourceDate || date : date}
                selectedTopicFile={selectedTopicFile}
                topicFileDraft={topicFileDraft}
                topicFileMode={topicFileMode}
                topicFileDirty={topicFileDirty}
                topicFileSaving={topicFileSaving}
                setTopicFileDraft={setTopicFileDraft}
                setTopicFileMode={setTopicFileMode}
                setTopicFileDirty={setTopicFileDirty}
                saveTopicFile={saveTopicFile}
                versions={versions}
                activeFile={activeFile}
                chooseFile={chooseFile}
                setVersions={setVersions}
                setDetail={setDetail}
                setDraft={setDraft}
                createProject={createProject}
                addContext={addContext}
                dirty={dirty}
                autoSaveStatus={autoSaveStatus}
                saving={saving}
                save={save}
                copyProject={copyProject}
                archiveProject={archiveProject}
                advance={advance}
                exportDraft={exportDraft}
                exporting={exporting}
                publishChecklistEnabled={workflowPolicy.publishChecklistEnabled}
                editorMode={editorMode}
                setEditorMode={setEditorMode}
                draft={draft}
                insertAtCursor={insertAtCursor}
                editorSelection={editorSelection}
                replaceRange={replaceRange}
                editorRef={editorRef}
                setDirty={setDirty}
                setEditorSelection={setEditorSelection}
                insertLocalFileLink={insertLocalFileLink}
                updateManifest={updateManifest}
              />
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

function CreativeStreamSkeleton() {
  return (
    <div className="creative-item-list creative-loading-list" aria-busy="true" aria-label={m.creativeUi.editor.loadingTopics}>
      {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} variant="row" lines={3} label={m.creativeUi.editor.loadingTopics} />)}
    </div>
  );
}

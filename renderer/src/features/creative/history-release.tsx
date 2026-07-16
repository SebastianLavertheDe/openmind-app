import { useEffect, useMemo, useState } from "react";
import { FileClock, History } from "lucide-react";
import type {
  CreativeAnalytics,
  CreativeProjectDetail,
  CreativeProjectSummary,
  CreativeReleaseEvent,
  CreativeVersion
} from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { useAi } from "../../ai-context";
import { EmptyState, LoadingState, Select, StatusBadge } from "../../design-system/components";
import { actionLabel, platformLabel, stageLabel } from "./types";

export function HistoryView({ detail, selectedProject, activeFile, versions, files, chooseFile, onVersionsChange, onRestored }: {
  detail: CreativeProjectDetail | null;
  selectedProject: CreativeProjectSummary | null;
  activeFile: string;
  versions: CreativeVersion[];
  files: string[];
  chooseFile(file: string): void;
  onVersionsChange(versions: CreativeVersion[]): void;
  onRestored(detail: CreativeProjectDetail): void;
}) {
  const ai = useAi();
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [leftContent, setLeftContent] = useState("");
  const [rightContent, setRightContent] = useState("");
  useEffect(() => {
    setLeftId(""); setRightId(""); setLeftContent(""); setRightContent("");
    if (detail && activeFile) void window.cctools.listCreativeVersions(detail.dir, activeFile).then(onVersionsChange).catch(() => {});
  }, [activeFile, selectedProject?.dir, detail?.dir, onVersionsChange]);
  const loadVersion = async (id: string, setter: (value: string) => void) => {
    if (!id) { setter(""); return; }
    const version = versions.find((item) => item.id === id);
    if (!version) return;
    try { setter((await window.cctools.readCreativeVersion(version.path)).content); }
    catch (cause) { ai.notify(cause instanceof Error ? cause.message : String(cause), "error"); }
  };
  const diff = useMemo(() => {
    if (!leftContent && !rightContent) return [];
    return lineDiff(leftContent.split(/\r?\n/), rightContent.split(/\r?\n/));
  }, [leftContent, rightContent]);
  const diffTruncated = diff.length > 600;
  const visibleDiff = diffTruncated ? diff.slice(0, 600) : diff;
  const restore = async (version: CreativeVersion) => {
    if (!detail || !await ai.confirm({ title: m.creativeUi.history.restoreTitle, body: m.creativeUi.history.restoreBody(version.note), confirmText: m.creativeUi.history.restoreConfirm, danger: true })) return;
    try {
      const next = await window.cctools.restoreCreativeVersion(detail.dir, activeFile, version.path);
      onRestored(next);
      onVersionsChange(await window.cctools.listCreativeVersions(detail.dir, activeFile));
      ai.notify(m.creativeUi.history.restored, "success");
    } catch (cause) { ai.notify(cause instanceof Error ? cause.message : String(cause), "error"); }
  };
  if (!detail || !selectedProject) return <EmptyState title={m.creativeUi.history.pickProject} description={m.creativeUi.history.pickProjectDesc} icon={<History size={28} />} />;
  return (
    <div className="creative-history">
      <header className="creative-document-header">
        <div><h1>{selectedProject.topic}</h1><p>{detail.dir}</p></div>
        <nav className="document-tabs">{files.map((file) => <button key={file} data-motion="selection" className={activeFile === file ? "active" : ""} onClick={() => chooseFile(file)}>{file}</button>)}</nav>
      </header>
      {!activeFile ? <EmptyState title={m.creativeUi.history.noFile} description={m.creativeUi.history.pickMarkdown} /> : (
        <>
          <div className="history-compare">
            <label>{m.creativeUi.history.versionA}<Select
              size="rect"
              value={leftId}
              onChange={(value) => { setLeftId(value); void loadVersion(value, setLeftContent); }}
              placeholder={m.creativeUi.history.currentContent}
              options={versions.map((version) => ({ value: version.id, label: `${version.note} · ${new Date(version.createdAt).toLocaleString("zh-CN")}` }))}
            /></label>
            <label>{m.creativeUi.history.versionB}<Select
              size="rect"
              value={rightId}
              onChange={(value) => { setRightId(value); void loadVersion(value, setRightContent); }}
              placeholder={m.creativeUi.history.currentContent}
              options={versions.map((version) => ({ value: version.id, label: `${version.note} · ${new Date(version.createdAt).toLocaleString("zh-CN")}` }))}
            /></label>
          </div>
          <pre className="history-diff" aria-label={m.creativeUi.history.diffAria}>{visibleDiff.length ? visibleDiff.map((line, index) => <span key={index} className={`diff-${line.type}`}>{line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}{line.text}{"\n"}</span>) : m.creativeUi.history.pickTwoVersions}</pre>
          {diffTruncated ? <p className="diff-truncated">{m.creativeUi.history.diffTruncated}</p> : null}
          <section className="history-versions">
            <h2>{m.creativeUi.history.versions}</h2>
            {versions.length ? versions.map((version) => (
              <div key={version.id} className="version-row">
                <FileClock size={14} />
                <div><strong>{version.note}</strong><small>{new Date(version.createdAt).toLocaleString("zh-CN")} · {Math.round(version.size / 1024)} KB</small></div>
                <button data-motion="icon" onClick={() => window.cctools.openPath(version.path)}>{m.common.open}</button>
                <button className="primary-button" onClick={() => void restore(version)}>{m.creativeUi.history.restoreAsNew}</button>
              </div>
            )) : <p className="review-empty">{m.creativeUi.history.empty}</p>}
          </section>
        </>
      )}
    </div>
  );
}

export function ReleaseLogView({ detail, selectedProject }: { detail: CreativeProjectDetail | null; selectedProject: CreativeProjectSummary | null }) {
  const [events, setEvents] = useState<CreativeReleaseEvent[]>([]);
  const [filter, setFilter] = useState("");
  useEffect(() => { if (detail) void window.cctools.getCreativeReleaseLog(detail.dir).then(setEvents).catch(() => setEvents([])); else setEvents([]); }, [detail?.dir]);
  if (!detail || !selectedProject) return <EmptyState title={m.creativeUi.history.pickProject} description={m.creativeUi.release.pickProjectDesc} icon={<FileClock size={28} />} />;
  const filtered = filter ? events.filter((event) => `${event.action} ${event.platform || ""} ${event.status || ""} ${event.detail || ""}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) : events;
  return (
    <div className="creative-release-log">
      <header className="creative-document-header"><div><h1>{selectedProject.topic}</h1><p>{detail.dir}</p></div></header>
      <label className="creative-search"><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={m.creativeUi.release.searchPlaceholder} /></label>
      <ol className="release-timeline">
        {filtered.length ? filtered.map((event) => (
          <li key={event.id} className={`release-event ${event.action}`}>
            <span className="release-time">{new Date(event.createdAt).toLocaleString("zh-CN")}</span>
            <strong>{actionLabel(event.action)}</strong>
            {event.platform ? <em>{platformLabel(event.platform)}</em> : null}
            {event.status ? <StatusBadge tone={event.status === "exported" || event.status === "approved" ? "success" : event.status === "cancelled" ? "warning" : "neutral"}>{event.status}</StatusBadge> : null}
            {event.target ? <small>{m.creativeUi.release.target(event.target)}</small> : null}
            {event.detail ? <p>{event.detail}</p> : null}
          </li>
        )) : <li className="review-empty">{m.creativeUi.release.empty}</li>}
      </ol>
    </div>
  );
}

export function AnalyticsView({ analytics, loading }: { analytics: CreativeAnalytics | null; loading: boolean }) {
  if (loading && !analytics) return <LoadingState label={m.creativeUi.analytics.loading} />;
  if (!analytics) return <EmptyState title={m.creativeUi.analytics.noData} description={m.creativeUi.analytics.noDataDesc} />;
  const stageMax = Math.max(1, ...analytics.stages.map((item) => item.count));
  const platformMax = Math.max(1, ...analytics.platforms.map((item) => item.count));
  return (
    <section className="creative-analytics">
      <header><h2>{m.creativeUi.analytics.title}</h2><small>{m.creativeUi.analytics.subtitle}</small></header>
      <div className="analytics-metrics">
        <div><strong>{analytics.total}</strong><span>{m.creativeUi.analytics.totalProjects}</span></div>
        <div><strong>{analytics.stages.find((item) => item.stage === "published")?.count || 0}</strong><span>{m.creativeUi.analytics.published}</span></div>
        <div><strong>{analytics.averageCycleHours != null ? m.common.hours(analytics.averageCycleHours) : "—"}</strong><span>{m.creativeUi.analytics.avgCycle}<small>{m.creativeUi.analytics.avgCycleHint}</small></span></div>
        <div><strong>{analytics.averageCompletion}%</strong><span>{m.creativeUi.analytics.avgCompletion}</span></div>
      </div>
      <div className="analytics-grid">
        <article><h3>{m.creativeUi.analytics.stageDistribution}<small>{m.creativeUi.analytics.stageDistributionHint}</small></h3>{analytics.stages.map((item) => <div key={item.stage}><span>{stageLabel(item.stage)}</span><div><i style={{ width: `${item.count / stageMax * 100}%` }} /></div><strong>{item.count}</strong></div>)}</article>
        <article><h3>{m.creativeUi.analytics.platformDistribution}<small>{m.creativeUi.analytics.platformDistributionHint}</small></h3>{analytics.platforms.length ? analytics.platforms.map((item) => <div key={item.platform}><span>{platformLabel(item.platform)}</span><div><i style={{ width: `${item.count / platformMax * 100}%` }} /></div><strong>{item.count}</strong></div>) : <p className="review-empty">{m.creativeUi.analytics.noPlatform}</p>}</article>
        <article><h3>{m.creativeUi.analytics.stageDuration}<small>{m.creativeUi.analytics.stageDurationHint}</small></h3>{(analytics.stageDurations || []).map((item) => <div key={item.stage}><span>{stageLabel(item.stage)}</span><strong>{item.averageHours != null ? m.common.hours(item.averageHours) : "—"}</strong></div>)}</article>
      </div>
    </section>
  );
}

function lineDiff(a: string[], b: string[]): Array<{ type: "same" | "add" | "del"; text: string }> {
  const n = a.length;
  const mLen = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(mLen + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = mLen - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Array<{ type: "same" | "add" | "del"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < mLen) {
    if (a[i] === b[j]) { out.push({ type: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: a[i] }); i++; }
    else { out.push({ type: "add", text: b[j] }); j++; }
  }
  while (i < n) { out.push({ type: "del", text: a[i] }); i++; }
  while (j < mLen) { out.push({ type: "add", text: b[j] }); j++; }
  return out;
}

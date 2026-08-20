import { useEffect, useMemo, useState } from "react";
import { Bot, Check, Clock3, Download, FileClock, FileText, RefreshCw, Save, Sparkles } from "lucide-react";
import type { CreativeProjectDetail, CreativeTopic, CreativeVersion } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { useAi } from "../../ai-context";
import { EmptyState, Select, StatusBadge } from "../../design-system/components";
import { MarkdownReader } from "../../components/MarkdownReader";
import {
  type CreativeReportShape,
  type PlatformOption,
  PLATFORM_OPTIONS,
  dimensionLabel,
  platformLabel
} from "./types";

export function TopicWorkspace({ topic, date, createProject, addContext }: { topic: CreativeTopic; date: string; createProject(platform?: PlatformOption): void; addContext(): void }) {
  const [showPlatform, setShowPlatform] = useState(false);
  return (
    <div className="topic-workspace">
      <header><div><span className="eyebrow">Recommended Topic · {date}</span><h1>{topic.title || m.creative.defaults.unnamedTopic}</h1><p>{topic.platform || m.creative.defaults.topicCreation}{topic.score ? ` · ${m.creativeUi.topic.score(topic.score)}` : ""}</p></div>
        <div><button data-motion="icon" onClick={addContext}><Bot size={14} />{m.creativeUi.topic.askAi}</button><button data-motion="icon" onClick={() => setShowPlatform((value) => !value)}><Sparkles size={14} />{m.creativeUi.topic.createDraft}</button></div>
      </header>
      {topic.projectDir ? <div className="topic-existing"><Check size={14} />{m.creativeUi.topic.hasDraft}</div> : null}
      {showPlatform ? (
        <div className="topic-platform-picker">
          <strong>{m.creativeUi.topic.pickPlatform}</strong>
          <div className="topic-platform-grid">
            <button data-motion="selection" onClick={() => createProject()}>{m.creativeUi.topic.genericDraft}</button>
            {PLATFORM_OPTIONS.map((option) => <button key={option.id} data-motion="selection" onClick={() => createProject(option)}>{option.label}</button>)}
          </div>
        </div>
      ) : null}
      <section><h2>推荐理由与创作角度</h2><MarkdownReader content={topic.body || m.creativeUi.topic.noBody} /></section>
      <section className="topic-outline"><h2>{m.creativeUi.topic.outline.title}</h2><ol><li>{m.creativeUi.topic.outline.hook}</li><li>{m.creativeUi.topic.outline.explain}</li><li>{m.creativeUi.topic.outline.evidence}</li><li>{m.creativeUi.topic.outline.close}</li></ol></section>
    </div>
  );
}

export function ReviewPanel({ content, detail, onReviewed, onStatusChange, onLocate }: { content: string; detail: CreativeProjectDetail; onReviewed(next: CreativeProjectDetail): void; onStatusChange(next: CreativeProjectDetail): void; onLocate(line: number | null): void }) {
  const ai = useAi();
  const [running, setRunning] = useState(false);
  const manifestRecord = (detail.manifest || {}) as Record<string, unknown>;
  const report = (manifestRecord.reviewReport as CreativeReportShape | undefined) || (detail.reviewReport as CreativeReportShape | undefined) || null;
  const checks = [
    { label: m.creativeUi.review.checks.length, passed: content.length >= 800, detail: m.common.chars(content.length) },
    { label: m.creativeUi.review.checks.headings, passed: /^##\s+/m.test(content), detail: m.creativeUi.review.checks.headingsDetail },
    { label: m.creativeUi.review.checks.links, passed: /https?:\/\//.test(content), detail: m.creativeUi.review.checks.linksDetail },
    { label: m.creativeUi.review.checks.closing, passed: content.trim().length > 0 && content.trim().split(/\n\s*\n/).at(-1)!.length >= 30, detail: m.creativeUi.review.checks.closingDetail }
  ];
  const score = Math.round(checks.filter((item) => item.passed).length / checks.length * 100);
  const runReview = async () => {
    setRunning(true);
    try { onReviewed(await window.openmind.reviewCreativeProject(detail.dir)); ai.notify(m.creativeUi.review.notify.generated, "success"); }
    catch (cause) { ai.notify(cause instanceof Error ? cause.message : String(cause), "error"); }
    finally { setRunning(false); }
  };
  const setStatus = async (status: "pending" | "changes-requested" | "approved") => {
    try {
      const next = await window.openmind.setCreativeReviewStatus(detail.dir, status);
      onStatusChange(next);
      ai.notify(status === "approved" ? m.creativeUi.review.notify.approved : status === "changes-requested" ? m.creativeUi.review.notify.changesRequested : m.creativeUi.review.notify.reset, status === "approved" ? "success" : "info");
    } catch (cause) { ai.notify(cause instanceof Error ? cause.message : String(cause), "error"); }
  };
  return (
    <section className="inline-review-panel">
      <header><div><span className="eyebrow">Quality Review</span><h2>{m.creativeUi.review.title}</h2><small>{m.creativeUi.review.subtitle}</small></div><strong>{report ? report.score : score}</strong></header>
      <div className="review-live-checks">{checks.map((item) => <article key={item.label} className={item.passed ? "passed" : "warning"}><span>{item.passed ? <Check size={14} /> : <Clock3 size={14} />}</span><div><strong>{item.label}</strong><p>{item.detail}</p></div></article>)}</div>
      {report ? (
        <div className="review-report">
          <div className="review-dimensions">{Object.entries(report.dimensions).map(([key, value]) => <div key={key}><span>{dimensionLabel(key)}</span><strong>{value}</strong></div>)}</div>
          {report.issues.length ? <ul className="review-issues">{report.issues.map((issue) => <li key={issue.id} className={issue.severity}><button data-motion="selection" onClick={() => onLocate(issue.line ?? null)}><strong>{issue.title}</strong><p>{issue.detail}{issue.line ? m.creativeUi.review.issueLine(issue.line) : ""}</p><span className="issue-locate">{m.creativeUi.review.locate}</span></button></li>)}</ul> : <p className="review-clean">{m.creativeUi.review.noIssues}</p>}
          <div className="review-status">{report.status === "approved" ? <StatusBadge tone="success">{m.creativeUi.review.status.approved}</StatusBadge> : report.status === "changes-requested" ? <StatusBadge tone="warning">{m.creativeUi.review.status.changesRequested}</StatusBadge> : <StatusBadge tone="info">{m.creativeUi.review.status.pending}</StatusBadge>}</div>
        </div>
      ) : <p className="review-empty">{m.creativeUi.review.empty}</p>}
      <div className="review-actions">
        <button data-motion="action" disabled={running} onClick={() => void runReview()}><RefreshCw size={14} />{running ? m.creativeUi.review.running : report ? m.creativeUi.review.rerun : m.creativeUi.review.run}</button>
        <button data-motion="action" onClick={() => void setStatus("changes-requested")}>{m.creativeUi.review.requestChanges}</button>
        <button className="primary-button" data-motion="action" disabled={report?.status === "approved"} onClick={() => void setStatus("approved")}><Check size={14} />{m.creativeUi.review.approve}</button>
      </div>
    </section>
  );
}

export function PublishForm({ detail, content, exporting, enforceChecklist = true, onExport, onPatch }: { detail: CreativeProjectDetail; content: string; exporting: boolean; enforceChecklist?: boolean; onExport(): void; onPatch(patch: Record<string, unknown>): void }) {
  const manifestRecord = (detail.manifest || {}) as Record<string, unknown>;
  const publish = (manifestRecord.publish as Record<string, unknown> | undefined) || {};
  const platform = String(publish.platform || "");
  const summary = String(publish.summary || "");
  const tagsValue = Array.isArray(publish.tags) ? (publish.tags as string[]).join(", ") : "";
  const coverPath = String(publish.coverPath || "");
  const exported = publish.status === "exported";
  const contentReady = content.trim().length >= 300;
  const titleReady = /^#\s+\S+/m.test(content);
  const summaryReady = Boolean(summary.trim());
  const tagsReady = Boolean(tagsValue.trim());
  const coverReady = Boolean(coverPath.trim());
  const requiredMet = Boolean(platform) && contentReady && (!enforceChecklist || (titleReady && summaryReady && tagsReady && coverReady));
  return (
    <section className="publish-form">
      <header><div><span className="eyebrow">Ready</span><h2>{m.creativeUi.publish.title}</h2></div><StatusBadge tone={exported ? "success" : "neutral"}>{exported ? m.creativeUi.publish.exported : m.creativeUi.publish.pendingExport}</StatusBadge></header>
      <p className="publish-note">{m.creativeUi.publish.note}</p>
      <label className="publish-field">{m.creativeUi.publish.platformLabel}
        <Select
          size="rect"
          className="publish-field-select"
          value={platform}
          onChange={(value) => onPatch({ platform: value })}
          placeholder={m.creativeUi.publish.platformPlaceholder}
          options={PLATFORM_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
        />
      </label>
      <label className="publish-field">{m.creativeUi.publish.summary}<textarea rows={2} value={summary} placeholder={m.creativeUi.publish.summaryPlaceholder} onChange={(event) => onPatch({ summary: event.target.value })} /></label>
      <label className="publish-field">{m.creativeUi.publish.tags}<input value={tagsValue} placeholder={m.creativeUi.publish.tagsPlaceholder} onChange={(event) => onPatch({ tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })} /></label>
      <label className="publish-field">{m.creativeUi.publish.cover}<input value={coverPath} placeholder={m.creativeUi.publish.coverPlaceholder} onChange={(event) => onPatch({ coverPath: event.target.value || null })} /></label>
      <ul className="publish-checklist-inline">
        <li className={contentReady ? "passed" : ""}>{contentReady ? <Check size={13} /> : <Clock3 size={13} />}{m.creativeUi.publish.checks.content}</li>
        <li className={platform ? "passed" : ""}>{platform ? <Check size={13} /> : <Clock3 size={13} />}{m.creativeUi.publish.checks.platform}</li>
        {enforceChecklist ? <>
          <li className={titleReady ? "passed" : ""}>{titleReady ? <Check size={13} /> : <Clock3 size={13} />}标题</li>
          <li className={summaryReady ? "passed" : ""}>{summaryReady ? <Check size={13} /> : <Clock3 size={13} />}摘要</li>
          <li className={tagsReady ? "passed" : ""}>{tagsReady ? <Check size={13} /> : <Clock3 size={13} />}标签</li>
          <li className={coverReady ? "passed" : ""}>{coverReady ? <Check size={13} /> : <Clock3 size={13} />}封面</li>
        </> : null}
      </ul>
      <div className="publish-actions">
        <button className="primary-button" disabled={!requiredMet || exporting} onClick={onExport}><Download size={14} />{exporting ? m.creativeUi.publish.exporting : exported ? m.creativeUi.publish.reexport : m.creativeUi.publish.exportNow}</button>
        {!requiredMet ? <small className="publish-block">{m.creativeUi.publish.blocked}</small> : null}
      </div>
    </section>
  );
}

export function WritingStats({ content }: { content: string }) {
  const stats = useMemo(() => {
    const text = content.replace(/[#>*_`\-]/g, "");
    const chars = text.replace(/\s/g, "").length;
    const headings = (content.match(/^#{1,6}\s+/gm) || []).length;
    const paragraphs = content.split(/\n\s*\n/).filter((block) => block.trim()).length;
    const images = (content.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;
    const links = (content.match(/(?<!\!)\[[^\]]+\]\([^)]+\)/g) || []).length;
    const longBlocks = content.split(/\n\s*\n/).filter((block) => block.replace(/\s/g, "").length > 400).length;
    return { chars, headings, paragraphs, images, links, longBlocks };
  }, [content]);
  return (
    <section className="writing-stats" aria-label={m.creativeUi.writingStats.aria}>
      <span><strong>{stats.chars}</strong>{m.creativeUi.stats.chars}</span>
      <span><strong>{stats.headings}</strong>{m.creativeUi.stats.headings}</span>
      <span><strong>{stats.paragraphs}</strong>{m.creativeUi.stats.paragraphs}</span>
      <span><strong>{stats.images}</strong>{m.creativeUi.stats.images}</span>
      <span><strong>{stats.links}</strong>{m.creativeUi.stats.links}</span>
      <span className={stats.longBlocks ? "warn" : ""} title={m.creativeUi.stats.longBlocksTitle}><strong>{stats.longBlocks}</strong>{m.creativeUi.stats.longBlocks}</span>
    </section>
  );
}

export function MaterialsPanel({ detail }: { detail: CreativeProjectDetail }) {
  const manifest = (detail.manifest || {}) as Record<string, unknown>;
  const assets = Array.isArray(manifest.assets) ? (manifest.assets as unknown[]) : [];
  const publish = manifest.publish as Record<string, unknown> | undefined;
  return <>
    <div className="inspector-section"><h3>{m.creativeUi.materials.title}</h3><p>{assets.length ? m.creativeUi.materials.count(assets.length) : m.creativeUi.materials.empty}</p></div>
    <div className="inspector-section"><h3>{m.creativeUi.files.title}</h3>{Object.keys(detail.files || {}).map((file) => <button className="inspector-file" key={file} onClick={() => window.openmind.openPath(`${detail.dir}/${file}`)}><FileText size={14} /><span>{file}</span></button>)}</div>
    {publish ? <div className="inspector-section"><h3>{m.creativeUi.publish.configTitle}</h3><p>{m.creativeUi.publish.platformPrefix}{platformLabel(String(publish.platform || "")) || m.common.notSet}</p><p>{m.creativeUi.publish.statusPrefix}{String(publish.status || "draft")}</p></div> : null}
  </>;
}

export function AiPanel({ addContext }: { addContext(): void }) {
  return <div className="inspector-section"><h3>{m.creativeUi.ai.title}</h3><p>{m.creativeUi.ai.description}</p><button className="primary-button" onClick={addContext}><Bot size={14} />{m.creativeUi.ai.addContext}</button></div>;
}

export function NotesPanel({ detail, onSaved }: { detail: CreativeProjectDetail | null; onSaved(next: CreativeProjectDetail): void }) {
  const ai = useAi();
  const [notes, setNotes] = useState("");
  const [savedNotes, setSavedNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const manifest = (detail?.manifest || {}) as Record<string, unknown>;
  const projectNotes = typeof manifest.notes === "string" ? manifest.notes : "";
  useEffect(() => {
    setNotes(projectNotes);
    setSavedNotes(projectNotes);
  }, [detail?.dir, projectNotes]);
  if (!detail) return <div className="inspector-section"><h3>{m.creativeUi.notes.title}</h3><p>{m.creativeUi.notes.openFirst}</p></div>;
  const dirty = notes !== savedNotes;
  const saveNotes = async () => {
    setSaving(true);
    try {
      const next = await window.openmind.updateCreativeManifest(detail.dir, { notes });
      onSaved(next);
      setSavedNotes(notes);
      ai.notify(m.creativeUi.notes.saved, "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="inspector-section notes-panel">
      <h3>{m.creativeUi.notes.title}</h3>
      <p>{m.creativeUi.notes.description}</p>
      <label>{m.creativeUi.notes.title}
        <textarea
          aria-label={m.creativeUi.notes.title}
          value={notes}
          maxLength={20000}
          placeholder={m.creativeUi.notes.placeholder}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <div className="notes-panel-footer">
        <small>{dirty ? m.creativeUi.notes.unsaved : m.creativeUi.notes.synced}</small>
        <button className="primary-button" disabled={!dirty || saving} onClick={() => void saveNotes()}><Save size={13} />{saving ? m.common.saving : m.creativeUi.notes.save}</button>
      </div>
    </div>
  );
}

export function VersionsPanel({ versions, activeFile, onRefresh }: { versions: CreativeVersion[]; activeFile: string; onRefresh(): void }) {
  if (!activeFile) return <EmptyState title={m.creativeUi.versions.noFileTitle} description={m.creativeUi.versions.noFileDescription} />;
  return <div className="inspector-section"><h3>{m.creativeUi.versions.title(activeFile)}<button className="inspector-refresh" onClick={onRefresh}><RefreshCw size={13} /></button></h3>{versions.length ? versions.map((version) => <button className="version-row" key={version.id} onClick={() => window.openmind.openPath(version.path)}><FileClock size={14} /><div><strong>{version.note}</strong><small>{new Date(version.createdAt).toLocaleString("zh-CN")}</small></div></button>) : <p>{m.creativeUi.versions.empty}</p>}</div>;
}

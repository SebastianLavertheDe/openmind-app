import { useMemo, useState } from "react";
import { Bot, Check, Clock3, Download, LoaderCircle, Sparkles } from "lucide-react";
import type { CreativeProjectDetail, CreativeTopic } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { Select, StatusBadge, Textarea, Input } from "../../design-system/components";
import { MarkdownReader } from "../../components/MarkdownReader";
import {
  type PlatformOption,
  PLATFORM_OPTIONS
} from "./types";

export function TopicWorkspace({ topic, date, createProject, addContext, creatingKey = null }: { topic: CreativeTopic; date: string; createProject(platform?: PlatformOption): void; addContext(): void; creatingKey?: string | null }) {
  const [showPlatform, setShowPlatform] = useState(false);
  return (
    <div className="topic-workspace">
      <header><div><span className="eyebrow">Recommended Topic · {date}</span><h1>{topic.title || m.creative.defaults.unnamedTopic}</h1><p>{topic.platform || m.creative.defaults.topicCreation}{topic.score ? ` · ${m.creativeUi.topic.score(topic.score)}` : ""}</p></div>
        <div><button data-motion="icon" onClick={addContext}><Bot size={14} />{m.creativeUi.topic.askAi}</button><button data-motion="icon" disabled={Boolean(creatingKey)} onClick={() => setShowPlatform((value) => !value)}><Sparkles size={14} />{m.creativeUi.topic.createDraft}</button></div>
      </header>
      {topic.projectDir ? <div className="topic-existing"><Check size={14} />{m.creativeUi.topic.hasDraft}</div> : null}
      {showPlatform ? (
        <div className="topic-platform-picker">
          <strong>{m.creativeUi.topic.pickPlatform}</strong>
          <div className="topic-platform-grid">
            <button data-motion="selection" disabled={Boolean(creatingKey)} aria-busy={creatingKey === "generic" || undefined} onClick={() => createProject()}>{creatingKey === "generic" ? <LoaderCircle size={14} className="spin" /> : null}{creatingKey === "generic" ? m.creativeUi.topic.creatingDraft : m.creativeUi.topic.genericDraft}</button>
            {PLATFORM_OPTIONS.map((option) => <button key={option.id} data-motion="selection" disabled={Boolean(creatingKey)} aria-busy={creatingKey === option.id || undefined} onClick={() => createProject(option)}>{creatingKey === option.id ? <LoaderCircle size={14} className="spin" /> : null}{creatingKey === option.id ? m.creativeUi.topic.creatingDraft : option.label}</button>)}
          </div>
        </div>
      ) : null}
      <section><h2>{m.creativeUi.topic.reasonHeading}</h2><MarkdownReader content={topic.body || m.creativeUi.topic.noBody} /></section>
      <section className="topic-outline"><h2>{m.creativeUi.topic.outline.title}</h2><ol><li>{m.creativeUi.topic.outline.hook}</li><li>{m.creativeUi.topic.outline.explain}</li><li>{m.creativeUi.topic.outline.evidence}</li><li>{m.creativeUi.topic.outline.close}</li></ol></section>
    </div>
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
      <label className="publish-field">{m.creativeUi.publish.summary}<Textarea rows={2} value={summary} placeholder={m.creativeUi.publish.summaryPlaceholder} onChange={(event) => onPatch({ summary: event.target.value })} /></label>
      <label className="publish-field">{m.creativeUi.publish.tags}<Input value={tagsValue} placeholder={m.creativeUi.publish.tagsPlaceholder} onChange={(event) => onPatch({ tags: event.target.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) })} /></label>
      <label className="publish-field">{m.creativeUi.publish.cover}<Input value={coverPath} placeholder={m.creativeUi.publish.coverPlaceholder} onChange={(event) => onPatch({ coverPath: event.target.value || null })} /></label>
      <ul className="publish-checklist-inline">
        <li className={contentReady ? "passed" : ""}>{contentReady ? <Check size={13} /> : <Clock3 size={13} />}{m.creativeUi.publish.checks.content}</li>
        <li className={platform ? "passed" : ""}>{platform ? <Check size={13} /> : <Clock3 size={13} />}{m.creativeUi.publish.checks.platform}</li>
        {enforceChecklist ? <>
          <li className={titleReady ? "passed" : ""}>{titleReady ? <Check size={13} /> : <Clock3 size={13} />}{m.creativeUi.publish.checks.title}</li>
          <li className={summaryReady ? "passed" : ""}>{summaryReady ? <Check size={13} /> : <Clock3 size={13} />}{m.creativeUi.publish.checks.summary}</li>
          <li className={tagsReady ? "passed" : ""}>{tagsReady ? <Check size={13} /> : <Clock3 size={13} />}{m.creativeUi.publish.checks.tags}</li>
          <li className={coverReady ? "passed" : ""}>{coverReady ? <Check size={13} /> : <Clock3 size={13} />}{m.creativeUi.publish.checks.cover}</li>
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

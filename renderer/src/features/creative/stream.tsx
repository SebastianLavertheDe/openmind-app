import { useLocale } from "../../i18n";
import { useEffect, useMemo, useRef } from "react";
import type { CreativeProjectSummary, CreativeTopic } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { EmptyState } from "../../design-system/components";
import {
  type Bucket,
  type StreamFilter,
  BUCKETS,
  bucketForStage,
  firstParagraph,
  formatRelative,
  platformLabel,
  stageLabel
} from "./types";

type StreamItem =
  | { kind: "topic"; topic: CreativeTopic }
  | { kind: "project"; project: CreativeProjectSummary; bucket: Bucket };

const ORDER: Record<Bucket, number> = { topic: 0, drafting: 1, pending: 2, published: 3 };
type TopicWithSource = CreativeTopic & { sourceDate?: string; sourceLabel?: string; sourceFile?: string };

export function FunnelBar({
  counts,
  active,
  onSelect
}: {
  counts: Record<Bucket, number>;
  active: StreamFilter;
  onSelect(value: StreamFilter): void;
}) {
  useLocale();
  return (
    <nav className="creative-funnel" aria-label={m.creativeUi.stream.funnelAria}>
      {BUCKETS.map((bucket) => (
        <span key={bucket.id} className="funnel-step">
          <button
            type="button"
            data-motion="selection"
            className={`funnel-segment${active === bucket.id ? " active" : ""}`}
            aria-pressed={active === bucket.id}
            onClick={() => onSelect(active === bucket.id ? "all" : bucket.id)}
          >
            <span className="funnel-label">{bucket.label}</span>
            <b>{counts[bucket.id]}</b>
          </button>
        </span>
      ))}
    </nav>
  );
}

export function TodayStream({
  topics,
  projects,
  filter,
  search,
  selectedTopic,
  selectedProject,
  selectedTopicFile,
  onOpenTopic,
  onOpenTopicFile,
  onOpenProject
}: {
  topics: CreativeTopic[];
  projects: CreativeProjectSummary[];
  filter: StreamFilter;
  search: string;
  selectedTopic: CreativeTopic | null;
  selectedProject: CreativeProjectSummary | null;
  selectedTopicFile: string;
  onOpenTopic(topic: CreativeTopic): void;
  onOpenTopicFile(path: string): void;
  onOpenProject(project: CreativeProjectSummary): void;
}) {
  const locale = useLocale();
  const listRef = useRef<HTMLDivElement | null>(null);
  const needle = search.trim().toLocaleLowerCase();
  const hasSearch = Boolean(needle);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [filter, search]);

  const visible = useMemo(() => {
    const match = (text: string) => !needle || text.toLocaleLowerCase().includes(needle);
    const topicItems: StreamItem[] = topics
      .filter((topic) => !topic.ignored)
      .filter((topic) => match(`${topic.title || ""} ${topic.body || ""}`))
      .map((topic) => ({ kind: "topic" as const, topic }));
    const projectItems: StreamItem[] = projects
      .filter((project) => match(`${project.topic} ${project.dir}`))
      .map((project) => ({ kind: "project" as const, project, bucket: bucketForStage(project.stage) }));
    return [...topicItems, ...projectItems]
      .filter((item) => filter === "all" || bucketOfItem(item) === filter)
      .sort((a, b) => {
        const diff = ORDER[bucketOfItem(a)] - ORDER[bucketOfItem(b)];
        if (diff !== 0) return diff;
        if (a.kind === "topic" && b.kind === "topic") {
          const dateDiff = topicDate(b.topic).localeCompare(topicDate(a.topic));
          if (dateDiff !== 0) return dateDiff;
          return (b.topic.score || 0) - (a.topic.score || 0);
        }
        if (a.kind === "project" && b.kind === "project") return String(b.project.updatedAt || "").localeCompare(String(a.project.updatedAt || ""));
        return 0;
      });
  }, [filter, needle, projects, topics, locale]);

  const sections = useMemo(() => BUCKETS
    .map((bucket) => ({ bucket, items: visible.filter((item) => bucketOfItem(item) === bucket.id) }))
    .filter((section) => section.items.length), [visible, locale]);

  if (!visible.length) {
    return (
      <div key={`stream:${filter}`} className="creative-stream-transition">
        <EmptyState
          title={filter === "all" ? m.creativeUi.stream.emptyAllTitle : m.creativeUi.stream.emptyFilterTitle}
          description={filter === "all" ? m.creativeUi.stream.emptyAllDesc : m.creativeUi.stream.emptyFilterDesc}
        />
      </div>
    );
  }

  return (
    <div key={`stream:${filter}`} ref={listRef} className="creative-item-list creative-stream creative-stream-transition">
      {sections.map(({ bucket, items }) => (
        <section className="stream-section" key={bucket.id}>
          <header className="stream-section-header"><span>{bucket.label}</span><b>{items.length}</b></header>
          {bucket.id === "topic" ? (
            <TopicDateGroups
              items={items.filter((item): item is Extract<StreamItem, { kind: "topic" }> => item.kind === "topic")}
              forceOpen={hasSearch}
              selectedTopic={selectedTopic}
              selectedTopicFile={selectedTopicFile}
              onOpenTopic={onOpenTopic}
              onOpenTopicFile={onOpenTopicFile}
            />
          ) : items.map((item) => (
            <StreamCard
              key={itemKey(item)}
              item={item}
              active={isActive(item, selectedTopic, selectedProject)}
              onOpen={() => (item.kind === "topic" ? onOpenTopic(item.topic) : onOpenProject(item.project))}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function TopicDateGroups({
  items,
  forceOpen: _forceOpen,
  selectedTopic: _selectedTopic,
  selectedTopicFile,
  onOpenTopic: _onOpenTopic,
  onOpenTopicFile
}: {
  items: Array<Extract<StreamItem, { kind: "topic" }>>;
  forceOpen: boolean;
  selectedTopic: CreativeTopic | null;
  selectedTopicFile: string;
  onOpenTopic(topic: CreativeTopic): void;
  onOpenTopicFile(path: string): void;
}) {
  useLocale();
  const groups = new Map<string, Array<Extract<StreamItem, { kind: "topic" }>>>();
  for (const item of items) {
    const key = `${topicDate(item.topic)}|${topicLabel(item.topic)}`;
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  return (
    <>
      {[...groups.entries()].map(([key, group]) => {
        const [date, label] = key.split("|");
        const sourceFile = String((group[0]?.topic as TopicWithSource | undefined)?.sourceFile || "");
        return (
          <button
            type="button"
            data-motion="selection"
            className={`stream-date-file${sourceFile && selectedTopicFile === sourceFile ? " active" : ""}`}
            key={key}
            disabled={!sourceFile}
            onClick={() => { if (sourceFile) onOpenTopicFile(sourceFile); }}
          >
            <span><strong>{label || date || m.creativeUi.stream.undated}</strong><small>{m.creativeUi.stream.topicManagementFile}</small></span>
            <b>{group.length}</b>
          </button>
        );
      })}
    </>
  );
}

function StreamCard({
  item,
  active,
  onOpen
}: {
  item: StreamItem;
  active: boolean;
  onOpen(): void;
}) {
  useLocale();
  if (item.kind === "topic") {
    const { topic } = item;
    const status = `${platformLabel(topic.platform || "") || m.creative.bucket.topic}${topic.score ? m.creativeUi.stream.recommendScore(topic.score) : ""}${topic.projectDir ? m.creativeUi.stream.hasDraft : ""}`;
    return (
      <button type="button" data-motion="selection" className={`creative-item-row creative-stream-card${active ? " active" : ""}`} onClick={onOpen}>
        <span className="creative-item-main">
          <div>
            <strong>{topic.title || m.creative.defaults.unnamedTopic}</strong>
            <p>{firstParagraph(topic.body || "")}</p>
            <small>{status}</small>
          </div>
        </span>
      </button>
    );
  }
  const { project } = item;
  const platforms = Object.keys(project.platforms || {});
  const stage = String(project.stage || "drafting");
  const bucket = bucketForStage(stage);
  const subtitle = platforms.length ? platforms.map(platformLabel).join("/") : m.creativeUi.stream.noPlatform;
  const status = `${m.creativeUi.stream.completion(project.completion)}${project.updatedAt ? ` · ${formatRelative(project.updatedAt)}` : ""}`;
  return (
    <button type="button" data-motion="selection" className={`creative-item-row creative-stream-card${active ? " active" : ""}`} onClick={onOpen}>
      <span className="creative-item-main">
        <div>
          <strong>{project.topic}</strong>
          <p>{subtitle}</p>
          <small>{status}</small>
        </div>
        <span className="stream-card-status">
          <span className="stream-stage-badge" data-bucket={bucket}>{stageLabel(stage)}</span>
          <span className="completion-ring">{project.completion}%</span>
        </span>
      </span>
    </button>
  );
}

function bucketOfItem(item: StreamItem): Bucket {
  return item.kind === "topic" ? "topic" : item.bucket;
}

function itemKey(item: StreamItem): string {
  return item.kind === "topic" ? `topic:${item.topic.id || item.topic.title}` : `project:${item.project.dir}`;
}

function isActive(item: StreamItem, selectedTopic: CreativeTopic | null, selectedProject: CreativeProjectSummary | null): boolean {
  if (item.kind === "topic") {
    const id = item.topic.id || item.topic.title;
    return Boolean(id) && (selectedTopic?.id || selectedTopic?.title) === id;
  }
  return selectedProject?.dir === item.project.dir;
}

function topicDate(topic: CreativeTopic): string {
  return String((topic as TopicWithSource).sourceDate || "").replace(/\D/g, "").slice(0, 8);
}

function topicLabel(topic: CreativeTopic): string {
  const sourced = topic as TopicWithSource;
  if (sourced.sourceLabel) return sourced.sourceLabel;
  const date = topicDate(topic);
  return date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : "";
}

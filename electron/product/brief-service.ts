import fs from "node:fs";
import path from "node:path";
import { DailyBriefSchema, type ContentItem, type DailyBrief } from "../../shared/contracts";
import { messages } from "../../shared/messages";
import { ContentIndexStore } from "./content-index";
import { statePath, readStateJson } from "./state-directory";
import {
  compactDate,
  countMarkdownLinks,
  extractHeadings,
  firstParagraph,
  readText,
  relatedContent,
  stableId,
  writeJsonAtomic,
  type CreativeApi
} from "./common";

export class BriefService {
  private readonly watchlistPath: string;

  constructor(
    /** ADR-001: the actual openmind root (content dir), not a repo. */
    private readonly openmindRoot: string,
    private readonly contentIndex: ContentIndexStore,
    private readonly creative: CreativeApi,
    /**
     * Root for app-private state. ADR-001 §1.3: this MUST live under userData,
     * not inside openmind. Defaults to the AppPaths state dir keyed by root-id.
     */
    stateRoot?: string
  ) {
    // Fall back to legacy `.openmind` next to openmindRoot only when no userData
    // state root is supplied (keeps older tests working); new construction
    // from main.ts passes the AppPaths state dir.
    this.watchlistPath = statePath(stateRoot ?? openmindRoot, "brief-watchlist.json");
  }

  getDailyBrief(rawDate: string): DailyBrief {
    const date = compactDate(rawDate);
    const inboxItems = this.contentIndex.listItemsForDate(date);
    const summaryPath = path.join(this.openmindRoot, "daily-summary", `${date}_daily_summary.md`);
    const markdown = readText(summaryPath);
    const topicsPayload = this.creative.getCreativeTopics(date);
    const topics = (topicsPayload.topics || []).slice(0, 10).map((topic, index) => {
      const related = relatedContent(topic.title || "", topic.body || "", inboxItems).slice(0, 12);
      return {
        id: stableId(`${date}:topic:${index}:${topic.title || ""}`),
        title: topic.title || messages.brief.unnamedTopic(index),
        summary: firstParagraph(topic.body || ""),
        score: topic.score == null ? null : Math.max(0, Math.min(100, topic.score <= 10 ? topic.score * 10 : topic.score)),
        sourceCount: new Set(related.map((item) => item.source)).size || countMarkdownLinks(topic.body || ""),
        contentIds: related.map((item) => item.id)
      };
    });
    const contribution = new Map<string, number>();
    for (const item of inboxItems) contribution.set(item.source, (contribution.get(item.source) || 0) + 1);
    const important = inboxItems.filter((item) => (item.state.score || 0) >= 80 || item.state.starred);
    const signals = extractHeadings(markdown).slice(0, 8);
    const recommendations = topics.slice(0, 3).map((topic) => messages.brief.recommendation(topic.title));
    const sourcePath = fs.existsSync(summaryPath) ? path.relative(this.openmindRoot, summaryPath) : null;

    return DailyBriefSchema.parse({
      schemaVersion: 1,
      date,
      generatedAt: sourcePath ? fs.statSync(summaryPath).mtime.toISOString() : null,
      sourcePath,
      counts: {
        content: inboxItems.length,
        unread: inboxItems.filter((item) => !item.state.read).length,
        articles: countItemsByKind(inboxItems, "article"),
        posts: countItemsByKind(inboxItems, "post"),
        reddit: countItemsByKind(inboxItems, "reddit"),
        important: important.length,
        topics: topics.length
      },
      topics,
      signals,
      watchlist: this.resolveWatchlist(date, inboxItems, important),
      sourceContribution: [...contribution.entries()]
        .map(([source, count]) => ({ source, count }))
        .sort((left, right) => right.count - left.count),
      recommendations,
      markdown
    });
  }

  getDashboardBrief(rawDate: string): {
    counts: Pick<DailyBrief["counts"], "content" | "unread" | "articles" | "posts" | "reddit">;
    sourceCounts: { articles: number; posts: number; reddit: number };
    topics: DailyBrief["topics"];
  } {
    const date = compactDate(rawDate);
    const inboxItems = this.contentIndex.listItemsForDate(date);
    const topicsPayload = this.creative.getCreativeTopics(date);
    const topics = (topicsPayload.topics || []).slice(0, 5).map((topic, index) => ({
      id: stableId(`${date}:topic:${index}:${topic.title || ""}`),
      title: topic.title || messages.brief.unnamedTopic(index),
      summary: firstParagraph(topic.body || ""),
      score: topic.score == null ? null : Math.max(0, Math.min(100, topic.score <= 10 ? topic.score * 10 : topic.score)),
      sourceCount: countMarkdownLinks(topic.body || ""),
      contentIds: []
    }));
    return {
      counts: {
        content: inboxItems.length,
        unread: inboxItems.filter((item) => !item.state.read).length,
        articles: countItemsByKind(inboxItems, "article"),
        posts: countItemsByKind(inboxItems, "post"),
        reddit: countItemsByKind(inboxItems, "reddit")
      },
      sourceCounts: {
        articles: countSourcesByKind(inboxItems, "article"),
        posts: countSourcesByKind(inboxItems, "post"),
        reddit: countSourcesByKind(inboxItems, "reddit")
      },
      topics
    };
  }

  updateBriefWatchlist(rawDate: string, relativePath: string, add: boolean): DailyBrief {
    const date = compactDate(rawDate);
    const store = this.readWatchlist();
    const inboxItems = this.contentIndex.listItemsForDate(date);
    const important = inboxItems.filter((item) => (item.state.score || 0) >= 80 || item.state.starred);
    if (!store[date]) store[date] = important.slice(0, 6).map((item) => item.path);
    const set = new Set(store[date]);
    if (add) set.add(relativePath); else set.delete(relativePath);
    store[date] = [...set];
    writeJsonAtomic(this.watchlistPath, store);
    return this.getDailyBrief(date);
  }

  private readWatchlist(): Record<string, string[]> {
    const parsed = readStateJson<Record<string, string[]>>(this.watchlistPath, {});
    return parsed && typeof parsed === "object" ? parsed : {};
  }

  private resolveWatchlist(date: string, inboxItems: ContentItem[], important: ContentItem[]): ContentItem[] {
    const store = this.readWatchlist();
    const stored = store[date];
    if (!stored) return important.slice(0, 6);
    const byPath = new Map(inboxItems.map((item) => [item.path, item]));
    const resolved = stored.map((entry) => byPath.get(entry)).filter((item): item is ContentItem => Boolean(item));
    return resolved.slice(0, 12);
  }
}

function countItemsByKind(items: ContentItem[], kind: ContentItem["kind"]): number {
  return items.filter((item) => item.kind === kind).length;
}

function countSourcesByKind(items: ContentItem[], kind: ContentItem["kind"]): number {
  return new Set(items.filter((item) => item.kind === kind).map((item) => item.source).filter(Boolean)).size;
}

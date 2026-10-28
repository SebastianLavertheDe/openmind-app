import type { RssSourceView } from "@shared/rss-contracts";
import { getLocale, messages as m } from "@shared/messages";
import { isRssTopic, RSS_TOPIC_IDS, rssGroupIdentity } from "@shared/rss-categories";

export type SourceFilter = "all" | "enabled" | "disabled" | "failed" | "pending";
export type SourceSort = "default" | "name" | "recent";
export const ALL_CATEGORY = "scope:all";
export const UNGROUPED_CATEGORY = "scope:ungrouped";
export const categoryId = (group: string) => group.trim() ? `group:${group}` : UNGROUPED_CATEGORY;
export const categoryLabel = (group: string) => !group.trim() ? m.rss.ungrouped : isRssTopic(group) ? m.rss.topicLabels[group] : group === "blog" ? m.rss.blog : group === "WeChat" ? m.rss.wechat : group;
export const needsSetup = (source: RssSourceView) => !source.inputUrl || source.lastError?.stage === "configuration";
export function sourceGroups(sources: RssSourceView[]): string[] {
  return [...RSS_TOPIC_IDS, ...new Set(sources.map(source => source.group).filter(group => group.trim() && !isRssTopic(group)))].sort((a, b) => {
    const rank = (value: string) => isRssTopic(value) ? RSS_TOPIC_IDS.indexOf(value) : RSS_TOPIC_IDS.length;
    return rank(a) - rank(b) || a.localeCompare(b, getLocale());
  });
}
export function existingCategory(name: string, groups: string[]): string | undefined {
  const identity = rssGroupIdentity(name);
  return groups.find(group => rssGroupIdentity(group) === identity || rssGroupIdentity(categoryLabel(group)) === identity);
}
export function selectSources(sources: RssSourceView[], query: string, filter: SourceFilter, category: string, sort: SourceSort) {
  const search = query.trim().toLocaleLowerCase();
  const matching = sources.filter(source => `${source.name} ${source.inputUrl} ${source.tags.join(" ")} ${source.group} ${categoryLabel(source.group)}`.toLocaleLowerCase().includes(search) &&
    (filter === "all" || filter === "enabled" && source.enabled || filter === "disabled" && !source.enabled || filter === "failed" && Boolean(source.lastError) || filter === "pending" && needsSetup(source)));
  const ids = [ALL_CATEGORY, ...sourceGroups(sources).map(categoryId), ...(sources.some(source => !source.group.trim()) ? [UNGROUPED_CATEGORY] : [])];
  const selected = ids.includes(category) ? category : ALL_CATEGORY;
  const tabs = ids.map(value => ({ value, label: value === ALL_CATEGORY ? m.rss.all : value === UNGROUPED_CATEGORY ? m.rss.ungrouped : categoryLabel(value.slice(6)) }));
  const rows = matching.filter(source => selected === ALL_CATEGORY || categoryId(source.group) === selected);
  if (sort !== "default") rows.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name, getLocale()) : timestamp(b.lastSyncAt) - timestamp(a.lastSyncAt)) || a.id.localeCompare(b.id));
  return { tabs, rows, selected };
}
function timestamp(value: string | null) { return value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0; }
export function feedLabel(source: RssSourceView) { return source.localFeed.status === "ready" ? m.rss.rssReady : source.localFeed.status === "outdated" ? m.rss.rssOutdated : m.rss.rssMissing; }
export function errorSummary(error: RssSourceView["lastError"]) {
  if (!error) return "";
  const stage = { sync: m.rss.syncFailed, collect: m.rss.collectFailed, configuration: m.rss.configurationFailed, detect: m.rss.detectFailed }[error.stage];
  return `${stage}${error.code === "access-denied" ? ` · ${m.rss.accessDenied}` : ""}`;
}
export function sourceTime(value: string | null) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(getLocale(), { hour12: false }) : m.rss.unknown; }
export function shortUrl(value: string) { try { const url = new URL(value); return `${url.host}${url.pathname === "/" ? "" : url.pathname}`; } catch { return value; } }

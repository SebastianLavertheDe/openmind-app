import { SourcesPage } from "../src/features/sources/SourcesPage";
import { DailyPreferences } from "../src/features/sources/DailyPreferences";
import { FeedbackProvider } from "../src/feedback-context";
import { RssSourceSchema, type RssDocumentView } from "../../shared/rss-contracts";
import type { DesktopApi } from "../../shared/contracts";
import { resolveDailyBriefPreferences } from "../../shared/daily-brief-preferences";

export function installRssCatalogApi(count = 0, customPlatforms = false) {
  let preferences = resolveDailyBriefPreferences({ schemaVersion: 1, revision: 0, text: "", updatedAt: null });
  if (customPlatforms) preferences = { ...preferences, topicPrompt: "Select original product design research.", topicPlatforms: [{ id: "name-a", name: "nameA", prompt: "Select practical experiments." }, { id: "name-b", name: "nameB", prompt: "Select long-form analysis." }] };
  let document: RssDocumentView = { schemaVersion: 1, initialized: true, revision: 1, rootKey: "catalog-root", deletedPresetIds: [], migrationWarnings: [], sources: [
    { id: "design", name: "Design research", group: "product", enabled: true, itemCount: 120, lastSyncAt: "2026-10-28T08:00:00Z", lastError: { stage: "collect", code: "access-denied", message: "HTTP 403 returned by the article endpoint. No login requirement inferred.", retryable: false } },
    { id: "wechat", name: "Agent workflows", group: "agents", enabled: true },
    { id: "custom", name: "A deliberately long research source name that remains accessible in full", group: "Custom OPML research group with a long preserved name", enabled: false },
    { id: "ungrouped", name: "An uncategorized feed", group: "", enabled: true },
    { id: "pending", name: "Source awaiting setup", group: "", enabled: false, inputUrl: "" }
  ].map(row => ({ ...RssSourceSchema.parse({ kind: "feed", revision: 1, inputUrl: `https://${row.id}.example/research/long-path/with-publications.xml`, ...row }), localFeed: { path: `/fixtures/content/.agent/skill-data/rss-article-saver/feeds/${row.id}.xml`, status: row.id === "design" || row.id === "wechat" ? "ready" : row.id === "custom" ? "outdated" : "missing" } })) };
  if (count) document.sources = Array.from({ length: count }, (_, index) => ({ ...document.sources[index % document.sources.length], id: `scale-${index}`, name: `Source ${index}`, inputUrl: `https://source${index}.example/feed` }));
  const api = {
    getDailyBriefPreferences: async () => structuredClone(preferences),
    saveDailyBriefPreferences: async input => { preferences = resolveDailyBriefPreferences({ ...preferences, ...input, revision: preferences.revision + 1 }); return structuredClone(preferences); },
    getRssSources: async () => structuredClone(document),
    getRssSourceEntries: async () => ({ entries: [{ title: "A synthetic local RSS entry", url: "https://design.example/article", publishedAt: "2026-10-28T08:00:00Z" }], total: 1, version: "catalog-1", status: "ready", nextCursor: null, reset: false }),
    getRssSourceRuns: async () => ({ runs: [], nextCursor: null }), getRssSourceRunEvents: async () => ({ events: [], nextAfter: null }),
    detectRssSource: async ({ inputUrl }) => ({ inputUrl, kind: "feed", resolvedFeedUrl: inputUrl, adapterId: "feed", candidates: [] }),
    editRssSource: async input => { document = { ...document, sources: document.sources.map(row => row.id === input.id ? { ...row, ...input, revision: row.revision + 1 } : row) }; return document; },
    removeRssSource: async ({ id }) => { document = { ...document, sources: document.sources.filter(row => row.id !== id) }; return document; },
    importRssOpml: async () => document, openExternal: async () => true
  } satisfies Partial<DesktopApi>;
  Object.defineProperty(window, "openmind", { value: api });
}

export function RssCatalogExample({ embedded, preferences = false }: { embedded: boolean; preferences?: boolean }) {
  return <div className={embedded ? "ui-catalog-rss-embedded" : "ui-catalog-rss"}><FeedbackProvider>{preferences ? <DailyPreferences presentation="settings" /> : <SourcesPage presentation={embedded ? "embedded" : "page"} />}</FeedbackProvider></div>;
}

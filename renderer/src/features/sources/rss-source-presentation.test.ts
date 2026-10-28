import { describe, expect, it } from "vitest";
import { RssSourceSchema, type RssSourceView } from "@shared/rss-contracts";
import { ALL_CATEGORY, UNGROUPED_CATEGORY, categoryId, errorSummary, selectSources } from "./rss-source-presentation";
import { messages as m } from "@shared/messages";
const row = (id: string, group: string, patch: Partial<RssSourceView> = {}): RssSourceView => ({ ...RssSourceSchema.parse({ id, group, name: id, inputUrl: `https://${id}.test/feed`, kind: "feed", enabled: true, revision: 1 }), localFeed: { path: "/fixture.xml", status: "missing" }, ...patch });
describe("RSS classification and status", () => {
  const rows = [row("first", "blog"), row("wechat", "WeChat"), row("custom", "Research", { tags: ["UX"] }), row("empty", "  "), row("all", "all"), row("ungrouped", "ungrouped", { enabled: false })];
  it("preserves custom names and keeps virtual category identities separate", () => {
    const result = selectSources(rows, "", "all", ALL_CATEGORY, "default");
    expect(result.tabs.map(tab => tab.value)).toEqual([ALL_CATEGORY, categoryId("blog"), categoryId("WeChat"), categoryId("all"), categoryId("Research"), categoryId("ungrouped"), UNGROUPED_CATEGORY]);
    expect(selectSources(rows, "", "all", categoryId("all"), "default").rows.map(row => row.id)).toEqual(["all"]);
  });
  it("counts search and status before category and only falls back when the group actually disappears", () => {
    const result = selectSources(rows, "UX", "enabled", categoryId("blog"), "default");
    expect(result.rows).toEqual([]); expect(result.selected).toBe(categoryId("blog"));
    expect(result.tabs.find(tab => tab.value === ALL_CATEGORY)?.count).toBe(1);
    expect(result.tabs.find(tab => tab.value === categoryId("Research"))?.count).toBe(1);
    expect(selectSources(rows.slice(1), "UX", "enabled", categoryId("blog"), "default").selected).toBe(ALL_CATEGORY);
  });
  it("distinguishes setup, old collect errors and sync time instead of generic success", () => {
    const error = { stage: "collect" as const, code: "access-denied", message: "403", retryable: false };
    const sources = [row("a", "", { lastSuccessAt: "2026-10-28", lastSyncAt: "2026-10-01", lastError: error }), row("b", "", { lastSyncAt: "2026-10-27" }), row("c", "", { inputUrl: "" })];
    expect(selectSources(sources, "", "pending", ALL_CATEGORY, "default").rows.map(row => row.id)).toEqual(["c"]);
    expect(selectSources(sources, "", "all", ALL_CATEGORY, "recent").rows.map(row => row.id)).toEqual(["b", "a", "c"]);
    expect(errorSummary(error)).toBe(`${m.rss.collectFailed} · ${m.rss.accessDenied}`);
  });
});

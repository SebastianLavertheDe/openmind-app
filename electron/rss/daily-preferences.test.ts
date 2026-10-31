import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SUMMARY_PROMPT, LEGACY_TOPIC_RULES, DEFAULT_TOPIC_PROMPT, DEFAULT_TOPIC_PLATFORMS, SaveDailyBriefPreferencesSchema } from "../../shared/daily-brief-preferences";
import { dailyPreferencesContext, readDailyPreferences } from "./daily-preferences";
import { RssRepository } from "./rss-repository";

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brief-prompts-")); roots.push(root);
  return { root, file: path.join(root, ".agent/preferences/daily-brief.json"), repository: new RssRepository(root, { schemaVersion: 1, sources: [], adapters: [] }) };
}
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

describe("editable brief rules", () => {
  it.each(["", "My existing preferences"])("resolves legacy defaults without overwriting preferences (%s)", text => {
    const { root, file, repository } = fixture();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const legacy = JSON.stringify({ schemaVersion: 1, revision: 7, text, updatedAt: null });
    fs.writeFileSync(file, legacy);
    expect(repository.preferences()).toEqual({ schemaVersion: 1, revision: 7, text, updatedAt: null, summaryPrompt: DEFAULT_SUMMARY_PROMPT, topicPrompt: DEFAULT_TOPIC_PROMPT, topicPlatforms: DEFAULT_TOPIC_PLATFORMS });
    expect(readDailyPreferences(root)).toEqual(repository.preferences());
    expect(fs.readFileSync(file, "utf8")).toBe(legacy);
  });
  it("uses and displays the legacy defaults for a new content root", () => {
    const { root, repository, file } = fixture();
    expect(repository.preferences()).toMatchObject({ revision: 0, text: "", summaryPrompt: DEFAULT_SUMMARY_PROMPT, topicPrompt: DEFAULT_TOPIC_PROMPT, topicPlatforms: DEFAULT_TOPIC_PLATFORMS });
    expect(dailyPreferencesContext(root)).toContain(DEFAULT_TOPIC_PROMPT);
    expect(fs.existsSync(file)).toBe(false);
  });
  it("persists both editable rules, preserves them for older clients and restores blank entries", () => {
    const { repository, root } = fixture();
    const summaryPrompt = { ...DEFAULT_SUMMARY_PROMPT, instructions: "Use precise English.", fields: { ...DEFAULT_SUMMARY_PROMPT.fields, summary: "Three short sentences." } };
    repository.savePreferences({ revision: 0, text: "Keep my preferences", summaryPrompt, topicPrompt: "Select all design research." });
    expect(readDailyPreferences(root)).toMatchObject({ revision: 1, summaryPrompt, topicPrompt: "Select all design research." });
    expect(dailyPreferencesContext(root)).toContain("Three short sentences.");
    const olderClient = repository.savePreferences({ revision: 1, text: "New extra preferences" });
    expect(olderClient).toMatchObject({ summaryPrompt, topicPrompt: "Select all design research." });
    expect(() => repository.savePreferences({ revision: 1, text: "Stale" })).toThrow(/changed/);
    const restored = repository.savePreferences({ revision: 2, text: "", summaryPrompt: { ...summaryPrompt, fields: { ...summaryPrompt.fields, summary: "  " } }, topicRules: "  " });
    expect(restored.summaryPrompt.instructions).toBe(summaryPrompt.instructions);
    expect(restored.summaryPrompt.fields.summary).toBe(DEFAULT_SUMMARY_PROMPT.fields.summary);
    expect(restored.topicPrompt).toBe(DEFAULT_TOPIC_PROMPT);
  });
  it("rejects renamed, missing and added summary fields at the IPC boundary", () => {
    const fields = { ...DEFAULT_SUMMARY_PROMPT.fields };
    const { summary, ...missing } = fields;
    for (const invalid of [{ ...missing, abstract: summary }, missing, { ...fields, keep: "Always keep" }]) {
      expect(SaveDailyBriefPreferencesSchema.safeParse({ revision: 0, text: "", summaryPrompt: { instructions: "Any requirements", fields: invalid } }).success).toBe(false);
    }
  });
  it("migrates custom legacy rules, simplifies stock defaults and never resurrects removed platforms", () => {
    const { repository, file, root } = fixture();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, revision: 4, text: "Existing preference", updatedAt: null, topicRules: "My custom topic rules" }));
    expect(repository.preferences()).toMatchObject({ topicPrompt: "My custom topic rules", topicPlatforms: DEFAULT_TOPIC_PLATFORMS });
    const blank = repository.savePreferences({ revision: 4, text: "Existing preference", topicPrompt: "", topicPlatforms: [] });
    expect(blank).toMatchObject({ topicPrompt: "", topicPlatforms: [], text: "Existing preference" });
    expect(readDailyPreferences(root)).toEqual(blank);
    expect(dailyPreferencesContext(root)).not.toMatch(/fit_score|@dotey/);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, revision: 5, text: "", updatedAt: null, topicRules: LEGACY_TOPIC_RULES }));
    expect(repository.preferences().topicPrompt).toBe(DEFAULT_TOPIC_PROMPT);
  });
  it("validates arbitrary platform names while rejecting duplicate names and IDs", () => {
    const valid = { revision: 0, text: "", topicPrompt: "Custom rules", topicPlatforms: [{ id: "a", name: "nameA", prompt: "Prompt A" }, { id: "b", name: "nameB", prompt: "Prompt B" }] };
    expect(SaveDailyBriefPreferencesSchema.safeParse(valid).success).toBe(true);
    for (const patch of [{ name: " nameA " }, { id: "a" }, { name: "" }]) expect(SaveDailyBriefPreferencesSchema.safeParse({ ...valid, topicPlatforms: [valid.topicPlatforms[0], { ...valid.topicPlatforms[1], ...patch }] }).success).toBe(false);
  });
});

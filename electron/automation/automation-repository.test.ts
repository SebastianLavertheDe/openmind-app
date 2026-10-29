import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationRuleSchema, type AutomationRule } from "../../shared/automation-contracts";
import { DEFAULT_AUTOMATION_RULES } from "../../shared/automation-defaults";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { AutomationRepository } from "./automation-repository";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-rss-schedules-"));
  roots.push(root);
  const paths = buildAppPaths(path.join(root, "user-data"));
  ensureAppPaths(paths);
  const file = path.join(paths.automation, "registry.json");
  return { paths, file, repository: new AutomationRepository(paths) };
}

function savedRule(id: string, overrides: Partial<AutomationRule> = {}): AutomationRule {
  return AutomationRuleSchema.parse({
    schemaVersion: 1, ...DEFAULT_AUTOMATION_RULES.find(rule => rule.id === id)!,
    enabled: true, timezone: "Asia/Shanghai", createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z", ...overrides
  });
}

describe("RSS schedule migration", () => {
  it.each(["workflow", "pipeline"])("splits a legacy %s into three visible independent tasks and preserves history", legacy => {
    const { paths, file, repository } = fixture();
    const capture = savedRule("rss-capture", {
      name: "RSS 抓取与每日总结", description: "Old combined task",
      target: legacy === "workflow" ? { type: "workflow", id: "rss-to-summary-workflow", versionPolicy: "^1.0.0" }
        : { type: "skill", id: "rss-article-saver", versionPolicy: "^1.0.0" },
      inputs: legacy === "workflow" ? {} : { mode: "pipeline" },
      trigger: { type: "cron", expression: "15 */3 * * *" }, lastTriggeredAt: "2026-10-28T14:00:00.000Z", lastScheduledKey: "old-key"
    });
    const history = {
      schemaVersion: 1, id: "automation-old", ruleId: capture.id, target: capture.target, state: "failed", attempt: 2,
      retryAt: null, childRunId: "old-child", triggerReason: "hourly", scheduledFor: null,
      createdAt: "2026-10-28T14:00:00.000Z", completedAt: "2026-10-28T14:10:00.000Z", error: "Original failure"
    };
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, defaultsSeeded: true, defaultSkillsEnabled: true, rules: [capture], runs: [history] }));

    const rules = repository.listRules();
    expect(rules.map(rule => rule.name)).toEqual(["RSS 更新", "RSS 文章采集", "每日总结"]);
    expect(rules.map(rule => [rule.target.id, rule.inputs])).toEqual([
      ["rss-article-saver", { mode: "sync" }], ["rss-article-saver", { mode: "collect" }], ["daily-article-summarizer", {}]
    ]);
    expect(rules.every(rule => rule.enabled && rule.timezone === capture.timezone)).toBe(true);
    expect(repository.getRule("rss-capture")).toMatchObject({
      id: capture.id, trigger: capture.trigger, timezone: capture.timezone, lastTriggeredAt: capture.lastTriggeredAt,
      lastScheduledKey: capture.lastScheduledKey, createdAt: capture.createdAt, target: { type: "skill", versionPolicy: "^1.0.0" }
    });
    expect(repository.getRule("daily-summary-generation")?.trigger).toEqual({ type: "daily", at: "22:00" });
    expect(repository.listRuns()).toEqual([history]);
    const persisted = fs.readFileSync(file, "utf8");
    expect(new AutomationRepository(paths).listRules()).toEqual(rules);
    expect(fs.readFileSync(file, "utf8")).toBe(persisted);
    repository.removeRule("rss-sync");
    repository.removeRule("daily-summary-generation");
    expect(new AutomationRepository(paths).listRules().map(rule => rule.id)).toEqual(["rss-capture"]);
  });

  it("preserves disabled state and separately configured schedules", () => {
    const { file, repository } = fixture();
    const capture = savedRule("rss-capture", { enabled: false, inputs: { mode: "pipeline", date: "20261028" } });
    const sync = savedRule("rss-sync", { trigger: { type: "interval", everyMinutes: 90 }, enabled: false, timezone: "UTC" });
    const summary = savedRule("daily-summary-generation", { trigger: { type: "daily", at: "19:30" }, timezone: "Europe/London" });
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, defaultsSeeded: true, rules: [capture, sync, summary], runs: [] }));
    expect(repository.getRule("rss-capture")).toMatchObject({ enabled: false, inputs: { mode: "collect", date: "20261028" } });
    expect(repository.getRule(sync.id)).toEqual(sync);
    expect(repository.getRule(summary.id)).toEqual(summary);
    expect(repository.listRules()).toHaveLength(3);
  });

  it("keeps newly split tasks disabled when the combined task was disabled", () => {
    const { file, repository } = fixture();
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, defaultsSeeded: true, rules: [savedRule("rss-capture", { enabled: false, inputs: { mode: "pipeline" } })], runs: [] }));
    expect(repository.listRules()).toHaveLength(3);
    expect(repository.listRules().every(rule => !rule.enabled)).toBe(true);
  });

  it("does not resurrect missing tasks for an already independent collection rule", () => {
    const { file, repository } = fixture();
    const capture = savedRule("rss-capture");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, defaultsSeeded: true, rules: [capture], runs: [] }));
    expect(repository.listRules()).toEqual([capture]);
  });

  it("leaves custom rules and users without defaults untouched", () => {
    const { file, repository } = fixture();
    const custom = savedRule("rss-capture", { target: { type: "skill", id: "custom-fetcher", versionPolicy: "*" } });
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, defaultsSeeded: false, rules: [custom], runs: [] }));
    expect(repository.listRules()).toEqual([custom]);
    expect(repository.getDefaultSkillsEnabled()).toBe(false);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, defaultsSeeded: false, rules: [], runs: [] }));
    expect(repository.listRules()).toEqual([]);
  });

  it("seeds the three independent tasks disabled on fresh opt-in", () => {
    const { repository } = fixture();
    expect(repository.listRules()).toEqual([]);
    repository.setDefaultRulesEnabled(true);
    expect(repository.listRules().slice(0, 3).map(rule => [rule.name, rule.enabled, rule.target.id, rule.inputs])).toEqual([
      ["RSS 更新", false, "rss-article-saver", { mode: "sync" }],
      ["RSS 文章采集", false, "rss-article-saver", { mode: "collect" }],
      ["每日总结", false, "daily-article-summarizer", {}]
    ]);
  });
});

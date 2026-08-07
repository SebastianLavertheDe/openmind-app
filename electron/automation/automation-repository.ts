import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { writeJsonAtomic } from "../lib/fs-utils";
import {
  AUTOMATION_SCHEMA_VERSION,
  AutomationRuleInputSchema,
  AutomationRuleSchema,
  AutomationRunRecordSchema,
  type AutomationRule,
  type AutomationRuleInput,
  type AutomationRunRecord
} from "../../shared/automation-contracts";
import { DEFAULT_AUTOMATION_RULES } from "../../shared/automation-defaults";
import type { AppPaths } from "../paths/app-paths-service";

type AutomationRegistry = {
  schemaVersion: typeof AUTOMATION_SCHEMA_VERSION;
  defaultsSeeded: boolean;
  rules: AutomationRule[];
  runs: AutomationRunRecord[];
};

/** Durable, app-private automation configuration and execution history. */
export class AutomationRepository {
  private readonly filePath: string;

  constructor(paths: AppPaths, filePath = path.join(paths.automation, "registry.json")) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  listRules(): AutomationRule[] { return this.read().rules.map((rule) => ({ ...rule })); }

  /** Seed policy once; subsequent deletes/edits are user-owned durable state. */
  ensureDefaultRules(): AutomationRule[] {
    const registry = this.read();
    if (registry.defaultsSeeded) return registry.rules.map((rule) => ({ ...rule }));
    const existing = new Set(registry.rules.map((rule) => rule.id));
    const seeded = DEFAULT_AUTOMATION_RULES.filter((rule) => !existing.has(rule.id)).map((input) => {
      const now = new Date().toISOString();
      return AutomationRuleSchema.parse({
        schemaVersion: AUTOMATION_SCHEMA_VERSION,
        ...AutomationRuleInputSchema.parse(input),
        lastTriggeredAt: null,
        lastScheduledKey: null,
        createdAt: now,
        updatedAt: now
      });
    });
    this.write({ ...registry, defaultsSeeded: true, rules: [...registry.rules, ...seeded] });
    return [...registry.rules, ...seeded].map((rule) => ({ ...rule }));
  }

  getRule(id: string): AutomationRule | undefined { return this.read().rules.find((rule) => rule.id === id); }

  saveRule(rawInput: AutomationRuleInput): AutomationRule {
    const input = AutomationRuleInputSchema.parse(rawInput);
    const registry = this.read();
    const current = registry.rules.find((rule) => rule.id === input.id);
    const now = new Date().toISOString();
    const rule = AutomationRuleSchema.parse({
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      ...input,
      ...(current ? { lastTriggeredAt: current.lastTriggeredAt, lastScheduledKey: current.lastScheduledKey, createdAt: current.createdAt } : { lastTriggeredAt: null, lastScheduledKey: null, createdAt: now }),
      updatedAt: now
    });
    this.write({ ...registry, rules: current ? registry.rules.map((item) => item.id === rule.id ? rule : item) : [...registry.rules, rule] });
    return { ...rule };
  }

  removeRule(id: string): boolean {
    const registry = this.read();
    const rules = registry.rules.filter((rule) => rule.id !== id);
    if (rules.length === registry.rules.length) return false;
    this.write({ ...registry, rules });
    return true;
  }

  markTriggered(ruleId: string, at: string, scheduledKey: string | null): AutomationRule {
    const registry = this.read();
    const rule = registry.rules.find((item) => item.id === ruleId);
    if (!rule) throw new Error(`Automation Rule 不存在：${ruleId}`);
    const next = AutomationRuleSchema.parse({ ...rule, lastTriggeredAt: at, lastScheduledKey: scheduledKey, updatedAt: at });
    this.write({ ...registry, rules: registry.rules.map((item) => item.id === ruleId ? next : item) });
    return { ...next };
  }

  listRuns(ruleId?: string): AutomationRunRecord[] {
    return this.read().runs
      .filter((run) => !ruleId || run.ruleId === ruleId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((run) => ({ ...run }));
  }

  getRun(id: string): AutomationRunRecord | undefined { return this.read().runs.find((run) => run.id === id); }

  createRun(input: Omit<AutomationRunRecord, "schemaVersion" | "id">): AutomationRunRecord {
    const registry = this.read();
    const run = AutomationRunRecordSchema.parse({ schemaVersion: AUTOMATION_SCHEMA_VERSION, id: `automation-${crypto.randomUUID()}`, ...input });
    this.write({ ...registry, runs: [...registry.runs, run].slice(-500) });
    return { ...run };
  }

  updateRun(id: string, patch: Partial<AutomationRunRecord>): AutomationRunRecord {
    const registry = this.read();
    const current = registry.runs.find((run) => run.id === id);
    if (!current) throw new Error(`Automation Run 不存在：${id}`);
    const next = AutomationRunRecordSchema.parse({ ...current, ...patch });
    this.write({ ...registry, runs: registry.runs.map((run) => run.id === id ? next : run) });
    return { ...next };
  }

  private read(): AutomationRegistry {
    if (!fs.existsSync(this.filePath)) return { schemaVersion: AUTOMATION_SCHEMA_VERSION, defaultsSeeded: false, rules: [], runs: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<AutomationRegistry>;
      if (raw.schemaVersion !== AUTOMATION_SCHEMA_VERSION || !Array.isArray(raw.rules) || !Array.isArray(raw.runs)) throw new Error("Automation registry schema mismatch");
      const rules = raw.rules.map((rule) => AutomationRuleSchema.parse(rule));
      const runs = raw.runs.map((run) => AutomationRunRecordSchema.parse(run));
      if (new Set(rules.map((rule) => rule.id)).size !== rules.length) throw new Error("Automation Rule ID 重复");
      return { schemaVersion: AUTOMATION_SCHEMA_VERSION, defaultsSeeded: raw.defaultsSeeded === true, rules, runs };
    } catch (error) {
      throw new Error(`Automation registry 无法读取，拒绝覆盖现有状态：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private write(registry: AutomationRegistry): void {
    const normalized = {
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      defaultsSeeded: registry.defaultsSeeded,
      rules: registry.rules.map((rule) => AutomationRuleSchema.parse(rule)),
      runs: registry.runs.map((run) => AutomationRunRecordSchema.parse(run)).slice(-500)
    } satisfies AutomationRegistry;
    writeJsonAtomic(this.filePath, normalized);
    try { fs.chmodSync(this.filePath, 0o600); } catch { /* Windows may not expose POSIX modes. */ }
  }
}

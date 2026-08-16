import type { BrokerRunRecord, BrokerRunEvent, SkillRunRequest, WorkflowRunRecord, WorkflowStartRequest } from "../../shared/execution-contracts";
import {
  AutomationRuleInputSchema,
  AutomationRuleSchema,
  AutomationRunRecordSchema,
  type AutomationRule,
  type AutomationRuleInput,
  type AutomationRunRecord,
  type AutomationScheduleSnapshot,
  type AutomationTarget
} from "../../shared/automation-contracts";
import { AutomationRepository } from "./automation-repository";
import { detectAutomationEnvironment, type AutomationEnvironment } from "./automation-environment";
import { AutomationLeader } from "./automation-leader";

type SkillSubmitter = (request: SkillRunRequest) => BrokerRunRecord;
type WorkflowSubmitter = (request: WorkflowStartRequest) => WorkflowRunRecord;
type SkillReader = (runId: string) => BrokerRunRecord;
type WorkflowReader = (runId: string) => WorkflowRunRecord;
type ChildCanceller = (runId: string) => Promise<boolean>;

const DATE_INPUT_TARGETS = new Set([
  "rss-article-saver",
  "rss-to-summary-workflow",
  "daily-article-summarizer",
  "daily-topic-selector",
  "reddit-fetcher"
]);

export type AutomationSchedulerOptions = {
  repository: AutomationRepository;
  rootGeneration: number;
  submitSkill: SkillSubmitter;
  submitWorkflow: WorkflowSubmitter;
  readSkill: SkillReader;
  readWorkflow: WorkflowReader;
  cancelSkill: ChildCanceller;
  cancelWorkflow: ChildCanceller;
  resolveTargetVersion?: (target: AutomationTarget) => string | undefined;
  leader?: AutomationLeader;
  fileFingerprint?: (paths: readonly string[]) => string | undefined;
  environment?: () => AutomationEnvironment;
  now?: () => Date;
  tickMs?: number;
};

/** Durable rule scheduler. Every actual execution is delegated to Broker/Workflow. */
export class AutomationScheduler {
  private readonly now: () => Date;
  private readonly tickMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private firstTick = true;
  private readonly leader?: AutomationLeader;
  private readonly fileFingerprint?: (paths: readonly string[]) => string | undefined;
  private readonly environment: () => AutomationEnvironment;

  constructor(private readonly options: AutomationSchedulerOptions) {
    this.now = options.now || (() => new Date());
    this.tickMs = options.tickMs || 30_000;
    this.leader = options.leader;
    this.fileFingerprint = options.fileFingerprint;
    this.environment = options.environment || detectAutomationEnvironment;
  }

  start(): void {
    if (this.timer) return;
    this.options.repository.ensureDefaultRules();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    if (typeof this.timer === "object" && "unref" in this.timer) this.timer.unref();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.leader?.release();
  }

  listRules(): AutomationRule[] { return this.options.repository.listRules(); }
  getRule(id: string): AutomationRule {
    const rule = this.options.repository.getRule(id);
    if (!rule) throw new Error(`Automation Rule 不存在：${id}`);
    return rule;
  }

  saveRule(rawInput: AutomationRuleInput): AutomationRule {
    const input = AutomationRuleInputSchema.parse(rawInput);
    rejectSecretLikeValues(input.inputs || {});
    assertTimezone(input.timezone || "UTC");
    if (input.trigger.type === "cron") validateCron(input.trigger.expression);
    if (input.target.type === "workflow" && (Object.keys(input.providerBindings || {}).length || input.externalExportBindingIds.length)) {
      throw new Error("Workflow Automation Rule 不能直接绑定 Provider 或外部导出位置。 ");
    }
    return this.options.repository.saveRule(input);
  }

  removeRule(id: string): boolean {
    const active = this.options.repository.listRuns(id).some((run) => run.state === "queued" || run.state === "running");
    if (active) throw new Error("Automation Rule 仍有运行中的任务，请先停止后删除。 ");
    return this.options.repository.removeRule(id);
  }

  listRuns(ruleId?: string): AutomationRunRecord[] { return this.options.repository.listRuns(ruleId); }

  listSchedules(at = this.now()): AutomationScheduleSnapshot[] {
    return this.listRules().map((rule) => ({
      ruleId: rule.id,
      nextRunAt: nextRunAt(rule, at),
      blockedReason: rule.enabled ? null : "规则已禁用"
    }));
  }

  async runNow(id: string): Promise<AutomationRunRecord> {
    const rule = this.getRule(id);
    if (!rule.enabled) throw new Error("Automation Rule 已禁用。 ");
    const at = this.now();
    // A retry waits in `queued` until its backoff expires. It is not an
    // executing child, so an explicit user request to run now should advance
    // that durable retry instead of being reported as an overlap-skipped
    // second run. Keep the existing record so its attempt/history remain
    // intact. Likewise, a second manual click while a child is genuinely
    // running should surface that active record to the caller instead of
    // creating a misleading terminal `skipped` record.
    const runs = this.options.repository.listRuns(rule.id);
    const running = rule.concurrencyPolicy === "skip"
      ? runs.find((run) => run.state === "running")
      : undefined;
    if (running) return running;
    const queuedRetry = rule.concurrencyPolicy === "skip"
      ? runs.find((run) => run.state === "queued" && !run.childRunId)
      : undefined;
    if (queuedRetry) {
      const ready = this.options.repository.updateRun(queuedRetry.id, { retryAt: null });
      await this.launch(ready, rule, at);
      return this.options.repository.getRun(ready.id)!;
    }
    return this.trigger(rule, "manual", null, null, at);
  }

  async tick(at = this.now()): Promise<void> {
    if (this.leader && !this.leader.tryAcquire(at)) return;
    await this.reconcile(at);
    const first = this.firstTick;
    for (const rule of this.listRules()) {
      if (!rule.enabled) continue;
      const due = this.due(rule, at);
      if (!due) continue;
      if (first && rule.missedRunPolicy === "skip" && due.missed) {
        this.options.repository.markTriggered(rule.id, at.toISOString(), due.key);
        continue;
      }
      await this.trigger(rule, due.reason, due.scheduledFor, due.key, at);
    }
    this.firstTick = false;
    await this.launchReady(at);
  }

  /** Called for every Broker event; completion triggers are data-driven. */
  async handleRunEvent(event: BrokerRunEvent): Promise<void> {
    if (event.state !== "succeeded") return;
    const at = this.now();
    if (this.leader && !this.leader.tryAcquire(at)) return;
    await this.reconcile(at);
    let child: BrokerRunRecord;
    try { child = this.options.readSkill(event.runId); }
    catch { return; }
    // Do not recursively fan out automation-generated Skill completions. A
    // completion graph is otherwise capable of creating an unbounded cycle;
    // manual, scheduled and Workflow-owned child runs remain triggerable.
    if (child.request.trigger.type === "automation") return;
    await this.triggerCompletedRules(child.request.skillId, null, child.id, at);
  }

  /** Workflow completion is delivered separately because WorkflowEngine owns its record. */
  async handleWorkflowRunEvent(run: WorkflowRunRecord): Promise<void> {
    if (!isTerminalWorkflowState(run.state)) return;
    const at = this.now();
    if (this.leader && !this.leader.tryAcquire(at)) return;
    await this.reconcile(at);
    if (run.state !== "succeeded") return;
    await this.triggerCompletedRules(null, run.workflowSkillId, run.id, at);
  }

  private async triggerCompletedRules(skillId: string | null, workflowSkillId: string | null, completionId: string, at: Date): Promise<void> {
    for (const rule of this.listRules()) {
      if (!rule.enabled || rule.trigger.type !== "run-completed") continue;
      if (workflowSkillId === null && rule.trigger.workflowSkillId) continue;
      if (workflowSkillId !== null && rule.trigger.skillId) continue;
      if (rule.trigger.skillId && rule.trigger.skillId !== skillId) continue;
      if (rule.trigger.workflowSkillId && rule.trigger.workflowSkillId !== workflowSkillId) continue;
      if (rule.lastScheduledKey === completionId) continue;
      await this.trigger(rule, `run-completed:${completionId}`, at, completionId, at);
    }
  }

  private due(rule: AutomationRule, at: Date): Due | null {
    return dueFor(rule, at, this.firstTick, this.fileFingerprint, this.environment);
  }

  private async trigger(rule: AutomationRule, reason: string, scheduledFor: Date | null, key: string | null, at: Date): Promise<AutomationRunRecord> {
    this.options.repository.markTriggered(rule.id, at.toISOString(), key);
    const active = this.options.repository.listRuns(rule.id).filter((run) => run.state === "queued" || run.state === "running");
    if (active.length && rule.concurrencyPolicy === "skip") {
      return this.options.repository.createRun({
        ruleId: rule.id,
        target: rule.target,
        state: "skipped",
        attempt: 0,
        retryAt: null,
        childRunId: null,
        triggerReason: `${reason}:overlap-skipped`,
        scheduledFor: scheduledFor?.toISOString() || null,
        createdAt: at.toISOString(),
        completedAt: at.toISOString(),
        error: "已有 Automation Run 正在执行。"
      });
    }
    if (active.length && rule.concurrencyPolicy === "replace") {
      await Promise.all(active.filter((run) => run.childRunId).map((run) => this.cancelChild(rule, run.childRunId!)));
    }
    const created = this.options.repository.createRun({
      ruleId: rule.id,
      target: rule.target,
      state: "queued",
      attempt: 0,
      retryAt: null,
      childRunId: null,
      triggerReason: reason,
      scheduledFor: scheduledFor?.toISOString() || null,
      createdAt: at.toISOString(),
      completedAt: null,
      error: null
    });
    if (!(active.length && rule.concurrencyPolicy === "queue")) await this.launch(created, rule, at);
    return this.options.repository.getRun(created.id)!;
  }

  private async reconcile(at: Date): Promise<void> {
    for (const record of this.options.repository.listRuns()) {
      if (record.state !== "running" || !record.childRunId) continue;
      const rule = this.options.repository.getRule(record.ruleId);
      if (!rule) {
        this.options.repository.updateRun(record.id, { state: "blocked", completedAt: at.toISOString(), error: "关联 Automation Rule 已不存在。" });
        continue;
      }
      let child: BrokerRunRecord | WorkflowRunRecord;
      try {
        child = this.readChild(rule, record.childRunId);
      } catch (error) {
        this.options.repository.updateRun(record.id, {
          state: "blocked",
          completedAt: at.toISOString(),
          retryAt: null,
          error: `Automation 子 Run 不可读取：${error instanceof Error ? error.message : String(error)}`.slice(0, 2000)
        });
        continue;
      }
      if (!["succeeded", "failed", "timed_out", "cancelled"].includes(child.state)) continue;
      if (child.state !== "succeeded" && child.state !== "cancelled" && record.attempt <= rule.retryPolicy.maxAttempts) {
        this.options.repository.updateRun(record.id, {
          state: "queued",
          childRunId: null,
          retryAt: new Date(at.getTime() + rule.retryPolicy.backoffMs).toISOString(),
          error: child.error || "Automation 子 Run 失败，等待重试。"
        });
        continue;
      }
      this.options.repository.updateRun(record.id, {
        state: child.state === "succeeded" ? "succeeded" : child.state === "cancelled" ? "cancelled" : "failed",
        completedAt: at.toISOString(),
        retryAt: null,
        error: child.state === "succeeded" || child.state === "cancelled" ? null : child.error || "Automation 子 Run 失败。"
      });
    }
  }

  private async launchReady(at: Date): Promise<void> {
    for (const record of this.options.repository.listRuns()) {
      if (record.state !== "queued" || (record.retryAt && new Date(record.retryAt).getTime() > at.getTime())) continue;
      const rule = this.options.repository.getRule(record.ruleId);
      if (!rule) continue;
      const active = this.options.repository.listRuns(rule.id).some((run) => run.id !== record.id && run.state === "running");
      if (active && rule.concurrencyPolicy === "queue") continue;
      if (active && rule.concurrencyPolicy === "skip") {
        this.options.repository.updateRun(record.id, { state: "skipped", completedAt: at.toISOString(), error: "已有 Automation Run 正在执行。" });
        continue;
      }
      await this.launch(record, rule, at);
    }
  }

  private async launch(record: AutomationRunRecord, rule: AutomationRule, at: Date): Promise<void> {
    try {
      const version = rule.target.versionPolicy === "*"
        ? undefined
        : this.options.resolveTargetVersion?.(rule.target);
      if (rule.target.versionPolicy !== "*" && !version) throw new Error(`Automation Rule 的 Skill version policy 未解析：${rule.target.id}@${rule.target.versionPolicy}`);
      const inputs = materializeInputs(rule, at);
      const child = rule.target.type === "skill"
        ? this.options.submitSkill({
          skillId: rule.target.id,
          ...(version ? { version } : {}),
          inputs,
          providerBindings: rule.providerBindings,
          externalExportBindingIds: rule.externalExportBindingIds,
          trigger: { type: "automation", ruleId: rule.id },
          rootGeneration: this.options.rootGeneration
        })
        : this.options.submitWorkflow({
          skillId: rule.target.id,
          ...(version ? { version } : {}),
          inputs,
          providerBindings: rule.providerBindings,
          rootGeneration: this.options.rootGeneration
        });
      this.options.repository.updateRun(record.id, {
        state: "running",
        attempt: record.attempt + 1,
        retryAt: null,
        childRunId: child.id,
        error: null
      });
      // A Workflow can fail while its synchronous start path is still
      // returning. Its terminal event may arrive before the parent record has
      // a childRunId, so reconcile once after that durable linkage exists.
      await this.reconcile(at);
    } catch (error) {
      this.options.repository.updateRun(record.id, {
        state: "blocked",
        completedAt: at.toISOString(),
        retryAt: null,
        error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000)
      });
    }
  }

  private readChild(rule: AutomationRule, childRunId: string): BrokerRunRecord | WorkflowRunRecord {
    return rule.target.type === "skill" ? this.options.readSkill(childRunId) : this.options.readWorkflow(childRunId);
  }

  private cancelChild(rule: AutomationRule, childRunId: string): Promise<boolean> {
    return rule.target.type === "skill" ? this.options.cancelSkill(childRunId) : this.options.cancelWorkflow(childRunId);
  }
}

function isTerminalWorkflowState(state: WorkflowRunRecord["state"]): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

function materializeInputs(rule: AutomationRule, at: Date): Record<string, unknown> {
  if (Object.prototype.hasOwnProperty.call(rule.inputs, "date") || !DATE_INPUT_TARGETS.has(rule.target.id)) {
    return { ...rule.inputs };
  }
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return { ...rule.inputs, date: `${year}${month}${day}` };
}

type Due = { reason: string; scheduledFor: Date; key: string; missed: boolean };

function dueFor(
  rule: AutomationRule,
  at: Date,
  firstTick: boolean,
  fileFingerprint?: (paths: readonly string[]) => string | undefined,
  environment: () => AutomationEnvironment = detectAutomationEnvironment
): Due | null {
  const trigger = rule.trigger;
  if (trigger.type === "run-completed") return null;
  if (trigger.type === "app-start") {
    return firstTick && rule.lastScheduledKey !== "app-start" ? { reason: "app-start", scheduledFor: at, key: "app-start", missed: false } : null;
  }
  if (trigger.type === "interval") {
    const last = rule.lastTriggeredAt ? Date.parse(rule.lastTriggeredAt) : NaN;
    const due = !Number.isFinite(last) || at.getTime() - last >= trigger.everyMinutes * 60_000;
    return due ? { reason: `interval:${trigger.everyMinutes}m`, scheduledFor: at, key: `interval:${Math.floor(at.getTime() / (trigger.everyMinutes * 60_000))}`, missed: false } : null;
  }
  const parts = zonedParts(at, rule.timezone);
  const key = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}-${parts.minute}`;
  if (trigger.type === "hourly") {
    const hourKey = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}`;
    const due = parts.minute === 0 && rule.lastScheduledKey !== hourKey;
    return due ? { reason: "hourly", scheduledFor: at, key: hourKey, missed: false } : null;
  }
  if (trigger.type === "daily") {
    const due = `${parts.hour}:${parts.minute}` >= trigger.at && rule.lastScheduledKey !== key.slice(0, 10);
    return due ? { reason: `daily:${trigger.at}`, scheduledFor: at, key: key.slice(0, 10), missed: `${parts.hour}:${parts.minute}` > trigger.at } : null;
  }
  if (trigger.type === "weekly") {
    const dateKey = `weekly:${parts.year}-${parts.month}-${parts.day}`;
    const time = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
    const due = trigger.daysOfWeek.includes(parts.weekday) && time >= trigger.at && rule.lastScheduledKey !== dateKey;
    return due ? { reason: `weekly:${trigger.daysOfWeek.join(",")}:${trigger.at}`, scheduledFor: at, key: dateKey, missed: time > trigger.at } : null;
  }
  if (trigger.type === "file-change") {
    const fingerprint = fileFingerprint?.(trigger.paths);
    if (!fingerprint) return null;
    const last = rule.lastTriggeredAt ? Date.parse(rule.lastTriggeredAt) : NaN;
    if (Number.isFinite(last) && at.getTime() - last < trigger.debounceMinutes * 60_000) return null;
    const changeKey = `file-change:${fingerprint}`;
    return rule.lastScheduledKey === changeKey ? null : { reason: `file-change:${trigger.paths.length}`, scheduledFor: at, key: changeKey, missed: false };
  }
  if (trigger.type === "network" || trigger.type === "power") {
    const state = trigger.type === "network" ? environment().network : environment().power;
    if (state === "unknown" || state !== trigger.state) return null;
    const bucket = Math.floor(at.getTime() / (trigger.everyMinutes * 60_000));
    const conditionKey = `${trigger.type}:${trigger.state}:${bucket}`;
    return rule.lastScheduledKey === conditionKey ? null : { reason: `${trigger.type}:${trigger.state}`, scheduledFor: at, key: conditionKey, missed: false };
  }
  const due = matchesCron(trigger.expression, parts) && rule.lastScheduledKey !== key;
  return due ? { reason: `cron:${trigger.expression}`, scheduledFor: at, key, missed: false } : null;
}

function nextRunAt(rule: AutomationRule, from: Date): string | null {
  if (!rule.enabled || rule.trigger.type === "run-completed") return null;
  if (rule.trigger.type === "app-start") return rule.lastScheduledKey === "app-start" ? null : from.toISOString();
  if (rule.trigger.type === "interval") {
    const last = rule.lastTriggeredAt ? Date.parse(rule.lastTriggeredAt) : NaN;
    if (!Number.isFinite(last)) return from.toISOString();
    return new Date(Math.max(from.getTime(), last + rule.trigger.everyMinutes * 60_000)).toISOString();
  }
  if (rule.trigger.type === "file-change") return null;
  if (rule.trigger.type === "network" || rule.trigger.type === "power") {
    const last = rule.lastTriggeredAt ? Date.parse(rule.lastTriggeredAt) : NaN;
    const every = rule.trigger.everyMinutes * 60_000;
    return Number.isFinite(last) ? new Date(Math.max(from.getTime(), last + every)).toISOString() : from.toISOString();
  }
  const start = new Date(from);
  start.setSeconds(0, 0);
  if (start.getTime() < from.getTime()) start.setMinutes(start.getMinutes() + 1);
  if (rule.trigger.type === "hourly") {
    const parts = zonedParts(start, rule.timezone);
    return (parts.minute === 0 ? start : new Date(start.getTime() + (60 - parts.minute) * 60_000)).toISOString();
  }
  for (let offset = 0; offset <= 8 * 24 * 60; offset++) {
    const candidate = new Date(start.getTime() + offset * 60_000);
    const parts = zonedParts(candidate, rule.timezone);
    if (rule.trigger.type === "daily" && `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}` === rule.trigger.at) return candidate.toISOString();
    if (rule.trigger.type === "weekly" && rule.trigger.daysOfWeek.includes(parts.weekday) && `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}` === rule.trigger.at) return candidate.toISOString();
    if (rule.trigger.type === "cron" && matchesCron(rule.trigger.expression, parts)) return candidate.toISOString();
  }
  return null;
}

function zonedParts(date: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const values = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const weekday = new Date(Date.UTC(values.year, values.month - 1, values.day)).getUTCDay();
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, weekday };
}

function matchesCron(expression: string, parts: ReturnType<typeof zonedParts>): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("Cron 必须包含 5 个字段：分 时 日 月 周。 ");
  const values = [parts.minute, parts.hour, parts.day, parts.month, parts.weekday];
  return fields.every((field, index) => matchesCronField(field, values[index], index === 0 ? 0 : index === 1 ? 0 : index === 2 ? 1 : index === 3 ? 1 : 0, index === 0 ? 59 : index === 1 ? 23 : index === 2 ? 31 : index === 3 ? 12 : 7));
}

function matchesCronField(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") return true;
  return field.split(",").some((part) => {
    const [base, stepText] = part.split("/");
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isInteger(step) || step < 1) return false;
    if (base === "*") return value >= min && value <= max && (value - min) % step === 0;
    if (base.includes("-")) {
      const [start, end] = base.split("-").map(Number);
      return Number.isInteger(start) && Number.isInteger(end) && value >= start && value <= end && (value - start) % step === 0;
    }
    const exact = Number(base);
    return Number.isInteger(exact) && exact === value;
  });
}

function validateCron(expression: string): void {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5 || fields.some((field) => !/^[0-9*,\-/]+$/.test(field))) throw new Error("Cron 表达式格式无效。 ");
  matchesCron(expression, zonedParts(new Date(), "UTC"));
}

function assertTimezone(timezone: string): void {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); }
  catch { throw new Error(`Timezone 无效：${timezone}`); }
}

function rejectSecretLikeValues(values: Record<string, unknown>): void {
  const dangerous = /(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|password|cookie|secret)/i;
  const visit = (value: unknown, prefix: string) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (dangerous.test(key)) throw new Error(`Automation 输入不能直接保存 Secret：${prefix}${key}`);
      visit(child, `${prefix}${key}.`);
    }
  };
  visit(values, "");
}

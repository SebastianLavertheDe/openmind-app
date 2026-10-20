import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { BrokerRunRecordSchema, EXECUTION_SCHEMA_VERSION, WorkflowRunRecordSchema, type BrokerRunEvent, type BrokerRunRecord, type WorkflowRunRecord } from "../../shared/execution-contracts";
import { AutomationRepository } from "./automation-repository";
import { AutomationScheduler } from "./automation-scheduler";
import type { AutomationEnvironment } from "./automation-environment";
import { DEFAULT_AUTOMATION_RULES } from "../../shared/automation-defaults";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("AutomationRepository", () => {
  it("persists rules and keeps scheduler metadata across reload", () => {
    const root = makeRoot();
    const paths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    const repository = new AutomationRepository(paths);
    repository.saveRule({
      id: "daily-brief",
      name: "Daily Brief",
      target: { type: "skill", id: "daily-article-summarizer", versionPolicy: "*" },
      trigger: { type: "daily", at: "08:00" },
      timezone: "UTC"
    });
    repository.markTriggered("daily-brief", "2026-08-05T08:00:00.000Z", "2026-08-05");

    const reloaded = new AutomationRepository(paths);
    expect(reloaded.getRule("daily-brief")).toMatchObject({ lastScheduledKey: "2026-08-05", lastTriggeredAt: "2026-08-05T08:00:00.000Z" });
  });

  it("creates defaults only on opt-in, persists opt-out and restores them on re-enable", () => {
    const root = makeRoot();
    const paths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    const repository = new AutomationRepository(paths);
    expect(repository.getDefaultSkillsEnabled()).toBe(false);
    expect(repository.listRules()).toEqual([]);
    repository.setDefaultRulesEnabled(true);
    expect(repository.listRules().map((rule) => rule.id)).toEqual(["rss-capture", "x-following-capture", "reddit-capture", "daily-topic-generation"]);
    expect(repository.removeRule("rss-capture")).toBe(true);
    const reloaded = new AutomationRepository(paths);
    expect(reloaded.getDefaultSkillsEnabled()).toBe(true);
    expect(reloaded.listRules().map((rule) => rule.id)).toEqual(["x-following-capture", "reddit-capture", "daily-topic-generation"]);
    reloaded.setDefaultRulesEnabled(false);
    expect(new AutomationRepository(paths).getDefaultSkillsEnabled()).toBe(false);
    expect(reloaded.listRules().every((rule) => !rule.enabled)).toBe(true);
    reloaded.setDefaultRulesEnabled(true);
    expect(reloaded.listRules()).toHaveLength(4);
    expect(reloaded.listRules().every((rule) => rule.enabled)).toBe(true);
  });

  it("preserves old seeded settings without inspecting the Skill store", () => {
    const paths = buildAppPaths(path.join(makeRoot(), "user-data"));
    ensureAppPaths(paths);
    fs.writeFileSync(path.join(paths.automation, "registry.json"), JSON.stringify({
      schemaVersion: 1, defaultsSeeded: true, rules: [], runs: []
    }));
    expect(new AutomationRepository(paths).getDefaultSkillsEnabled()).toBe(true);
  });
});

describe("AutomationScheduler", () => {
  it("starts without installing or seeding default jobs", async () => {
    const harness = createHarness(new Date("2026-08-05T09:00:00.000Z"));
    harness.scheduler.start();
    try {
      await harness.scheduler.tick();
      expect(harness.scheduler.listRules()).toEqual([]);
      expect(harness.submitted).toEqual([]);
      expect(harness.scheduler.getDefaultSkillsEnabled()).toBe(false);
    } finally { harness.scheduler.close(); }
  });

  it("stops built-in running jobs and queued retries while preserving custom jobs", async () => {
    const harness = createHarness(new Date("2026-08-05T09:00:00.000Z"));
    harness.scheduler.setDefaultSkillsEnabled(true);
    const reddit = DEFAULT_AUTOMATION_RULES.find((rule) => rule.id === "reddit-capture")!;
    harness.scheduler.saveRule({ ...reddit, concurrencyPolicy: "queue" });
    harness.scheduler.saveRule(rule({ id: "custom" }));
    await harness.scheduler.runNow("reddit-capture");
    await harness.scheduler.runNow("reddit-capture");
    await harness.scheduler.runNow("rss-capture");
    await harness.scheduler.runNow("custom");

    await harness.scheduler.stopDefaultSkills();
    harness.scheduler.setDefaultSkillsEnabled(false);
    expect(harness.scheduler.listRuns("reddit-capture").map((run) => run.state)).toEqual(["cancelled", "cancelled"]);
    expect(harness.scheduler.listRuns("rss-capture")[0].state).toBe("cancelled");
    expect(harness.scheduler.listRuns("custom")[0].state).toBe("running");
    expect(harness.scheduler.getRule("custom").enabled).toBe(true);
    expect(() => harness.scheduler.saveRule({ ...reddit, enabled: true })).toThrow("请先");
    const count = harness.submitted.length;
    await harness.scheduler.tick();
    expect(harness.submitted).toHaveLength(count);
  });

  it("waits for workflow child processes to exit before finishing stop", async () => {
    const harness = createHarness(new Date("2026-08-05T09:00:00.000Z"), { cancelSkill: async () => true });
    harness.scheduler.setDefaultSkillsEnabled(true);
    const run = await harness.scheduler.runNow("rss-capture");
    harness.children.set("workflow-child", child("workflow-child", "cancelling", "rss-article-saver"));
    harness.workflows.get(run.childRunId!)!.stepRuns.push({ runId: "workflow-child", state: "running" } as never);
    let stopped = false;
    const stopping = harness.scheduler.stopDefaultSkills().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    harness.children.get("workflow-child")!.state = "cancelled";
    await stopping;
    expect(stopped).toBe(true);
  });

  it("leaves defaults disabled and the switch retryable if a child does not stop", async () => {
    const harness = createHarness(new Date("2026-08-05T09:00:00.000Z"), { cancelSkill: async () => true });
    harness.scheduler.setDefaultSkillsEnabled(true);
    const run = await harness.scheduler.runNow("rss-capture");
    harness.children.set("stuck", child("stuck", "running", "rss-article-saver"));
    harness.workflows.get(run.childRunId!)!.stepRuns.push({ runId: "stuck", state: "running" } as never);
    const now = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(10_001);
    try {
      await expect(harness.scheduler.stopDefaultSkills()).rejects.toThrow("内置任务尚未停止");
      expect(harness.scheduler.getDefaultSkillsEnabled()).toBe(true);
      expect(harness.scheduler.listRules().every((rule) => !rule.enabled)).toBe(true);
      await harness.scheduler.tick();
      expect(harness.scheduler.listRuns("rss-capture")[0].state).toBe("cancelled");
      now.mockReturnValueOnce(0).mockReturnValue(10_001);
      await expect(harness.scheduler.stopDefaultSkills()).rejects.toThrow("内置任务尚未停止");
      harness.children.get("stuck")!.state = "cancelled";
      await harness.scheduler.stopDefaultSkills();
    } finally { now.mockRestore(); }
  });
  it("runs a daily rule once, reconciles the child and deduplicates the schedule key", async () => {
    const harness = createHarness(new Date("2026-08-05T08:01:00.000Z"));
    harness.scheduler.saveRule(rule({ id: "daily", trigger: { type: "daily", at: "08:00" } }));
    await harness.scheduler.tick();
    await harness.scheduler.tick();

    expect(harness.submitted).toHaveLength(1);
    expect(harness.scheduler.listRuns("daily")).toHaveLength(1);
    expect(harness.scheduler.listRuns("daily")[0].state).toBe("running");
    harness.children.get("child-1")!.state = "succeeded";
    await harness.scheduler.tick(new Date("2026-08-05T08:02:00.000Z"));
    expect(harness.scheduler.listRuns("daily")[0].state).toBe("succeeded");
  });

  it("reuses the active run for a second manual click under skip overlap policy", async () => {
    const harness = createHarness(new Date("2026-08-05T09:00:00.000Z"));
    harness.scheduler.saveRule(rule({ id: "overlap", trigger: { type: "interval", everyMinutes: 5 } }));
    const active = await harness.scheduler.runNow("overlap");
    const reused = await harness.scheduler.runNow("overlap");

    expect(reused).toMatchObject({ id: active.id, state: "running", childRunId: "child-1" });
    expect(harness.submitted).toHaveLength(1);
    expect(harness.scheduler.listRuns("overlap")).toEqual([expect.objectContaining({
      id: active.id,
      state: "running"
    })]);
  });

  it("queues an overlapping run instead of launching it immediately", async () => {
    const harness = createHarness(new Date("2026-08-05T09:00:00.000Z"));
    harness.scheduler.saveRule(rule({ id: "queue", concurrencyPolicy: "queue" }));
    await harness.scheduler.runNow("queue");
    const queued = await harness.scheduler.runNow("queue");

    expect(queued.state).toBe("queued");
    expect(harness.submitted).toHaveLength(1);
    harness.children.get("child-1")!.state = "succeeded";
    await harness.scheduler.tick(new Date("2026-08-05T09:01:00.000Z"));
    expect(harness.submitted).toHaveLength(2);
  });

  it("retries a failed child under the same Automation Run", async () => {
    const harness = createHarness(new Date("2026-08-05T09:00:00.000Z"));
    harness.scheduler.saveRule(rule({ id: "retry", retryPolicy: { maxAttempts: 1, backoffMs: 0 }, trigger: { type: "interval", everyMinutes: 5 } }));
    await harness.scheduler.runNow("retry");
    harness.children.get("child-1")!.state = "failed";
    harness.children.get("child-1")!.error = "child failed once";
    await harness.scheduler.tick(new Date("2026-08-05T09:01:00.000Z"));

    expect(harness.submitted).toHaveLength(2);
    expect(harness.scheduler.listRuns("retry")[0]).toMatchObject({ state: "running", attempt: 2 });
    harness.children.get("child-2")!.state = "succeeded";
    await harness.scheduler.tick(new Date("2026-08-05T09:02:00.000Z"));
    expect(harness.scheduler.listRuns("retry")[0].state).toBe("succeeded");
  });

  it("expedites a queued retry when the user manually runs a skip-policy rule", async () => {
    const harness = createHarness(new Date("2026-08-05T09:00:00.000Z"));
    harness.scheduler.saveRule(rule({ id: "retry-now", retryPolicy: { maxAttempts: 1, backoffMs: 60_000 }, trigger: { type: "interval", everyMinutes: 5 } }));
    const first = await harness.scheduler.runNow("retry-now");
    harness.children.get("child-1")!.state = "failed";
    harness.children.get("child-1")!.error = "child failed once";
    harness.setNow(new Date("2026-08-05T09:01:00.000Z"));
    await harness.scheduler.tick();

    expect(harness.scheduler.listRuns("retry-now")).toEqual([expect.objectContaining({
      id: first.id,
      state: "queued",
      attempt: 1,
      childRunId: null,
      retryAt: "2026-08-05T09:02:00.000Z"
    })]);

    const expedited = await harness.scheduler.runNow("retry-now");

    expect(harness.submitted).toEqual(["example-skill", "example-skill"]);
    expect(harness.scheduler.listRuns("retry-now")).toHaveLength(1);
    expect(expedited).toMatchObject({
      id: first.id,
      state: "running",
      attempt: 2,
      retryAt: null,
      childRunId: "child-2"
    });
  });

  it("turns a successful Broker completion into a data-driven run-completed trigger", async () => {
    const harness = createHarness(new Date("2026-08-05T10:00:00.000Z"));
    harness.scheduler.saveRule({
      ...rule({ id: "after-source", trigger: { type: "run-completed", skillId: "source-skill" } }),
      target: { type: "skill", id: "downstream-skill", versionPolicy: "*" }
    });
    const source = child("source-1", "succeeded", "source-skill");
    harness.children.set(source.id, source);
    await harness.scheduler.handleRunEvent(event("source-1", "succeeded"));

    expect(harness.submitted).toEqual(["downstream-skill"]);
    expect(harness.scheduler.listRuns("after-source")[0].triggerReason).toBe("run-completed:source-1");
  });

  it("reconciles a failed workflow immediately from its terminal event", async () => {
    const harness = createHarness(new Date("2026-08-05T10:00:00.000Z"));
    harness.scheduler.saveRule({
      ...rule({ id: "workflow-failure" }),
      target: { type: "workflow", id: "rss-to-summary-workflow", versionPolicy: "*" }
    });

    await harness.scheduler.runNow("workflow-failure");
    expect(harness.submittedWorkflows).toEqual(["rss-to-summary-workflow"]);
    const workflow = harness.workflows.get("workflow-1")!;
    workflow.state = "failed";
    workflow.completedAt = new Date("2026-08-05T10:00:01.000Z").toISOString();
    workflow.error = "Workflow Step fetch failed.";
    await harness.scheduler.handleWorkflowRunEvent(workflow);

    expect(harness.scheduler.listRuns("workflow-failure")[0]).toMatchObject({
      state: "failed",
      childRunId: "workflow-1",
      error: "Workflow Step fetch failed."
    });
  });

  it("reconciles a workflow that fails before its parent run is linked", async () => {
    const harness = createHarness(new Date("2026-08-05T10:00:00.000Z"), {
      onWorkflowSubmitted: (record) => ({
        ...record,
        state: "failed",
        completedAt: new Date("2026-08-05T10:00:01.000Z").toISOString(),
        error: "Workflow Step fetch failed."
      })
    });
    harness.scheduler.saveRule({
      ...rule({ id: "workflow-immediate-failure" }),
      target: { type: "workflow", id: "rss-to-summary-workflow", versionPolicy: "*" }
    });

    await harness.scheduler.runNow("workflow-immediate-failure");

    expect(harness.scheduler.listRuns("workflow-immediate-failure")[0]).toMatchObject({
      state: "failed",
      childRunId: "workflow-1",
      error: "Workflow Step fetch failed."
    });
  });

  it("supplies the local run date to date-based built-in targets when the rule omits it", async () => {
    const harness = createHarness(new Date(2026, 7, 5, 9, 0, 0));
    harness.scheduler.saveRule({
      ...rule({ id: "dated-workflow" }),
      target: { type: "workflow", id: "rss-to-summary-workflow", versionPolicy: "*" }
    });

    await harness.scheduler.runNow("dated-workflow");

    expect(harness.submittedWorkflowInputs).toEqual([{ date: "20260805" }]);
  });

  it("preserves an explicitly configured date input", async () => {
    const harness = createHarness(new Date(2026, 7, 5, 9, 0, 0));
    harness.scheduler.saveRule({
      ...rule({ id: "dated-workflow", inputs: { date: "20260804" } }),
      target: { type: "workflow", id: "rss-to-summary-workflow", versionPolicy: "*" }
    });

    await harness.scheduler.runNow("dated-workflow");

    expect(harness.submittedWorkflowInputs).toEqual([{ date: "20260804" }]);
  });

  it("runs weekly rules only once on a matching local weekday", async () => {
    const harness = createHarness(new Date("2026-08-05T08:01:00.000Z"));
    harness.scheduler.saveRule(rule({ id: "weekly", trigger: { type: "weekly", daysOfWeek: [3], at: "08:00" } }));

    await harness.scheduler.tick();
    await harness.scheduler.tick(new Date("2026-08-05T08:02:00.000Z"));

    expect(harness.submitted).toEqual(["example-skill"]);
    expect(harness.scheduler.listRuns("weekly")).toHaveLength(1);
  });

  it("debounces file-change rules and re-triggers after the fingerprint changes", async () => {
    let fingerprint = "a";
    const harness = createHarness(new Date("2026-08-05T10:00:00.000Z"), { fileFingerprint: () => fingerprint });
    harness.scheduler.saveRule(rule({ id: "file", trigger: { type: "file-change", paths: ["article/index.md"], debounceMinutes: 5 } }));

    await harness.scheduler.tick();
    expect(harness.submitted).toHaveLength(1);
    fingerprint = "b";
    await harness.scheduler.tick(new Date("2026-08-05T10:01:00.000Z"));
    expect(harness.submitted).toHaveLength(1);
    harness.children.get("child-1")!.state = "succeeded";
    await harness.scheduler.tick(new Date("2026-08-05T10:06:00.000Z"));

    expect(harness.submitted).toHaveLength(2);
  });

  it("polls network and power conditions without treating unknown state as a match", async () => {
    let environment: AutomationEnvironment = { network: "unknown", power: "unknown" };
    const harness = createHarness(new Date("2026-08-05T10:00:00.000Z"), { environment: () => environment });
    harness.scheduler.saveRule(rule({ id: "network", trigger: { type: "network", state: "online", everyMinutes: 5 } }));
    harness.scheduler.saveRule(rule({ id: "power", trigger: { type: "power", state: "ac", everyMinutes: 5 } }));

    await harness.scheduler.tick();
    expect(harness.submitted).toHaveLength(0);
    environment = { network: "online", power: "ac" };
    await harness.scheduler.tick(new Date("2026-08-05T10:01:00.000Z"));

    expect(harness.submitted).toEqual(["example-skill", "example-skill"]);
  });
});

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: "automation",
    name: "Automation",
    target: { type: "skill", id: "example-skill", versionPolicy: "*" },
    trigger: { type: "interval", everyMinutes: 5 },
    inputs: {},
    providerBindings: {},
    externalExportBindingIds: [],
    concurrencyPolicy: "skip",
    missedRunPolicy: "run-once",
    retryPolicy: { maxAttempts: 0, backoffMs: 0 },
    timezone: "UTC",
    ...overrides
  } as never;
}

function createHarness(initialNow: Date, options: {
  cancelSkill?: (id: string) => Promise<boolean>;
  fileFingerprint?: (paths: readonly string[]) => string | undefined;
  environment?: () => AutomationEnvironment;
  onWorkflowSubmitted?: (record: WorkflowRunRecord) => WorkflowRunRecord;
} = {}) {
  const root = makeRoot();
  const paths = buildAppPaths(path.join(root, "user-data"));
  ensureAppPaths(paths);
  const children = new Map<string, BrokerRunRecord>();
  const workflows = new Map<string, WorkflowRunRecord>();
  const submitted: string[] = [];
  const submittedWorkflows: string[] = [];
  const submittedWorkflowInputs: Record<string, unknown>[] = [];
  let now = initialNow;
  const scheduler = new AutomationScheduler({
    repository: new AutomationRepository(paths),
    rootGeneration: 1,
    now: () => now,
    submitSkill: (request) => {
      const id = `child-${submitted.length + 1}`;
      submitted.push(request.skillId);
      const record = child(id, "running", request.skillId);
      children.set(id, record);
      return record;
    },
    submitWorkflow: (request) => {
      const id = `workflow-${submittedWorkflows.length + 1}`;
      submittedWorkflows.push(request.skillId);
      submittedWorkflowInputs.push({ ...request.inputs });
      const record = workflow(id, "running", request.skillId);
      workflows.set(id, options.onWorkflowSubmitted?.(record) || record);
      return record;
    },
    readSkill: (runId) => {
      const record = children.get(runId);
      if (!record) throw new Error(`missing child ${runId}`);
      return record;
    },
    readWorkflow: (runId) => {
      const record = workflows.get(runId);
      if (!record) throw new Error(`missing workflow ${runId}`);
      return record;
    },
    cancelSkill: options.cancelSkill || (async (id) => { children.get(id)!.state = "cancelled"; return true; }),
    cancelWorkflow: async (id) => { workflows.get(id)!.state = "cancelled"; return true; },
    fileFingerprint: options.fileFingerprint,
    environment: options.environment
  });
  return { scheduler, children, workflows, submitted, submittedWorkflows, submittedWorkflowInputs, setNow: (value: Date) => { now = value; } };
}

function child(id: string, state: BrokerRunRecord["state"], skillId: string): BrokerRunRecord {
  return BrokerRunRecordSchema.parse({
    schemaVersion: EXECUTION_SCHEMA_VERSION,
    id,
    request: { skillId, trigger: { type: "manual" }, providerBindingIds: [], externalExportBindingIds: [], inputKeys: [] },
    state,
    sequence: 0,
    attempt: 1,
    rootGeneration: 1,
    skillDigest: null,
    runtime: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    terminalState: null,
    error: null,
    processPid: null,
    orphanPid: null,
    artifacts: []
  });
}

function workflow(id: string, state: WorkflowRunRecord["state"], skillId: string): WorkflowRunRecord {
  return WorkflowRunRecordSchema.parse({
    schemaVersion: EXECUTION_SCHEMA_VERSION,
    id,
    workflowSkillId: skillId,
    workflowVersion: "1.0.0",
    workflowFingerprint: "0".repeat(64),
    state,
    rootGeneration: 1,
    createdAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    stepRuns: []
  });
}

function event(runId: string, state: BrokerRunEvent["state"]): BrokerRunEvent {
  return { schemaVersion: EXECUTION_SCHEMA_VERSION, runId, sequence: 1, timestamp: new Date().toISOString(), state };
}

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-automation-"));
  roots.push(root);
  return root;
}

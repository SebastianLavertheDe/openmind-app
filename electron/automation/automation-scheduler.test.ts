import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { BrokerRunRecordSchema, EXECUTION_SCHEMA_VERSION, type BrokerRunEvent, type BrokerRunRecord } from "../../shared/execution-contracts";
import { AutomationRepository } from "./automation-repository";
import { AutomationScheduler } from "./automation-scheduler";
import type { AutomationEnvironment } from "./automation-environment";

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

  it("seeds default rules once and does not resurrect a deliberate delete", () => {
    const root = makeRoot();
    const paths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    const repository = new AutomationRepository(paths);
    expect(repository.ensureDefaultRules().map((rule) => rule.id)).toEqual(["daily-brief", "classify-new-content", "rss-capture"]);
    expect(repository.removeRule("rss-capture")).toBe(true);
    const reloaded = new AutomationRepository(paths);
    expect(reloaded.ensureDefaultRules().map((rule) => rule.id)).toEqual(["daily-brief", "classify-new-content"]);
  });
});

describe("AutomationScheduler", () => {
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

  it("applies skip overlap policy to manual runs", async () => {
    const harness = createHarness(new Date("2026-08-05T09:00:00.000Z"));
    harness.scheduler.saveRule(rule({ id: "overlap", trigger: { type: "interval", everyMinutes: 5 } }));
    await harness.scheduler.runNow("overlap");
    const skipped = await harness.scheduler.runNow("overlap");

    expect(skipped.state).toBe("skipped");
    expect(harness.submitted).toHaveLength(1);
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

function createHarness(initialNow: Date, options: { fileFingerprint?: (paths: readonly string[]) => string | undefined; environment?: () => AutomationEnvironment } = {}) {
  const root = makeRoot();
  const paths = buildAppPaths(path.join(root, "user-data"));
  ensureAppPaths(paths);
  const children = new Map<string, BrokerRunRecord>();
  const submitted: string[] = [];
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
    submitWorkflow: () => { throw new Error("workflow not used in this test"); },
    readSkill: (runId) => {
      const record = children.get(runId);
      if (!record) throw new Error(`missing child ${runId}`);
      return record;
    },
    readWorkflow: () => { throw new Error("workflow not used in this test"); },
    cancelSkill: async () => true,
    cancelWorkflow: async () => true,
    fileFingerprint: options.fileFingerprint,
    environment: options.environment
  });
  return { scheduler, children, submitted, setNow: (value: Date) => { now = value; } };
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

function event(runId: string, state: BrokerRunEvent["state"]): BrokerRunEvent {
  return { schemaVersion: EXECUTION_SCHEMA_VERSION, runId, sequence: 1, timestamp: new Date().toISOString(), state };
}

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-automation-"));
  roots.push(root);
  return root;
}

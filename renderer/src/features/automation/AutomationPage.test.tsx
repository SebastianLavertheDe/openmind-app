import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationRule, AutomationRunRecord, BrokerRunRecord, DesktopApi, SkillDefinition, SourceRun, WorkflowRunRecord } from "@shared/contracts";
import type { BrokerRunEvent } from "@shared/execution-contracts";
import { messages } from "@shared/messages";
import { AutomationPage } from "./AutomationPage";

const skills: SkillDefinition[] = [
  {
    id: "rss-article-saver",
    title: "RSS 文章抓取",
    description: "拉取订阅并保存文章。",
    cwd: ".claude/skills/rss-article-saver",
    command: "uv",
    runner: "uv",
    args: ["run", "--env-file", ".env", "python", "main.py"],
    envFile: ".env",
    group: "采集",
    permission: "edit",
    outputArtifacts: ["mymind/article/${date}/"],
    timeoutMs: 7200000
  },
  {
    id: "daily-article-summarizer",
    title: "每日文章总结",
    description: "总结当天文章。",
    cwd: ".claude/skills/daily-article-summarizer",
    command: "uv",
    runner: "uv",
    args: ["run", "python", "main.py"],
    envFile: null,
    group: "分析",
    permission: "edit",
    outputArtifacts: [],
    timeoutMs: 3600000
  },
  {
    id: "daily-topic-selector",
    title: "每日选题",
    description: "为新增资料归类并生成候选选题。",
    cwd: ".",
    command: "python",
    runner: "python",
    args: [".claude/skills/daily-topic-selector/scripts/generate_daily_topics.py"],
    envFile: null,
    group: "创作",
    permission: "edit",
    outputArtifacts: [],
    timeoutMs: 1800000
  }
];

const runs: SourceRun[] = [
  { schemaVersion: 1, id: "r1", sourceId: "daily", skillId: "daily-article-summarizer", status: "success", startedAt: "2026-06-15T08:00:00.000Z", completedAt: "2026-06-15T08:01:00.000Z", durationMs: 60000, code: 0, error: null, itemCount: 5, logs: [{ timestamp: "2026-06-15T08:01:00.000Z", stream: "stdout", text: "生成完成" }] },
  { schemaVersion: 1, id: "r2", sourceId: "rss", skillId: "rss-article-saver", status: "failed", startedAt: "2026-06-14T08:00:00.000Z", completedAt: "2026-06-14T08:00:30.000Z", durationMs: 30000, code: 1, error: "boom", itemCount: 0, logs: [] }
];

const seedRules: AutomationRule[] = [
  { schemaVersion: 1, id: "daily-brief", name: "每日简报生成", description: "每天汇总资料。", enabled: true, target: { type: "skill", id: "daily-article-summarizer", versionPolicy: "*" }, trigger: { type: "daily", at: "08:00" }, inputs: {}, providerBindings: {}, externalExportBindingIds: [], concurrencyPolicy: "skip", missedRunPolicy: "run-once", retryPolicy: { maxAttempts: 1, backoffMs: 0 }, timezone: "UTC", lastTriggeredAt: null, lastScheduledKey: null, createdAt: "2026-06-15T08:00:00.000Z", updatedAt: "2026-06-15T08:00:00.000Z" },
  { schemaVersion: 1, id: "classify-new-content", name: "新资料自动归类", description: "归类新增资料。", enabled: false, target: { type: "skill", id: "daily-topic-selector", versionPolicy: "*" }, trigger: { type: "run-completed", skillId: "rss-article-saver" }, inputs: {}, providerBindings: {}, externalExportBindingIds: [], concurrencyPolicy: "skip", missedRunPolicy: "run-once", retryPolicy: { maxAttempts: 1, backoffMs: 0 }, timezone: "UTC", lastTriggeredAt: null, lastScheduledKey: null, createdAt: "2026-06-15T08:00:00.000Z", updatedAt: "2026-06-15T08:00:00.000Z" },
  { schemaVersion: 1, id: "rss-capture", name: "RSS 定时抓取", description: "定时抓取 RSS。", enabled: true, target: { type: "skill", id: "rss-article-saver", versionPolicy: "*" }, trigger: { type: "interval", everyMinutes: 15 }, inputs: {}, providerBindings: {}, externalExportBindingIds: [], concurrencyPolicy: "skip", missedRunPolicy: "run-once", retryPolicy: { maxAttempts: 1, backoffMs: 0 }, timezone: "UTC", lastTriggeredAt: null, lastScheduledKey: null, createdAt: "2026-06-15T08:00:00.000Z", updatedAt: "2026-06-15T08:00:00.000Z" }
];

function makeApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  let currentRules = seedRules.map((rule) => ({ ...rule }));
  const saveAutomationRule = vi.fn(async (input: Parameters<DesktopApi["saveAutomationRule"]>[0]) => {
    const current = currentRules.find((rule) => rule.id === input.id);
    const next: AutomationRule = { schemaVersion: 1, ...input, lastTriggeredAt: current?.lastTriggeredAt || null, lastScheduledKey: current?.lastScheduledKey || null, createdAt: current?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    currentRules = currentRules.map((rule) => rule.id === next.id ? next : rule);
    return next;
  });
  return {
    listSourceRuns: async () => runs,
    runSkill: async () => true,
    stopSkill: async () => true,
    onSkillEvent: () => () => undefined,
    onSkillRunEvent: () => () => undefined,
    listAutomationRules: async () => currentRules,
    listAutomationSchedules: async () => [],
    listAutomationRuns: async () => [],
    saveAutomationRule,
    runAutomationNow: vi.fn(async (ruleId) => ({ schemaVersion: 1, id: "automation-run", ruleId, target: currentRules.find((rule) => rule.id === ruleId)!.target, state: "running", attempt: 1, retryAt: null, childRunId: "child-run", triggerReason: "manual", scheduledFor: null, createdAt: new Date().toISOString(), completedAt: null, error: null } as AutomationRunRecord)),
    cancelSkillRun: async () => true,
    cancelWorkflowRun: async () => true,
    ...overrides
  } as unknown as DesktopApi;
}

beforeEach(() => {
  window.cctools = makeApi();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => cleanup());

describe("AutomationPage", () => {
  it("shows the three persisted rules and no removed rules", async () => {
    const { container } = render(<AutomationPage skills={skills} go={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("3 条规则")).toBeTruthy());

    expect(container.querySelector(".automation-page-transition")).toBeTruthy();
    expect(screen.getByRole("button", { name: /每日简报生成/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /新资料自动归类/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /RSS 定时抓取/ })).toBeTruthy();
    expect(screen.queryByText(/失效源告警/)).toBeNull();
    expect(screen.queryByText(/草稿自动备份/)).toBeNull();
    expect(container.querySelectorAll(".rule-item button").length).toBe(0);
  });

  it("toggles a rule with SwitchButton and disables running when off", async () => {
    render(<AutomationPage skills={skills} go={vi.fn()} />);
    const toggle = await screen.findByRole("switch", { name: "启用 每日简报生成" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect((screen.getByRole("button", { name: /立即运行/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("runs the selected automation rule through the Automation API", async () => {
    const runAutomationNow = vi.fn().mockResolvedValue({});
    window.cctools = makeApi({ runAutomationNow });
    render(<AutomationPage skills={skills} go={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /立即运行/ }));
    expect(runAutomationNow).toHaveBeenCalledWith("daily-brief");

    fireEvent.click(screen.getByRole("button", { name: /RSS 定时抓取/ }));
    fireEvent.click(screen.getByRole("button", { name: /立即运行/ }));
    expect(runAutomationNow).toHaveBeenCalledWith("rss-capture");
  });

  it("remounts the detail pane so rule changes replay the transition", async () => {
    const { container } = render(<AutomationPage skills={skills} go={vi.fn()} />);
    await screen.findByText("每日简报生成", { selector: ".rule-detail h1" });
    const previousPane = container.querySelector(".automation-detail-transition");

    fireEvent.click(screen.getByRole("button", { name: /RSS 定时抓取/ }));

    expect(await screen.findByText("RSS 定时抓取", { selector: ".rule-detail h1" })).toBeTruthy();
    const nextPane = container.querySelector(".automation-detail-transition");
    expect(nextPane).not.toBe(previousPane);
  });

  it("uses the shared form controls and reveals trigger-specific schedule fields", async () => {
    const { container } = render(<AutomationPage skills={skills} go={vi.fn()} />);
    await screen.findByText("触发与目标");

    expect(container.querySelector(".automation-editor-card")).toBeTruthy();
    expect(container.querySelector(".automation-editor-grid")).toBeTruthy();
    expect(container.querySelector(".cron-row")).toBeNull();
    expect(container.querySelectorAll(".automation-editor-grid .ui-select").length).toBe(1);
    expect(screen.getByText("调度设置")).toBeTruthy();
    expect(screen.getByLabelText("每日时间")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("触发类型"), { target: { value: "weekly" } });
    expect(screen.getByLabelText("每周时间")).toBeTruthy();
    expect(screen.getByLabelText("每周星期")).toBeTruthy();
  });

  it("saves values from the redesigned schedule editor", async () => {
    const saveAutomationRule = vi.fn(async (input: Parameters<DesktopApi["saveAutomationRule"]>[0]): Promise<AutomationRule> => ({
      schemaVersion: 1,
      ...input,
      lastTriggeredAt: null,
      lastScheduledKey: null,
      createdAt: "2026-06-15T08:00:00.000Z",
      updatedAt: "2026-06-15T08:00:00.000Z"
    }));
    window.cctools = makeApi({ saveAutomationRule });
    render(<AutomationPage skills={skills} go={vi.fn()} />);
    await screen.findByText("触发与目标");

    fireEvent.change(screen.getByLabelText("触发类型"), { target: { value: "interval" } });
    fireEvent.change(screen.getByLabelText("间隔分钟"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /保存规则/ }));

    await waitFor(() => expect(saveAutomationRule).toHaveBeenCalledTimes(1));
    expect(saveAutomationRule.mock.calls[0][0]).toMatchObject({
      target: { type: "skill", id: "daily-article-summarizer" },
      trigger: { type: "interval", everyMinutes: 30 }
    });
  });

  it("copies the console output for the active rule", async () => {
    window.cctools = makeApi({
      onSkillEvent: (cb) => {
        cb({ skillId: "daily-article-summarizer", text: "生成完成", state: "running" });
        return () => undefined;
      }
    });
    render(<AutomationPage skills={skills} go={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: messages.common.copy }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("生成完成"));
  });

  it("shows workflow step failures and live broker errors for workflow automation", async () => {
    const workflowRule: AutomationRule = {
      ...seedRules[2],
      id: "rss-workflow",
      name: "RSS 抓取与每日总结",
      target: { type: "workflow", id: "rss-to-summary-workflow", versionPolicy: "*" }
    };
    const automationRun: AutomationRunRecord = {
      schemaVersion: 1,
      id: "automation-workflow-run",
      ruleId: workflowRule.id,
      target: workflowRule.target,
      state: "running",
      attempt: 1,
      retryAt: null,
      childRunId: "workflow-run",
      triggerReason: "manual",
      scheduledFor: null,
      createdAt: "2026-08-16T07:43:51.000Z",
      completedAt: null,
      error: null
    };
    const workflow: WorkflowRunRecord = {
      schemaVersion: 1,
      id: "workflow-run",
      workflowSkillId: "rss-to-summary-workflow",
      workflowVersion: "1.0.0",
      workflowFingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      state: "failed",
      rootGeneration: 1,
      createdAt: "2026-08-16T07:43:51.000Z",
      completedAt: "2026-08-16T07:44:24.000Z",
      error: "Workflow Step fetch failed.",
      stepRuns: [{ stepId: "fetch", skillId: "rss-article-saver", state: "failed", attempt: 1, retryAt: null, runId: "fetch-run", error: null, artifacts: [] }]
    };
    const fetchRun = { id: "fetch-run", state: "failed", error: null, completedAt: "2026-08-16T07:44:24.000Z", artifacts: [] } as unknown as BrokerRunRecord;
    let onRunEvent: Parameters<DesktopApi["onSkillRunEvent"]>[0] | undefined;
    window.cctools = makeApi({
      listAutomationRules: async () => [workflowRule],
      listAutomationRuns: async () => [automationRun],
      getWorkflowRun: async () => workflow,
      getSkillRun: async () => fetchRun,
      getSkillRunEvents: async () => [],
      onSkillRunEvent: (callback) => { onRunEvent = callback; return () => undefined; }
    });

    render(<AutomationPage skills={skills} go={vi.fn()} />);
    expect(await screen.findByText(/Workflow Step fetch failed/)).toBeTruthy();
    expect(screen.getByText(/rss-article-saver · 运行失败/)).toBeTruthy();
    expect(onRunEvent).toBeTruthy();

    onRunEvent?.({ schemaVersion: 1, runId: "fetch-run", sequence: 2, timestamp: "2026-08-16T07:44:24.000Z", state: "failed", error: "内置 Python 资源完整性校验失败。" });
    expect(await screen.findByText(/内置 Python 资源完整性校验失败/)).toBeTruthy();
  });

  it("shows concise Skill runtime progress in the recent workflow log", async () => {
    const workflowRule: AutomationRule = {
      ...seedRules[2],
      id: "rss-workflow-progress",
      name: "RSS 抓取与每日总结",
      target: { type: "workflow", id: "rss-to-summary-workflow", versionPolicy: "*" }
    };
    const automationRun: AutomationRunRecord = {
      schemaVersion: 1,
      id: "automation-progress-run",
      ruleId: workflowRule.id,
      target: workflowRule.target,
      state: "running",
      attempt: 1,
      retryAt: null,
      childRunId: "workflow-progress-run",
      triggerReason: "hourly",
      scheduledFor: "2026-08-17T14:00:00.000Z",
      createdAt: "2026-08-17T14:00:20.000Z",
      completedAt: null,
      error: null
    };
    const workflow: WorkflowRunRecord = {
      schemaVersion: 1,
      id: "workflow-progress-run",
      workflowSkillId: "rss-to-summary-workflow",
      workflowVersion: "1.0.0",
      workflowFingerprint: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      state: "running",
      rootGeneration: 1,
      createdAt: "2026-08-17T14:00:20.000Z",
      completedAt: null,
      error: null,
      stepRuns: [{ stepId: "fetch", skillId: "rss-article-saver", state: "running", attempt: 1, retryAt: null, runId: "fetch-progress-run", error: null, artifacts: [] }]
    };
    const fetchRun = { id: "fetch-progress-run", state: "running", error: null, completedAt: null, artifacts: [], request: { skillId: "rss-article-saver" } } as unknown as BrokerRunRecord;
    const events: BrokerRunEvent[] = [
      { schemaVersion: 1, runId: "fetch-progress-run", sequence: 0, timestamp: "2026-08-17T14:00:20.000Z", state: "queued", reason: "run-created" },
      { schemaVersion: 1, runId: "fetch-progress-run", sequence: 1, timestamp: "2026-08-17T14:00:23.000Z", state: "running", reason: "process-started" },
      { schemaVersion: 1, runId: "fetch-progress-run", sequence: 2, timestamp: "2026-08-17T14:01:00.000Z", state: "running", stream: "stdout", text: "Loaded 122 RSS feeds\nFeed: Cursor Blog\nProcessing: Cursor is now a part of SpaceX...\nSaved to: article.md" }
    ];
    window.cctools = makeApi({
      listAutomationRules: async () => [workflowRule],
      listAutomationRuns: async () => [automationRun],
      getWorkflowRun: async () => workflow,
      getSkillRun: async () => fetchRun,
      getSkillRunEvents: async () => events
    });

    render(<AutomationPage skills={skills} go={vi.fn()} />);

    expect(await screen.findByText(/rss-article-saver · Loaded 122 RSS feeds/)).toBeTruthy();
    expect(screen.getByText(/rss-article-saver · Processing: Cursor is now a part of SpaceX/)).toBeTruthy();
    expect(screen.getByText(/rss-article-saver · 运行中/)).toBeTruthy();
  });

  it("prefers an active workflow over newer skipped runs and keeps its live logs visible", async () => {
    const workflowRule: AutomationRule = {
      ...seedRules[2],
      id: "rss-workflow",
      name: "RSS 抓取与每日总结",
      target: { type: "workflow", id: "rss-to-summary-workflow", versionPolicy: "*" }
    };
    const activeRun: AutomationRunRecord = {
      schemaVersion: 1,
      id: "automation-active-run",
      ruleId: workflowRule.id,
      target: workflowRule.target,
      state: "running",
      attempt: 2,
      retryAt: null,
      childRunId: "workflow-active-run",
      triggerReason: "manual",
      scheduledFor: null,
      createdAt: "2026-08-16T09:11:00.000Z",
      completedAt: null,
      error: null
    };
    const skippedRun: AutomationRunRecord = {
      ...activeRun,
      id: "automation-skipped-run",
      state: "skipped",
      attempt: 0,
      childRunId: null,
      createdAt: "2026-08-16T09:17:00.000Z",
      completedAt: "2026-08-16T09:17:00.000Z",
      error: "已有 Automation Run 正在执行。"
    };
    const workflow: WorkflowRunRecord = {
      schemaVersion: 1,
      id: "workflow-active-run",
      workflowSkillId: "rss-to-summary-workflow",
      workflowVersion: "1.0.0",
      workflowFingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      state: "running",
      rootGeneration: 1,
      createdAt: activeRun.createdAt,
      completedAt: null,
      error: null,
      stepRuns: [{ stepId: "fetch", skillId: "rss-article-saver", state: "running", attempt: 1, retryAt: null, runId: "fetch-active-run", error: null, artifacts: [] }]
    };
    const fetchRun: BrokerRunRecord = {
      id: "fetch-active-run",
      state: "running",
      error: null,
      completedAt: null,
      artifacts: []
    } as unknown as BrokerRunRecord;
    window.cctools = makeApi({
      listAutomationRules: async () => [workflowRule],
      // The store returns newest-first; a skipped click must not hide this active parent.
      listAutomationRuns: async () => [skippedRun, activeRun],
      getWorkflowRun: async () => workflow,
      getSkillRun: async () => fetchRun,
      getSkillRunEvents: async () => [{
        schemaVersion: 1,
        runId: "fetch-active-run",
        sequence: 1,
        timestamp: "2026-08-16T09:11:01.000Z",
        state: "running",
        stream: "stdout",
        text: "开始抓取 RSS"
      }]
    });

    const { container } = render(<AutomationPage skills={skills} go={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "停止运行" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /立即运行/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /授权/ })).toBeNull();
    expect(screen.queryByText(/等待授权/)).toBeNull();
    expect(container.querySelector(".rule-item .rule-copy small")?.textContent).toContain("运行中");
    await waitFor(() => expect(screen.getByRole("log").textContent).toContain("rss-article-saver · 运行中"));
    expect(screen.getByRole("log").textContent).toContain("rss-article-saver · 开始抓取 RSS");
    expect(container.querySelector(".automation-history-row")?.textContent).toContain("running");
  });

  it("labels a queued retry error as the previous attempt instead of a current Automation failure", async () => {
    const queuedRetry: AutomationRunRecord = {
      schemaVersion: 1,
      id: "queued-retry",
      ruleId: seedRules[0].id,
      target: seedRules[0].target,
      state: "queued",
      attempt: 1,
      retryAt: "2026-08-16T14:50:05.000Z",
      childRunId: null,
      triggerReason: "manual",
      scheduledFor: null,
      createdAt: "2026-08-16T14:49:34.000Z",
      completedAt: null,
      error: "Workflow Step fetch failed."
    };
    window.cctools = makeApi({
      listAutomationRules: async () => [seedRules[0]],
      listAutomationRuns: async () => [queuedRetry]
    });

    render(<AutomationPage skills={skills} go={vi.fn()} />);

    expect(await screen.findAllByText(/上次尝试失败，等待重试/)).toHaveLength(2);
    expect(screen.queryByText(/Automation 失败/)).toBeNull();
  });

  it("hides run history older than three days and keeps recent records", async () => {
    const recent: AutomationRunRecord = {
      schemaVersion: 1,
      id: "recent-run",
      ruleId: seedRules[0].id,
      target: seedRules[0].target,
      state: "succeeded",
      attempt: 1,
      retryAt: null,
      childRunId: "recent-child",
      triggerReason: "manual",
      scheduledFor: null,
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      completedAt: new Date().toISOString(),
      error: null
    };
    const stale: AutomationRunRecord = {
      ...recent,
      id: "stale-run",
      state: "failed",
      childRunId: "stale-child",
      createdAt: "2026-08-01T08:00:00.000Z",
      error: "boom"
    };
    window.cctools = makeApi({
      listAutomationRules: async () => [seedRules[0]],
      listAutomationRuns: async () => [recent, stale]
    });

    const { container } = render(<AutomationPage skills={skills} go={vi.fn()} />);
    await screen.findByText("触发与目标");

    expect(container.querySelectorAll(".automation-history-row")).toHaveLength(1);
    expect(screen.getByText("recent-child")).toBeTruthy();
    expect(screen.queryByText("stale-child")).toBeNull();
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
  });
});

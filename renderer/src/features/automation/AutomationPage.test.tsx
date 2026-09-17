import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationRule, AutomationRunRecord, BrokerRunRecord, DesktopApi, InstalledRunnableSkillView, SourceRun, WorkflowRunRecord } from "@shared/contracts";
import type { BrokerRunEvent } from "@shared/execution-contracts";
import { messages } from "@shared/messages";
import { AutomationPage } from "./AutomationPage";
import { INSTALLED_SKILL_CATALOG_CHANGED_EVENT } from "../../installed-skill-events";

const skillCatalog: InstalledRunnableSkillView[] = [
  {
    key: "openmind/rss-article-saver",
    id: "rss-article-saver",
    publisherId: "openmind",
    version: "1.0.0",
    digest: "a".repeat(64),
    kind: "process",
    title: "RSS 文章抓取",
    description: "拉取订阅并保存文章。",
    group: "采集",
    enabled: true
  },
  {
    key: "openmind/daily-article-summarizer",
    id: "daily-article-summarizer",
    publisherId: "openmind",
    version: "1.0.0",
    digest: "b".repeat(64),
    kind: "process",
    title: "每日文章总结",
    description: "总结当天文章。",
    group: "分析",
    enabled: true
  },
  {
    key: "openmind/daily-topic-selector",
    id: "daily-topic-selector",
    publisherId: "openmind",
    version: "1.0.0",
    digest: "c".repeat(64),
    kind: "process",
    title: "每日选题",
    description: "为新增资料归类并生成候选选题。",
    group: "创作",
    enabled: true
  },
  {
    key: "openmind/rss-to-summary-workflow",
    id: "rss-to-summary-workflow",
    publisherId: "openmind",
    version: "1.0.0",
    digest: "d".repeat(64),
    kind: "workflow",
    title: "RSS 抓取与每日总结",
    description: "依次抓取并总结 RSS 文章。",
    group: "工作流",
    enabled: true
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
    listInstalledRunnableSkills: async () => skillCatalog,
    saveAutomationRule,
    runAutomationNow: vi.fn(async (ruleId) => ({ schemaVersion: 1, id: "automation-run", ruleId, target: currentRules.find((rule) => rule.id === ruleId)!.target, state: "running", attempt: 1, retryAt: null, childRunId: "child-run", triggerReason: "manual", scheduledFor: null, createdAt: new Date().toISOString(), completedAt: null, error: null } as AutomationRunRecord)),
    cancelSkillRun: async () => true,
    cancelWorkflowRun: async () => true,
    ...overrides
  } as unknown as DesktopApi;
}

async function changeTriggerAndWaitForField(value: "weekly" | "interval", fieldLabel: string): Promise<void> {
  await waitFor(() => {
    if (!screen.queryByLabelText(fieldLabel)) {
      fireEvent.change(screen.getByLabelText("触发类型"), { target: { value } });
    }
    expect(screen.getByLabelText(fieldLabel)).toBeTruthy();
  });
}

beforeEach(() => {
  window.openmind = makeApi();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => cleanup());

describe("AutomationPage", () => {
  it.each(["success", "failure"])("ignores an older refresh %s after a newer refresh succeeds", async (outcome) => {
    let resolveOld!: (rules: AutomationRule[]) => void;
    let rejectOld!: (cause: Error) => void;
    let resolveNew!: (rules: AutomationRule[]) => void;
    const old = new Promise<AutomationRule[]>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    const next = new Promise<AutomationRule[]>((resolve) => { resolveNew = resolve; });
    const listAutomationRules = vi.fn().mockResolvedValueOnce(seedRules).mockReturnValueOnce(old).mockReturnValueOnce(next);
    window.openmind = makeApi({ listAutomationRules });
    await act(async () => { render(<AutomationPage />); });
    act(() => {
      window.dispatchEvent(new Event(INSTALLED_SKILL_CATALOG_CHANGED_EVENT));
      window.dispatchEvent(new Event(INSTALLED_SKILL_CATALOG_CHANGED_EVENT));
    });
    expect(listAutomationRules).toHaveBeenCalledTimes(3);
    await act(async () => resolveNew([{ ...seedRules[0], name: "最新规则" }]));
    await act(async () => {
      if (outcome === "success") resolveOld([{ ...seedRules[0], name: "过期规则" }]);
      else rejectOld(new Error("过期请求失败"));
    });
    expect(screen.getByRole("heading", { name: "最新规则" })).toBeTruthy();
    expect(screen.queryByText("过期规则")).toBeNull();
    expect(screen.queryByText("过期请求失败")).toBeNull();
  });

  it("keeps loading until the latest request settles", async () => {
    let resolveOld!: (rules: AutomationRule[]) => void;
    let resolveNew!: (rules: AutomationRule[]) => void;
    const old = new Promise<AutomationRule[]>((resolve) => { resolveOld = resolve; });
    const next = new Promise<AutomationRule[]>((resolve) => { resolveNew = resolve; });
    window.openmind = makeApi({ listAutomationRules: vi.fn().mockReturnValueOnce(old).mockReturnValueOnce(next) });
    render(<AutomationPage />);
    act(() => { window.dispatchEvent(new Event(INSTALLED_SKILL_CATALOG_CHANGED_EVENT)); });
    await act(async () => resolveOld(seedRules));
    expect(screen.getByText(messages.automation.loading)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: seedRules[0].name })).toBeNull();
    await act(async () => resolveNew(seedRules));
    expect(screen.getByRole("heading", { name: seedRules[0].name })).toBeTruthy();
  });

  it("offers an announced retry path when the initial rule load fails", async () => {
    const listAutomationRules = vi.fn()
      .mockRejectedValueOnce(new Error("automation unavailable"))
      .mockResolvedValueOnce([]);
    window.openmind = makeApi({ listAutomationRules });

    render(<AutomationPage />);

    expect((await screen.findByRole("alert")).textContent).toContain("automation unavailable");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(listAutomationRules).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText(messages.automation.empty)).toBeTruthy();
  });

  it("loads the installed runnable catalog and shows formal Process metadata", async () => {
    const listInstalledRunnableSkills = vi.fn(async () => skillCatalog);
    window.openmind = makeApi({ listInstalledRunnableSkills });

    render(<AutomationPage />);

    expect(await screen.findByText("每日文章总结 · Process · daily-article-summarizer")).toBeTruthy();
    expect(screen.getByText("Process · v1.0.0")).toBeTruthy();
    expect(listInstalledRunnableSkills).toHaveBeenCalledTimes(1);
  });

  it("shows formal Workflow metadata from the independent installed catalog", async () => {
    const workflowRule: AutomationRule = {
      ...seedRules[0],
      id: "rss-summary-workflow",
      name: "RSS 工作流",
      target: { type: "workflow", id: "rss-to-summary-workflow", versionPolicy: "*" }
    };
    window.openmind = makeApi({ listAutomationRules: async () => [workflowRule] });

    render(<AutomationPage />);

    expect(await screen.findByText("RSS 抓取与每日总结 · Workflow · rss-to-summary-workflow")).toBeTruthy();
    expect(screen.getByText("Workflow · v1.0.0")).toBeTruthy();
  });

  it("blocks new Automation runs when the installed target is disabled", async () => {
    const runAutomationNow = vi.fn();
    const disabledCatalog = skillCatalog.map((skill) => skill.id === "daily-article-summarizer"
      ? { ...skill, enabled: false }
      : skill);
    window.openmind = makeApi({
      listInstalledRunnableSkills: async () => disabledCatalog,
      runAutomationNow
    });

    render(<AutomationPage />);

    expect(await screen.findByText("Skill 已关闭")).toBeTruthy();
    const runButton = screen.getByRole("button", { name: /立即运行/ }) as HTMLButtonElement;
    expect(runButton.disabled).toBe(true);
    fireEvent.click(runButton);
    expect(runAutomationNow).not.toHaveBeenCalled();
  });

  it("refreshes its preserved catalog after Skill Center changes availability", async () => {
    let currentCatalog = skillCatalog;
    window.openmind = makeApi({ listInstalledRunnableSkills: async () => currentCatalog });
    render(<AutomationPage />);

    expect(await screen.findByText("已启用")).toBeTruthy();
    currentCatalog = skillCatalog.map((skill) => skill.id === "daily-article-summarizer"
      ? { ...skill, enabled: false }
      : skill);
    window.dispatchEvent(new Event(INSTALLED_SKILL_CATALOG_CHANGED_EVENT));

    expect(await screen.findByText("Skill 已关闭")).toBeTruthy();
    expect((screen.getByRole("button", { name: /立即运行/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks a new Automation run when the installed target does not satisfy its version policy", async () => {
    const runAutomationNow = vi.fn();
    const incompatibleRule: AutomationRule = {
      ...seedRules[0],
      target: { ...seedRules[0].target, versionPolicy: "^2.0.0" }
    };
    window.openmind = makeApi({
      listAutomationRules: async () => [incompatibleRule],
      runAutomationNow
    });

    render(<AutomationPage />);

    expect(await screen.findByText("执行目标不可用")).toBeTruthy();
    const runButton = screen.getByRole("button", { name: /立即运行/ }) as HTMLButtonElement;
    expect(runButton.disabled).toBe(true);
    fireEvent.click(runButton);
    expect(runAutomationNow).not.toHaveBeenCalled();
  });

  it("shows the three persisted rules and no removed rules", async () => {
    const { container } = render(<AutomationPage />);
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
    render(<AutomationPage />);
    const toggle = await screen.findByRole("switch", { name: "启用 每日简报生成" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect((screen.getByRole("button", { name: /立即运行/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("runs the selected automation rule through the Automation API", async () => {
    const runAutomationNow = vi.fn().mockResolvedValue({});
    window.openmind = makeApi({ runAutomationNow });
    render(<AutomationPage />);

    fireEvent.click(await screen.findByRole("button", { name: /立即运行/ }));
    await waitFor(() => expect(runAutomationNow).toHaveBeenCalledWith("daily-brief"));
    await waitFor(() => expect(screen.getByRole("button", { name: /立即运行/ })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /RSS 定时抓取/ }));
    fireEvent.click(screen.getByRole("button", { name: /立即运行/ }));
    await waitFor(() => expect(runAutomationNow).toHaveBeenCalledWith("rss-capture"));
  });

  it("acknowledges a run command immediately and prevents duplicate submission", async () => {
    let resolveRun!: (value: AutomationRunRecord) => void;
    const pending = new Promise<AutomationRunRecord>((resolve) => { resolveRun = resolve; });
    const runAutomationNow = vi.fn(() => pending);
    window.openmind = makeApi({ runAutomationNow });
    render(<AutomationPage />);

    fireEvent.click(await screen.findByRole("button", { name: /立即运行/ }));

    const pendingButton = screen.getByRole("button", { name: /正在启动/ }) as HTMLButtonElement;
    expect(pendingButton.disabled).toBe(true);
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(pendingButton);
    expect(runAutomationNow).toHaveBeenCalledTimes(1);

    await act(async () => resolveRun({
      schemaVersion: 1,
      id: "automation-run",
      ruleId: "daily-brief",
      target: seedRules[0].target,
      state: "running",
      attempt: 1,
      retryAt: null,
      childRunId: "child-run",
      triggerReason: "manual",
      scheduledFor: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      error: null
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: /立即运行/ })).toBeTruthy());
  });

  it("remounts the detail pane so rule changes replay the transition", async () => {
    const { container } = render(<AutomationPage />);
    await screen.findByText("每日简报生成", { selector: ".rule-detail h1" });
    const previousPane = container.querySelector(".automation-detail-transition");

    fireEvent.click(screen.getByRole("button", { name: /RSS 定时抓取/ }));

    expect(await screen.findByText("RSS 定时抓取", { selector: ".rule-detail h1" })).toBeTruthy();
    const nextPane = container.querySelector(".automation-detail-transition");
    expect(nextPane).not.toBe(previousPane);
  });

  it("uses the shared form controls and reveals trigger-specific schedule fields", async () => {
    const { container } = render(<AutomationPage />);
    await screen.findByText("触发与目标");

    expect(container.querySelector(".automation-editor-card")).toBeTruthy();
    expect(container.querySelector(".automation-editor-grid")).toBeTruthy();
    expect(container.querySelector(".cron-row")).toBeNull();
    expect(container.querySelectorAll(".automation-editor-grid .ui-select").length).toBe(1);
    expect(screen.getByText("调度设置")).toBeTruthy();
    expect(screen.getByLabelText("每日时间")).toBeTruthy();

    await changeTriggerAndWaitForField("weekly", "每周时间");
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
    window.openmind = makeApi({ saveAutomationRule });
    render(<AutomationPage />);
    await screen.findByText("触发与目标");

    await changeTriggerAndWaitForField("interval", "间隔分钟");
    fireEvent.change(screen.getByLabelText("间隔分钟"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /保存规则/ }));

    await waitFor(() => expect(saveAutomationRule).toHaveBeenCalledTimes(1));
    expect(saveAutomationRule.mock.calls[0][0]).toMatchObject({
      target: { type: "skill", id: "daily-article-summarizer" },
      trigger: { type: "interval", everyMinutes: 30 }
    });
  });

  it("copies the console output for the active rule", async () => {
    window.openmind = makeApi({
      onSkillEvent: (cb) => {
        cb({ skillId: "daily-article-summarizer", text: "生成完成", state: "running" });
        return () => undefined;
      }
    });
    render(<AutomationPage />);

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
    window.openmind = makeApi({
      listAutomationRules: async () => [workflowRule],
      listAutomationRuns: async () => [automationRun],
      getWorkflowRun: async () => workflow,
      getSkillRun: async () => fetchRun,
      getSkillRunEvents: async () => [],
      onSkillRunEvent: (callback) => { onRunEvent = callback; return () => undefined; }
    });

    render(<AutomationPage />);
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
      stepRuns: [
        { stepId: "fetch", skillId: "rss-article-saver", state: "running", attempt: 1, retryAt: null, runId: "fetch-progress-run", error: null, artifacts: [] },
        { stepId: "summarize", skillId: "daily-article-summarizer", state: "pending", attempt: 0, retryAt: null, runId: null, error: null, artifacts: [] },
        { stepId: "select-topic", skillId: "daily-topic-selector", state: "pending", attempt: 0, retryAt: null, runId: null, error: null, artifacts: [] }
      ]
    };
    const fetchRun = { id: "fetch-progress-run", state: "running", error: null, completedAt: null, artifacts: [], request: { skillId: "rss-article-saver" } } as unknown as BrokerRunRecord;
    const events: BrokerRunEvent[] = [
      { schemaVersion: 1, runId: "fetch-progress-run", sequence: 0, timestamp: "2026-08-17T14:00:20.000Z", state: "queued", reason: "run-created" },
      { schemaVersion: 1, runId: "fetch-progress-run", sequence: 1, timestamp: "2026-08-17T14:00:23.000Z", state: "running", reason: "process-started" },
      { schemaVersion: 1, runId: "fetch-progress-run", sequence: 2, timestamp: "2026-08-17T14:01:00.000Z", state: "running", stream: "stdout", text: "Loaded 122 RSS feeds\nFeed: Cursor Blog\nFetching URL to check content type...\nEntries: 7\nNew articles: 1\nProcessing: Cursor is now a part of SpaceX...\nSaved to: article.md\nFetching timeline from curl...\nWaiting 7.4s before the next cURL...\nFetching timeline from curl_2...\n  Got 20 tweets from curl_2" },
      { schemaVersion: 1, runId: "fetch-progress-run", sequence: 3, timestamp: "2026-08-17T14:01:01.000Z", state: "running", stream: "system", text: "Artifact 登记失败，已忽略：测试错误" }
    ];
    window.openmind = makeApi({
      listAutomationRules: async () => [workflowRule],
      listAutomationRuns: async () => [automationRun],
      getWorkflowRun: async () => workflow,
      getSkillRun: async () => fetchRun,
      getSkillRunEvents: async () => events
    });

    render(<AutomationPage />);

    expect(await screen.findByText(/rss-article-saver · Loaded 122 RSS feeds/)).toBeTruthy();
    expect(screen.getByText(/rss-article-saver · Processing: Cursor is now a part of SpaceX/)).toBeTruthy();
    expect(screen.getByText("rss-article-saver · Fetching timeline from curl...")).toBeTruthy();
    expect(screen.getByText(/rss-article-saver · Waiting 7.4s before the next cURL/)).toBeTruthy();
    expect(screen.getByText(/rss-article-saver · Got 20 tweets from curl_2/)).toBeTruthy();
    expect(screen.getByText("rss-article-saver · 运行中")).toBeTruthy();
    expect(screen.getByText(/步骤 1\/3 · rss-article-saver · 运行中/)).toBeTruthy();
    expect(screen.getByText(/步骤 2\/3 · daily-article-summarizer · 等待上一步/)).toBeTruthy();
    expect(screen.getByText(/RSS 进度：已开始检查 1 个源（初始订阅 122，嵌套源另计） · 发现新增 1 篇 · 已保存 1 篇 · 当前 Cursor Blog/)).toBeTruthy();
    expect(screen.getByText(/Artifact 登记失败，已忽略：测试错误/)).toBeTruthy();
  });

  it("prefers an active workflow over newer skipped runs and keeps its live logs visible", async () => {
    const activeCreatedAt = new Date(Date.now() - 60_000).toISOString();
    const skippedCreatedAt = new Date(Date.now() - 30_000).toISOString();
    const activeEventAt = new Date(Date.parse(activeCreatedAt) + 1_000).toISOString();
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
      createdAt: activeCreatedAt,
      completedAt: null,
      error: null
    };
    const skippedRun: AutomationRunRecord = {
      ...activeRun,
      id: "automation-skipped-run",
      state: "skipped",
      attempt: 0,
      childRunId: null,
      createdAt: skippedCreatedAt,
      completedAt: skippedCreatedAt,
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
    const cancelWorkflowRun = vi.fn(async () => true);
    window.openmind = makeApi({
      listAutomationRules: async () => [workflowRule],
      listInstalledRunnableSkills: async () => skillCatalog.map((skill) => skill.id === "rss-to-summary-workflow"
        ? { ...skill, enabled: false }
        : skill),
      // The store returns newest-first; a skipped click must not hide this active parent.
      listAutomationRuns: async () => [skippedRun, activeRun],
      getWorkflowRun: async () => workflow,
      getSkillRun: async () => fetchRun,
      getSkillRunEvents: async () => [{
        schemaVersion: 1,
        runId: "fetch-active-run",
        sequence: 1,
        timestamp: activeEventAt,
        state: "running",
        stream: "stdout",
        text: "开始抓取 RSS"
      }],
      cancelWorkflowRun
    });

    const { container } = render(<AutomationPage />);

    expect(await screen.findByRole("button", { name: "停止运行" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /立即运行/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /授权/ })).toBeNull();
    expect(screen.queryByText(/等待授权/)).toBeNull();
    expect(screen.getByText("Skill 已关闭")).toBeTruthy();
    expect(container.querySelector(".rule-item .rule-copy small")?.textContent).toContain("运行中");
    await waitFor(() => expect(screen.getByRole("log").textContent).toContain("rss-article-saver · 运行中"));
    expect(screen.getByRole("log").textContent).toContain("rss-article-saver · 开始抓取 RSS");
    await waitFor(() => expect(container.querySelector(".automation-history-row")?.textContent).toContain("running"));
    fireEvent.click(screen.getByRole("button", { name: "停止运行" }));
    await waitFor(() => expect(cancelWorkflowRun).toHaveBeenCalledWith("workflow-active-run"));
  });

  it("labels a queued retry error as the previous attempt instead of a current Automation failure", async () => {
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const queuedRetry: AutomationRunRecord = {
      schemaVersion: 1,
      id: "queued-retry",
      ruleId: seedRules[0].id,
      target: seedRules[0].target,
      state: "queued",
      attempt: 1,
      retryAt: new Date(Date.parse(createdAt) + 30_000).toISOString(),
      childRunId: null,
      triggerReason: "manual",
      scheduledFor: null,
      createdAt,
      completedAt: null,
      error: "Workflow Step fetch failed."
    };
    window.openmind = makeApi({
      listAutomationRules: async () => [seedRules[0]],
      listAutomationRuns: async () => [queuedRetry]
    });

    render(<AutomationPage />);

    await waitFor(() => expect(screen.getAllByText(/上次尝试失败，等待重试/)).toHaveLength(2));
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
    window.openmind = makeApi({
      listAutomationRules: async () => [seedRules[0]],
      listAutomationRuns: async () => [recent, stale]
    });

    const { container } = render(<AutomationPage />);
    await screen.findByText("触发与目标");

    expect(container.querySelectorAll(".automation-history-row")).toHaveLength(1);
    expect(screen.getByText("recent-child")).toBeTruthy();
    expect(screen.queryByText("stale-child")).toBeNull();
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
  });

  it("does not render retry actions for failed run history", async () => {
    const failed: AutomationRunRecord = {
      schemaVersion: 1,
      id: "recent-failed-run",
      ruleId: seedRules[0].id,
      target: seedRules[0].target,
      state: "failed",
      attempt: 2,
      retryAt: null,
      childRunId: "failed-child",
      triggerReason: "manual",
      scheduledFor: null,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      completedAt: new Date().toISOString(),
      error: "Workflow Step failed."
    };
    window.openmind = makeApi({
      listAutomationRules: async () => [seedRules[0]],
      listAutomationRuns: async () => [failed]
    });

    render(<AutomationPage />);
    expect(await screen.findByText("failed-child")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
  });
});

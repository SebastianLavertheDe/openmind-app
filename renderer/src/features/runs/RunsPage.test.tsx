import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { BrokerRunRecordSchema, EXECUTION_SCHEMA_VERSION, WorkflowRunRecordSchema } from "@shared/execution-contracts";
import { RunsPage } from "./RunsPage";

const skillRun = BrokerRunRecordSchema.parse({
  schemaVersion: EXECUTION_SCHEMA_VERSION,
  id: "skill-run-1",
  request: { skillId: "daily-summary", trigger: { type: "manual" }, providerBindingIds: [], externalExportBindingIds: [], inputKeys: [] },
  state: "failed",
  sequence: 1,
  rootGeneration: 1,
  skillDigest: null,
  runtime: null,
  createdAt: "2026-08-05T08:00:00.000Z",
  startedAt: "2026-08-05T08:00:01.000Z",
  completedAt: "2026-08-05T08:00:02.000Z",
  terminalState: "failed",
  error: "boom",
  processPid: null,
  orphanPid: null,
  usage: { model: "test-model", inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.01, durationMs: 1234 },
  artifacts: []
});

const workflowRun = WorkflowRunRecordSchema.parse({
  schemaVersion: EXECUTION_SCHEMA_VERSION,
  id: "workflow-run-1",
  workflowSkillId: "daily-workflow",
  workflowVersion: "1.0.0",
  state: "failed",
  rootGeneration: 1,
  createdAt: "2026-08-05T07:00:00.000Z",
  completedAt: "2026-08-05T07:00:02.000Z",
  error: "step failed",
  stepRuns: [{ stepId: "summarize", skillId: "daily-summary", state: "failed", attempt: 1, retryAt: null, runId: "child-1", error: "boom", artifacts: [{ id: "summary", runId: "child-1", skillId: "daily-summary", logicalPath: "daily-summary/20260805.md", type: "markdown", declared: true, createdAt: "2026-08-05T07:00:01.000Z" }] }]
});

function makeApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    listSkillRuns: async () => [skillRun],
    listWorkflowRuns: async () => [workflowRun],
    listRunArtifacts: async () => [],
    getSkillRunEvents: async () => [],
    retrySkillRun: vi.fn(async () => skillRun),
    retryWorkflowStep: vi.fn(async () => workflowRun),
    deleteRunHistory: vi.fn(async () => true),
    cancelSkillRun: vi.fn(async () => true),
    ...overrides
  } as unknown as DesktopApi;
}

beforeEach(() => {
  window.openmind = makeApi();
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => vi.restoreAllMocks());

describe("RunsPage", () => {
  it("shows unified Skill and Workflow history and retries a failed Skill Run", async () => {
    const retrySkillRun = vi.fn(async () => skillRun);
    window.openmind = makeApi({ retrySkillRun });
    render(<RunsPage />);

    expect((await screen.findAllByText("daily-summary")).length).toBeGreaterThan(0);
    expect(screen.getByText("daily-workflow")).toBeTruthy();
    expect(screen.getByText(/test-model · 15 tokens · \$0\.0100 · 1\.2s/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    await waitFor(() => expect(retrySkillRun).toHaveBeenCalledWith("skill-run-1"));
  });

  it("exposes failed Workflow Step retry and history deletion", async () => {
    const retryWorkflowStep = vi.fn(async () => workflowRun);
    const deleteRunHistory = vi.fn(async () => true);
    window.openmind = makeApi({ retryWorkflowStep, deleteRunHistory });
    render(<RunsPage initialRunId="workflow-run-1" />);

    expect(await screen.findByText("summarize")).toBeTruthy();
    expect(screen.getByText(/1 个 Artifact/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试 Step" }));
    await waitFor(() => expect(retryWorkflowStep).toHaveBeenCalledWith("workflow-run-1", "summarize"));
    fireEvent.click(screen.getByRole("button", { name: /删除历史/ }));
    await waitFor(() => expect(deleteRunHistory).toHaveBeenCalledWith("workflow-run-1"));
  });
  it("opens and reveals logical Artifacts without exposing external paths", async () => {
    const openPath = vi.fn(async () => "");
    const revealPath = vi.fn(async () => true);
    window.openmind = makeApi({
      listSkillRuns: async () => [skillRun],
      listWorkflowRuns: async () => [],
      listRunArtifacts: async () => [
        { id: "logical", runId: skillRun.id, skillId: skillRun.request.skillId, logicalPath: "openmind/daily-summary/out.md", type: "markdown", declared: true, createdAt: "2026-08-05T08:00:01.000Z" },
        { id: "external", runId: skillRun.id, skillId: skillRun.request.skillId, externalPathRef: "export-1", type: "video", declared: true, createdAt: "2026-08-05T08:00:01.000Z" }
      ],
      openPath,
      revealPath
    });
    render(<RunsPage initialRunId={skillRun.id} />);

    expect(await screen.findByRole("button", { name: "打开 openmind/daily-summary/out.md" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "打开 openmind/daily-summary/out.md" }));
    fireEvent.click(screen.getByRole("button", { name: "定位 openmind/daily-summary/out.md" }));
    await waitFor(() => {
      expect(openPath).toHaveBeenCalledWith("openmind/daily-summary/out.md");
      expect(revealPath).toHaveBeenCalledWith("openmind/daily-summary/out.md");
    });
    expect(screen.getByText("外部导出绑定：export-1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开 export-1" })).toBeNull();
  });

  it("shows a possible orphan process after restart without offering an automatic kill", async () => {
    const orphanRun = BrokerRunRecordSchema.parse({ ...skillRun, orphanPid: 45678, error: "Run 在应用重启时中断：application-restarted；发现可能残留进程 PID 45678，需要人工诊断。" });
    window.openmind = makeApi({ listSkillRuns: async () => [orphanRun], listWorkflowRuns: async () => [] });
    render(<RunsPage initialRunId={orphanRun.id} />);

    expect((await screen.findByRole("alert")).textContent).toContain("PID 45678");
    expect(screen.queryByRole("button", { name: /终止进程|杀掉进程/i })).toBeNull();
  });
});

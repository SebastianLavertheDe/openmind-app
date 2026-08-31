import { describe, expect, it } from "vitest";
import { isTerminalProjectTaskRunStatus, matchesProjectTaskSession } from "./ProjectTasksPanel";
import type { ProjectTask } from "./types";

const task: ProjectTask = {
  taskId: "task-1",
  projectName: "AI 安全",
  title: "整理报告",
  sessionId: "session-1",
  providerId: "codex",
  status: "active",
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z"
};

describe("matchesProjectTaskSession", () => {
  it("accepts only the session scoped to the selected task and project", () => {
    expect(matchesProjectTaskSession({ id: "session-1", scope: { type: "project-task", projectName: "AI 安全", taskId: "task-1" } }, "AI 安全", task)).toBe(true);
    expect(matchesProjectTaskSession({ id: "session-1", scope: { type: "workspace" } }, "AI 安全", task)).toBe(false);
    expect(matchesProjectTaskSession({ id: "session-1", scope: { type: "project-task", projectName: "其他项目", taskId: "task-1" } }, "AI 安全", task)).toBe(false);
    expect(matchesProjectTaskSession({ id: "other-session", scope: { type: "project-task", projectName: "AI 安全", taskId: "task-1" } }, "AI 安全", task)).toBe(false);
  });

  it("recognizes statuses that require a persisted task-list refresh", () => {
    expect(isTerminalProjectTaskRunStatus("completed")).toBe(true);
    expect(isTerminalProjectTaskRunStatus("failed")).toBe(true);
    expect(isTerminalProjectTaskRunStatus("cancelled")).toBe(true);
    expect(isTerminalProjectTaskRunStatus("conflicted")).toBe(true);
    expect(isTerminalProjectTaskRunStatus("running")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { isTerminalProjectTaskRunStatus, matchesProjectTaskSession } from "./ProjectTasksPanel";
import type { ProjectTask } from "./types";

const task: ProjectTask = {
  taskId: "task-1",
  projectId: "5a111111-1111-4111-8111-111111111111",
  projectName: "AI 安全",
  title: "整理报告",
  sessionId: "session-1",
  previousSessionIds: [],
  providerId: "codex",
  status: "active",
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z"
};

describe("matchesProjectTaskSession", () => {
  it("accepts only the session scoped to the selected task and project", () => {
    expect(matchesProjectTaskSession({ id: "session-1", scope: { type: "project-task", projectId: task.projectId, projectName: "AI 安全", taskId: "task-1" } }, task.projectId, task)).toBe(true);
    expect(matchesProjectTaskSession({ id: "session-1", scope: { type: "workspace" } }, task.projectId, task)).toBe(false);
    expect(matchesProjectTaskSession({ id: "session-1", scope: { type: "project-task", projectId: "6a111111-1111-4111-8111-111111111111", projectName: "其他项目", taskId: "task-1" } }, task.projectId, task)).toBe(false);
    expect(matchesProjectTaskSession({ id: "other-session", scope: { type: "project-task", projectId: task.projectId, projectName: "AI 安全", taskId: "task-1" } }, task.projectId, task)).toBe(false);
  });

  it("recognizes statuses that require a persisted task-list refresh", () => {
    expect(isTerminalProjectTaskRunStatus("completed")).toBe(true);
    expect(isTerminalProjectTaskRunStatus("failed")).toBe(true);
    expect(isTerminalProjectTaskRunStatus("cancelled")).toBe(true);
    expect(isTerminalProjectTaskRunStatus("conflicted")).toBe(true);
    expect(isTerminalProjectTaskRunStatus("running")).toBe(false);
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AiEvent } from "@shared/contracts";
import { ActiveTodoFloat, selectRunTodoEvents, WorkStateCard } from "./plan";

function event(kind: "plan" | "todo", seq: number, payload: Record<string, unknown>, provider: "codex" | "claude" = "codex"): AiEvent {
  return {
    schemaVersion: 1,
    id: `event-${seq}`,
    seq,
    timestamp: "2026-07-15T00:00:00.000Z",
    projectId: "project-1",
    sessionId: "session-1",
    runId: "run-1",
    provider,
    kind,
    payload,
    risks: []
  };
}

describe("WorkStateCard", () => {
  it("展示 Codex 完成的 Plan item 与 turn/plan/updated Todo 快照", () => {
    const { container } = render(<WorkStateCard
      planEvents={[event("plan", 1, { text: "## 计划\n先核对协议", sourceEvent: "item/completed" })]}
      todoEvents={[event("todo", 2, {
        sourceEvent: "turn/plan/updated",
        items: [
          { id: "1", text: "核对协议", status: "completed" },
          { id: "2", text: "实现界面", status: "in-progress" }
        ]
      })]}
    />);

    expect(screen.getByText(/先核对协议/)).toBeTruthy();
    expect(screen.getByText("核对协议")).toBeTruthy();
    expect(screen.getByText("实现界面")).toBeTruthy();
    expect(screen.getByText("Codex CLI")).toBeTruthy();
    expect(screen.getAllByText("1/2")).toHaveLength(2);
    const trigger = screen.getByRole("button", { name: "计划与任务，展开" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".work-state-body")).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "计划与任务，收起" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("忽略 Claude Task* 生命周期事件，只展示 TodoWrite 返回的任务", () => {
    render(<WorkStateCard
      planEvents={[]}
      todoEvents={[
        event("todo", 1, { operation: "upsert", item: { id: "task-1", text: "不应展示", status: "pending" }, sourceTool: "TaskCreate" }, "claude"),
        event("todo", 2, { operation: "update", item: { id: "task-1", status: "in-progress" }, sourceTool: "TaskUpdate" }, "claude"),
        event("todo", 3, {
          sourceTool: "TodoWrite",
          items: [{ id: "todo-1", text: "补测试", status: "in-progress" }]
        }, "claude")
      ]}
    />);

    expect(screen.getAllByText("补测试")).toHaveLength(2);
    expect(screen.queryByText("不应展示")).toBeNull();
    expect(screen.queryByText("进行中")).toBeNull();
    expect(screen.getByLabelText("补测试，进行中")).toBeTruthy();
  });
});

describe("ActiveTodoFloat", () => {
  const runningTodo = event("todo", 1, {
    sourceEvent: "turn/plan/updated",
    items: [
      { id: "1", text: "核对协议", status: "completed" },
      { id: "2", text: "实现界面", activeForm: "正在实现界面", status: "in-progress" },
      { id: "3", text: "补充验证", status: "pending" }
    ]
  });

  it("固定展示当前运行 Todo 及实时步骤", () => {
    const { container } = render(<ActiveTodoFloat events={[runningTodo]} active />);

    expect(screen.getByText("核对协议")).toBeTruthy();
    expect(screen.getByText("正在实现界面")).toBeTruthy();
    expect(screen.getByText("第 2 / 3 步")).toBeTruthy();
    expect(container.querySelector(".active-todo-float")).toBeTruthy();
  });

  it("全部完成后播放退场并移除", () => {
    vi.useFakeTimers();
    const completeTodo = event("todo", 2, {
      sourceEvent: "turn/plan/updated",
      items: [
        { id: "1", text: "核对协议", status: "completed" },
        { id: "2", text: "实现界面", status: "completed" },
        { id: "3", text: "补充验证", status: "completed" }
      ]
    });
    const { container, rerender } = render(<ActiveTodoFloat events={[runningTodo]} active />);

    rerender(<ActiveTodoFloat events={[completeTodo]} active />);
    expect(container.querySelector(".active-todo-float")?.hasAttribute("data-leaving")).toBe(true);
    act(() => vi.advanceTimersByTime(170));
    expect(container.querySelector(".active-todo-float")).toBeNull();
    vi.useRealTimers();
  });
});

describe("selectRunTodoEvents", () => {
  it("selects one run's native Todo events and restores protocol order", () => {
    const otherRun = { ...event("todo", 1, { sourceEvent: "turn/plan/updated", items: [] }), runId: "run-2" };
    const taskLifecycle = event("todo", 2, { sourceTool: "TaskUpdate", items: [] }, "claude");
    const latest = event("todo", 4, { sourceEvent: "turn/plan/updated", items: [{ id: "2", text: "实现", status: "in-progress" }] });
    const earlier = event("todo", 3, { sourceEvent: "turn/plan/updated", items: [{ id: "1", text: "检查", status: "completed" }] });

    expect(selectRunTodoEvents([otherRun, taskLifecycle, latest, earlier], "run-1").map((item) => item.seq)).toEqual([3, 4]);
    expect(selectRunTodoEvents([earlier], null)).toEqual([]);
  });
});

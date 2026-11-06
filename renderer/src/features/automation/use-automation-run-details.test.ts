import { act, cleanup, renderHook } from "@testing-library/react";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { SkillRunRequestSchema } from "@shared/execution-contracts";
import { RunStore } from "../../../../electron/execution/run-store";
import { useAutomationRunDetails } from "./use-automation-run-details";

const timestamp = "2026-11-06T00:00:00.000Z";
const workflow = { id: "workflow", state: "running", stepRuns: [{ stepId: "done", runId: "done", state: "succeeded" }, { stepId: "busy", runId: "busy", state: "running" }] };
const event = (runId: string, sequence: number) => ({ schemaVersion: 1 as const, runId, sequence, timestamp, state: "running" as const });
const onTerminal = vi.fn(async () => {});
beforeEach(() => {
  vi.useFakeTimers(); onTerminal.mockClear();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  window.openmind = {
    getWorkflowRun: vi.fn(async () => workflow),
    getSkillRun: vi.fn(async (id: string) => ({ id, state: id === "done" ? "succeeded" : "running", artifacts: [] })),
    getSkillRunEventsPage: vi.fn(async (id: string, query: { after?: number }) => ({ events: (query.after ?? -1) >= 1 ? [] : [event(id, 1)], nextAfter: null }))
  } as unknown as DesktopApi;
});
afterEach(() => { cleanup(); vi.useRealTimers(); delete (document as unknown as { visibilityState?: string }).visibilityState; });

it("serializes slow refreshes and stops while hidden or unmounted", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  vi.mocked(window.openmind.getWorkflowRun).mockReturnValueOnce(pending as never);
  const view = renderHook(() => useAutomationRunDetails("workflow", "workflow", onTerminal));
  await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
  expect(window.openmind.getWorkflowRun).toHaveBeenCalledTimes(1);
  await act(async () => { finish(workflow); });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(window.openmind.getWorkflowRun).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(window.openmind.getWorkflowRun).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(window.openmind.getWorkflowRun).toHaveBeenCalledTimes(2);
});

it("requests only new events and never rereads a completed step", async () => {
  await act(async () => { renderHook(() => useAutomationRunDetails("workflow", "workflow", onTerminal)); });
  for (let index = 0; index < 3; index++) await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  const calls = vi.mocked(window.openmind.getSkillRunEventsPage!).mock.calls;
  expect(calls.filter(([id]) => id === "done")).toHaveLength(1);
  expect(calls.filter(([id]) => id === "busy")).toHaveLength(4);
  expect(calls.at(-1)).toEqual(["busy", { after: 1, limit: 200 }]);
});

it("opens the latest 800 events of a large completed run in four bounded pages", async () => {
  window.openmind.getSkillRun = vi.fn(async id => ({ id, sequence: 40000, state: "succeeded", artifacts: [] })) as never;
  window.openmind.getSkillRunEventsPage = vi.fn(async (id, query) => {
    const after = query?.after ?? -1;
    return { events: Array.from({ length: 200 }, (_, index) => event(id, after + index + 1)), nextAfter: after < 39800 ? after + 200 : null };
  });
  const view = renderHook(() => useAutomationRunDetails("done", "skill", onTerminal));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(window.openmind.getSkillRunEventsPage).toHaveBeenCalledTimes(4);
  expect(window.openmind.getSkillRunEventsPage).toHaveBeenNthCalledWith(1, "done", { after: 39200, limit: 200 });
  expect(view.result.current.childEvents).toHaveLength(800);
  expect(view.result.current.childEvents.at(-1)?.sequence).toBe(40000);
  expect(onTerminal).toHaveBeenCalledTimes(1);
});

it("restarts a completed workflow when resume starts a new child without changing the workflow ID", async () => {
  vi.mocked(window.openmind.getWorkflowRun).mockResolvedValueOnce({ ...workflow, state: "succeeded", stepRuns: [workflow.stepRuns[0]] } as never);
  const view = renderHook(({ activity }) => useAutomationRunDetails("workflow", "workflow", onTerminal, activity), { initialProps: { activity: null as ReturnType<typeof event> | null } });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(window.openmind.getWorkflowRun).toHaveBeenCalledTimes(1);
  await act(async () => view.rerender({ activity: event("new-child", 1) }));
  expect(view.result.current.workflowRun?.state).toBe("running");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(window.openmind.getWorkflowRun).toHaveBeenCalledTimes(3);
});

it("ignores an old request after switching to another run", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(window.openmind.getWorkflowRun).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }) as never);
  const view = renderHook(({ id }) => useAutomationRunDetails(id, "workflow", onTerminal), { initialProps: { id: "old" } });
  await act(async () => view.rerender({ id: "new" }));
  await act(async () => finish({ ...workflow, id: "old" }));
  expect(view.result.current.workflowRun?.id).toBe("workflow");
  expect(window.openmind.getSkillRun).toHaveBeenCalledTimes(2);
});

it("keeps other workflow steps readable after a completed child history is deleted and stops polling", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-workflow-details-"));
  try {
    const store = new RunStore(root, () => new Date(timestamp));
    const deleted = randomUUID(), retained = randomUUID();
    for (const id of [deleted, retained]) {
      store.create(SkillRunRequestSchema.parse({ skillId: "example-skill", digest: "a".repeat(64), inputs: {}, providerBindings: {}, trigger: { type: "workflow", parentRunId: "workflow", stepId: id }, rootGeneration: 1 }), id);
      store.transition(id, "inspecting");
      store.transition(id, "preparing_runtime");
      store.transition(id, "running");
      store.appendOutput(id, "stdout", `${id} output`);
      store.transition(id, "succeeded");
    }
    expect(store.deleteHistory(deleted)).toBe(true);
    window.openmind.getWorkflowRun = vi.fn(async () => ({ ...workflow, state: "succeeded", stepRuns: [deleted, retained].map(id => ({ stepId: id, runId: id, state: "succeeded" })) })) as never;
    window.openmind.getSkillRun = vi.fn(async id => store.get(id));
    window.openmind.listSkillRuns = vi.fn(async () => store.list());
    window.openmind.getSkillRunEventsPage = vi.fn(async (id, query) => store.eventsPage(id, query));
    const view = renderHook(() => useAutomationRunDetails("workflow", "workflow", onTerminal));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(view.result.current.workflowRun?.state).toBe("succeeded");
    expect(view.result.current.workflowSteps[0]).toMatchObject({ child: null, events: [] });
    expect(view.result.current.workflowSteps[1].child?.id).toBe(retained);
    expect(view.result.current.workflowSteps[1].events.some(event => event.text === `${retained} output`)).toBe(true);
    expect(window.openmind.listSkillRuns).toHaveBeenCalledTimes(1);
    expect(window.openmind.getWorkflowRun).toHaveBeenCalledTimes(1);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    view.unmount();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it.each([false, true])("shows successful steps while retrying a transient child failure (existence check failed: %s)", async (existenceCheckFails) => {
  window.openmind.getWorkflowRun = vi.fn(async () => ({ ...workflow, state: "succeeded" })) as never;
  window.openmind.getSkillRun = vi.fn(async id => ({ id, state: "succeeded", artifacts: [] })) as never;
  vi.mocked(window.openmind.getSkillRun).mockRejectedValueOnce(new Error("temporary transport failure"));
  window.openmind.listSkillRuns = vi.fn(async () => [{ id: "done" }, { id: "busy" }]) as never;
  if (existenceCheckFails) vi.mocked(window.openmind.listSkillRuns).mockRejectedValueOnce(new Error("temporary list failure"));
  const view = renderHook(() => useAutomationRunDetails("workflow", "workflow", onTerminal));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(view.result.current.workflowSteps[1].child?.id).toBe("busy");
  expect(onTerminal).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(999); });
  expect(window.openmind.getWorkflowRun).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(view.result.current.workflowSteps[0].child?.id).toBe("done");
  expect(window.openmind.getWorkflowRun).toHaveBeenCalledTimes(2);
  expect(vi.mocked(window.openmind.getSkillRun).mock.calls.filter(([id]) => id === "busy")).toHaveLength(1);
  expect(onTerminal).toHaveBeenCalledTimes(1);
});

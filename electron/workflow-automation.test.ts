import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowAutomationCoordinator } from "./workflow-automation";

afterEach(() => vi.useRealTimers());

describe("WorkflowAutomationCoordinator", () => {
  it("debounces successful source runs into a real daily brief skill run", async () => {
    vi.useFakeTimers();
    const runSkill = vi.fn(async () => true);
    const coordinator = new WorkflowAutomationCoordinator(() => ({ workflowAutoBriefOnSourceComplete: true }), runSkill, 100);
    coordinator.handleSkillEvent({ type: "status", state: "success", skillId: "rss-article-saver", invocationId: "rss-1", timestamp: "2026-07-12T01:00:00.000Z" });
    coordinator.handleSkillEvent({ type: "status", state: "success", skillId: "reddit-fetcher", invocationId: "reddit-1", timestamp: "2026-07-12T01:00:01.000Z" });
    await vi.advanceTimersByTimeAsync(100);
    expect(runSkill).toHaveBeenCalledTimes(1);
    expect(runSkill).toHaveBeenCalledWith("daily-article-summarizer", "20260712");
    coordinator.close();
  });

  it("does nothing when disabled or when the event is not a source success", async () => {
    vi.useFakeTimers();
    const runSkill = vi.fn(async () => true);
    const coordinator = new WorkflowAutomationCoordinator(() => ({ workflowAutoBriefOnSourceComplete: false }), runSkill, 10);
    coordinator.handleSkillEvent({ type: "status", state: "success", skillId: "rss-article-saver", invocationId: "rss-1" });
    coordinator.handleSkillEvent({ type: "status", state: "failed", skillId: "reddit-fetcher", invocationId: "reddit-1" });
    coordinator.handleSkillEvent({ type: "status", state: "success", skillId: "daily-article-summarizer", invocationId: "brief-1" });
    await vi.runAllTimersAsync();
    expect(runSkill).not.toHaveBeenCalled();
    coordinator.close();
  });
});

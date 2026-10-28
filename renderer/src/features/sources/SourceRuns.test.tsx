import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import type { RssSourceRun } from "@shared/rss-contracts";
import { messages as m } from "@shared/messages";
import { SourceRuns } from "./SourceRuns";

afterEach(() => { cleanup(); vi.useRealTimers(); });
it("loads logs in StrictMode, preserves older pages on return and stops polling on close", async () => {
  const row = (id: string): RssSourceRun => ({ id, mode: "pipeline", createdAt: "2026-10-28T08:00:00Z", completedAt: null, state: "failed", outcome: "succeeded", updated: 3, collected: 2, error: null, reason: null });
  const runs = vi.fn(async ({ cursor }: { cursor?: string }) => cursor === "older" ? { runs: [row("old")], nextCursor: "oldest" } : { runs: [row("new")], nextCursor: "older" });
  const events = vi.fn(async () => ({ events: [{ runId: "new", sequence: 1, timestamp: "2026-10-28T08:00:00Z", state: "running", text: "Real scoped log presentation" }], nextAfter: null }));
  window.openmind = { getRssSourceRuns: runs, getRssSourceRunEvents: events } as unknown as DesktopApi;
  const view = render(<StrictMode><SourceRuns sourceId="one" rootKey="root" open /></StrictMode>);
  await screen.findByText(m.rss.runCounts(3, 2));
  expect(screen.getByText(m.runs.state.succeeded)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: m.rss.moreRuns })); await waitFor(() => expect(screen.getAllByText(m.rss.runCounts(3, 2))).toHaveLength(2));
  fireEvent.click(screen.getAllByRole("button", { name: m.rss.runLogs })[0]); await screen.findByText("Real scoped log presentation");
  expect(events).toHaveBeenCalledWith({ sourceId: "one", rootKey: "root", runId: "new", after: 0, limit: 200 });
  fireEvent.click(screen.getByRole("button", { name: m.rss.back })); await waitFor(() => expect(screen.getAllByText(m.rss.runCounts(3, 2))).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: m.rss.moreRuns })); await waitFor(() => expect(runs).toHaveBeenLastCalledWith({ sourceId: "one", rootKey: "root", cursor: "oldest", limit: 20 }));
  view.rerender(<StrictMode><SourceRuns sourceId="one" rootKey="root" open={false} /></StrictMode>);
  vi.useFakeTimers(); const calls = runs.mock.calls.length;
  await act(async () => { vi.advanceTimersByTime(15000); }); expect(runs).toHaveBeenCalledTimes(calls);
});

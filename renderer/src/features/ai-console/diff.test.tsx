import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiEvent, AiRun } from "@shared/contracts";
import { ChangeReviewCard, ChangeTraceCard } from "./diff";
import { FilePreviewProvider } from "./file-preview-context";

afterEach(cleanup);

function event(id: string, files: Array<Record<string, unknown>>): AiEvent {
  return {
    schemaVersion: 1,
    id,
    seq: Number(id.replace(/\D/g, "")) || 1,
    projectId: "project",
    sessionId: "session",
    runId: "run",
    provider: "codex",
    providerId: "codex-native",
    kind: "changes",
    timestamp: "2026-01-01T00:00:00.000Z",
    payload: { changeSet: { files } },
    risks: []
  } as AiEvent;
}

function run(changeFiles: Array<Record<string, unknown>> = []): AiRun {
  return {
    id: "run",
    changeSet: changeFiles.length ? { files: changeFiles } : null
  } as unknown as AiRun;
}

describe("ChangeReviewCard", () => {
  it("folds incremental change events into one post-final artifact", () => {
    const openPreview = vi.fn();
    const events = [
      event("change-1", [{ path: "src/one.ts", status: "modified", additions: 2, deletions: 1, patch: "one" }]),
      event("change-2", [{ path: "src/two.ts", status: "created", additions: 4, deletions: 0, patch: "two" }])
    ];
    const { container } = render(
      <FilePreviewProvider open={openPreview}>
        <ChangeReviewCard events={events} run={run()} />
      </FilePreviewProvider>
    );

    const card = container.querySelector(".change-review-card");
    expect(card).toBeTruthy();
    expect(card?.querySelector("strong")?.textContent).toContain("2");
    expect(card?.querySelector("em")).toBeNull();
    expect(screen.queryByText("+6 -1")).toBeNull();

    expect(screen.getByText("src/one.ts")).toBeTruthy();
    expect(screen.getByText("src/two.ts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "src/one.ts" }));
    expect(openPreview).toHaveBeenCalledWith("src/one.ts");
  });

  it("uses the durable run change set when the provider emitted no changes event", () => {
    const { container } = render(
      <ChangeReviewCard
        events={[]}
        run={run([{ path: "src/app.ts", status: "modified", additions: 3, deletions: 2, patch: "patch" }])}
      />
    );
    expect(container.querySelector(".change-review-card strong")?.textContent).toContain("1");
    expect(container.querySelector(".change-review-card em")).toBeNull();
    expect(screen.queryByText("+3 -2")).toBeNull();
  });

  it("turns a Codex aggregated unified diff snapshot into file review rows", () => {
    const patch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,2 @@",
      "+one",
      "+two"
    ].join("\n");
    const diffEvent = { ...event("change-3", []), payload: { diff: patch, patch, snapshot: true } };
    const { container } = render(<ChangeReviewCard events={[diffEvent]} run={run()} />);

    expect(container.querySelector(".change-review-card strong")?.textContent).toContain("2");
    expect(container.querySelector(".change-review-card em")).toBeNull();
    expect(screen.getByText("src/app.ts")).toBeTruthy();
    expect(screen.getByText("src/new.ts")).toBeTruthy();
    expect(screen.queryByText("新增 · +2 -0")).toBeNull();
  });

  it("shows three file rows first and reveals the remainder on demand", () => {
    const files = ["one.ts", "two.ts", "three.ts", "four.ts", "five.ts"].map((path) => ({ path, status: "modified" }));
    render(<ChangeReviewCard events={[]} run={run(files)} />);

    expect(screen.getByText("three.ts")).toBeTruthy();
    expect(screen.queryByText("four.ts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "再显示 2 个文件" }));
    expect(screen.getByText("four.ts")).toBeTruthy();
    expect(screen.getByText("five.ts")).toBeTruthy();
    expect(screen.getByRole("button", { name: "收起" })).toBeTruthy();
  });

  it("does not render an empty artifact", () => {
    const { container } = render(<ChangeReviewCard events={[]} run={run()} />);
    expect(container.childElementCount).toBe(0);
  });

  it("derives a unified diff once while opening and closing its trace card", () => {
    const patch = "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new";
    const readPatch = vi.fn(() => patch);
    const payload: Record<string, unknown> = {};
    Object.defineProperty(payload, "diff", { enumerable: true, get: readPatch });
    const diffEvent = { ...event("change-4", []), payload } as AiEvent;

    render(<ChangeTraceCard event={diffEvent} run={run()} />);
    expect(readPatch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByText("src/app.ts").length).toBeGreaterThan(0);
    expect(readPatch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(readPatch).toHaveBeenCalledTimes(1);
  });
});

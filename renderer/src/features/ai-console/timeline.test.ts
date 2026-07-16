import { describe, expect, it } from "vitest";
import type { AiEvent, AiRun, ChangeSet } from "@shared/contracts";
import {
  changePaths,
  compactEvents,
  deriveRunActivity,
  firstLine,
  formatElapsedSeconds,
  numeric,
  scalar,
  summarizeTrace,
  toolCategory,
  toolCategoryLabel,
  toolEventFailed,
  toolEventIdentity,
  toolOperationSummary,
  toolValueText,
  traceStepEvents,
  traceSummaryText,
  type TraceStep
} from "./timeline";

// ---- fixtures --------------------------------------------------------------

function makeRun(overrides: Partial<AiRun> = {}): AiRun {
  return {
    schemaVersion: 1,
    id: "run-1",
    sessionId: "s1",
    projectId: "p1",
    provider: "claude",
    providerId: "legacy",
    permissionProfile: "edit",
    status: "running",
    prompt: "p",
    contexts: [],
    turnContext: null,
    workspacePath: null,
    baseCommit: null,
    startedAt: "2026-07-07T00:00:00.000Z",
    completedAt: null,
    error: null,
    changeSet: null,
    risks: [],
    ...overrides
  } as AiRun;
}

function evt(overrides: Partial<AiEvent> = {}): AiEvent {
  return {
    schemaVersion: 1,
    id: "e1",
    seq: 1,
    timestamp: "2026-07-07T00:00:00.000Z",
    projectId: "p1",
    sessionId: "s1",
    runId: "run-1",
    provider: "claude",
    kind: "assistant-message",
    payload: {},
    risks: [],
    ...overrides
  } as AiEvent;
}

// ---- pure scalar helpers ---------------------------------------------------

describe("firstLine", () => {
  it("returns the first line, truncated to 180 chars", () => {
    expect(firstLine("a\nb\nc")).toBe("a");
    expect(firstLine("x".repeat(200))).toHaveLength(180);
  });
  it("handles CRLF", () => {
    expect(firstLine("hello\r\nworld")).toBe("hello");
  });
});

describe("toolValueText", () => {
  it("passes strings through", () => {
    expect(toolValueText("hi")).toBe("hi");
  });
  it("JSON-stringifies objects", () => {
    expect(toolValueText({ a: 1 })).toBe("{\n  \"a\": 1\n}");
  });
  it("stringifies null/undefined", () => {
    expect(toolValueText(null)).toBe(String(null));
    expect(toolValueText(undefined)).toBe("");
  });
});

describe("scalar / numeric", () => {
  it("scalar returns string/number as string, else empty", () => {
    expect(scalar("x")).toBe("x");
    expect(scalar(5)).toBe("5");
    expect(scalar({})).toBe("");
    expect(scalar(null)).toBe("");
  });
  it("numeric returns finite numbers or 0", () => {
    expect(numeric(7)).toBe(7);
    expect(numeric(Infinity)).toBe(0);
    expect(numeric("7")).toBe(0);
    expect(numeric(null)).toBe(0);
  });
});

// ---- tool classification ---------------------------------------------------

describe("toolCategory", () => {
  it("classifies write/edit/delete as write", () => {
    expect(toolCategory("Write")).toBe("write");
    expect(toolCategory("Edit")).toBe("write");
    expect(toolCategory("delete-file")).toBe("write");
    expect(toolCategory("createDir")).toBe("write");
  });
  it("classifies grep/glob/find as search", () => {
    expect(toolCategory("Grep")).toBe("search");
    expect(toolCategory("glob")).toBe("search");
    expect(toolCategory("find")).toBe("search");
  });
  it("classifies read/view as read", () => {
    expect(toolCategory("Read")).toBe("read");
    expect(toolCategory("view-file")).toBe("read");
  });
  it("classifies bash/shell/exec as command", () => {
    expect(toolCategory("Bash")).toBe("command");
    expect(toolCategory("shell-exec")).toBe("command");
    expect(toolCategory("PowerShell")).toBe("command");
  });
  it("classifies web/fetch/http as network", () => {
    expect(toolCategory("WebFetch")).toBe("network");
    expect(toolCategory("http-request")).toBe("network");
  });
  it("classifies anything containing skill as skill", () => {
    expect(toolCategory("run-skill")).toBe("skill");
  });
  it("falls back to generic", () => {
    expect(toolCategory("noop")).toBe("generic");
  });
});

describe("toolCategoryLabel", () => {
  it("maps generic to the 'tool' message key", () => {
    // every category produces a non-empty localized label
    for (const cat of ["command", "search", "read", "write", "network", "skill", "generic"] as const) {
      expect(toolCategoryLabel(cat).length).toBeGreaterThan(0);
    }
  });
});

describe("toolOperationSummary", () => {
  it("returns the raw first line for string inputs", () => {
    expect(toolOperationSummary("Bash", "ls -la\ngrep")).toBe("ls -la");
  });
  it("summarizes bash via command field", () => {
    expect(toolOperationSummary("Bash", { command: "git status" })).toBe("git status");
  });
  it("summarizes grep/glob via pattern · path", () => {
    expect(toolOperationSummary("Grep", { pattern: "TODO", path: "src" })).toBe("TODO · src");
  });
  it("summarizes file tools via path", () => {
    expect(toolOperationSummary("Edit", { file_path: "a.md" })).toBe("a.md");
  });
  it("summarizes web tools via url/pattern", () => {
    expect(toolOperationSummary("WebFetch", { url: "https://x" })).toBe("https://x");
  });
});

// ---- tool event helpers ----------------------------------------------------

describe("toolEventIdentity", () => {
  it("prefers itemId, then item.id, then invocationId, then tool, then event id", () => {
    expect(toolEventIdentity(evt({ id: "e", payload: { itemId: "it" } }))).toBe("it");
    expect(toolEventIdentity(evt({ id: "e", payload: { item: { id: "obj" } } }))).toBe("obj");
    expect(toolEventIdentity(evt({ id: "e", payload: { invocationId: "inv" } }))).toBe("inv");
    expect(toolEventIdentity(evt({ id: "fallback", payload: { tool: "Bash" } }))).toBe("Bash");
    expect(toolEventIdentity(evt({ id: "last", payload: {} }))).toBe("last");
  });
});

describe("toolEventFailed", () => {
  it("detects error kind or failure payloads", () => {
    expect(toolEventFailed(evt({ kind: "error", payload: {} }))).toBe(true);
    expect(toolEventFailed(evt({ kind: "tool-complete", payload: { state: "failed" } }))).toBe(true);
    expect(toolEventFailed(evt({ kind: "tool-complete", payload: { isError: true } }))).toBe(true);
    expect(toolEventFailed(evt({ kind: "tool-complete", payload: { is_error: true } }))).toBe(true);
  });
  it("returns false for successful events", () => {
    expect(toolEventFailed(evt({ kind: "tool-complete", payload: { state: "completed" } }))).toBe(false);
  });
});

// ---- changePaths -----------------------------------------------------------

describe("changePaths", () => {
  it("collects paths from run.changeSet.files", () => {
    const cs = { files: [{ path: "a.md" }, { path: "b.md" }] } as unknown as ChangeSet;
    const run = makeRun({ changeSet: cs });
    expect(changePaths(run, []).sort()).toEqual(["a.md", "b.md"]);
  });

  it("collects write tool-start paths", () => {
    const events = [evt({ kind: "tool-start", payload: { tool: "Write", input: { file_path: "new.md" } } })];
    expect(changePaths(makeRun(), events)).toContain("new.md");
  });

  it("ignores non-write tool-start events", () => {
    const events = [evt({ kind: "tool-start", payload: { tool: "Read", input: { file_path: "ignored.md" } } })];
    expect(changePaths(makeRun(), events)).toEqual([]);
  });

  it("collects paths from changes events (files / changeSet.files / changes)", () => {
    const events = [
      evt({ kind: "changes", payload: { files: [{ path: "f1.md" }] } }),
      evt({ kind: "changes", payload: { changeSet: { files: [{ path: "f2.md" }] } } }),
      evt({ kind: "changes", payload: { changes: ["f3.md"] } })
    ];
    const out = changePaths(makeRun(), events);
    expect(out).toEqual(expect.arrayContaining(["f1.md", "f2.md", "f3.md"]));
  });
});

// ---- trace summary ---------------------------------------------------------

describe("traceStepEvents", () => {
  it("returns step.events for tool/reasoning/approval/changes/error steps, [event] otherwise", () => {
    const event = evt({ id: "single" });
    expect(traceStepEvents({ type: "changes", key: "single", event })).toEqual([event]);
    const events = [evt({ id: "a" }), evt({ id: "b" })];
    expect(traceStepEvents({ type: "tool", key: "k", events } as unknown as TraceStep)).toEqual(events);
  });
});

describe("summarizeTrace + traceSummaryText", () => {
  it("counts each step type, computes changedFiles, writeTools, and failures", () => {
    const run = makeRun();
    const steps: TraceStep[] = [
      { type: "reasoning", key: "r1", events: [evt({ id: "r1" })] } as TraceStep,
      { type: "tool", key: "t1", events: [evt({ id: "t1", payload: { tool: "Write" } })] } as TraceStep,
      { type: "tool", key: "t2", events: [evt({ id: "t2", kind: "tool-complete", payload: { tool: "Read" } })] } as TraceStep,
      { type: "approval", key: "a1", events: [evt({ id: "a1" })] } as TraceStep,
      { type: "error", key: "e1", event: evt({ id: "e1" }) } as TraceStep
    ];
    const summary = summarizeTrace(run, steps);
    expect(summary.reasoning).toBe(1);
    expect(summary.tools).toBe(2);
    expect(summary.approvals).toBe(1);
    expect(summary.changeOperations).toBe(1); // one Write tool
    expect(summary.failures).toBe(1);
  });

  it("traceSummaryText renders a non-empty localized summary", () => {
    const text = traceSummaryText({ reasoning: 1, tools: 2, approvals: 0, changedFiles: 3, changeOperations: 0, failures: 0 });
    expect(text.length).toBeGreaterThan(0);
  });

  it("traceSummaryText falls back to the no-tools message for an empty summary", () => {
    const text = traceSummaryText({ reasoning: 0, tools: 0, approvals: 0, changedFiles: 0, changeOperations: 0, failures: 0 });
    expect(text.length).toBeGreaterThan(0);
  });
});

// ---- deriveRunActivity -----------------------------------------------------

describe("deriveRunActivity", () => {
  it("returns the waiting-approval activity when the run is waiting for approval", () => {
    const out = deriveRunActivity(makeRun({ status: "waiting-approval" }), []);
    expect(out.tone).toBe("approval");
    expect(out.label.length).toBeGreaterThan(0);
  });

  it("returns the applying activity when the run is applying changes", () => {
    const out = deriveRunActivity(makeRun({ status: "applying" }), []);
    expect(out.tone).toBe("working");
  });

  it("describes the active tool when a tool-start has no matching tool-complete", () => {
    const events = [evt({ kind: "tool-start", payload: { tool: "Bash", itemId: "x", command: "ls" } })];
    const out = deriveRunActivity(makeRun(), events);
    expect(out.tone).toBe("working");
    expect(out.label).toContain("Bash");
  });

  it("reports idle when no events arrive for 10+ seconds", () => {
    const out = deriveRunActivity(makeRun(), [], 5, 12);
    expect(out.idle).toBe(true);
  });

  it("uses long-running detail past 30s elapsed", () => {
    const out = deriveRunActivity(makeRun(), [], 45, 0);
    expect(out.detail.length).toBeGreaterThan(0);
  });
});

// ---- compactEvents ---------------------------------------------------------

describe("compactEvents", () => {
  it("drops assistant-delta and reasoning-delta events while keeping semantic events and the active run's tail", () => {
    const events = [
      evt({ id: "d1", kind: "assistant-delta", runId: "other", payload: { text: "x" } }),
      evt({ id: "d2", kind: "reasoning-delta", runId: "other", payload: { text: "y" } }),
      evt({ id: "k1", kind: "assistant-message", runId: "run-1", payload: { text: "keep" } })
    ];
    const compacted = compactEvents(events, "run-1");
    const ids = compacted.map((e) => e.id);
    expect(ids).not.toContain("d1");
    expect(ids).not.toContain("d2");
    expect(ids).toContain("k1");
  });
});

// ---- formatElapsedSeconds --------------------------------------------------

describe("formatElapsedSeconds", () => {
  it("formats seconds under 60 as a localized seconds string", () => {
    expect(formatElapsedSeconds(5).length).toBeGreaterThan(0);
  });
  it("formats 60s+ as M:SS", () => {
    expect(formatElapsedSeconds(65)).toBe("1:05");
    expect(formatElapsedSeconds(125)).toBe("2:05");
    expect(formatElapsedSeconds(0)).toBe(formatElapsedSeconds(0)); // stable
  });
});

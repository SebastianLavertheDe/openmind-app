import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AiEvent, AiRun, RiskFinding } from "../../shared/contracts";
import { buildApprovalAudit, writeSecurityReportFile } from "./security-report";

function makeEvent(overrides: Partial<AiEvent> & { payload: Record<string, unknown> }): AiEvent {
  return {
    id: "evt",
    seq: 1,
    timestamp: "2026-07-07T00:00:00.000Z",
    projectId: "p",
    sessionId: "s",
    runId: "r1",
    provider: "claude",
    kind: "approval-request",
    risks: [],
    ...overrides
  } as AiEvent;
}

describe("buildApprovalAudit", () => {
  it("filters to the requested run and approval kinds only", () => {
    const events = [
      makeEvent({ id: "a", runId: "r1", kind: "approval-request", payload: { approval: { category: "command", title: "t", command: "ls", paths: [] } } }),
      makeEvent({ id: "b", runId: "r2", kind: "approval-request", payload: { approval: { category: "command" } } }),
      makeEvent({ id: "c", runId: "r1", kind: "assistant-message", payload: { text: "x" } })
    ];
    const audit = buildApprovalAudit(events, "r1");
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0]).toMatchObject({ eventId: "a", category: "command", title: "t", command: "ls", paths: [] });
  });

  it("extracts fields from payload top-level when approval object is absent", () => {
    const events = [
      makeEvent({ id: "d", kind: "approval-decision", payload: { decision: "accepted", category: "network", approvalId: "ap-1", command: "curl" } })
    ];
    const audit = buildApprovalAudit(events, "r1");
    expect(audit.records[0]).toMatchObject({ decision: "accepted", category: "network", approvalId: "ap-1", command: "curl" });
  });

  it("coerces paths to string array and surfaces dangerous categories", () => {
    const events = [
      makeEvent({ id: "e", kind: "approval-request", payload: { approval: { category: "delete", paths: ["/a", 1] } } }),
      makeEvent({ id: "f", kind: "approval-request", payload: { approval: { category: "outside-workspace" } } }),
      makeEvent({ id: "g", kind: "approval-request", payload: { approval: { category: "elevation" } } }),
      makeEvent({ id: "h", kind: "approval-request", payload: { approval: { category: "command" } } })
    ];
    const audit = buildApprovalAudit(events, "r1");
    expect(audit.records).toHaveLength(4);
    expect(audit.records[0].paths).toEqual(["/a", "1"]);
    // distinct dangerous categories, order preserved as discovered
    expect(audit.dangerousCategories.sort()).toEqual(["delete", "elevation", "outside-workspace"]);
  });
});

describe("writeSecurityReportFile", () => {
  it("writes an atomic security-report.json with audit + risks + run metadata", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-report-"));
    try {
      const run = { id: "r1" } as AiRun;
      const risks: RiskFinding[] = [{ id: "rk1", kind: "token", severity: "high", summary: "leak" }];
      const events = [makeEvent({ id: "i", kind: "approval-request", payload: { approval: { category: "delete", paths: [] } } })];
      writeSecurityReportFile(run, risks, events, dir);

      const written = JSON.parse(fs.readFileSync(path.join(dir, "security-report.json"), "utf8"));
      expect(written.runId).toBe("r1");
      expect(written.policy).toBe("warn-only");
      expect(written.findings).toEqual(risks);
      expect(written.dangerousCategories).toEqual(["delete"]);
      expect(written.approvals).toHaveLength(1);
      expect(written.generatedAt).toBeTruthy();
      // no .tmp leftovers
      expect(fs.readdirSync(dir).filter((f) => f.startsWith("security-report.json.tmp"))).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

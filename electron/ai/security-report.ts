import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION, type AiEvent, type AiRun, type RiskFinding } from "../../shared/contracts";
import { asRecord } from "../../shared/utils";
import { replaceFileAtomicallySync } from "./process-utils";

export type ApprovalAuditRecord = {
  eventId: string;
  kind: "approval-request" | "approval-decision";
  timestamp: string;
  approvalId: string | null;
  category: string | null;
  decision: string | null;
  title: string | null;
  command: string | null;
  paths: string[];
};

export type ApprovalAudit = {
  records: ApprovalAuditRecord[];
  dangerousCategories: string[];
};

/**
 * 纯领域逻辑：从一组 events 聚合某 run 的审批审计记录与危险类别。与存储无关——
 * 从 SessionStore.approvalAuditForRun 抽出，使其可独立单测（输入 events 数组即可）。
 */
export function buildApprovalAudit(events: AiEvent[], runId: string): ApprovalAudit {
  const records = events
    .filter((event) => event.runId === runId && (event.kind === "approval-request" || event.kind === "approval-decision"))
    .map((event) => {
      const approval = asRecord(event.payload.approval);
      const paths = Array.isArray(approval.paths) ? approval.paths.map(String) : [];
      return {
        eventId: event.id,
        kind: event.kind as "approval-request" | "approval-decision",
        timestamp: event.timestamp,
        approvalId: String(event.payload.approvalId || approval.id || "") || null,
        category: String(approval.category || event.payload.category || "") || null,
        decision: String(event.payload.decision || "") || null,
        title: String(approval.title || event.payload.title || "") || null,
        command: String(approval.command || event.payload.command || "") || null,
        paths
      };
    });
  const dangerousCategories = [...new Set(records
    .map((record) => record.category)
    .filter((category): category is string => category === "delete" || category === "outside-workspace" || category === "elevation"))];
  return { records, dangerousCategories };
}

/**
 * 写 security-report.json：用 buildApprovalAudit 聚合审批审计，连同风险发现原子落盘。
 * events 由调用方（SessionStore）从 rollout 重建后传入；runDir 是该 run 的目录。
 */
export function writeSecurityReportFile(run: AiRun, risks: RiskFinding[], events: AiEvent[], runDir: string): void {
  const audit = buildApprovalAudit(events, run.id);
  fs.mkdirSync(runDir, { recursive: true });
  const target = path.join(runDir, "security-report.json");
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      runId: run.id,
      generatedAt: new Date().toISOString(),
      policy: "warn-only",
      approvals: audit.records,
      dangerousCategories: audit.dangerousCategories,
      findings: risks
    }, null, 2)}\n`, "utf8");
    replaceFileAtomicallySync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

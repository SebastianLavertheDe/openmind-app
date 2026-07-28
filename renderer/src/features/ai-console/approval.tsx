import { useEffect, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, ShieldAlert } from "lucide-react";
import type { AiEvent, ApprovalRequest, RiskFinding } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { errorText, formatDateTime } from "../../ai-utils";
import { useAi } from "../../ai-context";
import { useExitPresence } from "../../design-system/use-exit-presence";
import { asRecord, scalar } from "./timeline";

export function ApprovalCard({ approval, risks = [] }: { approval: ApprovalRequest; risks?: RiskFinding[] }) {
  const ai = useAi();
  const [busyAction, setBusyAction] = useState<"accept" | "accept-session" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const declineTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  // P1-APR-1: 详情面板收起动画——用 useExitPresence 保留卸载前的内容做退场。
  // 所有 hooks 必须在 early return 之前调用,遵守 Rules of Hooks。
  const { visible: detailsVisible, leaving: detailsLeaving } = useExitPresence(detailsOpen, 200);
  const [stashedApproval, setStashedApproval] = useState(approval);
  const [stashedRisks, setStashedRisks] = useState(risks);
  useEffect(() => () => { mountedRef.current = false; }, []);
  useEffect(() => { if (detailsOpen) { setStashedApproval(approval); setStashedRisks(risks); } }, [detailsOpen, approval, risks]);
  const current = ai.snapshot.pendingApprovals.find((item) => item.id === approval.id);
  if (!current) return null;
  const commitResolution = async (value: "accept" | "accept-session" | "decline") => {
    const resolved = await window.cctools.aiResolveApproval(approval.id, value);
    if (!resolved) throw new Error(m.ai.approval.alreadyHandled);
    await ai.refresh();
  };
  const resolve = async (value: "accept" | "accept-session" | "decline") => {
    const busy = Boolean(busyAction);
    if (busy) return;
    setBusyAction(value);
    setError(null);
    const subject = approval.command || approval.paths[0] || approval.title;
    if (value === "decline") {
      declineTimerRef.current = window.setTimeout(() => {
        declineTimerRef.current = null;
        void commitResolution("decline").catch((cause) => {
          if (mountedRef.current) setError(errorText(cause));
        }).finally(() => {
          if (mountedRef.current) setBusyAction(null);
        });
      }, 5_000);
      ai.notify(m.ai.approval.declinedToast(subject), "info", {
        durationMs: 5_000,
        action: {
          label: m.ai.approval.undo,
          onClick: () => {
            if (!declineTimerRef.current) {
              ai.notify(m.ai.approval.undoExpired, "info");
              return;
            }
            window.clearTimeout(declineTimerRef.current);
            declineTimerRef.current = null;
            if (mountedRef.current) setBusyAction(null);
          }
        }
      });
      return;
    }
    try {
      await commitResolution(value);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyAction(null);
    }
  };
  const busy = Boolean(busyAction);
  const titleId = `approval-title-${approval.id}`;
  // Bar shows the command (or path / first line of detail) so the user can tell
  // at a glance what is being asked without opening details.
  const barText = approval.command || approval.paths[0] || approval.detail || approval.title;
  return (
    <section
      className="approval-card approval-prompt"
      role="alert"
      aria-labelledby={titleId}
      data-open={detailsOpen || undefined}
    >
      <div className="approval-bar">
        <span className="approval-bar-icon" aria-hidden="true"><ShieldAlert size={15} /></span>
        <span className="approval-bar-label">{m.ai.approval.executeAsk}</span>
        <code className="approval-bar-cmd" id={titleId} title={barText}><DangerousCommandText text={barText} /></code>
        <button
          type="button"
          className="approval-detail-toggle"
          aria-expanded={detailsOpen}
          aria-controls={`approval-detail-${approval.id}`}
          onClick={() => setDetailsOpen((value) => !value)}
        >
          {m.ai.approval.details}
          <ChevronDown size={13} className={detailsOpen ? "approval-detail-chev-open" : undefined} />
        </button>
        <span className="approval-bar-actions">
          <button
            type="button"
            className="approval-btn approval-btn-danger"
            disabled={busy}
            onClick={() => void resolve("decline")}
          >
            {busyAction === "decline" ? <LoaderCircle className="spin" size={13} /> : null}
            {m.ai.approval.decline}
          </button>
          <button
            type="button"
            className="approval-btn approval-btn-primary"
            disabled={busy}
            onClick={() => void resolve("accept")}
          >
            {busyAction === "accept" ? <LoaderCircle className="spin" size={13} /> : null}
            {m.ai.approval.allow}
          </button>
        </span>
      </div>

      {detailsVisible ? (
        <div
          className="approval-detail-panel"
          id={`approval-detail-${approval.id}`}
          data-leaving={detailsLeaving || undefined}
        >
          <strong className="approval-detail-title">{stashedApproval.title}</strong>
          {stashedApproval.detail ? (
            <div className="approval-detail-section">
              <span className="approval-detail-heading">{m.ai.approval.requestDetail}</span>
              <pre className="approval-detail-pre">{stashedApproval.detail}</pre>
            </div>
          ) : null}
          <div className="approval-detail-meta">
            <span>{approvalCategoryLabel(stashedApproval.category)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDateTime(stashedApproval.createdAt)}</span>
            {stashedApproval.cwd ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="approval-detail-cwd">{stashedApproval.cwd}</span>
              </>
            ) : null}
          </div>
          {stashedApproval.paths.length ? (
            <div className="approval-detail-section">
              <span className="approval-detail-heading">{m.ai.approval.affectedPaths}</span>
              <pre className="approval-detail-pre approval-detail-paths">{stashedApproval.paths.join("\n")}</pre>
            </div>
          ) : null}
          {stashedRisks.length ? (
            <ul className="approval-detail-risks">
              {stashedRisks.map((risk) => (
                <li key={risk.id}>{risk.summary}</li>
              ))}
            </ul>
          ) : null}
          <div className="approval-detail-footer">
            <button
              type="button"
              className="approval-btn approval-btn-warning"
              disabled={busy}
              onClick={() => void resolve("accept-session")}
            >
              {busyAction === "accept-session" ? <LoaderCircle className="spin" size={13} /> : null}
              {m.ai.approval.acceptSession}
            </button>
            <span className="approval-hint">{m.ai.approval.sessionHint}</span>
          </div>
        </div>
      ) : null}

      {error ? <p className="inline-error">{error}</p> : null}
    </section>
  );
}

function DangerousCommandText({ text }: { text: string }) {
  const chunks = text.split(/(\brm\s+-rf\b|\brm\b|\bsudo\b|\bRemove-Item\b|\bdel\b|\bformat\b|>>?|chmod\s+777|\bcurl\b|\bwget\b|\biwr\b|\bInvoke-WebRequest\b)/gi);
  return (
    <>
      {chunks.map((chunk, index) => {
        if (!chunk) return null;
        const dangerous = /^(rm\s+-rf|rm|sudo|Remove-Item|del|format|>|>>|chmod\s+777|curl|wget|iwr|Invoke-WebRequest)$/i.test(chunk);
        return dangerous ? <mark key={index}>{chunk}</mark> : <span key={index}>{chunk}</span>;
      })}
    </>
  );
}

export function ApprovalDecisionEvent({ event }: { event: AiEvent }) {
  const decision = String(event.payload.decision || "processed");
  const declined = decision === "decline";
  const subject = approvalDecisionSubject(event);
  return (
    <span
      className={`approval-decision-inline ${declined ? "declined" : "accepted"}`}
      data-declined={declined || undefined}
      title={subject}
    >
      {declined ? m.ai.approval.decisionLine.declined(subject) : m.ai.approval.decisionLine.ran(subject)}
    </span>
  );
}

function approvalCategoryLabel(value: ApprovalRequest["category"]): string {
  const labels: Record<ApprovalRequest["category"], string> = {
    command: m.ai.approval.category.command,
    "file-change": m.ai.approval.category.fileChange,
    delete: m.ai.approval.category.delete,
    "outside-workspace": m.ai.approval.category.outsideWorkspace,
    network: m.ai.approval.category.network,
    elevation: m.ai.approval.category.elevation,
    tool: m.ai.approval.category.tool
  };
  return labels[value];
}

function approvalDecisionSubject(event: AiEvent): string {
  const approval = asRecord(event.payload.approval);
  const paths = approval.paths;
  const path = Array.isArray(paths) ? paths.map(scalar).find(Boolean) : "";
  return scalar(approval.command)
    || path
    || scalar(approval.title)
    || scalar(approval.detail)
    || m.ai.approval.category.tool;
}

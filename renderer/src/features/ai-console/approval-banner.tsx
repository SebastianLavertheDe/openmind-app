import { useEffect, useRef, useState } from "react";
import type { ApprovalRequest } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { useAi } from "../../ai-context";
import { useExitingList } from "../../design-system/use-exiting-list";
import { ApprovalCard } from "./approval";

/**
 * 审批卡位于聊天滚动区之外、composer 正上方。它不会随历史消息滚动，
 * 同时保留输入框，并为长命令和批量审批提供独立的纵向空间。
 */
export function ApprovalBanner() {
  const ai = useAi();
  const pendingApprovals = ai.snapshot.pendingApprovals.filter(
    (approval) => approval.sessionId.startsWith("agent:") || !ai.activeSession || approval.sessionId === ai.activeSession.id
  );
  const approvalList = useExitingList(pendingApprovals, (approval) => String(approval.id), 200);
  if (!approvalList.length) return null;
  return (
    <div className="approval-banner" role="region" aria-label="待审批操作" aria-live="polite">
      {approvalList.length > 1 ? <ApprovalBatchBar approvals={pendingApprovals} /> : null}
      <div className="approval-banner-list">
        {approvalList.map(({ item: approval, leaving }) => {
          const requestEvent = ai.events.find((event) => {
            if (event.kind !== "approval-request") return false;
            const request = event.payload.approval as ApprovalRequest | undefined;
            return request?.id === approval.id || event.payload.approvalId === approval.id;
          });
          return (
            <div key={approval.id} className="ui-overlay" data-leaving={leaving || undefined}>
              <ApprovalCard approval={approval} risks={requestEvent?.risks} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** P1-APR-4: 多审批批量操作。 */
function ApprovalBatchBar({ approvals }: { approvals: ApprovalRequest[] }) {
  const ai = useAi();
  const [busy, setBusy] = useState(false);
  const declineTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const resolveAll = async (value: "accept" | "decline") => {
    if (busy) return;
    setBusy(true);
    if (value === "decline") {
      declineTimerRef.current = window.setTimeout(() => {
        declineTimerRef.current = null;
        void Promise.all(approvals.map((approval) => window.cctools.aiResolveApproval(approval.id, "decline")))
          .then(() => ai.refresh())
          .catch(() => undefined)
          .finally(() => { if (mountedRef.current) setBusy(false); });
      }, 5_000);
      ai.notify(m.ai.approval.declinedToast(m.ai.approval.batchSummary(approvals.length)), "info", {
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
            if (mountedRef.current) setBusy(false);
          }
        }
      });
      return;
    }
    try {
      await Promise.all(approvals.map((approval) => window.cctools.aiResolveApproval(approval.id, value)));
      await ai.refresh();
    } catch {
      // 单个失败由卡片自身展示错误。
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="approval-batch-bar">
      <span>{m.ai.approval.batchSummary(approvals.length)}</span>
      <div className="approval-batch-actions">
        <button type="button" className="approval-btn approval-btn-danger" disabled={busy} onClick={() => void resolveAll("decline")}>
          {m.ai.approval.declineAll}
        </button>
        <button type="button" className="approval-btn approval-btn-primary" disabled={busy} onClick={() => void resolveAll("accept")}>
          {m.ai.approval.allowAll}
        </button>
      </div>
    </div>
  );
}

import crypto from "node:crypto";
import type { ApprovalDecision, ApprovalRequest, AiRun } from "../../shared/contracts";

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
}

export class ApprovalBroker {
  private pending = new Map<string, PendingApproval>();
  private sessionGrants = new Map<string, Set<string>>();

  constructor(private onRequest: (request: ApprovalRequest) => void) {}

  list(): ApprovalRequest[] {
    return [...this.pending.values()].map((entry) => entry.request);
  }

  request(run: AiRun, input: Omit<ApprovalRequest, "id" | "runId" | "sessionId" | "createdAt" | "status">): Promise<ApprovalDecision> {
    const signature = `${input.category}:${input.command || input.detail}`;
    if (this.sessionGrants.get(run.sessionId)?.has(signature)) return Promise.resolve("accept-session");
    const request: ApprovalRequest = {
      ...input,
      id: crypto.randomUUID(),
      runId: run.id,
      sessionId: run.sessionId,
      createdAt: new Date().toISOString(),
      status: "pending"
    };
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(request.id, { request, resolve });
      this.onRequest(request);
    });
  }

  resolve(id: string, decision: ApprovalDecision): boolean {
    const pending = this.pending.get(id);
    if (!pending) return false;
    if (decision === "accept-session" && canRememberForSession(pending.request.category)) {
      const signature = `${pending.request.category}:${pending.request.command || pending.request.detail}`;
      const grants = this.sessionGrants.get(pending.request.sessionId) || new Set<string>();
      grants.add(signature);
      this.sessionGrants.set(pending.request.sessionId, grants);
    }
    this.pending.delete(id);
    pending.resolve(decision);
    return true;
  }

  declineForRun(runId: string): ApprovalRequest[] {
    const declined: ApprovalRequest[] = [];
    for (const [id, pending] of this.pending) {
      if (pending.request.runId !== runId) continue;
      this.pending.delete(id);
      declined.push(pending.request);
      pending.resolve("decline");
    }
    return declined;
  }
}

function canRememberForSession(category: ApprovalRequest["category"]): boolean {
  return category !== "delete" && category !== "outside-workspace" && category !== "elevation";
}

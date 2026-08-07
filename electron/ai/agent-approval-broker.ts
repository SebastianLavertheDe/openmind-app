import crypto from "node:crypto";
import type { ApprovalDecision, ApprovalRequest } from "../../shared/contracts";

export type AgentApprovalInput = {
  tool: "mymind_read" | "mymind_write" | "shell" | "web_fetch" | "browser" | "skill_run";
  detail: string;
  paths?: string[];
  network?: boolean;
};

interface PendingAgentApproval {
  request: ApprovalRequest;
  resolve: (decision: "allow" | "deny") => void;
}

/**
 * ApprovalBroker is tied to AiRun/SessionStore. Internal Agent Runs belong to
 * ExecutionBroker instead, so they use this small parallel broker while
 * sharing the same ApprovalRequest contract and renderer IPC action.
 */
export class AgentApprovalBroker {
  private readonly pending = new Map<string, PendingAgentApproval>();
  private readonly runGrants = new Map<string, Set<string>>();

  constructor(private readonly onRequest: (request: ApprovalRequest) => void) {}

  list(): ApprovalRequest[] {
    return [...this.pending.values()].map((entry) => entry.request);
  }

  request(runId: string, input: AgentApprovalInput): Promise<"allow" | "deny"> {
    const category = categoryFor(input.tool);
    const signature = `${category}:${input.detail}`;
    if (this.runGrants.get(runId)?.has(signature)) return Promise.resolve("allow");

    const request: ApprovalRequest = {
      id: crypto.randomUUID(),
      runId,
      // Agent approvals are deliberately scoped to one Broker Run. The UI
      // recognizes this prefix and displays them even without an Ai session.
      sessionId: `agent:${runId}`,
      providerRequestId: crypto.randomUUID(),
      category,
      title: `Internal Agent · ${input.tool}`,
      detail: input.detail,
      ...(input.tool === "shell" ? { command: input.detail } : {}),
      paths: input.paths || [],
      createdAt: new Date().toISOString(),
      status: "pending"
    };
    return new Promise<"allow" | "deny">((resolve) => {
      this.pending.set(request.id, { request, resolve });
      this.onRequest(request);
    });
  }

  resolve(id: string, decision: ApprovalDecision): boolean {
    const pending = this.pending.get(id);
    if (!pending) return false;
    if (decision === "accept-session" && canRememberForRun(pending.request.category)) {
      const runId = pending.request.runId;
      const signature = `${pending.request.category}:${pending.request.detail}`;
      const grants = this.runGrants.get(runId) || new Set<string>();
      grants.add(signature);
      this.runGrants.set(runId, grants);
    }
    this.pending.delete(id);
    pending.resolve(decision === "decline" ? "deny" : "allow");
    return true;
  }

  declineForRun(runId: string): ApprovalRequest[] {
    const declined: ApprovalRequest[] = [];
    for (const [id, pending] of this.pending) {
      if (pending.request.runId !== runId) continue;
      this.pending.delete(id);
      declined.push(pending.request);
      pending.resolve("deny");
    }
    this.runGrants.delete(runId);
    return declined;
  }
}

function categoryFor(tool: AgentApprovalInput["tool"]): ApprovalRequest["category"] {
  if (tool === "mymind_write") return "file-change";
  if (tool === "shell") return "command";
  if (tool === "web_fetch") return "network";
  return "tool";
}

function canRememberForRun(category: ApprovalRequest["category"]): boolean {
  return category !== "delete" && category !== "outside-workspace" && category !== "elevation";
}

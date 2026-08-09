import crypto from "node:crypto";
import { RunScheduler } from "./scheduler";
import { AUTO_MODEL } from "../../shared/model-catalog";
import { browserAutomationConfigFromEnv } from "./browser-evidence";
import { CredentialKindSchema, type CredentialKind } from "../../shared/provider-profiles";

type WorkerRequest = { id: string; method: string; args: unknown[] };
type CredentialResponse = { type: "credential-response"; id: string; secret?: string; error?: string } | { type: "credential-kind-response"; id: string; kind?: CredentialKind | null; error?: string };
const parentPort = (process as unknown as { parentPort?: { on(event: string, callback: (message: { data: WorkerRequest | CredentialResponse }) => void): void; postMessage(message: unknown): void } }).parentPort;
if (!parentPort) throw new Error("AI worker must run as an Electron utility process.");
const port = parentPort;

const pendingCredentials = new Map<string, { resolve: (secret: string) => void; reject: (error: Error) => void }>();
const pendingCredentialKinds = new Map<string, { resolve: (kind: CredentialKind | null) => void; reject: (error: Error) => void }>();

const projectRoot = process.env.CCTOOLS_REPO_ROOT;
if (!projectRoot) throw new Error("CCTOOLS_REPO_ROOT is required.");
const stateRoot = process.env.CCTOOLS_STATE_ROOT?.trim() || undefined;
const mymindRoot = process.env.CCTOOLS_MYMIND_ROOT?.trim() || undefined;
const rootGeneration = Number(process.env.CCTOOLS_ROOT_GENERATION) || 1;

const scheduler = new RunScheduler(
  projectRoot,
  (payload) => port.postMessage({ type: "push", payload }),
  // 模型始终交给 Codex / Claude Code 自己的配置决定。保留 scheduler 的注入点仅供单元测试。
  () => AUTO_MODEL,
  browserAutomationConfigFromEnv(),
  stateRoot,
  mymindRoot,
  rootGeneration,
  (credentialId, scope) => requestCredential(credentialId, scope),
  (credentialId) => requestCredentialKind(credentialId)
);

// 启动时异步探测一次 provider（本机 + WSL），完成后由 scheduler 推送 snapshot。
// 探测走 spawn 不阻塞事件循环；之后整次会话期 send/snapshot 只读这份缓存。
void scheduler.refreshProviders();

port.on("message", ({ data }) => {
  if (data && "type" in data && data.type === "credential-kind-response") {
    const pending = pendingCredentialKinds.get(data.id);
    if (!pending) return;
    pendingCredentialKinds.delete(data.id);
    if (data.error) pending.reject(new Error(data.error));
    else {
      try { pending.resolve(data.kind === null || data.kind === undefined ? null : CredentialKindSchema.parse(data.kind)); }
      catch (error) { pending.reject(error instanceof Error ? error : new Error(String(error))); }
    }
    return;
  }
  if (data && "type" in data && data.type === "credential-response") {
    const pending = pendingCredentials.get(data.id);
    if (!pending) return;
    pendingCredentials.delete(data.id);
    if (data.error) pending.reject(new Error(data.error));
    else if (data.secret) pending.resolve(data.secret);
    else pending.reject(new Error("Credential response 为空。"));
    return;
  }
  void dispatch(data as WorkerRequest).then(
    (result) => port.postMessage({ type: "response", id: (data as WorkerRequest).id, result }),
    (error) => port.postMessage({ type: "response", id: (data as WorkerRequest).id, error: error instanceof Error ? error.message : String(error) })
  );
});

function requestCredential(credentialId: string, scope: unknown): Promise<string> {
  const id = `credential-${crypto.randomUUID()}`;
  port.postMessage({ type: "credential-request", id, credentialId, scope });
  return new Promise((resolve, reject) => pendingCredentials.set(id, { resolve, reject }));
}

function requestCredentialKind(credentialId: string): Promise<CredentialKind | null> {
  const id = `credential-kind-${crypto.randomUUID()}`;
  port.postMessage({ type: "credential-kind-request", id, credentialId });
  return new Promise((resolve, reject) => pendingCredentialKinds.set(id, { resolve, reject }));
}

async function dispatch(request: WorkerRequest): Promise<unknown> {
  const [first, second, third] = request.args;
  switch (request.method) {
    case "snapshot": return scheduler.snapshot();
    case "refresh-providers": return scheduler.refreshProviders();
    case "events": return scheduler.getEvents(String(first));
    case "turns": return scheduler.getTurns(String(first), (second || {}) as never);
    case "context-state": return scheduler.getContextState(String(first));
    case "search": return scheduler.searchSessions(String(first || ""));
    case "skills": return scheduler.listSkills();
    case "active-count": return scheduler.activeTaskCount();
    case "refresh-skills": return scheduler.refreshSkills();
    case "prewarm": return scheduler.prewarmClaude(typeof first === "string" ? first : undefined);
    case "run-skill": return scheduler.startSkill(String(first), typeof second === "string" ? second : undefined);
    case "stop-skill": return scheduler.stopSkill(String(first));
    case "skill-run-list": return scheduler.listSkillRuns();
    case "skill-run-get": return scheduler.getSkillRun(String(first));
    case "skill-run-events": return scheduler.getSkillRunEvents(String(first));
    case "run-list-artifacts": return scheduler.listRunArtifacts(typeof first === "string" && first ? first : undefined);
    case "run-retry": return scheduler.retrySkillRun(String(first));
    case "agent-run-resume": return scheduler.resumeAgentRun(first as never);
    case "credential-revoked": return scheduler.revokeCredential(String(first));
    case "credential-available": return scheduler.restoreCredential(String(first));
    case "credential-replaced": return scheduler.rotateCredential(String(first));
    case "run-retry-step": return scheduler.retryWorkflowStep(String(first), String(second));
    case "run-delete-history": return scheduler.deleteRunHistory(String(first));
    case "skill-run-cancel": return scheduler.cancelSkillRun(String(first));
    case "skill-run-approve": return scheduler.approveSkillRun(String(first));
    case "workflow-run-start": return scheduler.startWorkflowRun(first as never);
    case "workflow-run-list": return scheduler.listWorkflowRuns();
    case "workflow-run-get": return scheduler.getWorkflowRun(String(first));
    case "workflow-run-resume": return scheduler.resumeWorkflowRun(first as never);
    case "workflow-run-cancel": return scheduler.cancelWorkflowRun(String(first));
    case "automation-rules-list": return scheduler.listAutomationRules();
    case "automation-rule-save": return scheduler.saveAutomationRule(first as never);
    case "automation-rule-delete": return scheduler.deleteAutomationRule(String(first));
    case "automation-run-now": return scheduler.runAutomationNow(String(first));
    case "automation-runs-list": return scheduler.listAutomationRuns(typeof first === "string" ? first : undefined);
    case "automation-schedules-list": return scheduler.listAutomationSchedules();
    case "run-source": {
      const input = (third || {}) as { date?: string; url?: string; name?: string };
      return scheduler.startSource(String(first), String(second), input.date, input.url, input.name);
    }
    case "stop-source": return scheduler.stopSource(String(first));
    case "start": return scheduler.startRun(first as never);
    case "cancel": return scheduler.cancelRun(String(first));
    case "update-session": return scheduler.updateSession(String(first), second as never);
    case "delete-session": return scheduler.deleteSession(String(first));
    case "fork-session": return scheduler.forkSession(String(first), typeof second === "string" ? second : undefined);
    case "rollback-turns": return scheduler.rollbackTurns(String(first), Number(second));
    case "resolve-approval": return scheduler.resolveApproval(String(first), second as never);
    case "change-set": return scheduler.getChangeSet(String(first));
    case "apply-change": return scheduler.applyChange(String(first), typeof second === "string" ? second : undefined);
    case "revert-change": return scheduler.revertChange(String(first), String(second));
    case "discard-change": return scheduler.discardChange(String(first), String(second));
    case "discard-run": return scheduler.discardRun(String(first));
    default: throw new Error(`Unknown AI worker method: ${request.method}`);
  }
}

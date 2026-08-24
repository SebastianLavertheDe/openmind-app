import { RunScheduler } from "./scheduler";
import { AUTO_MODEL } from "../../shared/model-catalog";
import { browserAutomationConfigFromEnv } from "./browser-evidence";

type WorkerRequest = { id: string; method: string; args: unknown[] };
const parentPort = (process as unknown as { parentPort?: { on(event: string, callback: (message: { data: WorkerRequest }) => void): void; postMessage(message: unknown): void } }).parentPort;
if (!parentPort) throw new Error("AI worker must run as an Electron utility process.");
const port = parentPort;

const projectRoot = process.env.OPENMIND_REPO_ROOT;
if (!projectRoot) throw new Error("OPENMIND_REPO_ROOT is required.");
const stateRoot = process.env.OPENMIND_STATE_ROOT?.trim() || undefined;
const openmindRoot = process.env.OPENMIND_ROOT?.trim() || undefined;
const rootGeneration = Number(process.env.OPENMIND_ROOT_GENERATION) || 1;

const scheduler = new RunScheduler(
  projectRoot,
  (payload) => port.postMessage({ type: "push", payload }),
  // 模型始终交给 Codex / Claude Code 自己的配置决定。保留 scheduler 的注入点仅供单元测试。
  () => AUTO_MODEL,
  browserAutomationConfigFromEnv(),
  stateRoot,
  openmindRoot,
  rootGeneration
);

// 启动时异步探测一次 provider（本机 + WSL），完成后由 scheduler 推送 snapshot。
// 探测走 spawn 不阻塞事件循环；之后整次会话期 send/snapshot 只读这份缓存。
void scheduler.refreshProviders();

port.on("message", ({ data }) => {
  void dispatch(data as WorkerRequest).then(
    (result) => port.postMessage({ type: "response", id: (data as WorkerRequest).id, result }),
    (error) => port.postMessage({ type: "response", id: (data as WorkerRequest).id, error: error instanceof Error ? error.message : String(error) })
  );
});

async function dispatch(request: WorkerRequest): Promise<unknown> {
  const [first, second] = request.args;
  switch (request.method) {
    case "snapshot": return scheduler.snapshot();
    case "refresh-providers": return scheduler.refreshProviders();
    case "events": return scheduler.getEvents(String(first));
    case "turns": return scheduler.getTurns(String(first), (second || {}) as never);
    case "search": return scheduler.searchSessions(String(first || ""));
    case "skills": return scheduler.listSkills();
    case "active-count": return scheduler.activeTaskCount();
    case "credential-revoked": return scheduler.revokeCredential(String(first));
    case "credential-available": return scheduler.restoreCredential(String(first));
    case "credential-replaced": return scheduler.rotateCredential(String(first));
    case "refresh-skills": return scheduler.refreshSkills();
    case "prewarm": return scheduler.prewarmClaude(typeof first === "string" ? first : undefined);
    case "skill-run-list": return scheduler.listSkillRuns();
    case "skill-run-get": return scheduler.getSkillRun(String(first));
    case "skill-run-events": return scheduler.getSkillRunEvents(String(first));
    case "run-list-artifacts": return scheduler.listRunArtifacts(typeof first === "string" && first ? first : undefined);
    case "run-retry": return scheduler.retrySkillRun(String(first));
    case "run-retry-step": return scheduler.retryWorkflowStep(String(first), String(second));
    case "run-delete-history": return scheduler.deleteRunHistory(String(first));
    case "skill-run-cancel": return scheduler.cancelSkillRun(String(first));
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
    case "start": return scheduler.startRun(first as never);
    case "cancel": return scheduler.cancelRun(String(first));
    case "update-session": return scheduler.updateSession(String(first), second as never);
    case "fork-session": return scheduler.forkSession(String(first), typeof second === "string" ? second : undefined);
    case "resolve-approval": return scheduler.resolveApproval(String(first), second as never);
    default: throw new Error(`Unknown AI worker method: ${request.method}`);
  }
}

import { RunScheduler } from "./scheduler";
import { AUTO_MODEL } from "../../shared/model-catalog";
import { browserAutomationConfigFromEnv } from "./browser-evidence";

type WorkerRequest = { id: string; method: string; args: unknown[] };
const parentPort = (process as unknown as { parentPort?: { on(event: string, callback: (message: { data: WorkerRequest }) => void): void; postMessage(message: unknown): void } }).parentPort;
if (!parentPort) throw new Error("AI worker must run as an Electron utility process.");

const projectRoot = process.env.CCTOOLS_REPO_ROOT;
if (!projectRoot) throw new Error("CCTOOLS_REPO_ROOT is required.");

const scheduler = new RunScheduler(
  projectRoot,
  (payload) => parentPort.postMessage({ type: "push", payload }),
  // 模型始终交给 Codex / Claude Code 自己的配置决定。保留 scheduler 的注入点仅供单元测试。
  () => AUTO_MODEL,
  browserAutomationConfigFromEnv()
);

// 启动时异步探测一次 provider（本机 + WSL），完成后由 scheduler 推送 snapshot。
// 探测走 spawn 不阻塞事件循环；之后整次会话期 send/snapshot 只读这份缓存。
void scheduler.refreshProviders();

parentPort.on("message", ({ data }) => {
  void dispatch(data).then(
    (result) => parentPort.postMessage({ type: "response", id: data.id, result }),
    (error) => parentPort.postMessage({ type: "response", id: data.id, error: error instanceof Error ? error.message : String(error) })
  );
});

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
    case "refresh-skills": return scheduler.refreshSkills();
    case "prewarm": return scheduler.prewarmClaude(typeof first === "string" ? first : undefined);
    case "run-skill": return scheduler.startSkill(String(first), typeof second === "string" ? second : undefined);
    case "stop-skill": return scheduler.stopSkill(String(first));
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

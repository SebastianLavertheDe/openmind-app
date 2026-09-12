import { parentPort } from "node:worker_threads";
import { OpenmindFileSearchEngine } from "./openmind-file-search-engine";

/**
 * 文件搜索 worker：索引构建 + 200k 文件评分检索整体离开主进程事件循环。
 * 协议（CJS 编译产物，由 openmind-file-search.ts 按需 spawn）：
 *   main → worker: { kind: "init", openmindRoot, logicalPrefix }
 *                  { kind: "search", id, query, limit }
 *                  { kind: "invalidate" }
 *   worker → main: { kind: "result", id, result } | { kind: "error", id, message }
 * 同一端口的 message 保序投递，init 之后才会收到 search。
 */

type WorkerRequest =
  | { kind: "init"; openmindRoot: string; logicalPrefix: string }
  | { kind: "search"; id: number; query: string; limit: number }
  | { kind: "invalidate" };

let engine: OpenmindFileSearchEngine | null = null;
const bootstrap: WorkerRequest[] = [];

if (!parentPort) throw new Error("openmind-file-search-worker must run inside a worker_threads Worker.");
const port = parentPort;

port.on("message", (message: WorkerRequest) => {
  if (message.kind === "init") {
    engine = new OpenmindFileSearchEngine(message.openmindRoot, message.logicalPrefix);
    // init 之后排队进来的消息按序补放。
    for (const queued of bootstrap.splice(0)) dispatch(queued);
    return;
  }
  dispatch(message);
});

function dispatch(message: WorkerRequest): void {
  if (!engine) {
    bootstrap.push(message);
    return;
  }
  if (message.kind === "invalidate") {
    engine.invalidate();
    return;
  }
  if (message.kind === "search") {
    void engine.search(message.query, message.limit).then(
      (result) => port.postMessage({ kind: "result", id: message.id, result }),
      (error: unknown) => port.postMessage({ kind: "error", id: message.id, message: error instanceof Error ? error.message : String(error) })
    );
  }
}

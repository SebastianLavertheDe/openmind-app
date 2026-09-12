import { parentPort } from "node:worker_threads";
import { ContentIndexStore } from "./content-index";
import { createExplicitContentSource } from "./content-source";

/**
 * 内容索引 worker：冷索引构建（逐日期目录遍历、readFileSync、Zod 解析、
 * searchText 拼接）与整轮 sweep 的 topK 扫描整体离开主进程事件循环。
 * 协议（CJS 编译产物，由 content-index-service.ts 按需 spawn）：
 *   main → worker: { kind: "init", openmindRoot, stateRoot }
 *                  { kind: "search", id, query, limit }
 *                  { kind: "refreshDate", date }
 *   worker → main: { kind: "result", id, result } | { kind: "error", id, message }
 * 同一端口的 message 保序投递：init 之后的 refreshDate 一定先于其后的 search
 * 被处理，writeContent 的「保存即刷新」顺序语义由此保证。
 */

type WorkerRequest =
  | { kind: "init"; openmindRoot: string; stateRoot: string | null }
  | { kind: "search"; id: number; query: string; limit: number }
  | { kind: "refreshDate"; date: string };

let engine: ContentIndexStore | null = null;
const bootstrap: WorkerRequest[] = [];

if (!parentPort) throw new Error("content-index.worker must run inside a worker_threads Worker.");
const port = parentPort;

port.on("message", (message: WorkerRequest) => {
  if (message.kind === "init") {
    engine = new ContentIndexStore(message.openmindRoot, createExplicitContentSource(message.openmindRoot), message.stateRoot ?? undefined);
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
  const store = engine;
  if (message.kind === "refreshDate") {
    store.refreshDate(message.date);
    return;
  }
  if (message.kind === "search") {
    void Promise.resolve()
      .then(() => store.searchContent(message.query, message.limit))
      .then(
        (result) => port.postMessage({ kind: "result", id: message.id, result }),
        (error: unknown) => port.postMessage({ kind: "error", id: message.id, message: error instanceof Error ? error.message : String(error) })
      );
  }
}

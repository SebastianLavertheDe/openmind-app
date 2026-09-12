import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { GlobalSearchResult } from "../../shared/contracts";
import { ContentIndexStore } from "./content-index";
import type { ContentApi } from "./common";

type ContentIndexWorkerRequest =
  | { kind: "init"; openmindRoot: string; stateRoot: string | null }
  | { kind: "search"; id: number; query: string; limit: number }
  | { kind: "refreshDate"; date: string };

type ContentIndexWorkerReply =
  | { kind: "result"; id: number; result: GlobalSearchResult[] }
  | { kind: "error"; id: number; message: string };

const WORKER_FILE = "content-index.worker.js";

/**
 * ContentIndexStore 的 worker 代理：冷索引构建与搜索评分整体跑在 worker_threads
 * 里（编译产物存在时），TTL 过期重扫 / 启动后首次搜索 / 全量冷建都不再阻塞主进程；
 * 找不到编译好的 worker 文件时（vitest 直接执行 TS 源码）回退到进程内同一引擎，
 * 行为一致。refreshDate 在 worker 模式下是保序的 fire-and-forget：同一端口的
 * 消息 FIFO 保证 writeContent 之后的搜索一定看到刷新后的索引。
 */
export class ContentIndexService {
  private worker: Worker | null = null;
  private readonly requests = new Map<number, { resolve(result: GlobalSearchResult[]): void; reject(error: Error): void }>();
  private requestSeq = 0;
  private fallbackEngine: ContentIndexStore | null = null;
  private readonly openmindRoot: string;
  private readonly stateRoot: string | null;

  constructor(
    repoRoot: string,
    /** 主进程注入的内容 API；仅进程内回退模式使用，worker 模式用显式 root 内容源。 */
    private readonly content: ContentApi,
    stateRoot?: string
  ) {
    this.openmindRoot = path.resolve(repoRoot);
    this.stateRoot = stateRoot ?? null;
  }

  searchContent(query: string, limit = 20): Promise<GlobalSearchResult[]> {
    const worker = this.ensureWorker();
    if (!worker) return Promise.resolve(this.fallbackEngine!.searchContent(query, limit));
    const id = ++this.requestSeq;
    return new Promise<GlobalSearchResult[]>((resolve, reject) => {
      this.requests.set(id, { resolve, reject });
      worker.postMessage({ kind: "search", id, query, limit } satisfies ContentIndexWorkerRequest);
    });
  }

  refreshDate(date: string): void {
    const worker = this.ensureWorker();
    if (worker) worker.postMessage({ kind: "refreshDate", date } satisfies ContentIndexWorkerRequest);
    else this.fallbackEngine!.refreshDate(date);
  }

  /** 释放 worker；openmindRoot 切换重建 ProductService 时由调用方调用，避免残留线程。 */
  dispose(): void {
    this.rejectAll(new Error("ContentIndexService 已释放。"));
    this.worker?.terminate();
    this.worker = null;
    this.fallbackEngine = null;
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.fallbackEngine) return null;
    // 编译产物（.build/electron/**）里 worker 文件与本模块同目录；vitest 直接
    // 执行 TS 源码时不存在，回退进程内引擎。
    const workerPath = path.join(__dirname, WORKER_FILE);
    if (!fs.existsSync(workerPath)) {
      this.fallbackEngine = new ContentIndexStore(this.openmindRoot, this.content, this.stateRoot ?? undefined);
      return null;
    }
    try {
      const worker = new Worker(workerPath);
      worker.on("message", (message: ContentIndexWorkerReply) => {
        const pending = this.requests.get(message.id);
        if (!pending) return;
        this.requests.delete(message.id);
        if (message.kind === "result") pending.resolve(message.result);
        else pending.reject(new Error(message.message));
      });
      worker.on("error", (error: Error) => {
        this.rejectAll(error);
        if (this.worker === worker) this.worker = null;
      });
      worker.on("exit", (code) => {
        if (this.worker === worker) this.worker = null;
        if (code !== 0) this.rejectAll(new Error(`内容索引 worker 退出（code ${code}）。`));
      });
      // 端口保序：init 先于任何 search/refreshDate 抵达 worker。
      worker.postMessage({ kind: "init", openmindRoot: this.openmindRoot, stateRoot: this.stateRoot } satisfies ContentIndexWorkerRequest);
      this.worker = worker;
      return worker;
    } catch {
      this.fallbackEngine = new ContentIndexStore(this.openmindRoot, this.content, this.stateRoot ?? undefined);
      return null;
    }
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.requests) {
      pending.reject(error);
      this.requests.delete(id);
    }
  }
}

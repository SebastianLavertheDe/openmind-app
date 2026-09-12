import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { ProjectFileSearchResult } from "../shared/contracts";
import { OpenmindFileSearchEngine } from "./openmind-file-search-engine";

type OpenmindFileSearchOptions = {
  /** New path-boundary mode: the constructor argument is the actual root. */
  rootKind?: "openmind" | "legacy-project";
};

type SearchRequest = { kind: "search"; id: number; query: string; limit: number };
type WorkerReply =
  | { kind: "result"; id: number; result: ProjectFileSearchResult }
  | { kind: "error"; id: number; message: string };

const WORKER_FILE = "openmind-file-search.worker.js";

/**
 * @ 文件引用搜索。评分检索跑在 worker_threads 里（编译产物存在时），宽泛查询
 * 在 20 万文件规模下也不再制造主进程长任务；找不到编译好的 worker 文件时
 * （vitest 直接执行 TS 源码）回退到进程内同一引擎，行为完全一致。
 */
export class OpenmindFileSearch {
  private worker: Worker | null = null;
  private readonly requests = new Map<number, { resolve(result: ProjectFileSearchResult): void; reject(error: Error): void }>();
  private requestSeq = 0;
  private fallbackEngine: OpenmindFileSearchEngine | null = null;
  private readonly projectRoot: string;
  private readonly openmindRoot: string;
  private readonly logicalPrefix: string;

  constructor(root: string, options: OpenmindFileSearchOptions = {}) {
    if (options.rootKind === "openmind") {
      this.projectRoot = path.resolve(root);
      this.openmindRoot = this.projectRoot;
      this.logicalPrefix = "openmind";
    } else {
      // Compatibility for the old constructor used by existing callers/tests.
      this.projectRoot = path.resolve(root);
      this.openmindRoot = path.join(this.projectRoot, "openmind");
      this.logicalPrefix = "openmind";
    }
  }

  async search(rawQuery: string, rawLimit = 40): Promise<ProjectFileSearchResult> {
    const worker = this.ensureWorker();
    if (!worker) return this.fallbackEngine!.search(rawQuery, rawLimit);
    const id = ++this.requestSeq;
    return new Promise<ProjectFileSearchResult>((resolve, reject) => {
      this.requests.set(id, { resolve, reject });
      worker.postMessage({ kind: "search", id, query: rawQuery.trim(), limit: Math.max(1, Math.min(100, Math.floor(rawLimit))) } satisfies SearchRequest);
    });
  }

  invalidate(): void {
    if (this.worker) this.worker.postMessage({ kind: "invalidate" });
    else this.fallbackEngine?.invalidate();
  }

  /** 释放 worker；openmindRoot 切换重建实例时由调用方调用，避免残留线程。 */
  dispose(): void {
    this.rejectAll(new Error("OpenmindFileSearch 已释放。"));
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
      this.fallbackEngine = new OpenmindFileSearchEngine(this.openmindRoot, this.logicalPrefix);
      return null;
    }
    try {
      const worker = new Worker(workerPath);
      worker.on("message", (message: WorkerReply) => {
        const pending = this.requests.get(message.id);
        if (!pending) return;
        this.requests.delete(message.id);
        if (message.kind === "result") pending.resolve(message.result);
        else pending.reject(new Error(message.message));
      });
      const fail = (error: Error) => {
        this.rejectAll(error);
        if (this.worker === worker) this.worker = null;
      };
      worker.on("error", fail);
      worker.on("exit", (code) => {
        const exitError = code === 0 ? null : new Error(`文件搜索 worker 退出（code ${code}）。`);
        if (exitError) this.rejectAll(exitError);
        if (this.worker === worker) this.worker = null;
      });
      // 端口保序：init 先于任何 search 抵达 worker。
      worker.postMessage({ kind: "init", openmindRoot: this.openmindRoot, logicalPrefix: this.logicalPrefix });
      this.worker = worker;
      return worker;
    } catch {
      this.fallbackEngine = new OpenmindFileSearchEngine(this.openmindRoot, this.logicalPrefix);
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

export function normalizeOpenmindSelection(rootInput: string, candidate: string, options: OpenmindFileSearchOptions = {}): string {
  const root = path.resolve(rootInput);
  const openmindRoot = options.rootKind === "openmind" ? root : path.join(root, "openmind");
  const resolved = path.resolve(candidate);
  let openmindStat: fs.Stats;
  let candidateStat: fs.Stats;
  try {
    openmindStat = fs.lstatSync(openmindRoot);
    candidateStat = fs.lstatSync(resolved);
  } catch {
    throw new Error("所选 openmind 文件不存在。");
  }
  if (!openmindStat.isDirectory() || openmindStat.isSymbolicLink() || !candidateStat.isFile() || candidateStat.isSymbolicLink()) {
    throw new Error("只能通过 @ 引用 openmind 目录内的普通文件。");
  }
  const relativeToOpenmind = path.relative(openmindRoot, resolved);
  if (!relativeToOpenmind || relativeToOpenmind.startsWith("..") || path.isAbsolute(relativeToOpenmind)) {
    throw new Error("只能通过 @ 引用 openmind 目录内的文件。");
  }
  const realOpenmindRoot = fs.realpathSync(openmindRoot);
  const realCandidate = fs.realpathSync(resolved);
  const realRelative = path.relative(realOpenmindRoot, realCandidate);
  if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error("只能通过 @ 引用 openmind 目录内的文件。");
  }
  const logicalRelative = path.relative(openmindRoot, resolved);
  return `openmind/${logicalRelative.split(path.sep).join("/")}`;
}

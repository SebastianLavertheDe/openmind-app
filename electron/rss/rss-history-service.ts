import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { RssCatalog, RssRunsQuery, RssRunsPage, RssRunEventsQuery, RssRunEventsPage } from "../../shared/rss-contracts";
import type { RssRepository } from "./rss-repository";
import { RssSourceReader } from "./rss-source-reader";

type HistoryResult = RssRunsPage | RssRunEventsPage;
export type RssHistoryRequest = { id: number; root: string; runsRoot: string; catalog: RssCatalog; legacyStateRoots: string[] } & (
  { kind: "runs"; query: RssRunsQuery } | { kind: "events"; query: RssRunEventsQuery }
);
export type RssHistoryReply = { id: number; result: HistoryResult } | { id: number; error: string };

/** Keep first history indexing, stat sweeps and log parsing off the main loop. */
export class RssHistoryService {
  private worker: Worker | null = null;
  private sequence = 0;
  private readonly pending = new Map<number, { resolve(result: HistoryResult): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly workerFile = path.join(__dirname, "rss-history.worker.js")) {}

  runs(repository: RssRepository, runsRoot: string, query: RssRunsQuery, legacyStateRoots: string[] = []): Promise<RssRunsPage> {
    return this.query(repository, runsRoot, { kind: "runs", query }, legacyStateRoots) as Promise<RssRunsPage>;
  }

  events(repository: RssRepository, runsRoot: string, query: RssRunEventsQuery, legacyStateRoots: string[] = []): Promise<RssRunEventsPage> {
    return this.query(repository, runsRoot, { kind: "events", query }, legacyStateRoots) as Promise<RssRunEventsPage>;
  }

  dispose(error = new Error("RSS history service closed.")): void {
    const worker = this.worker; this.worker = null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
    void worker?.terminate();
  }

  private query(repository: RssRepository, runsRoot: string, request: Pick<Extract<RssHistoryRequest, { kind: "runs" }>, "kind" | "query"> | Pick<Extract<RssHistoryRequest, { kind: "events" }>, "kind" | "query">, legacyStateRoots: string[]): Promise<HistoryResult> {
    // Source-only tests have no compiled worker; packaged builds always do.
    if (!fs.existsSync(this.workerFile)) return Promise.resolve().then(() => {
      const reader = new RssSourceReader(repository, runsRoot);
      return request.kind === "runs" ? reader.runs(request.query) : reader.events(request.query);
    });
    if (this.pending.size >= 16) return Promise.reject(new Error("RSS history queries are busy; retry shortly."));
    // Registry initialization/migration owns a filesystem lock. Finish that
    // small transaction before entering a cancellable worker, which may be
    // terminated at any point by disposal or timeout. Historical run/log I/O
    // and parsing remain entirely in the worker.
    try { repository.read(); }
    catch (error) { return Promise.reject(error); }
    const worker = this.ensureWorker();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.dispose(new Error("RSS history query timed out.")), 30_000);
      this.pending.set(id, { resolve, reject, timer });
      worker.ref();
      try { worker.postMessage({ ...request, id, root: repository.root, runsRoot, catalog: repository.catalog, legacyStateRoots } satisfies RssHistoryRequest); }
      catch (error) { this.dispose(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerFile);
    this.worker = worker;
    worker.on("message", (reply: RssHistoryReply) => {
      if (this.worker !== worker) return;
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id); clearTimeout(pending.timer);
      if ("error" in reply) pending.reject(new Error(reply.error)); else pending.resolve(reply.result);
      if (!this.pending.size) worker.unref();
    });
    worker.on("error", error => { if (this.worker === worker) this.dispose(error instanceof Error ? error : new Error(String(error))); });
    worker.on("exit", code => { if (this.worker === worker) this.dispose(new Error(`RSS history worker exited (${code}).`)); });
    worker.unref();
    return worker;
  }
}

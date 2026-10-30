import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { RssEntriesPage, RssEntriesQuery, RssEntriesWorkerReply, RssEntriesWorkerRequest } from "../../shared/rss-contracts";
import type { RssRepository } from "./rss-repository";
import { RssSourceReader } from "./rss-source-reader";

/** Keep XML reads, validation and sorting off Electron's main event loop. */
export class RssEntriesService {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve(value: RssEntriesPage): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private workerFile = path.join(__dirname, "rss-entries.worker.js")) {}

  entries(repository: RssRepository, query: RssEntriesQuery, legacyStateRoots: string[] = []): Promise<RssEntriesPage> {
    // Source-only test/dev execution has no compiled worker. Packaged builds do.
    if (!fs.existsSync(this.workerFile)) return Promise.resolve().then(() => new RssSourceReader(repository, "").entries(query));
    const worker = this.ensureWorker();
    if (this.pending.size >= 16) return Promise.reject(new Error("RSS entry queries are busy; retry shortly."));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.dispose(new Error("RSS entry query timed out.")), 30_000);
      this.pending.set(id, { resolve, reject, timer });
      worker.ref();
      try { worker.postMessage({ id, root: repository.root, catalog: repository.catalog, legacyStateRoots, query } satisfies RssEntriesWorkerRequest); }
      catch (error) { this.dispose(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  dispose(error = new Error("RSS entry service closed.")): void {
    const worker = this.worker; this.worker = null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
    void worker?.terminate();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerFile);
    this.worker = worker;
    worker.on("message", (reply: RssEntriesWorkerReply) => {
      if (this.worker !== worker) return;
      const request = this.pending.get(reply.id);
      if (!request) return;
      this.pending.delete(reply.id); clearTimeout(request.timer);
      if ("error" in reply) request.reject(new Error(reply.error)); else request.resolve(reply.result);
      if (!this.pending.size) worker.unref();
    });
    worker.on("error", error => { if (this.worker === worker) this.dispose(error instanceof Error ? error : new Error(String(error))); });
    worker.on("exit", code => { if (this.worker === worker) this.dispose(new Error(`RSS entry worker exited (${code}).`)); });
    worker.unref();
    return worker;
  }
}

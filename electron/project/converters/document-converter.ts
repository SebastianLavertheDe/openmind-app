import { randomUUID } from "node:crypto";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { ConvertedDocument } from "./document-converter-core";
import type { DocumentWorkerRequest, DocumentWorkerResponse } from "./document-worker";

const DEFAULT_TIMEOUT_MS = 120_000;

export function convertDocumentInWorker(
  inputPath: string,
  options: { timeoutMs?: number } = {}
): Promise<ConvertedDocument> {
  const workerPath = path.join(__dirname, "document-worker.js");
  const requestId = randomUUID();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath);
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error("文档转换超时"));
    }, timeoutMs);
    timeout.unref();

    const finish = () => {
      clearTimeout(timeout);
      void worker.terminate();
    };
    worker.once("error", (error) => {
      finish();
      reject(error);
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`文档转换进程异常退出（${code}）`));
      }
    });
    worker.on("message", (message: DocumentWorkerResponse) => {
      if (message.requestId !== requestId) return;
      finish();
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error));
    });
    worker.postMessage({ requestId, inputPath } satisfies DocumentWorkerRequest);
  });
}

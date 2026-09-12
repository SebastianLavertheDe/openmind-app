import { randomUUID } from "node:crypto";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { ConvertedWebPage } from "./web-extract";
import type { WebWorkerRequest, WebWorkerResponse } from "./web-worker";
import { safeHttpGet, type SafeHttpOptions } from "./safe-http";

export type { ConvertedWebPage };

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Main-thread facade: fetches the page (async I/O) and runs the CPU-bound
 * JSDOM/Readability extraction in a worker thread, mirroring
 * convertDocumentInWorker, so adding a web material never blocks the main
 * process event loop.
 */
export async function convertWebPageToMarkdown(
  inputUrl: string,
  options: SafeHttpOptions = {}
): Promise<ConvertedWebPage> {
  const response = await safeHttpGet(inputUrl, options);
  const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
  if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml") && !contentType.includes("text/plain")) {
    throw new Error(`网页内容类型不受支持：${contentType.split(";")[0]}`);
  }
  const html = response.body.toString("utf8");
  if (!html.trim()) throw new Error("网页内容为空");

  return extractInWorker(html, response.finalUrl);
}

function extractInWorker(html: string, sourceUrl: string): Promise<ConvertedWebPage> {
  const workerPath = path.join(__dirname, "web-worker.js");
  const requestId = randomUUID();

  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath);
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error("网页转换超时"));
    }, DEFAULT_TIMEOUT_MS);
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
        reject(new Error(`网页转换进程异常退出（${code}）`));
      }
    });
    worker.on("message", (message: WebWorkerResponse) => {
      if (message.requestId !== requestId) return;
      finish();
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error));
    });
    worker.postMessage({ requestId, html, sourceUrl } satisfies WebWorkerRequest);
  });
}

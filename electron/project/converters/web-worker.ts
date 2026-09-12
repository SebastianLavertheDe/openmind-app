import { isMainThread, parentPort } from "node:worker_threads";
import { extractWebPageMarkdown } from "./web-extract";

export type WebWorkerRequest = { requestId: string; html: string; sourceUrl: string };
export type WebWorkerResponse =
  | { requestId: string; ok: true; result: ReturnType<typeof extractWebPageMarkdown> }
  | { requestId: string; ok: false; error: string };

// Readability/JSDOM parse of a large page is CPU-bound; the worker keeps it
// off the main process event loop. Heavy libraries load only here.
if (!isMainThread && parentPort) {
  parentPort.once("message", async (request: WebWorkerRequest) => {
    try {
      const result = extractWebPageMarkdown(request.html, request.sourceUrl);
      parentPort?.postMessage({ requestId: request.requestId, ok: true, result } satisfies WebWorkerResponse);
    } catch (error) {
      parentPort?.postMessage({
        requestId: request.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      } satisfies WebWorkerResponse);
    }
  });
}

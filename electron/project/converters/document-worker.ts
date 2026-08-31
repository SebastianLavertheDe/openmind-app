import { isMainThread, parentPort } from "node:worker_threads";
import { convertDocumentToMarkdown } from "./document-converter-core";

export type DocumentWorkerRequest = { requestId: string; inputPath: string };
export type DocumentWorkerResponse =
  | { requestId: string; ok: true; result: Awaited<ReturnType<typeof convertDocumentToMarkdown>> }
  | { requestId: string; ok: false; error: string };

if (!isMainThread && parentPort) {
  parentPort.once("message", async (request: DocumentWorkerRequest) => {
    try {
      const result = await convertDocumentToMarkdown(request.inputPath);
      parentPort?.postMessage({ requestId: request.requestId, ok: true, result } satisfies DocumentWorkerResponse);
    } catch (error) {
      parentPort?.postMessage({
        requestId: request.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      } satisfies DocumentWorkerResponse);
    }
  });
}

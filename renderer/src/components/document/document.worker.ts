import type { DocumentWorkerRequest, DocumentWorkerResponse, ReadingDocument } from "@shared/document-view";
import { setLocale } from "@shared/messages";
import { buildReadingDocument, findDocumentMatches } from "./document-model";

let document: ReadingDocument | null = null;
self.onmessage = ({ data }: MessageEvent<DocumentWorkerRequest>) => {
  try {
    let response: DocumentWorkerResponse;
    if (data.type === "parse") {
      setLocale(data.locale ?? "zh-CN");
      document = buildReadingDocument(data.content, data.math);
      response = { type: "document", document };
    } else {
      response = { type: "matches", id: data.id, matches: document ? findDocumentMatches(document, data.query) : [] };
    }
    self.postMessage(response);
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) } satisfies DocumentWorkerResponse);
  }
};

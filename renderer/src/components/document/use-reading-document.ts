import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentMatch, DocumentWorkerRequest, DocumentWorkerResponse, ReadingDocument } from "@shared/document-view";
import { ASYNC_DOCUMENT_CHARACTERS, buildReadingDocument, findDocumentMatches } from "./document-model";
import { buildPlainDocument } from "./plain-document";

type ReadingWorkerConstructor = new () => Worker;
let readingWorkerCtor: Promise<ReadingWorkerConstructor> | null = null;
function loadReadingWorker(): Promise<ReadingWorkerConstructor> {
  // Lazily resolved so the large inline worker bundle stays out of the entry
  // chunk and loads on first long-document render. The inline encoding itself
  // is required for Electron's packaged file:// origin (Blob workers, no
  // separate script fetch), so the blob size can only be moved to an async
  // chunk, not shared.
  readingWorkerCtor ||= import("./document.worker?worker&inline").then(module => module.default);
  return readingWorkerCtor;
}

/** Long-document work is cancellable by terminating its worker on replacement.
 * Width and scroll never participate in this lifecycle. */
export function useReadingDocument(content: string, math = false, plain = false) {
  const small = plain || content.length <= ASYNC_DOCUMENT_CHARACTERS;
  const previousPlain = useRef<ReadingDocument | null>(null);
  const sync = useMemo(() => {
    if (plain) return previousPlain.current = buildPlainDocument(content, previousPlain.current);
    previousPlain.current = null;
    return small ? buildReadingDocument(content, math) : null;
  }, [content, math, small, plain]);
  const [loaded, setLoaded] = useState<{ content: string; math: boolean; document: ReadingDocument } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const request = useRef(0);
  const pending = useRef(new Map<number, (matches: DocumentMatch[]) => void>());
  useEffect(() => {
    setError(null);
    setLoaded(null);
    if (small) return;
    let active = true;
    let instance: Worker | null = null;
    loadReadingWorker().then((ReadingWorker) => {
      if (!active) return;
      try {
        // Inline worker also works under Electron's packaged file:// origin.
        instance = new ReadingWorker();
        worker.current = instance;
        instance.onmessage = ({ data }: MessageEvent<DocumentWorkerResponse>) => {
          if (!active) return;
          if (data.type === "document") setLoaded({ content, math, document: data.document });
          else if (data.type === "error") fail(data.message);
          else { pending.current.get(data.id)?.(data.matches); pending.current.delete(data.id); }
        };
        instance.onerror = event => { if (active) fail(`文档解析失败：${event.message || "请重新打开文件。"}`); };
        instance.postMessage({ type: "parse", content, math } satisfies DocumentWorkerRequest);
      } catch { fail("无法启动文档阅读器，请重新打开文件。"); }
    }).catch(() => { if (active) fail("无法启动文档阅读器，请重新打开文件。"); });
    function fail(message: string) {
      setError(message);
      worker.current = null;
      instance?.terminate();
      for (const resolve of pending.current.values()) resolve([]);
      pending.current.clear();
    }
    return () => {
      active = false; instance?.terminate(); worker.current = null;
      for (const resolve of pending.current.values()) resolve([]);
      pending.current.clear();
    };
  }, [content, math, small]);
  const document = sync || (loaded?.content === content && loaded.math === math ? loaded.document : null);
  const find = useCallback((query: string): Promise<DocumentMatch[]> => {
    if (!document) return Promise.resolve([]);
    if (small) return Promise.resolve(findDocumentMatches(document, query));
    return new Promise(resolve => {
      if (!worker.current) { resolve([]); return; }
      const id = ++request.current;
      pending.current.set(id, resolve);
      worker.current.postMessage({ type: "find", query, id } satisfies DocumentWorkerRequest);
    });
  }, [document, small]);
  return { document, error, find };
}

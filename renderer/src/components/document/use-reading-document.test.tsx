import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReadingDocument } from "./use-reading-document";
import { buildReadingDocument } from "./document-model";
import { getMessages, setLocale } from "@shared/messages";

const workerState = vi.hoisted(() => ({ instances: [] as any[] }));
vi.mock("./document.worker?worker&inline", () => ({ default: class {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { workerState.instances.push(this); }
} }));
afterEach(() => { cleanup(); setLocale("zh-CN"); workerState.instances.length = 0; });
const long = "long document paragraph\n\n".repeat(2000);

// The worker constructor module resolves asynchronously; drain the microtask
// queue inside act until the hook has created the worker instance.
async function flushWorkerBoot() {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
  });
}

describe("document parsing lifecycle", () => {
  it("rebuilds translated image placeholders when the interface language changes", () => {
    const { result } = renderHook(() => useReadingDocument("![](https://example.com/image.png)"));
    expect(result.current.document?.text).toBe(getMessages("zh-CN").interface.remoteImage);
    act(() => setLocale("en"));
    expect(result.current.document?.text).toBe(getMessages("en").interface.remoteImage);
    act(() => setLocale("zh-CN"));
    expect(result.current.document?.text).toBe(getMessages("zh-CN").interface.remoteImage);
  });

  it("passes the interface language to long-document workers and ignores the previous language result", async () => {
    const { result } = renderHook(() => useReadingDocument(long));
    await flushWorkerBoot();
    const first = workerState.instances[0];
    expect(first.postMessage).toHaveBeenCalledWith({ type: "parse", content: long, math: false, locale: "zh-CN" });
    const previous = buildReadingDocument("![](https://example.com/image.png)");
    act(() => first.onmessage({ data: { type: "document", document: previous } }));
    act(() => setLocale("en"));
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(result.current.document).toBeNull();
    await flushWorkerBoot();
    const current = workerState.instances[1];
    expect(current.postMessage).toHaveBeenCalledWith({ type: "parse", content: long, math: false, locale: "en" });
    act(() => first.onmessage({ data: { type: "document", document: previous } }));
    expect(result.current.document).toBeNull();
    const next = buildReadingDocument("![](https://example.com/image.png)");
    act(() => current.onmessage({ data: { type: "document", document: next } }));
    expect(result.current.document?.text).toBe(getMessages("en").interface.remoteImage);
  });

  it("does not restart parsing on unrelated rerenders; replaces and terminates on content change", async () => {
    const { result, rerender, unmount } = renderHook(({ text, width }) => { void width; return useReadingDocument(text); }, { initialProps: { text: long, width: 800 } });
    await flushWorkerBoot();
    const first = workerState.instances[0];
    expect(first.postMessage).toHaveBeenCalledTimes(1);
    const model = buildReadingDocument("ready");
    act(() => first.onmessage({ data: { type: "document", document: model } }));
    expect(result.current.document).toBe(model);
    rerender({ text: long, width: 400 });
    expect(workerState.instances).toHaveLength(1);
    expect(result.current.document).toBe(model);
    rerender({ text: long + "replacement", width: 400 });
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(result.current.document).toBeNull();
    await flushWorkerBoot();
    act(() => first.onmessage({ data: { type: "document", document: model } }));
    expect(result.current.document).toBeNull();
    unmount();
    expect(workerState.instances[1].terminate).toHaveBeenCalledOnce();
  });
  it("resolves pending searches on worker failure and does not block subsequent searches", async () => {
    const { result } = renderHook(() => useReadingDocument(long));
    await flushWorkerBoot();
    const worker = workerState.instances[0];
    act(() => worker.onmessage({ data: { type: "document", document: buildReadingDocument("ready") } }));
    const pending = result.current.find("ready");
    act(() => worker.onerror({ message: "worker stopped" }));
    await expect(pending).resolves.toEqual([]);
    await expect(result.current.find("ready")).resolves.toEqual([]);
    expect(result.current.error).toContain("worker stopped");
  });
  it("uses a stable model for small documents and incremental blocks for streaming plain text", () => {
    const { result, rerender } = renderHook(({ text }) => useReadingDocument(text, false, true), { initialProps: { text: long } });
    const block = result.current.document!.blocks[0];
    rerender({ text: long + "tail" });
    expect(result.current.document!.blocks[0]).toBe(block);
    expect(result.current.document!.text).toBe(long + "tail");
    expect(workerState.instances).toHaveLength(0);
  });
});

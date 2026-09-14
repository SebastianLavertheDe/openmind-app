import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { documentPreviewResource, type FilePreviewSource, type PreviewResource } from "./model";
import { useFilePreviewController } from "./use-file-preview-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function resource(id: string, content: string): PreviewResource {
  return documentPreviewResource({ path: `${id}.md`, name: id, content }, id);
}

function readOnlySource(id: string, load: FilePreviewSource["load"]): FilePreviewSource {
  return {
    id,
    path: `${id}.md`,
    capabilities: { editContent: false, editTitle: false, openExternal: false },
    load
  };
}

describe("useFilePreviewController", () => {
  it("remains usable after the StrictMode effect replay", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useFilePreviewController(), { wrapper });

    await act(async () => {
      expect(await result.current.openSource(readOnlySource("strict", async () => resource("strict", "loaded")))).toBe(true);
    });
    expect(result.current.resource?.id).toBe("strict");
  });

  it("does not let an older load overwrite the newest source", async () => {
    const first = deferred<PreviewResource>();
    const second = deferred<PreviewResource>();
    const { result } = renderHook(() => useFilePreviewController());

    let firstOpen!: Promise<boolean>;
    let secondOpen!: Promise<boolean>;
    act(() => {
      firstOpen = result.current.openSource(readOnlySource("first", () => first.promise));
      secondOpen = result.current.openSource(readOnlySource("second", () => second.promise), { force: true });
    });
    await act(async () => { second.resolve(resource("second", "new")); await secondOpen; });
    await act(async () => { first.resolve(resource("first", "stale")); await firstOpen; });

    expect(result.current.source?.id).toBe("second");
    expect(result.current.resource?.id).toBe("second");
  });

  it("serializes another save when the draft changes during persistence", async () => {
    const firstSave = deferred<PreviewResource>();
    const save = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(async ({ content, title }) => documentPreviewResource({ path: "editable.md", name: title, content }, "editable"));
    const source: FilePreviewSource = {
      id: "editable",
      path: "editable.md",
      capabilities: { editContent: true, editTitle: false, openExternal: false },
      load: async () => resource("editable", "one"),
      save
    };
    const { result } = renderHook(() => useFilePreviewController());
    await act(async () => { await result.current.openSource(source, { initialMode: "edit" }); });
    act(() => result.current.setContent("two"));
    let operation!: Promise<boolean>;
    act(() => { operation = result.current.save(); });
    act(() => result.current.setContent("three"));
    await act(async () => {
      firstSave.resolve(documentPreviewResource({ path: "editable.md", name: "editable", content: "two" }, "editable"));
      await operation;
    });

    expect(save).toHaveBeenNthCalledWith(1, expect.objectContaining({ content: "two" }));
    expect(save).toHaveBeenNthCalledWith(2, expect.objectContaining({ content: "three" }));
    await waitFor(() => expect(result.current.dirty).toBe(false));
    expect(result.current.draft.content).toBe("three");
  });

  it("orders a reopened resource save after an older generation of the same source", async () => {
    const firstSave = deferred<PreviewResource>();
    const firstSource: FilePreviewSource = {
      id: "reopened",
      path: "reopened.md",
      capabilities: { editContent: true, editTitle: false, openExternal: false },
      load: async () => resource("reopened", "first persisted"),
      save: vi.fn(() => firstSave.promise)
    };
    const secondSave = vi.fn(async ({ content }) => resource("reopened", content));
    const secondSource: FilePreviewSource = {
      ...firstSource,
      load: async () => resource("reopened", "second persisted"),
      save: secondSave
    };
    const { result } = renderHook(() => useFilePreviewController());
    await act(async () => { await result.current.openSource(firstSource, { initialMode: "edit" }); });
    act(() => result.current.setContent("old draft"));
    let oldOperation!: Promise<boolean>;
    act(() => { oldOperation = result.current.save(); });

    await act(async () => {
      await result.current.openSource(secondSource, { initialMode: "edit", force: true });
    });
    act(() => result.current.setContent("newest draft"));
    let newOperation!: Promise<boolean>;
    act(() => { newOperation = result.current.save(); });
    expect(secondSave).not.toHaveBeenCalled();

    await act(async () => {
      firstSave.resolve(resource("reopened", "old draft"));
      await Promise.all([oldOperation, newOperation]);
    });
    expect(secondSave).toHaveBeenCalledOnce();
    expect(secondSave).toHaveBeenCalledWith(expect.objectContaining({ content: "newest draft" }));
    expect(result.current.draft.content).toBe("newest draft");
    expect(result.current.dirty).toBe(false);
  });

  it("requires explicit confirmation before replacing a dirty source", async () => {
    const editable: FilePreviewSource = {
      id: "editable",
      path: "editable.md",
      capabilities: { editContent: true, editTitle: false, openExternal: false },
      load: async () => resource("editable", "one"),
      save: async ({ content }) => resource("editable", content)
    };
    const { result } = renderHook(() => useFilePreviewController());
    await act(async () => { await result.current.openSource(editable, { initialMode: "edit" }); });
    act(() => result.current.setContent("dirty"));

    let opened = true;
    await act(async () => {
      opened = await result.current.openSource(readOnlySource("next", async () => resource("next", "next")), {
        confirmDiscard: async () => false
      });
    });
    expect(opened).toBe(false);
    expect(result.current.source?.id).toBe("editable");
    expect(result.current.draft.content).toBe("dirty");
  });

  it("discards the draft only after confirming a dirty edit-to-preview transition", async () => {
    const editable: FilePreviewSource = {
      id: "mode",
      path: "mode.md",
      capabilities: { editContent: true, editTitle: false, openExternal: false },
      load: async () => resource("mode", "persisted"),
      save: async ({ content }) => resource("mode", content)
    };
    const { result } = renderHook(() => useFilePreviewController());
    await act(async () => { await result.current.openSource(editable, { initialMode: "edit" }); });
    act(() => result.current.setContent("dirty"));

    await act(async () => {
      expect(await result.current.setMode("preview", async () => false)).toBe(false);
    });
    expect(result.current.mode).toBe("edit");
    expect(result.current.draft.content).toBe("dirty");

    await act(async () => {
      expect(await result.current.setMode("preview", async () => true)).toBe(true);
    });
    expect(result.current.mode).toBe("preview");
    expect(result.current.draft.content).toBe("persisted");
    expect(result.current.dirty).toBe(false);
  });

  it("reports load failures and can retry the same source", async () => {
    const onLoadError = vi.fn();
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValueOnce(resource("retry", "loaded"));
    const { result } = renderHook(() => useFilePreviewController({ onLoadError }));

    await act(async () => {
      expect(await result.current.openSource(readOnlySource("retry", load))).toBe(false);
    });
    expect(result.current.error).toBe("read failed");
    expect(onLoadError).toHaveBeenCalledWith("read failed");

    await act(async () => {
      expect(await result.current.reload()).toBe(true);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.draft.content).toBe("loaded");
  });

  it("keeps the current draft after a save failure", async () => {
    const onSaveError = vi.fn();
    const source: FilePreviewSource = {
      id: "save-failure",
      path: "save-failure.md",
      capabilities: { editContent: true, editTitle: false, openExternal: false },
      load: async () => resource("save-failure", "persisted"),
      save: vi.fn(async () => { throw new Error("write failed"); })
    };
    const { result } = renderHook(() => useFilePreviewController({ onSaveError }));
    await act(async () => { await result.current.openSource(source, { initialMode: "edit" }); });
    act(() => result.current.setContent("unsaved draft"));

    await act(async () => {
      expect(await result.current.save()).toBe(false);
    });
    expect(result.current.draft.content).toBe("unsaved draft");
    expect(result.current.dirty).toBe(true);
    expect(result.current.saveError).toBe("write failed");
    expect(onSaveError).toHaveBeenCalledWith("write failed");
  });

  it("prevents edit mode for read-only and truncated documents", async () => {
    const readOnly = readOnlySource("read-only", async () => resource("read-only", "one"));
    const truncated: FilePreviewSource = {
      id: "truncated",
      path: "truncated.md",
      capabilities: { editContent: true, editTitle: false, openExternal: false },
      load: async () => documentPreviewResource({ path: "truncated.md", content: "prefix", truncated: true }, "truncated"),
      save: async ({ content }) => resource("truncated", content)
    };
    const { result } = renderHook(() => useFilePreviewController());

    await act(async () => { await result.current.openSource(readOnly, { initialMode: "edit" }); });
    expect(result.current.mode).toBe("preview");
    expect(result.current.canEditContent).toBe(false);
    act(() => result.current.setContent("ignored"));
    expect(result.current.draft.content).toBe("one");

    await act(async () => { await result.current.openSource(truncated, { initialMode: "edit", force: true }); });
    expect(result.current.mode).toBe("preview");
    expect(result.current.canEditContent).toBe(false);
    act(() => result.current.setContent("ignored"));
    expect(result.current.draft.content).toBe("prefix");
  });

  it("confirms dirty close and flushes a captured final draft on unmount when requested", async () => {
    const save = vi.fn(async ({ content, title }) => documentPreviewResource({ path: "flush.md", name: title, content }, "flush"));
    const source: FilePreviewSource = {
      id: "flush",
      path: "flush.md",
      capabilities: { editContent: true, editTitle: false, openExternal: false },
      load: async () => resource("flush", "one"),
      save
    };
    const view = renderHook(() => useFilePreviewController({ flushOnUnmount: true }));
    await act(async () => { await view.result.current.openSource(source, { initialMode: "edit" }); });
    act(() => view.result.current.setContent("final draft"));

    await act(async () => {
      expect(await view.result.current.close(async () => false)).toBe(false);
    });
    expect(view.result.current.open).toBe(true);
    view.unmount();

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ content: "final draft" }));
  });

  it("orders the unmount flush after an older in-flight save", async () => {
    const firstSave = deferred<PreviewResource>();
    const save = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(async ({ content }) => resource("ordered", content));
    const source: FilePreviewSource = {
      id: "ordered",
      path: "ordered.md",
      capabilities: { editContent: true, editTitle: false, openExternal: false },
      load: async () => resource("ordered", "one"),
      save
    };
    const view = renderHook(() => useFilePreviewController({ flushOnUnmount: true }));
    await act(async () => { await view.result.current.openSource(source, { initialMode: "edit" }); });
    act(() => view.result.current.setContent("older"));
    act(() => { void view.result.current.save(); });
    act(() => view.result.current.setContent("final"));
    view.unmount();

    expect(save).toHaveBeenCalledTimes(1);
    firstSave.resolve(resource("ordered", "older"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenNthCalledWith(2, expect.objectContaining({ content: "final" }));
  });
});

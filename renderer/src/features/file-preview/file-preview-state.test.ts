import { describe, expect, it } from "vitest";
import { filePreviewReducer, initialFilePreviewState } from "./file-preview-state";
import { documentPreviewResource, type FilePreviewSource } from "./model";

function source(id = "source:a"): FilePreviewSource {
  return {
    id,
    path: `${id}.md`,
    capabilities: { editContent: true, editTitle: true, openExternal: false },
    load: async () => documentPreviewResource({ path: `${id}.md`, name: "A", content: "one" }, id),
    save: async ({ content, title }) => documentPreviewResource({ path: `${id}.md`, name: title, content }, id)
  };
}

describe("filePreviewReducer", () => {
  it("ignores a stale load completion", () => {
    const first = source("source:first");
    const second = source("source:second");
    let state = filePreviewReducer(initialFilePreviewState, { type: "open", source: first, mode: "preview" });
    state = filePreviewReducer(state, { type: "open", source: second, mode: "preview" });
    state = filePreviewReducer(state, {
      type: "load-success",
      sourceId: first.id,
      resource: documentPreviewResource({ path: "first.md", content: "stale" }, first.id),
      mode: "preview"
    });
    expect(state.source?.id).toBe(second.id);
    expect(state.resource).toBeNull();
    expect(state.phase).toBe("loading");
  });

  it("keeps edits made while an older save is in flight", () => {
    const currentSource = source();
    const loaded = documentPreviewResource({ path: "a.md", name: "A", content: "one" }, currentSource.id);
    let state = filePreviewReducer(initialFilePreviewState, { type: "open", source: currentSource, mode: "edit" });
    state = filePreviewReducer(state, { type: "load-success", sourceId: currentSource.id, resource: loaded, mode: "edit" });
    state = filePreviewReducer(state, { type: "set-content", content: "two" });
    const savedRevision = state.editRevision;
    const savedDraft = state.draft;
    state = filePreviewReducer(state, { type: "save-start", sourceId: currentSource.id });
    state = filePreviewReducer(state, { type: "set-content", content: "three" });
    state = filePreviewReducer(state, {
      type: "save-success",
      sourceId: currentSource.id,
      resource: documentPreviewResource({ path: "a.md", name: "A", content: "two" }, currentSource.id),
      savedDraft,
      savedRevision
    });
    expect(state.draft.content).toBe("three");
    expect(state.persisted.content).toBe("two");
    expect(state.mode).toBe("edit");
  });
});


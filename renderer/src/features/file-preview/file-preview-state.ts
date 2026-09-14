import type { FilePreviewSource, PreviewDraft, PreviewResource } from "./model";
import { previewResourceDraft } from "./model";

export type FilePreviewMode = "preview" | "edit";
export type FilePreviewPhase = "closed" | "loading" | "ready" | "saving" | "error";

export type FilePreviewState = {
  phase: FilePreviewPhase;
  source: FilePreviewSource | null;
  resource: PreviewResource | null;
  mode: FilePreviewMode;
  draft: PreviewDraft;
  persisted: PreviewDraft;
  editRevision: number;
  loadError: string | null;
  saveError: string | null;
};

export type FilePreviewAction =
  | { type: "open"; source: FilePreviewSource; mode: FilePreviewMode }
  | { type: "load-success"; sourceId: string; resource: PreviewResource; mode: FilePreviewMode }
  | { type: "load-failure"; sourceId: string; error: string }
  | { type: "set-content"; content: string }
  | { type: "set-title"; title: string }
  | { type: "set-mode"; mode: FilePreviewMode }
  | { type: "save-start"; sourceId: string }
  | { type: "save-success"; sourceId: string; resource: PreviewResource; savedDraft: PreviewDraft; savedRevision: number }
  | { type: "save-failure"; sourceId: string; error: string }
  | { type: "discard" }
  | { type: "clear-save-error" }
  | { type: "close" };

const EMPTY_DRAFT: PreviewDraft = { content: "", title: "" };

export const initialFilePreviewState: FilePreviewState = {
  phase: "closed",
  source: null,
  resource: null,
  mode: "preview",
  draft: EMPTY_DRAFT,
  persisted: EMPTY_DRAFT,
  editRevision: 0,
  loadError: null,
  saveError: null
};

export function filePreviewReducer(state: FilePreviewState, action: FilePreviewAction): FilePreviewState {
  switch (action.type) {
    case "open":
      return {
        ...initialFilePreviewState,
        phase: "loading",
        source: action.source,
        mode: action.mode
      };
    case "load-success": {
      if (state.source?.id !== action.sourceId) return state;
      const draft = previewResourceDraft(action.resource);
      return {
        ...state,
        phase: "ready",
        resource: action.resource,
        mode: action.mode,
        draft,
        persisted: draft,
        editRevision: 0,
        loadError: null,
        saveError: null
      };
    }
    case "load-failure":
      if (state.source?.id !== action.sourceId) return state;
      return {
        ...state,
        phase: "error",
        resource: null,
        loadError: action.error,
        saveError: null
      };
    case "set-content":
      if (!state.resource || state.resource.kind !== "document") return state;
      return {
        ...state,
        draft: { ...state.draft, content: action.content },
        editRevision: state.editRevision + 1,
        saveError: null
      };
    case "set-title":
      if (!state.resource) return state;
      return {
        ...state,
        draft: { ...state.draft, title: action.title },
        editRevision: state.editRevision + 1,
        saveError: null
      };
    case "set-mode":
      return { ...state, mode: action.mode };
    case "save-start":
      if (state.source?.id !== action.sourceId) return state;
      return { ...state, phase: "saving", saveError: null };
    case "save-success": {
      if (state.source?.id !== action.sourceId) return state;
      const normalized = previewResourceDraft(action.resource);
      const changedWhileSaving = state.editRevision !== action.savedRevision;
      return {
        ...state,
        phase: "ready",
        resource: action.resource,
        draft: changedWhileSaving ? state.draft : normalized,
        persisted: normalized,
        mode: state.mode,
        loadError: null,
        saveError: null
      };
    }
    case "save-failure":
      if (state.source?.id !== action.sourceId) return state;
      return { ...state, phase: "ready", saveError: action.error };
    case "discard":
      return {
        ...state,
        phase: state.resource ? "ready" : state.phase,
        draft: state.persisted,
        mode: "preview",
        editRevision: state.editRevision + 1,
        saveError: null
      };
    case "clear-save-error":
      return { ...state, saveError: null };
    case "close":
      return initialFilePreviewState;
    default:
      return assertNever(action);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled file preview action: ${JSON.stringify(value)}`);
}

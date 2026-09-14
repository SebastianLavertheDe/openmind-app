import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { errorText } from "../../ai-utils";
import {
  filePreviewReducer,
  initialFilePreviewState,
  type FilePreviewAction,
  type FilePreviewMode,
  type FilePreviewState
} from "./file-preview-state";
import {
  previewResourceTruncated,
  samePreviewDraft,
  type FilePreviewSource,
  type PreviewResource
} from "./model";

export type ConfirmPreviewDiscard = () => Promise<boolean>;

export type OpenFilePreviewOptions = {
  initialMode?: FilePreviewMode;
  confirmDiscard?: ConfirmPreviewDiscard;
  force?: boolean;
};

export type FilePreviewControllerOptions = {
  /** Persist the final immutable draft when the owning surface unmounts. */
  flushOnUnmount?: boolean;
  onLoadError?(error: string): void;
  onSaved?(resource: PreviewResource): void;
  onSaveError?(error: string): void;
};

export function useFilePreviewController(options: FilePreviewControllerOptions = {}) {
  const [renderState, reactDispatch] = useReducer(filePreviewReducer, initialFilePreviewState);
  const stateRef = useRef<FilePreviewState>(renderState);
  const openIntentRef = useRef(0);
  const requestRef = useRef(0);
  const sourceVersionRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const saveOperationsRef = useRef(new Map<string, { sourceVersion: number; promise: Promise<boolean> }>());
  const mountedRef = useRef(true);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const dispatch = useCallback((action: FilePreviewAction) => {
    stateRef.current = filePreviewReducer(stateRef.current, action);
    if (mountedRef.current) reactDispatch(action);
  }, []);

  useEffect(() => {
    // React StrictMode intentionally runs an extra setup/cleanup cycle in
    // development. Restore the flag in setup so the real mount remains usable.
    mountedRef.current = true;
    return () => {
      const finalState = stateRef.current;
      if (callbacksRef.current.flushOnUnmount
        && finalState.source?.save
        && finalState.resource?.kind === "document"
        && !samePreviewDraft(finalState.draft, finalState.persisted)) {
        // The surface is going away, so there can be no later edits to merge.
        // Persist the captured draft without attempting any React state update.
        // If a prior save is already running, chain after it so its older bytes
        // can never land after this final snapshot.
        const persistFinalDraft = () => finalState.source!.save!({ ...finalState.draft }).catch(() => {});
        const pendingSave = saveOperationsRef.current.get(finalState.source.id)?.promise;
        if (pendingSave) void pendingSave.finally(persistFinalDraft);
        else void persistFinalDraft();
      }
      mountedRef.current = false;
      openIntentRef.current += 1;
      requestRef.current += 1;
      sourceVersionRef.current += 1;
      loadAbortRef.current?.abort();
    };
  }, []);

  const isDirty = useCallback((state = stateRef.current) => {
    return Boolean(state.resource) && !samePreviewDraft(state.draft, state.persisted);
  }, []);

  const open = useCallback(async (source: FilePreviewSource, openOptions: OpenFilePreviewOptions = {}) => {
    const intent = ++openIntentRef.current;
    if (!openOptions.force && isDirty()) {
      if (!openOptions.confirmDiscard || !await openOptions.confirmDiscard()) return false;
    }
    if (!mountedRef.current || intent !== openIntentRef.current) return false;
    const request = ++requestRef.current;
    sourceVersionRef.current += 1;
    loadAbortRef.current?.abort();
    const loadAbort = new AbortController();
    loadAbortRef.current = loadAbort;
    const requestedMode = openOptions.initialMode || "preview";
    dispatch({ type: "open", source, mode: requestedMode });
    try {
      const resource = await source.load(loadAbort.signal);
      if (!mountedRef.current || request !== requestRef.current || stateRef.current.source?.id !== source.id) return false;
      const canEdit = resource.kind === "document"
        && !previewResourceTruncated(resource)
        && Boolean(source.save)
        && source.capabilities.editContent;
      dispatch({
        type: "load-success",
        sourceId: source.id,
        resource,
        mode: requestedMode === "edit" && canEdit ? "edit" : "preview"
      });
      if (loadAbortRef.current === loadAbort) loadAbortRef.current = null;
      return true;
    } catch (cause) {
      if (!mountedRef.current || request !== requestRef.current || stateRef.current.source?.id !== source.id) return false;
      if (loadAbortRef.current === loadAbort) loadAbortRef.current = null;
      const message = errorText(cause);
      dispatch({ type: "load-failure", sourceId: source.id, error: message });
      callbacksRef.current.onLoadError?.(message);
      return false;
    }
  }, [dispatch, isDirty]);

  const close = useCallback(async (confirmDiscard?: ConfirmPreviewDiscard) => {
    const intent = ++openIntentRef.current;
    if (isDirty()) {
      if (!confirmDiscard || !await confirmDiscard()) return false;
    }
    if (!mountedRef.current || intent !== openIntentRef.current) return false;
    requestRef.current += 1;
    sourceVersionRef.current += 1;
    loadAbortRef.current?.abort();
    loadAbortRef.current = null;
    dispatch({ type: "close" });
    return true;
  }, [dispatch, isDirty]);

  const reload = useCallback(async () => {
    const source = stateRef.current.source;
    if (!source) return false;
    return open(source, { initialMode: stateRef.current.mode, force: true });
  }, [open]);

  const setMode = useCallback(async (mode: FilePreviewMode, confirmDiscard?: ConfirmPreviewDiscard) => {
    const state = stateRef.current;
    if (mode === "edit") {
      const canEdit = state.resource?.kind === "document"
        && !previewResourceTruncated(state.resource)
        && Boolean(state.source?.save)
        && Boolean(state.source?.capabilities.editContent);
      if (!canEdit) return false;
    }
    if (mode === "preview" && state.mode === "edit" && isDirty() && confirmDiscard) {
      if (!await confirmDiscard()) return false;
      dispatch({ type: "discard" });
      return true;
    }
    dispatch({ type: "set-mode", mode });
    return true;
  }, [dispatch, isDirty]);

  const setContent = useCallback((content: string) => {
    const state = stateRef.current;
    if (!state.source?.capabilities.editContent || !state.source.save || previewResourceTruncated(state.resource)) return;
    dispatch({ type: "set-content", content });
  }, [dispatch]);

  const setTitle = useCallback((title: string) => {
    const state = stateRef.current;
    if (!state.source?.capabilities.editTitle || !state.source.save) return;
    dispatch({ type: "set-title", title });
  }, [dispatch]);

  const discard = useCallback(() => dispatch({ type: "discard" }), [dispatch]);
  const clearSaveError = useCallback(() => dispatch({ type: "clear-save-error" }), [dispatch]);

  const save = useCallback((): Promise<boolean> => {
    const requestedState = stateRef.current;
    const requestedSourceId = requestedState.source?.id;
    const requestedSourceVersion = sourceVersionRef.current;
    if (!requestedSourceId || !requestedState.source?.save || requestedState.resource?.kind !== "document") {
      return Promise.resolve(false);
    }
    const existing = saveOperationsRef.current.get(requestedSourceId);
    if (existing?.sourceVersion === requestedSourceVersion) return existing.promise;

    const persist = async () => {
      if (!mountedRef.current
        || sourceVersionRef.current !== requestedSourceVersion
        || stateRef.current.source?.id !== requestedSourceId) return false;
      while (mountedRef.current
        && sourceVersionRef.current === requestedSourceVersion
        && stateRef.current.source?.id === requestedSourceId
        && isDirty()) {
        const state = stateRef.current;
        const source = state.source;
        if (!source?.save || !state.resource || state.resource.kind !== "document") return false;
        const savedDraft = { ...state.draft };
        const savedRevision = state.editRevision;
        const sourceId = source.id;
        dispatch({ type: "save-start", sourceId });
        let resource: PreviewResource;
        try {
          resource = await source.save(savedDraft);
        } catch (cause) {
          const message = errorText(cause);
          if (mountedRef.current
            && sourceVersionRef.current === requestedSourceVersion
            && stateRef.current.source?.id === sourceId) {
            dispatch({ type: "save-failure", sourceId, error: message });
            callbacksRef.current.onSaveError?.(message);
          }
          return false;
        }
        if (!mountedRef.current
          || sourceVersionRef.current !== requestedSourceVersion
          || stateRef.current.source?.id !== sourceId) return false;
        dispatch({ type: "save-success", sourceId, resource, savedDraft, savedRevision });
        callbacksRef.current.onSaved?.(resource);
      }
      return mountedRef.current
        && sourceVersionRef.current === requestedSourceVersion
        && stateRef.current.source?.id === requestedSourceId;
    };
    // Reopening the same logical resource creates a new source generation.
    // Let an older write settle before persisting the new generation so stale
    // bytes can never land after the user's newest draft.
    const operation = existing
      ? existing.promise.then(persist, persist)
      : persist();
    saveOperationsRef.current.set(requestedSourceId, { sourceVersion: requestedSourceVersion, promise: operation });
    void operation.finally(() => {
      if (saveOperationsRef.current.get(requestedSourceId)?.promise === operation) {
        saveOperationsRef.current.delete(requestedSourceId);
      }
    });
    return operation;
  }, [dispatch, isDirty]);

  const state = renderState;
  const dirty = Boolean(state.resource) && !samePreviewDraft(state.draft, state.persisted);
  const canEditContent = state.resource?.kind === "document"
    && !previewResourceTruncated(state.resource)
    && Boolean(state.source?.save)
    && Boolean(state.source?.capabilities.editContent);
  const canEditTitle = Boolean(state.resource)
    && Boolean(state.source?.save)
    && Boolean(state.source?.capabilities.editTitle);

  return useMemo(() => ({
    state,
    source: state.source,
    resource: state.resource,
    phase: state.phase,
    open: Boolean(state.source),
    loading: state.phase === "loading",
    saving: state.phase === "saving",
    error: state.loadError,
    saveError: state.saveError,
    mode: state.mode,
    draft: state.draft,
    dirty,
    canEditContent,
    canEditTitle,
    openSource: open,
    close,
    reload,
    setMode,
    setContent,
    setTitle,
    save,
    discard,
    clearSaveError
  }), [canEditContent, canEditTitle, clearSaveError, close, dirty, discard, open, reload, renderState, save, setContent, setMode, setTitle]);
}

export type FilePreviewController = ReturnType<typeof useFilePreviewController>;

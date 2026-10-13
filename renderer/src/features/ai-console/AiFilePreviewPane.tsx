import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Eye, FileText, Pencil, Save, X } from "lucide-react";
import { messages as m } from "@shared/messages";
import { useAiUi } from "../../ai-context";
import { ColumnSplitter } from "../../components/ColumnSplitter";
import { ResponsiveActionBar, type ResponsiveAction, Textarea } from "../../design-system/components";
import { useResponsiveLayout } from "../../app/responsive-layout";
import { useContainerLayoutMode } from "../../design-system/use-container-layout-mode";
import { useExitPresence } from "../../design-system/use-exit-presence";
import { MarkdownEditor } from "../creative/MarkdownEditor";
import { PreviewRenderer, useFilePreviewController } from "../file-preview";
import { previewResourceTruncated, type FilePreviewSource, type PreviewDraft, type PreviewResource } from "../file-preview/model";
import { FilePreviewProvider } from "./file-preview-context";
import { usePreviewMotion } from "./use-preview-motion";
import {
  DEFAULT_PREVIEW_RATIO,
  FILE_PREVIEW_PANE_MIN_INLINE_SIZE,
  FILE_PREVIEW_SPLIT_MIN_INLINE_SIZE,
  FILE_PREVIEW_SPLITTER_INLINE_SIZE,
  MAX_PREVIEW_RATIO,
  MIN_PREVIEW_RATIO,
  filePreviewLayoutMode,
  loadPreviewRatio,
  savePreviewRatio
} from "./file-preview-layout";
import {
  isBinaryPreviewPath,
  workspacePreviewSource,
  type ConversationSurface
} from "./workspace-preview-source";

type DisplayedPreview = {
  source: FilePreviewSource;
  resource: PreviewResource | null;
  draft: PreviewDraft;
  mode: "preview" | "edit";
  loading: boolean;
  error: string | null;
  saveError: string | null;
  saving: boolean;
  dirty: boolean;
  canEditContent: boolean;
};

export function AiFilePreviewPane({
  surface,
  restoredPreviewPath = null,
  onPreviewPathChange,
  children
}: {
  surface: ConversationSurface;
  restoredPreviewPath?: string | null;
  onPreviewPathChange?: (path: string | null) => void;
  children: ReactNode;
}) {
  const ui = useAiUi();
  const responsiveLayout = useResponsiveLayout();
  const surfaceKind = surface.kind;
  const projectName = surface.kind === "project-task" ? surface.projectName : null;
  const preview = useFilePreviewController();
  const [previewRatio, setPreviewRatio] = useState(() => {
    try {
      return loadPreviewRatio(window.localStorage);
    } catch {
      return DEFAULT_PREVIEW_RATIO;
    }
  });
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [previewResizing, setPreviewResizing] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const workbenchLayout = useContainerLayoutMode<HTMLDivElement>({ splitMinInlineSize: FILE_PREVIEW_SPLIT_MIN_INLINE_SIZE });
  const workbenchRef = workbenchLayout.ref;
  const workbenchElementRef = workbenchLayout.elementRef;
  const layoutMode = filePreviewLayoutMode(workbenchLayout.inlineSize);
  const conversationRef = useRef<HTMLElement>(null);
  const previewPaneRef = useRef<HTMLElement>(null);
  const focusBeforePreviewRef = useRef<HTMLElement | null>(null);
  const restorePreviewFocusRef = useRef(false);
  const previewRatioRef = useRef(previewRatio);
  const previewResizeStartRatio = useRef(previewRatio);
  const previewDragging = useRef(false);
  const providerIntentRef = useRef(0);
  const openingSourceRef = useRef<string | null>(null);
  const restoredPathRef = useRef<string | null>(null);
  const previewSnapshotRef = useRef<DisplayedPreview | null>(null);
  const previewOpen = preview.open;
  const { visible: previewVisible, leaving: previewLeaving } = useExitPresence(previewOpen, 240);
  const previewOnly = previewVisible && layoutMode === "preview-only";
  const { capture: captureConversation, cancel: cancelConversationMotion } = usePreviewMotion(conversationRef, previewOpen, previewVisible, layoutMode);

  const livePreview = useMemo<DisplayedPreview | null>(() => preview.source ? {
    source: preview.source,
    resource: preview.resource,
    draft: preview.draft,
    mode: preview.mode,
    loading: preview.loading,
    error: preview.error,
    saveError: preview.saveError,
    saving: preview.saving,
    dirty: preview.dirty,
    canEditContent: preview.canEditContent
  } : null, [preview.canEditContent, preview.dirty, preview.draft, preview.error, preview.loading, preview.mode, preview.resource, preview.saveError, preview.saving, preview.source]);
  const displayedPreview = livePreview || previewSnapshotRef.current;

  useLayoutEffect(() => {
    if (livePreview) previewSnapshotRef.current = livePreview;
  }, [livePreview]);
  useEffect(() => {
    if (!previewDragging.current) previewRatioRef.current = previewRatio;
    const timeout = window.setTimeout(() => {
      try {
        savePreviewRatio(window.localStorage, previewRatio);
      } catch {
        // Hardened renderers can block localStorage; keep the in-memory ratio.
      }
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [previewRatio]);
  useEffect(() => () => {
    try {
      savePreviewRatio(window.localStorage, previewRatioRef.current);
    } catch {
      // Preserve in-memory behavior when storage access is unavailable.
    }
  }, []);
  useEffect(() => {
    if (!previewOpen || !previewVisible) {
      setPreviewActive(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => setPreviewActive(true));
    return () => window.cancelAnimationFrame(frame);
  }, [preview.source?.id, previewOpen, previewVisible]);

  const confirmLeavePreview = useCallback(() => ui.confirm({
    title: m.ai.workbench.unsavedTitle,
    body: m.ai.workbench.unsavedConfirm,
    confirmText: m.ai.workbench.unsavedConfirmText,
    danger: true
  }), [ui]);

  const openSource = useCallback(async (source: FilePreviewSource, logicalPath: string) => {
    if (openingSourceRef.current === source.id) return;
    openingSourceRef.current = source.id;
    if (!previewOpen) {
      focusBeforePreviewRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      captureConversation();
    }
    setSaveNotice(null);
    setRenderError(null);
    preview.clearSaveError();
    const opened = await preview.openSource(source, { confirmDiscard: confirmLeavePreview });
    if (openingSourceRef.current === source.id) openingSourceRef.current = null;
    if (opened) {
      // Record user-initiated opens as already restored before the parent
      // persists the path. Otherwise close() can briefly render with the old
      // restored prop and immediately reopen the file.
      restoredPathRef.current = logicalPath;
      onPreviewPathChange?.(logicalPath);
    }
  }, [captureConversation, confirmLeavePreview, onPreviewPathChange, preview.clearSaveError, preview.openSource, previewOpen]);

  const providerOpenPreview = useCallback(async (targetPath: string) => {
    const intent = ++providerIntentRef.current;
    if (surfaceKind === "workspace") {
      if (intent !== providerIntentRef.current) return;
      await openSource(workspacePreviewSource(targetPath), targetPath);
      return;
    }
    try {
      const { resolveProjectPreviewSource } = await import("./project-preview-source");
      if (intent !== providerIntentRef.current) return;
      const resolved = await resolveProjectPreviewSource(targetPath, projectName!);
      if (intent !== providerIntentRef.current) return;
      if (resolved) {
        await openSource(resolved.source, resolved.logicalPath);
        return;
      }
      ui.notify(isBinaryPreviewPath(targetPath)
        ? "该文件是二进制格式，请在项目“文件”页查看。"
        : "未能在当前项目中找到该文件；请在项目“文件”页确认文件名。", "error");
    } catch (cause) {
      ui.notify(errorText(cause), "error");
    }
  }, [openSource, projectName, surfaceKind, ui]);

  useEffect(() => {
    if (surfaceKind !== "workspace" || !restoredPreviewPath || previewOpen || restoredPathRef.current === restoredPreviewPath) return;
    // StrictMode replays mount effects and invalidates the controller's first
    // load. Start restoration after that replay; a cleaned-up effect must not
    // claim the path or leave an invalidated request stuck in loading.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      restoredPathRef.current = restoredPreviewPath;
      void openSource(workspacePreviewSource(restoredPreviewPath), restoredPreviewPath);
    });
    return () => { cancelled = true; };
  }, [openSource, previewOpen, restoredPreviewPath, surfaceKind]);

  const closePreview = useCallback(async () => {
    captureConversation();
    if (!await preview.close(async () => {
      const confirmed = await confirmLeavePreview();
      // A discard dialog may remain open while the window is resized.
      if (confirmed) captureConversation();
      return confirmed;
    })) return;
    providerIntentRef.current += 1;
    openingSourceRef.current = null;
    onPreviewPathChange?.(null);
    setPreviewActive(false);
    setPreviewResizing(false);
    setSaveNotice(null);
    setRenderError(null);
    restorePreviewFocusRef.current = true;
  }, [captureConversation, confirmLeavePreview, onPreviewPathChange, preview.close]);

  const switchToPreview = useCallback(async () => {
    await preview.setMode("preview", preview.dirty ? () => ui.confirm({
      title: m.ai.workbench.discardDirtyTitle,
      body: m.ai.workbench.discardDirtyConfirm,
      confirmText: m.ai.workbench.discardDirtyConfirmText,
      danger: true
    }) : undefined);
  }, [preview.dirty, preview.setMode, ui]);

  const savePreview = useCallback(async () => {
    setSaveNotice(null);
    preview.clearSaveError();
    if (await preview.save()) setSaveNotice(m.ai.workbench.saved);
  }, [preview.clearSaveError, preview.save]);

  useEffect(() => {
    if (!previewOnly || !previewActive) return;
    const frame = requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (focused instanceof Element && previewPaneRef.current?.contains(focused)) return;
      previewPaneRef.current?.querySelector<HTMLButtonElement>('[data-action-id="close"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [previewActive, previewOnly]);

  useLayoutEffect(() => {
    if (previewVisible || !restorePreviewFocusRef.current) return;
    restorePreviewFocusRef.current = false;
    const target = focusBeforePreviewRef.current;
    focusBeforePreviewRef.current = null;
    const focusTarget = target?.isConnected ? target : conversationRef.current;
    focusTarget?.focus({ preventScroll: true });
  }, [previewVisible]);

  const resizePreview = useCallback((delta: number) => {
    const width = workbenchLayout.inlineSize || workbenchElementRef.current?.getBoundingClientRect().width || FILE_PREVIEW_SPLIT_MIN_INLINE_SIZE;
    const ratio = Math.min(MAX_PREVIEW_RATIO, Math.max(MIN_PREVIEW_RATIO, previewRatioRef.current + delta / Math.max(1, width)));
    previewRatioRef.current = ratio;
    if (previewDragging.current) {
      workbenchElementRef.current?.style.setProperty("--workbench-columns", previewGridColumns(ratio));
      workbenchElementRef.current?.querySelector(":scope > .column-splitter")?.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    } else setPreviewRatio(ratio);
  }, [workbenchElementRef, workbenchLayout.inlineSize]);
  const startPreviewResize = useCallback(() => {
    cancelConversationMotion();
    previewResizeStartRatio.current = previewRatioRef.current;
    previewDragging.current = true;
  }, [cancelConversationMotion]);
  const cancelPreviewResize = useCallback(() => {
    previewRatioRef.current = previewResizeStartRatio.current;
    workbenchElementRef.current?.style.setProperty("--workbench-columns", previewGridColumns(previewRatioRef.current));
    setPreviewRatio(previewRatioRef.current);
  }, [workbenchElementRef]);
  const setPreviewResizeActive = useCallback((active: boolean) => {
    previewDragging.current = active;
    setPreviewResizing(active);
    if (!active) setPreviewRatio(previewRatioRef.current);
  }, []);

  const previewColumns = previewVisible && layoutMode === "split"
    ? previewGridColumns(previewDragging.current ? previewRatioRef.current : previewRatio)
    : "minmax(0, 1fr)";
  const truncated = previewResourceTruncated(displayedPreview?.resource || null);
  const canSave = previewOpen && displayedPreview?.canEditContent && preview.dirty && !preview.saving;
  const previewActions: ResponsiveAction[] = displayedPreview ? [
    {
      id: "preview",
      label: m.ai.workbench.preview,
      shortLabel: m.ai.workbench.preview,
      icon: Eye,
      priority: "essential",
      pressed: preview.mode === "preview",
      onSelect: switchToPreview
    },
    {
      id: "edit",
      label: truncated ? m.ai.workbench.fileTooLargePreviewOnly : m.ai.workbench.editFile,
      displayLabel: m.ai.workbench.edit,
      shortLabel: m.ai.workbench.edit,
      icon: Pencil,
      priority: "essential",
      pressed: preview.mode === "edit",
      disabled: !displayedPreview.canEditContent,
      onSelect: () => void preview.setMode("edit")
    },
    {
      id: "save",
      label: truncated
        ? m.ai.workbench.fileTooLargeCannotSave
        : preview.dirty
          ? m.ai.workbench.saveFile
          : m.ai.workbench.noUnsavedChanges,
      displayLabel: preview.saving ? m.ai.workbench.saving : m.ai.workbench.save,
      shortLabel: m.ai.workbench.save,
      icon: Save,
      priority: "essential",
      className: "ai-file-save",
      disabled: !canSave,
      onSelect: () => void savePreview()
    },
    {
      id: "close",
      label: m.ai.workbench.closeFilePreview,
      icon: X,
      priority: "essential",
      labelBehavior: "icon",
      onSelect: closePreview
    }
  ] : [];

  const openExternal = displayedPreview?.resource?.kind === "video"
    && displayedPreview.resource.playback.kind === "external-only"
    && displayedPreview.resource.playback.sourceUrl
    && displayedPreview.source.openExternal
    ? () => void displayedPreview.source.openExternal?.()
    : undefined;

  return (
    <FilePreviewProvider open={providerOpenPreview}>
      <div
        ref={workbenchRef}
        className={`ai-workbench${previewVisible ? " with-file-preview" : ""}${previewActive ? " preview-active" : ""}${previewLeaving ? " preview-leaving" : ""}${previewVisible && !previewOpen ? " preview-closing" : ""}${previewResizing ? " is-resizing-preview" : ""}`}
        data-preview-layout={previewVisible ? layoutMode : undefined}
        style={{ "--workbench-columns": previewColumns } as CSSProperties}
      >
        {!previewOnly ? <section ref={conversationRef} className="conversation-pane" tabIndex={-1}>{children}</section> : null}
        {previewVisible && displayedPreview ? (
          <>
            {layoutMode === "split" ? <ColumnSplitter
              side="left"
              collapsed={false}
              ariaLabel={m.ai.workbench.filePreviewWidth}
              toggle={closePreview}
              resize={resizePreview}
              reset={() => setPreviewRatio(DEFAULT_PREVIEW_RATIO)}
              onResizeStart={startPreviewResize}
              onResizeCancel={cancelPreviewResize}
              onResizeActiveChange={setPreviewResizeActive}
              ariaValueMin={Math.round(MIN_PREVIEW_RATIO * 100)}
              ariaValueMax={Math.round(MAX_PREVIEW_RATIO * 100)}
              ariaValueNow={Math.round(previewRatio * 100)}
            /> : null}
            <aside
              ref={previewPaneRef}
              className="ai-file-preview"
              tabIndex={-1}
              aria-label={m.ai.workbench.filePreview}
              aria-hidden={previewLeaving || undefined}
              inert={previewLeaving || undefined}
              data-leaving={previewLeaving || undefined}
            >
              <header>
                <FileText size={16} />
                <div>
                  <strong>{displayedPreview.resource?.title || displayedPreview.source.path.split(/[\\/]/).at(-1)}</strong>
                  <span title={displayedPreview.source.path}>{displayedPreview.source.path}</span>
                </div>
                <ResponsiveActionBar
                  className="ai-file-preview-actions"
                  actions={previewActions}
                  presentation={responsiveLayout.actions}
                  overflowLabel={m.ai.workbench.viewMode}
                />
              </header>
              <div className="ai-file-preview-body">
                {displayedPreview.loading ? <div className="preview-state">{m.ai.workbench.loadingFile}</div> : null}
                {displayedPreview.error ? <div className="preview-state error">{previewErrorText(displayedPreview.error)}</div> : null}
                {displayedPreview.saveError ? <div className="preview-inline-state error">{displayedPreview.saveError}</div> : null}
                {saveNotice ? <div className="preview-inline-state success">{saveNotice}</div> : null}
                {truncated ? <div className="preview-inline-state">{m.ai.workbench.fileTruncatedWarning}</div> : null}
                {renderError ? <div className="preview-state error">{renderError}</div> : null}
                {!renderError && displayedPreview.resource?.kind === "pdf" && displayedPreview.mode === "preview" ? (
                  <div className="ai-file-preview-pdf"><PreviewRenderer resource={displayedPreview.resource} onError={setRenderError} /></div>
                ) : null}
                {!renderError && displayedPreview.resource && displayedPreview.resource.kind !== "pdf" && displayedPreview.mode === "preview" ? (
                  <PreviewRenderer
                    resource={displayedPreview.resource}
                    content={displayedPreview.draft.content}
                    layout="file"
                    onOpenExternal={openExternal}
                  />
                ) : null}
                {displayedPreview.resource?.kind === "document" && displayedPreview.mode === "edit" && displayedPreview.canEditContent ? (
                  <div className="ai-file-editor-shell" onKeyDownCapture={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                      event.preventDefault();
                      event.stopPropagation();
                      void savePreview();
                    }
                  }}>
                    {/\.(md|markdown|mdown|mkd)$/i.test(displayedPreview.source.path) ? <MarkdownEditor
                      ariaLabel={m.ai.workbench.editFileContent}
                      value={displayedPreview.draft.content}
                      onSelectionChange={() => {}}
                      onChange={(value) => {
                        preview.setContent(value);
                        preview.clearSaveError();
                        setSaveNotice(null);
                      }}
                    /> : <Textarea variant="inline" className="ai-source-editor"
                      aria-label={m.ai.workbench.editFileContent}
                      value={displayedPreview.draft.content}
                      spellCheck={false}
                      onChange={event => { preview.setContent(event.target.value); preview.clearSaveError(); setSaveNotice(null); }}
                    />}
                  </div>
                ) : null}
              </div>
            </aside>
          </>
        ) : null}
      </div>
    </FilePreviewProvider>
  );
}

function previewGridColumns(ratio: number): string {
  return `minmax(${FILE_PREVIEW_PANE_MIN_INLINE_SIZE}px, ${ratio.toFixed(4)}fr) ${FILE_PREVIEW_SPLITTER_INLINE_SIZE}px minmax(${FILE_PREVIEW_PANE_MIN_INLINE_SIZE}px, ${(1 - ratio).toFixed(4)}fr)`;
}

function previewErrorText(message: string): string {
  return /enoent|not found|no such file|找不到|不存在/i.test(message) ? m.ai.workbench.fileMissing : message;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

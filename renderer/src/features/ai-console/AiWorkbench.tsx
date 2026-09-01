import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, FileText, History, Pencil, Save, X } from "lucide-react";
import type { AiSession, ContentRecord } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { AUTO_MODEL, effectiveModelInfo } from "@shared/model-catalog";
import { errorText, sessionStatusLabel } from "../../ai-utils";
import { useAi } from "../../ai-context";
import { ColumnSplitter } from "../../components/ColumnSplitter";
import { ResponsiveActionBar, ResponsiveContextBadge, VirtualList, type ResponsiveAction } from "../../design-system/components";
import { useResponsiveLayout } from "../../app/responsive-layout";
import { useAnchoredPopover } from "../../design-system/use-anchored-popover";
import { useContainerLayoutMode } from "../../design-system/use-container-layout-mode";
import { useExitPresence } from "../../design-system/use-exit-presence";
import { ContentPreview } from "../../components/ContentPreview";
import { Chat, type ChatDraftSubmitHandler } from "./Chat";
import { FilePreviewProvider } from "./file-preview-context";
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

type PreviewState = {
  path: string;
  content: ContentRecord | null;
  loading: boolean;
  error: string | null;
};

type PreviewMode = "preview" | "edit";

export function AiWorkbench({
  restoredPreviewPath = null,
  onPreviewPathChange,
  projectMode = false,
  onDraftSubmit
}: {
  restoredPreviewPath?: string | null;
  onPreviewPathChange?: (path: string | null) => void;
  /** Project Tasks have a separate content API/root. Until a Project-scoped
   * preview bridge is supplied, suppress the global editable file preview. */
  projectMode?: boolean;
  /** Lets a Project reuse the complete AI conversation UI while preserving
   * its own task creation and persistence boundary. */
  onDraftSubmit?: ChatDraftSubmitHandler;
} = {}) {
  const ai = useAi();
  const responsiveLayout = useResponsiveLayout();
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewRatio, setPreviewRatio] = useState(() => {
    try {
      return loadPreviewRatio(window.localStorage);
    } catch {
      return DEFAULT_PREVIEW_RATIO;
    }
  });
  const [previewMode, setPreviewMode] = useState<PreviewMode>("preview");
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [previewResizing, setPreviewResizing] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const historyFlyoutRef = useRef<HTMLDivElement>(null);
  const historyPresence = useExitPresence(historyOpen, 160);
  const historyPopover = useAnchoredPopover({
    open: historyPresence.visible,
    anchorRef: historyButtonRef,
    floatingRef: historyFlyoutRef,
    align: "end"
  });
  const workbenchLayout = useContainerLayoutMode<HTMLDivElement>({ splitMinInlineSize: FILE_PREVIEW_SPLIT_MIN_INLINE_SIZE });
  const workbenchRef = workbenchLayout.ref;
  const workbenchElementRef = workbenchLayout.elementRef;
  const previewLayoutMode = filePreviewLayoutMode(workbenchLayout.inlineSize);
  const conversationRef = useRef<HTMLElement>(null);
  const previewPaneRef = useRef<HTMLElement>(null);
  const focusBeforePreviewRef = useRef<HTMLElement | null>(null);
  const restorePreviewFocusRef = useRef(false);
  const previewRatioRef = useRef(previewRatio);
  const previewResizeStartRatio = useRef(previewRatio);
  const previewRequest = useRef(0);
  const openingPreviewPathRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const previewSnapshot = useRef<PreviewState | null>(null);
  const previewOpen = Boolean(preview);
  const { visible: previewVisible, leaving: previewLeaving } = useExitPresence(previewOpen, 240);
  const previewOnly = previewVisible && previewLayoutMode === "preview-only";
  const displayedPreview = preview || previewSnapshot.current;

  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => {
    previewRatioRef.current = previewRatio;
    const timeout = window.setTimeout(() => {
      try {
        savePreviewRatio(window.localStorage, previewRatio);
      } catch {
        // Accessing localStorage itself can be blocked in hardened renderers.
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
  useLayoutEffect(() => {
    if (preview) previewSnapshot.current = preview;
  }, [preview]);
  useEffect(() => {
    if (!previewOpen || !previewVisible) {
      setPreviewActive(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => setPreviewActive(true));
    return () => window.cancelAnimationFrame(frame);
  }, [preview?.path, previewOpen, previewVisible]);

  // 头部只展示当前会话所绑定运行时的 CLI 配置模型，不再应用应用内模型覆盖。
  const modelInfo = useMemo(() => {
    const session = ai.activeSession;
    if (!session) return null;
    const caps = ai.snapshot.providers.find((item) => item.id === session.providerId) ?? null;
    return effectiveModelInfo(session.provider, AUTO_MODEL, caps);
  }, [ai.activeSession, ai.snapshot.providers]);

  const canLeavePreview = useCallback(async () => {
    return !dirtyRef.current || await ai.confirm({
      title: m.ai.workbench.unsavedTitle,
      body: m.ai.workbench.unsavedConfirm,
      confirmText: m.ai.workbench.unsavedConfirmText,
      danger: true
    });
  }, [ai]);

  // P2-PRV-2: edit 模式 dirty 时切回 preview 需确认丢弃改动
  const switchToPreview = useCallback(async () => {
    if (previewMode === "edit" && dirty && !await ai.confirm({
      title: m.ai.workbench.discardDirtyTitle,
      body: m.ai.workbench.discardDirtyConfirm,
      confirmText: m.ai.workbench.discardDirtyConfirmText,
      danger: true
    })) return;
    setPreviewMode("preview");
  }, [ai, previewMode, dirty]);

  const openPreview = useCallback(async (path: string) => {
    if (openingPreviewPathRef.current === path) return;
    openingPreviewPathRef.current = path;
    if (!await canLeavePreview()) {
      openingPreviewPathRef.current = null;
      return;
    }
    if (!previewOpen) focusBeforePreviewRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const request = ++previewRequest.current;
    onPreviewPathChange?.(path);
    setPreview({ path, content: null, loading: true, error: null });
    setPreviewMode("preview");
    setDraft("");
    setDirty(false);
    setSaveError(null);
    setSaveNotice(null);
    void window.openmind.readContent(path).then((content) => {
      if (openingPreviewPathRef.current === path) openingPreviewPathRef.current = null;
      if (request !== previewRequest.current) return;
      setPreview({ path, content, loading: false, error: null });
      setDraft(content.content || "");
      setDirty(false);
    }).catch((cause) => {
      if (openingPreviewPathRef.current === path) openingPreviewPathRef.current = null;
      if (request === previewRequest.current) {
        setPreview({ path, content: null, loading: false, error: previewErrorText(cause) });
      }
    });
  }, [canLeavePreview, onPreviewPathChange, previewOpen]);

  // 路由切走时 AI 工作台会卸载。文件路径由工作区保留，返回同一工作台后
  // 重新载入该文件，恢复“左文件、右对话”的分栏，而不是退回纯对话视图。
  useEffect(() => {
    if (projectMode || !restoredPreviewPath || preview) return;
    void openPreview(restoredPreviewPath);
  }, [openPreview, preview, projectMode, restoredPreviewPath]);

  const providerOpenPreview = useCallback(async (targetPath: string) => {
    if (projectMode) {
      ai.notify("Project 资料请在“资料”页查看；此处不会使用全局工作区文件编辑器。", "error");
      return;
    }
    await openPreview(targetPath);
  }, [ai, openPreview, projectMode]);

  const closePreview = useCallback(async () => {
    if (!await canLeavePreview()) return;
    previewRequest.current += 1;
    openingPreviewPathRef.current = null;
    onPreviewPathChange?.(null);
    setPreviewActive(false);
    setPreview(null);
    setPreviewResizing(false);
    restorePreviewFocusRef.current = true;
  }, [canLeavePreview, onPreviewPathChange]);

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

  const toggleHistory = useCallback(() => setHistoryOpen((current) => !current), []);

  useLayoutEffect(() => {
    if (!historyOpen) return;
    const button = historyButtonRef.current;
    if (!button) {
      setHistoryOpen(false);
      return;
    }

    let frame = 0;
    const closeWhenAnchorIsUnavailable = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) {
          setHistoryOpen(false);
        }
      });
    };
    closeWhenAnchorIsUnavailable();

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(closeWhenAnchorIsUnavailable);
    resizeObserver?.observe(button);
    const shell = button.closest(".app-shell");
    const mutationObserver = shell && typeof MutationObserver !== "undefined"
      ? new MutationObserver(closeWhenAnchorIsUnavailable)
      : null;
    if (shell) mutationObserver?.observe(shell, { attributes: true, subtree: true, attributeFilter: ["class", "style", "hidden"] });
    window.addEventListener("resize", closeWhenAnchorIsUnavailable);
    window.visualViewport?.addEventListener("resize", closeWhenAnchorIsUnavailable);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", closeWhenAnchorIsUnavailable);
      window.visualViewport?.removeEventListener("resize", closeWhenAnchorIsUnavailable);
    };
  }, [historyOpen, previewLayoutMode, responsiveLayout.shell]);

  useEffect(() => {
    if (!historyOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const button = historyButtonRef.current;
      const menu = historyFlyoutRef.current;
      if (button?.contains(target) || menu?.contains(target)) return;
      setHistoryOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setHistoryOpen(false);
        historyButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [historyOpen]);

  const resizePreview = useCallback((delta: number) => {
    const width = workbenchLayout.inlineSize || workbenchElementRef.current?.getBoundingClientRect().width || FILE_PREVIEW_SPLIT_MIN_INLINE_SIZE;
    setPreviewRatio((value) => Math.min(MAX_PREVIEW_RATIO, Math.max(MIN_PREVIEW_RATIO, value + delta / Math.max(1, width))));
  }, [workbenchElementRef, workbenchLayout.inlineSize]);
  const startPreviewResize = useCallback(() => {
    previewResizeStartRatio.current = previewRatio;
  }, [previewRatio]);
  const cancelPreviewResize = useCallback(() => {
    setPreviewRatio(previewResizeStartRatio.current);
  }, []);

  const savePreview = useCallback(async () => {
    if (!preview || saving || preview.content?.truncated) return;
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const content = await window.openmind.writeContent(preview.path, draft);
      setPreview((current) => current?.path === preview.path ? { ...current, content, loading: false, error: null } : current);
      setDraft(content.content || draft);
      setDirty(false);
      setSaveNotice(m.ai.workbench.saved);
    } catch (cause) {
      setSaveError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }, [draft, preview, saving]);

  const previewColumns = previewVisible && previewLayoutMode === "split"
    ? previewActive
      ? `minmax(${FILE_PREVIEW_PANE_MIN_INLINE_SIZE}px, ${previewRatio.toFixed(3)}fr) ${FILE_PREVIEW_SPLITTER_INLINE_SIZE}px minmax(${FILE_PREVIEW_PANE_MIN_INLINE_SIZE}px, ${(1 - previewRatio).toFixed(3)}fr)`
      : "minmax(0, 0fr) 0px minmax(0, 1fr)"
    : "minmax(0, 1fr)";
  const canEdit = Boolean(displayedPreview?.content && !displayedPreview.content.truncated);
  const canSave = previewOpen && canEdit && dirty && !saving;
  const previewActions: ResponsiveAction[] = displayedPreview ? [
    {
      id: "preview",
      label: m.ai.workbench.preview,
      shortLabel: m.ai.workbench.preview,
      icon: Eye,
      priority: "essential",
      pressed: previewMode === "preview",
      onSelect: switchToPreview
    },
    {
      id: "edit",
      label: displayedPreview.content?.truncated ? m.ai.workbench.fileTooLargePreviewOnly : m.ai.workbench.editFile,
      displayLabel: m.ai.workbench.edit,
      shortLabel: m.ai.workbench.edit,
      icon: Pencil,
      priority: "essential",
      pressed: previewMode === "edit",
      disabled: !canEdit,
      onSelect: () => setPreviewMode("edit")
    },
    {
      id: "save",
      label: displayedPreview.content?.truncated
        ? m.ai.workbench.fileTooLargeCannotSave
        : dirty
          ? m.ai.workbench.saveFile
          : m.ai.workbench.noUnsavedChanges,
      displayLabel: saving ? m.ai.workbench.saving : m.ai.workbench.save,
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

  return (
    <FilePreviewProvider open={providerOpenPreview}>
      <div
        ref={workbenchRef}
        className={`ai-workbench${previewVisible ? " with-file-preview" : ""}${previewActive ? " preview-active" : ""}${previewLeaving ? " preview-leaving" : ""}${previewResizing ? " is-resizing-preview" : ""}`}
        data-preview-layout={previewVisible ? previewLayoutMode : undefined}
        style={{ "--workbench-columns": previewColumns } as React.CSSProperties}
      >
        {!previewOnly ? <main ref={conversationRef} className="conversation-pane" tabIndex={-1}>
          <header className="conversation-header">
            <div>
              {/* P1-HDR-2: provider 改 segmented control + 彩色 dot */}
              {ai.activeSession ? (
                <span className="provider-segmented">
                  <span className={`provider-dot ${ai.activeSession.provider === "claude" ? "claude" : "codex"}`} aria-hidden="true" />
                  <span className="provider-name">{ai.activeSession.provider === "claude" ? "Claude Code" : "Codex"}</span>
                  {modelInfo ? <span className="provider-model" title={modelInfo.label}>{modelInfo.label}{modelInfo.oneMillion ? " · 1M" : ""}</span> : null}
                  <span className="provider-sep" aria-hidden="true">·</span>
                  <span className="provider-perm">{ai.activeSession.permissionProfile}</span>
                  {ai.activeSession.interactionMode === "plan" ? <span className="provider-mode">{m.ai.mode.planActive}</span> : null}
                </span>
              ) : (
                <span className="eyebrow">{m.ai.workbench.draftStatus}</span>
              )}
              <h2>{ai.activeSession?.title || m.ai.session.new}</h2>
              {ai.activeSession ? <small title={displaySessionPath(ai.activeSession, ai.snapshot.projectRoot)}>{responsiveLayout.actions === "full" ? displaySessionPath(ai.activeSession, ai.snapshot.projectRoot) : compactPath(displaySessionPath(ai.activeSession, ai.snapshot.projectRoot))}</small> : null}
            </div>
            {/* P1-HDR-1: status 改圆点 + 脉冲,配语义色 token */}
            <div className="conversation-header-actions">
              {ai.activeSession ? (
                <ResponsiveContextBadge
                  presentation={responsiveLayout.actions}
                  priority="essential"
                  label={sessionStatusLabel(ai.activeSession.status)}
                  tone={sessionStatusTone(ai.activeSession.status)}
                />
              ) : null}
              {!projectMode ? <button
                ref={historyButtonRef}
                className="icon-button history-toggle"
                aria-label={m.ai.session.recent}
                title={m.ai.session.recent}
                aria-haspopup="menu"
                aria-expanded={historyOpen}
                onClick={toggleHistory}
              >
                <History size={16} />
              </button> : null}
            </div>
          </header>
          <Chat onDraftSubmit={onDraftSubmit} />
        </main> : null}
        {!projectMode && historyPresence.visible ? createPortal(
          <div
            ref={historyFlyoutRef}
            className="history-flyout"
            data-leaving={historyPresence.leaving || undefined}
            data-side={historyPopover.side}
            role="menu"
            aria-label={m.ai.session.recent}
            style={historyPopover.style}
          >
            <AiSessionNavigation />
          </div>,
          document.body
        ) : null}
        {previewVisible && displayedPreview ? (
          <>
            {previewLayoutMode === "split" ? <ColumnSplitter
              side="left"
              collapsed={false}
              ariaLabel={m.ai.workbench.filePreviewWidth}
              toggle={closePreview}
              resize={resizePreview}
              reset={() => setPreviewRatio(DEFAULT_PREVIEW_RATIO)}
              onResizeStart={startPreviewResize}
              onResizeCancel={cancelPreviewResize}
              onResizeActiveChange={setPreviewResizing}
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
                  <strong>{displayedPreview.content?.name || displayedPreview.path.split(/[\\/]/).at(-1)}</strong>
                  <span title={displayedPreview.path}>{displayedPreview.path}</span>
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
                {displayedPreview.error ? <div className="preview-state error">{displayedPreview.error}</div> : null}
                {saveError ? <div className="preview-inline-state error">{saveError}</div> : null}
                {saveNotice ? <div className="preview-inline-state success">{saveNotice}</div> : null}
                {displayedPreview.content?.truncated ? <div className="preview-inline-state">{m.ai.workbench.fileTruncatedWarning}</div> : null}
                {displayedPreview.content && previewMode === "preview" ? <ContentPreview content={{ ...displayedPreview.content, content: dirty ? draft : displayedPreview.content.content }} layout="file" /> : null}
                {displayedPreview.content && previewMode === "edit" && canEdit ? (
                  <div className="ai-file-editor-shell">
                    <textarea
                      aria-label={m.ai.workbench.editFileContent}
                      value={draft}
                      spellCheck={false}
                      onChange={(event) => {
                        setDraft(event.target.value);
                        setDirty(true);
                        setSaveError(null);
                        setSaveNotice(null);
                      }}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
                          event.preventDefault();
                          void savePreview();
                        }
                      }}
                    />
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
function sessionStatusTone(status: AiSession["status"]): "neutral" | "success" | "warning" | "danger" {
  const tones: Record<AiSession["status"], "neutral" | "success" | "warning" | "danger"> = {
    idle: "neutral",
    running: "success",
    "waiting-approval": "warning",
    failed: "danger"
  };
  return tones[status];
}

function previewErrorText(cause: unknown): string {
  const message = errorText(cause);
  return /enoent|not found|no such file|找不到|不存在/i.test(message) ? m.ai.workbench.fileMissing : message;
}

function compactPath(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) || value;
}

function displaySessionPath(session: AiSession, fallbackRoot: string): string {
  return session.cwd === "." ? session.projectRoot || fallbackRoot : session.cwd;
}

export function AiSessionNavigation() {
  const ai = useAi();
  const sessions = useMemo(() => ai.snapshot.sessions
    .filter((session) => session.scope?.type !== "project-task")
    .sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return right.createdAt.localeCompare(left.createdAt);
    }), [ai.snapshot.sessions]);

  const onSessionListKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('article.nav-recent-item[role="option"]'));
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    let target: HTMLElement | null = null;
    if (event.key === "ArrowDown") target = items[Math.min(items.length - 1, currentIndex + 1)] || null;
    else if (event.key === "ArrowUp") target = items[Math.max(0, currentIndex - 1)] || null;
    else if (event.key === "Home") target = items[0] || null;
    else if (event.key === "End") target = items[items.length - 1] || null;
    target?.focus();
  };

  return (
    <section className="app-session-navigation">
      <header>
        <strong>{m.ai.session.recent} <span>({sessions.length})</span></strong>
      </header>
      {sessions.length > 60 ? (
        <VirtualList
          items={sessions}
          rowHeight={44}
          getKey={(session) => session.id}
          renderItem={(session) => <SessionItem session={session} />}
          className="session-list"
          role="listbox"
          ariaLabel={m.ai.session.list}
          tabIndex={0}
          onKeyDown={onSessionListKeyDown}
        />
      ) : (
        <div className="session-list" role="listbox" aria-label={m.ai.session.list} tabIndex={sessions.length ? 0 : -1} onKeyDown={onSessionListKeyDown}>
          {!sessions.length ? <div className="list-empty">{m.ai.session.empty}</div> : sessions.map((session) => <SessionItem key={session.id} session={session} />)}
        </div>
      )}
    </section>
  );
}

function SessionItem({ session }: { session: AiSession }) {
  const ai = useAi();
  const active = ai.activeSession?.id === session.id;
  const waitingApproval = session.status === "waiting-approval" || ai.snapshot.pendingApprovals.some((approval) => approval.sessionId === session.id);
  const dot = waitingApproval ? "waiting-approval" : session.status === "running" ? "running" : session.status === "failed" ? "failed" : "";
  return (
    <article
      className={`nav-recent-item ${active ? "active" : ""}`}
      role="option"
      aria-selected={active}
      tabIndex={0}
      onClick={() => void ai.setActiveSession(session.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void ai.setActiveSession(session.id);
        }
      }}
    >
      {dot ? <span className={`nav-recent-dot ${dot}`} aria-hidden /> : <span aria-hidden />}
      <span className="nav-recent-item-main">
        <span className="nav-recent-item-title">{session.title || m.common.unnamedTopic}</span>
        <span className={`nav-recent-item-meta${waitingApproval ? " waiting-approval" : ""}`}>
          {waitingApproval ? m.ai.status.session.waitingApproval : relativeSessionTime(session.createdAt)}
        </span>
      </span>
    </article>
  );
}

function relativeSessionTime(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const delta = Math.max(0, Date.now() - then);
  if (delta < 60_000) return m.common.justNow;
  if (delta < 3_600_000) return m.common.minutesAgo(Math.floor(delta / 60_000));
  if (delta < 86_400_000) return m.common.hoursAgo(Math.floor(delta / 3_600_000));
  return m.common.daysAgo(Math.floor(delta / 86_400_000));
}

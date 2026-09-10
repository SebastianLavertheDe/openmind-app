import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, FileText, History, Pencil, Save, X } from "lucide-react";
import type { AiSession, ContentRecord } from "@shared/contracts";
import { workspaceSessions } from "@shared/ai-session-scope";
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
import { projectsApi } from "../projects/projects-api";
import { PdfMaterialViewer } from "../projects/PdfMaterialViewer";
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
  projectName,
  onDraftSubmit
}: {
  restoredPreviewPath?: string | null;
  onPreviewPathChange?: (path: string | null) => void;
  /** Project Tasks have a separate content API/root. File references resolve
   * read-only against the owning Project; editing stays disabled. */
  projectMode?: boolean;
  /** Owning Project name, used to resolve file references inside the Project. */
  projectName?: string;
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
  const [previewReadOnly, setPreviewReadOnly] = useState(false);
  const [previewPdf, setPreviewPdf] = useState<{ data: Uint8Array; title: string } | null>(null);
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
    setPreviewReadOnly(false);
    setPreviewPdf(null);
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

  // 消息里的文件引用常常只有裸文件名（目录拆在表格另一列）。先按候选路径
  // 探测，失败后用项目资料/产出清单按文件名反查完整目录，把路径补全。
  // 清单带 30s 缓存（含 in-flight 去重）：反复点击不重复拉取，也避免多文件
  // 引用密集点击时对主进程形成放大。
  const resolveInProject = useCallback(async (targetPath: string): Promise<{ logical: string; relative: string } | null> => {
    if (!projectName) return null;
    const prefix = `openmind/projects/${projectName}/`;
    for (const candidate of projectPreviewCandidates(targetPath, projectName)) {
      try {
        await window.openmind.readContent(candidate);
        return { logical: candidate, relative: candidate.startsWith(prefix) ? candidate.slice(prefix.length) : candidate };
      } catch { /* 尝试下一个候选路径 */ }
    }
    const basename = targetPath.trim().split(/[\\/]/).pop()?.trim().toLowerCase();
    if (!basename) return null;
    try {
      const listings = await loadProjectFileListings(projectName);
      // 资料的 relativePath 指向转换后的文档；PDF 等原件登记在 originalRelativePath。
      // 命中原件时，readPath 必须用资料自身的 relativePath（readMaterialOriginal 按它查记录）。
      const entries: Array<{ logicalRelative: string; readPath: string }> = [];
      for (const item of listings.materials) {
        if (item.relativePath) entries.push({ logicalRelative: item.relativePath, readPath: item.relativePath });
        if (item.originalRelativePath && item.relativePath) {
          entries.push({ logicalRelative: item.originalRelativePath, readPath: item.relativePath });
        }
      }
      for (const item of listings.outputs) {
        if (item.relativePath) entries.push({ logicalRelative: item.relativePath, readPath: item.relativePath });
      }
      const match = entries.find((entry) => {
        const lowered = entry.logicalRelative.toLowerCase();
        return lowered === basename || lowered.endsWith(`/${basename}`);
      });
      if (match) return { logical: `${prefix}${match.logicalRelative}`, relative: match.readPath };
    } catch { /* 清单不可用时维持未找到 */ }
    return null;
  }, [projectName]);

  const providerOpenPreview = useCallback(async (targetPath: string) => {
    if (projectMode) {
      // Project 会话保留只读边界：点击文件引用时把路径解析到所属 Project 内，
      // 以只读方式预览；项目外的路径仍然拒绝打开全局可编辑预览。
      const resolved = await resolveInProject(targetPath);
      if (resolved && !isBinaryPreviewPath(resolved.logical)) {
        await openPreview(resolved.logical);
        setPreviewReadOnly(true);
        return;
      }
      if (resolved && /\.pdf$/i.test(resolved.logical) && projectName) {
        try {
          // PDF 原件登记在资料记录的 originalRelativePath 上，而 readMaterialOriginal
          // 只按资料自身的 relativePath 查记录——先把点击路径映射回资料记录再取原件。
          const prefix = `openmind/projects/${projectName}/`;
          const lowered = resolved.logical.toLowerCase();
          const listings = await loadProjectFileListings(projectName);
          const material = listings.materials.find((item) => [item.relativePath, item.originalRelativePath]
            .some((value) => value && `${prefix}${value}`.toLowerCase() === lowered));
          if (material?.relativePath) {
            const original = await projectsApi.readMaterialOriginal(projectName, material.relativePath);
            await openPreview(resolved.logical);
            setPreviewReadOnly(true);
            setPreviewPdf({ data: original.data, title: resolved.relative.split("/").at(-1) || resolved.relative });
            return;
          }
        } catch { /* 原件不可用时回退到提示 */ }
      }
      ai.notify(isBinaryPreviewPath(targetPath)
        ? "该文件是二进制格式（如 PDF/图片），请在项目“文件”页查看。"
        : "未能在当前项目中找到该文件；请在项目“文件”页确认文件名。", "error");
      return;
    }
    await openPreview(targetPath);
  }, [ai, openPreview, projectMode, resolveInProject]);

  const closePreview = useCallback(async () => {
    if (!await canLeavePreview()) return;
    previewRequest.current += 1;
    openingPreviewPathRef.current = null;
    onPreviewPathChange?.(null);
    setPreviewActive(false);
    setPreview(null);
    setPreviewPdf(null);
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
  const canEdit = Boolean(displayedPreview?.content && !displayedPreview.content.truncated) && !previewReadOnly;
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
          <header className={`conversation-header${ai.activeSession ? "" : " is-draft"}`}>
            {ai.activeSession ? (
              <div>
                {/* P1-HDR-2: provider 改 segmented control + 彩色 dot */}
                <span className="provider-segmented">
                  <span className={`provider-dot ${ai.activeSession.provider === "claude" ? "claude" : "codex"}`} aria-hidden="true" />
                  <span className="provider-name">{ai.activeSession.provider === "claude" ? "Claude Code" : "Codex"}</span>
                  {modelInfo ? <span className="provider-model" title={modelInfo.label}>{modelInfo.label}{modelInfo.oneMillion ? " · 1M" : ""}</span> : null}
                  <span className="provider-sep" aria-hidden="true">·</span>
                  <span className="provider-perm">{ai.activeSession.permissionProfile}</span>
                  {ai.activeSession.interactionMode === "plan" ? <span className="provider-mode">{m.ai.mode.planActive}</span> : null}
                </span>
                <h2>{ai.activeSession.title}</h2>
                <small title={displaySessionPath(ai.activeSession, ai.snapshot.projectRoot)}>{responsiveLayout.actions === "full" ? displaySessionPath(ai.activeSession, ai.snapshot.projectRoot) : compactPath(displaySessionPath(ai.activeSession, ai.snapshot.projectRoot))}</small>
              </div>
            ) : null}
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
                {previewPdf ? <div className="ai-file-preview-pdf"><PdfMaterialViewer data={previewPdf.data} title={previewPdf.title} onError={(message) => {
                  // PDF 渲染失败时清掉二进制乱码内容，避免回退成文本预览。
                  setPreview((current) => current ? { ...current, content: null, loading: false, error: message } : current);
                  setPreviewPdf(null);
                  setSaveError(null);
                }} /></div> : null}
                {!previewPdf && displayedPreview.content && previewMode === "preview" ? <ContentPreview content={{ ...displayedPreview.content, content: dirty ? draft : displayedPreview.content.content }} layout="file" /> : null}
                {!previewPdf && displayedPreview.content && previewMode === "edit" && canEdit ? (
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

const BINARY_PREVIEW_EXTENSIONS = /\.(pdf|png|jpe?g|gif|webp|svg|ico|bmp|zip|gz|7z|tar|rar|mp4|mov|webm|mp3|wav|ogg|woff2?|ttf|otf|eot|exe|dll)$/i;

export function isBinaryPreviewPath(path: string): boolean {
  return BINARY_PREVIEW_EXTENSIONS.test(path.trim());
}

type ProjectFileListings = {
  materials: Array<{ relativePath?: string; originalRelativePath?: string | null }>;
  outputs: Array<{ relativePath?: string }>;
};

const PROJECT_LISTINGS_CACHE_TTL_MS = 30_000;
const projectFileListingsCache = new Map<string, { at: number; promise: Promise<ProjectFileListings> }>();

/** 项目清单短缓存：点击解析是低频用户动作，30s 内复用一次拉取即可。 */
function loadProjectFileListings(projectName: string): Promise<ProjectFileListings> {
  const cached = projectFileListingsCache.get(projectName);
  if (cached && Date.now() - cached.at < PROJECT_LISTINGS_CACHE_TTL_MS) return cached.promise;
  const promise = (async () => {
    const [materials, outputs] = await Promise.all([
      window.openmind.listProjectMaterials(projectName),
      window.openmind.listProjectOutputs(projectName).catch(() => [] as Array<{ relativePath?: string }>)
    ]);
    return {
      materials: materials as Array<{ relativePath?: string; originalRelativePath?: string | null }>,
      outputs: outputs as Array<{ relativePath?: string }>
    };
  })();
  projectFileListingsCache.set(projectName, { at: Date.now(), promise });
  promise.catch(() => projectFileListingsCache.delete(projectName));
  return promise;
}

/**
 * Project 会话里点击文件引用时的候选逻辑路径，按尝试顺序返回。
 * 主进程的 readContent 对 `openmind/…` 逻辑路径按只读放行项目数据，
 * 相对路径则一律以当前路径解析，因此项目内文件必须补全为逻辑路径。
 */
export function projectPreviewCandidates(targetPath: string, projectName: string): string[] {
  const normalized = targetPath.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (!normalized || !projectName) return [];
  if (/^openmind\//i.test(normalized)) return [normalized];
  if (/^[a-z]:\//i.test(normalized) || normalized.startsWith("//")) {
    // 绝对路径：readContent 自带目录边界校验，原样尝试即可。
    return [normalized];
  }
  return [`openmind/projects/${projectName}/${normalized}`];
}

function compactPath(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) || value;
}

function displaySessionPath(session: AiSession, fallbackRoot: string): string {
  return session.cwd === "." ? session.projectRoot || fallbackRoot : session.cwd;
}

export function AiSessionNavigation() {
  const ai = useAi();
  const sessions = useMemo(() => workspaceSessions(ai.snapshot.sessions, true)
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

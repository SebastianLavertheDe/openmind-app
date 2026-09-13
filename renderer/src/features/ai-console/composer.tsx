import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, ChevronDown, ChevronLeft, ChevronRight, FilePlus2, FolderOpen, ListChecks, LoaderCircle, Plus, Quote, ShieldCheck, Square, Trash2, X } from "lucide-react";
import type { ContextReference, InteractionMode, PermissionProfile, ProjectFileMatch, SkillDefinition } from "@shared/contracts";
import { slashCommandValidationError } from "@shared/slash-commands";
import { messages as m } from "@shared/messages";
import { useAiActions, useAiDraft, useAiSnapshot, useAiUi } from "../../ai-context";
import { AnimatedDisclosure } from "../../design-system/animated-disclosure";
import { useAnchoredPopover } from "../../design-system/use-anchored-popover";
import { ComposerSuggestionMenu } from "./composer-suggestion-menu";
import { useExitPresence } from "../../design-system/use-exit-presence";
import {
  findComposerTrigger,
  parseSkillSlashInvocation,
  removeMentionTrigger,
  replaceComposerTrigger,
  skillMatchScore,
  type ComposerTrigger
} from "./composer-suggestions";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const COMPRESS_THRESHOLD = 512 * 1024;
const COMPRESS_MAX_EDGE = 1568;
const LIGHTBOX_EXIT_MS = 160;

type ComposerCaretAnchor = { left: number; top: number; height: number; width: number };

function measureTextareaCaret(textarea: HTMLTextAreaElement): ComposerCaretAnchor {
  const style = getComputedStyle(textarea);
  const textareaBox = textarea.getBoundingClientRect();
  const mirror = document.createElement("div");
  const copiedProperties = [
    "box-sizing", "border-left-width", "border-right-width", "border-top-width", "border-bottom-width",
    "padding-left", "padding-right", "padding-top", "padding-bottom", "font-family", "font-size",
    "font-style", "font-weight", "letter-spacing", "line-height", "text-align", "text-indent",
    "text-transform", "tab-size", "word-break", "overflow-wrap"
  ];
  for (const property of copiedProperties) mirror.style.setProperty(property, style.getPropertyValue(property));
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    left: `${textareaBox.left - textarea.scrollLeft}px`,
    top: `${textareaBox.top - textarea.scrollTop}px`,
    width: `${textareaBox.width}px`,
    height: "auto",
    overflow: "hidden",
    whiteSpace: "pre-wrap"
  });
  mirror.textContent = textarea.value.slice(0, textarea.selectionStart ?? textarea.value.length);
  if (mirror.textContent.endsWith("\n")) mirror.appendChild(document.createTextNode("\u200b"));
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const markerBox = marker.getBoundingClientRect();
  mirror.remove();

  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4 || 20;
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
  const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
  return {
    left: Math.max(textareaBox.left, Math.min(markerBox.left, textareaBox.right - 1)),
    top: Math.max(textareaBox.top + borderTop, Math.min(markerBox.top, textareaBox.bottom - borderBottom - lineHeight)),
    height: lineHeight,
    width: textareaBox.width
  };
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function compressImage(dataURL: string, mediaType: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= COMPRESS_MAX_EDGE && height <= COMPRESS_MAX_EDGE) { resolve(null); return; }
      const scale = COMPRESS_MAX_EDGE / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0, width, height);
      try { resolve(canvas.toDataURL(mediaType === "image/png" ? "image/png" : "image/jpeg", 0.85)); } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = dataURL;
  });
}

async function ingestPastedImage(
  file: File,
  addContext: (ctx: ContextReference) => void,
  onError: (message: string) => void
): Promise<void> {
  if (file.size > MAX_IMAGE_BYTES) {
    onError(m.ai.composer.imageTooLarge((file.size / 1024 / 1024).toFixed(1)));
    return;
  }
  const mediaType = file.type || "image/png";
  try {
    let dataURL = await readAsDataURL(file);
    if (file.size > COMPRESS_THRESHOLD) {
      const compressed = await compressImage(dataURL, mediaType);
      if (compressed) dataURL = compressed;
    }
    const ext = mediaType === "image/jpeg" ? "jpg" : mediaType.split("/")[1] || "png";
    addContext({
      id: `image:${crypto.randomUUID()}`,
      kind: "image",
      label: `pasted-image.${ext}`,
      content: dataURL,
      mediaType,
      byteSize: file.size
    });
  } catch {
    onError(m.ai.composer.imageReadFailed);
  }
}

export type ChatDraftSubmitInput = {
  prompt: string;
  providerId: string;
  permissionProfile: PermissionProfile;
  interactionMode: InteractionMode;
  contexts: ContextReference[];
};

export type ChatDraftSubmitHandler = (input: ChatDraftSubmitInput) => Promise<void>;

export function ChatComposer({ onDraftSubmit }: { onDraftSubmit?: ChatDraftSubmitHandler } = {}) {
  // Slices instead of the full controller: the composer must not re-render on
  // every streamed event flush, only on the snapshot/UI/actions values it renders.
  const { snapshot, activeSession, sessionActiveRun, queuedRuns, pendingContexts, skills } = useAiSnapshot();
  const ui = useAiUi();
  const actions = useAiActions();
  const { draft, setDraft } = useAiDraft();
  const availableProviders = snapshot.providers.filter((provider) => provider.available);
  const projectName = snapshot.projectRoot.split(/[\\/]/).filter(Boolean).at(-1) || snapshot.projectRoot;
  const [providerId, setProviderId] = useState(availableProviders[0]?.id || "");
  // 设置页"设为默认"的 agent provider：新会话的默认选中项，与设置页展示一致。
  const [preferredProviderId, setPreferredProviderId] = useState("");
  const userChoseProviderRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    window.openmind.getPreferences?.().then((preferences) => {
      if (!cancelled) setPreferredProviderId(preferences.defaultProvider || "");
    }).catch(() => { /* 读不到偏好时回退到第一个可用 provider。 */ });
    return () => { cancelled = true; };
  }, []);
  const [permissionProfile, setPermissionProfile] = useState<PermissionProfile>("auto");
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("default");
  const [trigger, setTrigger] = useState<ComposerTrigger | null>(null);
  const [fileResults, setFileResults] = useState<ProjectFileMatch[]>([]);
  const [fileSearchMeta, setFileSearchMeta] = useState({ indexedCount: 0, truncated: false });
  const [fileLoading, setFileLoading] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [customSending, setCustomSending] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLElement>(null);
  const suggestionAnchorRef = useRef<HTMLSpanElement>(null);
  const suggestionMenuRef = useRef<HTMLDivElement>(null);
  const [suggestionAnchor, setSuggestionAnchor] = useState<ComposerCaretAnchor>({ left: 0, top: 0, height: 20, width: 0 });
  const searchRequest = useRef(0);
  const menuSnapRef = useRef(false);
  const menuStashRef = useRef<ReactNode>(null);
  const visibleActiveRun = sessionActiveRun;
  const draftSkillInvocation = parseSkillSlashInvocation(draft, skills);
  const errorMessage = localError || ui.error || null;
  const { visible: errorVisible, leaving: errorLeaving } = useExitPresence(Boolean(errorMessage), 160);
  const [stashedError, setStashedError] = useState(errorMessage);
  useEffect(() => { if (errorMessage) setStashedError(errorMessage); }, [errorMessage]);

  useEffect(() => {
    if (activeSession?.providerId) {
      setProviderId(activeSession.providerId);
      return;
    }
    // 会话没带 provider（或草稿态）时：优先设置页默认 provider，用户手动
    // 选过之后（userChoseProviderRef）不再覆盖其选择。
    if (userChoseProviderRef.current) return;
    const fallback = availableProviders.find((provider) => provider.id === preferredProviderId) || availableProviders[0];
    if (fallback) setProviderId(fallback.id);
  }, [activeSession?.providerId, availableProviders, preferredProviderId]);
  useEffect(() => {
    // 无活动会话（草稿态）时重置回默认档位，不残留上一个会话的选择。
    setPermissionProfile(activeSession?.permissionProfile ?? "auto");
  }, [activeSession?.permissionProfile]);
  useEffect(() => {
    setInteractionMode(activeSession?.interactionMode || "default");
  }, [activeSession?.interactionMode]);
  useEffect(() => {
    setTrigger(null);
    setLocalError(null);
  }, [activeSession?.id]);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(230, el.scrollHeight)}px`;
  }, [draft]);
  useEffect(() => {
    if (!ui.composerFocusRequest) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [ui.composerFocusRequest]);
  useEffect(() => {
    if (trigger?.kind !== "mention" || !trigger.query) {
      setFileResults([]);
      setFileSearchMeta({ indexedCount: 0, truncated: false });
      setFileLoading(false);
      return;
    }
    const requestId = ++searchRequest.current;
    setFileLoading(true);
    const timer = window.setTimeout(() => {
      void window.openmind.searchOpenmindFiles(trigger.query, 50).then((result) => {
        if (searchRequest.current !== requestId) return;
        setFileResults(result.items);
        setFileSearchMeta({ indexedCount: result.indexedCount, truncated: result.truncated });
      }).catch((cause) => {
        if (searchRequest.current !== requestId) return;
        setFileResults([]);
        setLocalError(cause instanceof Error ? cause.message : String(cause));
      }).finally(() => {
        if (searchRequest.current === requestId) setFileLoading(false);
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [trigger?.kind, trigger?.query]);
  useEffect(() => {
    if (!trigger) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!composerRef.current?.contains(target) && !suggestionMenuRef.current?.contains(target)) setTrigger(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [trigger]);

  const skillResults = useMemo(() => {
    if (trigger?.kind !== "command") return [];
    if (!trigger.query) return [...skills];
    return skills
      .map((skill) => ({ skill, score: skillMatchScore(skill, trigger.query) }))
      .filter((candidate) => candidate.score >= 0)
      .sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id))
      .map((candidate) => candidate.skill);
  }, [skills, trigger]);
  const suggestionCount = trigger?.kind === "mention" ? fileResults.length : trigger?.kind === "command" ? skillResults.length : 0;
  useEffect(() => {
    setActiveSuggestion(0);
  }, [trigger?.kind, trigger?.query]);
  useEffect(() => {
    if (suggestionCount && activeSuggestion >= suggestionCount) setActiveSuggestion(suggestionCount - 1);
  }, [activeSuggestion, suggestionCount]);

  const submit = async () => {
    if (!draft.trim() || ui.isSending || customSending) return;
    const skillInvocation = parseSkillSlashInvocation(draft, skills);
    const validationError = skillInvocation ? null : slashCommandValidationError(draft, pendingContexts);
    if (validationError) {
      setLocalError(validationError);
      return;
    }
    setTrigger(null);
    setLocalError(null);
    try {
      if (onDraftSubmit) {
        setCustomSending(true);
        await onDraftSubmit({
          prompt: draft,
          providerId,
          permissionProfile,
          interactionMode,
          contexts: pendingContexts
        });
      } else {
        await actions.send(draft, { providerId, permissionProfile, interactionMode });
      }
    } catch (cause) {
      if (onDraftSubmit) setLocalError(cause instanceof Error ? cause.message : String(cause));
      // The controller keeps the draft and exposes the actionable error.
    } finally {
      setCustomSending(false);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    let hasImage = false;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        hasImage = true;
        const file = item.getAsFile();
        if (file) void ingestPastedImage(file, actions.addContext, setLocalError);
      }
    }
    if (hasImage) event.preventDefault();
  };

  const updateTrigger = (value: string, caret: number | null) => {
    const next = findComposerTrigger(value, caret ?? value.length);
    setTrigger(next);
    if (next) setLocalError(null);
  };

  const applyDraftAtCaret = (next: { value: string; caret: number }) => {
    setDraft(next.value);
    setTrigger(null);
    setLocalError(null);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const chooseFile = (file: ProjectFileMatch) => {
    if (!trigger || trigger.kind !== "mention") return;
    menuSnapRef.current = true; // snap-close on selection (no exit animation that would linger on the chosen item)
    actions.addContext({
      id: `file:${file.path}`,
      kind: "file",
      label: file.name,
      path: file.path
    });
    applyDraftAtCaret(removeMentionTrigger(draft, trigger));
  };

  const chooseSkill = (skill: SkillDefinition) => {
    if (!trigger || trigger.kind !== "command") return;
    menuSnapRef.current = true;
    applyDraftAtCaret(replaceComposerTrigger(draft, trigger, `/${skill.id} `));
  };

  const browseFiles = async () => {
    const files = await window.openmind.selectOpenmindFiles();
    for (const file of files) {
      actions.addContext({
        id: `file:${file}`,
        kind: "file",
        label: file.split(/[\\/]/).at(-1) || file,
        path: file
      });
    }
    if (files.length && trigger?.kind === "mention") { menuSnapRef.current = true; applyDraftAtCaret(removeMentionTrigger(draft, trigger)); }
  };

  const chooseActiveSuggestion = () => {
    if (trigger?.kind === "mention") {
      const file = fileResults[activeSuggestion];
      if (file) chooseFile(file);
      return;
    }
    if (trigger?.kind === "command") {
      const skill = skillResults[activeSuggestion];
      if (skill) chooseSkill(skill);
    }
  };

  const menuOpen = trigger?.kind === "mention" || trigger?.kind === "command";
  const menuElement = trigger?.kind === "mention" ? (
    <ComposerSuggestionMenu kind="mention" query={trigger.query} files={fileResults} loading={fileLoading} activeIndex={activeSuggestion} indexedCount={fileSearchMeta.indexedCount} truncated={fileSearchMeta.truncated} onActiveIndex={setActiveSuggestion} onChooseFile={chooseFile} onBrowse={() => void browseFiles()} />
  ) : trigger?.kind === "command" ? (
    <ComposerSuggestionMenu kind="skill" query={trigger.query} skills={skillResults} activeIndex={activeSuggestion} onActiveIndex={setActiveSuggestion} onChooseSkill={chooseSkill} />
  ) : null;
  // Stash the menu while open so a dismiss (Escape / typing clears the trigger)
  // can fade out the last rendered content. Selection sets menuSnapRef to snap
  // the menu shut instantly instead of lingering on the just-chosen item.
  if (menuOpen) { menuSnapRef.current = false; menuStashRef.current = menuElement; }
  const { visible: menuVisible, leaving: menuLeaving } = useExitPresence(menuOpen, 140);
  const showMenu = menuVisible && !menuSnapRef.current;
  const suggestionPopover = useAnchoredPopover({
    open: showMenu,
    anchorRef: suggestionAnchorRef,
    floatingRef: suggestionMenuRef,
    preferredSide: "top",
    align: "start"
  });
  const updateSuggestionAnchor = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const next = measureTextareaCaret(textarea);
    setSuggestionAnchor((current) => current.left === next.left && current.top === next.top && current.height === next.height && current.width === next.width ? current : next);
  }, []);
  useLayoutEffect(() => {
    if (!showMenu) return;
    updateSuggestionAnchor();
    const frame = window.requestAnimationFrame(updateSuggestionAnchor);
    const textarea = textareaRef.current;
    const observer = typeof ResizeObserver === "undefined" || !textarea ? null : new ResizeObserver(updateSuggestionAnchor);
    if (textarea) {
      observer?.observe(textarea);
      textarea.addEventListener("scroll", updateSuggestionAnchor, { passive: true });
    }
    window.addEventListener("resize", updateSuggestionAnchor);
    window.visualViewport?.addEventListener("resize", updateSuggestionAnchor);
    window.visualViewport?.addEventListener("scroll", updateSuggestionAnchor);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      textarea?.removeEventListener("scroll", updateSuggestionAnchor);
      window.removeEventListener("resize", updateSuggestionAnchor);
      window.visualViewport?.removeEventListener("resize", updateSuggestionAnchor);
      window.visualViewport?.removeEventListener("scroll", updateSuggestionAnchor);
    };
  }, [draft, showMenu, trigger?.end, updateSuggestionAnchor]);
  useLayoutEffect(() => {
    if (showMenu) suggestionPopover.updatePosition();
  }, [showMenu, suggestionAnchor, suggestionPopover.updatePosition]);

  return (
    <footer className="composer" ref={composerRef}>
      <div className="composer-flow">
        {pendingContexts.length ? <ContextTray contexts={pendingContexts} /> : null}
        {errorVisible && stashedError ? (
          <div className="composer-error ui-overlay" data-leaving={errorLeaving || undefined} role="alert">
            <span>{stashedError}</span>
            <button data-motion="icon" aria-label={m.ai.composer.closeError} onClick={() => { setLocalError(null); ui.clearError(); }}><X size={13} /></button>
          </div>
        ) : null}
        {queuedRuns.length ? (
          <AnimatedDisclosure
            className="queue-tray"
            open={queueOpen}
            onOpenChange={setQueueOpen}
            summary={m.ai.composer.queuedSummary(queuedRuns.length)}
          >
            {queuedRuns.map((run, index) => <div key={run.id}><span>{index + 1}</span><p>{run.prompt}</p><button data-motion="icon" aria-label={m.ai.composer.cancelQueued} onClick={() => void actions.cancel(run.id)}><X size={12} /></button></div>)}
          </AnimatedDisclosure>
        ) : null}
        <div className="composer-editor">
          <textarea
            onPaste={handlePaste}
            ref={textareaRef}
            aria-label={m.ai.composer.messageInput}
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={Boolean(trigger)}
            aria-controls={trigger ? "composer-suggestions" : undefined}
            aria-activedescendant={trigger && suggestionCount ? `composer-suggestion-${activeSuggestion}` : undefined}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              updateTrigger(event.target.value, event.target.selectionStart);
            }}
            onSelect={(event) => updateTrigger(event.currentTarget.value, event.currentTarget.selectionStart)}
            onKeyDown={(event) => {
              if (trigger && event.key === "Escape") {
                event.preventDefault();
                setTrigger(null);
                return;
              }
              if (trigger && suggestionCount && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                if (event.key === "ArrowDown") setActiveSuggestion((value) => (value + 1) % suggestionCount);
                if (event.key === "ArrowUp") setActiveSuggestion((value) => (value - 1 + suggestionCount) % suggestionCount);
                if (event.key === "Home") setActiveSuggestion(0);
                if (event.key === "End") setActiveSuggestion(suggestionCount - 1);
                return;
              }
              if (trigger && suggestionCount && (event.key === "Tab" || (event.key === "Enter" && !event.nativeEvent.isComposing))) {
                event.preventDefault();
                chooseActiveSuggestion();
                return;
              }
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void submit(); return; }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={activeSession ? m.ai.composer.placeholderContinue(activeSession.title) : m.ai.composer.placeholderNew}
          />
          {/* P2-CMP-2: 空状态 prompt 提示 chip —— 空 draft 时显示快捷入口 */}
          {/* P2-CMP-3: textarea 到底渐变遮罩 —— 由 CSS 控制 */}
          {showMenu && menuStashRef.current ? (
            createPortal(
              <>
                {/* 锚点必须与弹层同级挂在 body 下：.ai-workbench 的动画残留 transform
                    会接管 position:fixed 的包含块，导致锚点测量坐标整体漂移。 */}
                <span
                  ref={suggestionAnchorRef}
                  className="composer-suggestion-caret-anchor"
                  aria-hidden="true"
                  style={{ left: suggestionAnchor.left, top: suggestionAnchor.top, height: suggestionAnchor.height } as CSSProperties}
                />
                <div
                  ref={suggestionMenuRef}
                  className="composer-suggestion-popover ui-overlay"
                  data-leaving={menuLeaving || undefined}
                  data-side={suggestionPopover.side}
                  style={{ ...suggestionPopover.style, width: suggestionAnchor.width } as CSSProperties}
                >
                  {menuStashRef.current}
                </div>
              </>,
              document.body
            )
          ) : null}
          <div className="composer-editor-actions">
            <button
              type="button"
              className="composer-add-context"
              onClick={() => void actions.addFiles()}
              aria-label={m.ai.composer.addAttachment}
              title={m.ai.composer.addAttachment}
            >
              <Plus size={20} />
            </button>
            <ChipSelect
              className="mode-select"
              icon={<ListChecks size={16} />}
              label={m.ai.mode.label}
              value={interactionMode}
              options={[
                { value: "default", label: m.ai.mode.default },
                { value: "plan", label: m.ai.mode.plan }
              ]}
              onChange={(value) => setInteractionMode(value as InteractionMode)}
            />
            <ChipSelect
              className="permission-select"
              icon={<ShieldCheck size={16} />}
              label={m.ai.permission.label}
              value={permissionProfile}
              options={[
                { value: "read-only", label: m.ai.permission.readOnly },
                { value: "edit", label: m.ai.permission.edit },
                { value: "auto", label: m.ai.permission.auto }
              ]}
              onChange={(value) => setPermissionProfile(value as PermissionProfile)}
            />
            {ui.projectComposeTarget && !activeSession ? (
              <span
                className="composer-workspace is-project-target"
                title={m.ai.composer.projectTargetHint(ui.projectComposeTarget.projectName)}
              >
                <FolderOpen size={16} />
                <span>{m.ai.chat.currentProject}</span>
                <strong>{ui.projectComposeTarget.projectName}</strong>
              </span>
            ) : (
              <button
                data-motion="icon"
                type="button"
                className="composer-workspace"
                aria-label={m.ai.composer.openWorkspace}
                title={snapshot.projectRoot}
                onClick={() => void window.openmind.openPath(".")}
              >
                <FolderOpen size={16} />
                <span>{m.ai.chat.currentProject}</span>
                <strong>{projectName}</strong>
                <ChevronDown size={13} aria-hidden />
              </button>
            )}
            <ChipSelect
              className="provider-select"
              label={m.ai.composer.provider}
              value={providerId}
              options={availableProviders.map((provider) => ({ value: provider.id, label: provider.label }))}
              onChange={(id) => { userChoseProviderRef.current = true; setProviderId(id); }}
            />
            {draft.length ? <span className="composer-counter" aria-live="polite">{m.ai.composer.charCount(draft.length)}</span> : null}
            <div className="composer-send-wrap">
              <button
                type="button"
                className={`composer-send${visibleActiveRun ? " danger" : ""}`}
                disabled={visibleActiveRun
                  ? visibleActiveRun.status === "applying"
                  : ui.isSending || customSending || !draft.trim() || (!draftSkillInvocation && !activeSession && !providerId)}
                aria-label={visibleActiveRun ? m.ai.composer.stop : m.ai.composer.send}
                title={visibleActiveRun ? m.ai.composer.stop : m.ai.composer.sendShortcut}
                onClick={() => visibleActiveRun ? void actions.cancel(visibleActiveRun.id) : void submit()}
              >
                {visibleActiveRun ? (
                  <span key="stop" className="composer-send-icon" aria-hidden="true"><Square size={16} /></span>
                ) : (
                  <ComposerSendIcon loading={ui.isSending || customSending} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

function ComposerSendIcon({ loading }: { loading: boolean }) {
  return (
    <span key={loading ? "loading" : "send"} className="composer-send-icon" aria-hidden="true">
      {loading ? <LoaderCircle className="spin" size={16} /> : <ArrowUp size={18} />}
    </span>
  );
}

export function ContextTray({ contexts }: { contexts: ContextReference[] }) {
  const actions = useAiActions();
  const [dragId, setDragId] = useState<string | null>(null);
  const [chipOverflow, setChipOverflow] = useState({ start: false, end: false });
  const [enlargedId, setEnlargedId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Horizontal slide track state: dragX is the live finger offset (px) while
  // swiping, dragging drops the CSS transition so the image tracks the finger,
  // then on release we snap (or advance past the threshold) with transition on.
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const chipsRef = useRef<HTMLDivElement>(null);

  const updateChipOverflow = useCallback(() => {
    const chips = chipsRef.current;
    if (!chips) return;
    const next = {
      start: chips.scrollLeft > 1,
      end: chips.scrollLeft + chips.clientWidth < chips.scrollWidth - 1
    };
    setChipOverflow((current) => current.start === next.start && current.end === next.end ? current : next);
  }, []);

  useEffect(() => {
    const chips = chipsRef.current;
    if (!chips) return;
    const frame = window.requestAnimationFrame(updateChipOverflow);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateChipOverflow);
    observer?.observe(chips);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [contexts, updateChipOverflow]);

  const images = contexts.filter((c) => c.kind === "image" && Boolean(c.content));
  const imagesRef = useRef(images);
  imagesRef.current = images;
  // Track the open image by ID, not index, so reordering or removing other
  // contexts can never shift which image is displayed.
  const safeIndex = enlargedId ? images.findIndex((c) => c.id === enlargedId) : -1;
  const isOpen = safeIndex >= 0;
  const hasMultiple = images.length > 1;

  const stepImage = useCallback((dir: number) => setEnlargedId((id) => {
    const imgs = imagesRef.current;
    if (!id) return id;
    const i = imgs.findIndex((c) => c.id === id);
    if (i < 0) return id;
    return imgs[(i + dir + imgs.length) % imgs.length].id;
  }), []);

  const openAt = useCallback((id: string) => {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    setLeaving(false);
    setDragX(0);
    setDragging(false);
    setEnlargedId(id);
  }, []);

  const close = useCallback(() => {
    if (!isOpen || closeTimer.current) return;
    if (prefersReducedMotion()) { setEnlargedId(null); return; }
    setLeaving(true);
    closeTimer.current = window.setTimeout(() => {
      setEnlargedId(null);
      setLeaving(false);
      closeTimer.current = null;
    }, LIGHTBOX_EXIT_MS);
  }, [isOpen]);

  // Keyboard (Esc / arrows / Tab trap) + focus capture while open; restore focus on unmount.
  useEffect(() => {
    if (!isOpen) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const raf = window.requestAnimationFrame(() => closeBtnRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key === "ArrowLeft" && hasMultiple) { stepImage(-1); return; }
      if (event.key === "ArrowRight" && hasMultiple) { stepImage(1); return; }
      if (event.key !== "Tab") return;
      const focusables = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables.at(-1) || first;
      const active = document.activeElement;
      if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      previousFocus.current?.focus?.();
      previousFocus.current = null;
    };
  }, [isOpen, hasMultiple, close, stepImage]);

  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }, []);

  return (
    <div className="context-tray" role="group" aria-label={m.ai.context.count(contexts.length)}>
      <span className="context-tray-count" aria-live="polite">{m.ai.context.count(contexts.length)}</span>
      <div
        ref={chipsRef}
        className="context-chips"
        data-count={contexts.length || undefined}
        data-overflow-start={chipOverflow.start || undefined}
        data-overflow-end={chipOverflow.end || undefined}
        onScroll={updateChipOverflow}
      >
        {contexts.map((context, index) =>
          context.kind === "image" ? (
            <div className="context-chip image-chip" key={context.id} title={context.label}>
              <button aria-label={context.label} data-motion="icon" className="image-chip-button" onClick={() => openAt(context.id)}><img src={context.content} alt={context.label} /></button>
              <button aria-label={m.ai.context.remove} title={m.ai.context.remove} className="image-chip-remove" onClick={() => actions.removeContext(context.id)}><X size={11} /></button>
            </div>
          ) : (
            <ContextReferenceChip
              key={context.id}
              context={context}
              index={index}
              total={contexts.length}
              dragging={dragId === context.id}
              onDragStart={() => setDragId(context.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragId && dragId !== context.id) actions.reorderContexts(dragId, context.id);
                setDragId(null);
              }}
              onDragEnd={() => setDragId(null)}
            />
          )
        )}
      </div>
      <button
        type="button"
        className="context-tray-clear"
        data-motion="icon"
        aria-label={`${m.ai.context.clear} ${m.ai.context.count(contexts.length)}`}
        onClick={actions.clearContexts}
      >
        <Trash2 size={12} />
        {m.ai.context.clear}
      </button>
      {isOpen ? (
        <div
          ref={dialogRef}
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={m.ai.composer.imagePreview}
          data-leaving={leaving || undefined}
          data-dragging={dragging || undefined}
          data-multiple={hasMultiple || undefined}
          onClick={close}
          onTouchStart={(event) => {
            touchStartX.current = event.changedTouches?.[0]?.clientX ?? null;
            if (hasMultiple && !prefersReducedMotion()) setDragging(true);
          }}
          onTouchMove={(event) => {
            if (touchStartX.current === null || !hasMultiple || prefersReducedMotion()) return;
            const dx = (event.changedTouches?.[0]?.clientX ?? touchStartX.current) - touchStartX.current;
            setDragX(dx);
          }}
          onTouchEnd={(event) => {
            const startX = touchStartX.current;
            touchStartX.current = null;
            setDragging(false);
            setDragX(0);
            if (startX === null || !hasMultiple) return;
            const endX = event.changedTouches?.[0]?.clientX ?? startX;
            const dx = endX - startX;
            if (Math.abs(dx) > 40) stepImage(dx > 0 ? -1 : 1);
          }}
        >
          <div className="lightbox-track">
            {images.map((im, i) => (
              <div
                key={im.id}
                className="lightbox-slide"
                style={{ transform: `translateX(calc(${(i - safeIndex) * 100}% + ${dragX}px))` }}
              >
                <img
                  className="lightbox-image"
                  src={im.content}
                  alt={im.label}
                  draggable={false}
                  onClick={(event) => event.stopPropagation()}
                />
              </div>
            ))}
          </div>
          <button
            data-motion="icon"
            ref={closeBtnRef}
            className="lightbox-close-btn"
            aria-label={m.ai.composer.closePreview}
            onClick={(event) => { event.stopPropagation(); close(); }}
          >
            <X size={18} />
          </button>
          {hasMultiple ? (
            <>
              <button
                data-motion="icon"
                className="lightbox-nav-btn prev"
                aria-label={m.ai.composer.previousImage}
                onClick={(event) => { event.stopPropagation(); stepImage(-1); }}
              >
                <ChevronLeft size={22} />
              </button>
              <button
                data-motion="icon"
                className="lightbox-nav-btn next"
                aria-label={m.ai.composer.nextImage}
                onClick={(event) => { event.stopPropagation(); stepImage(1); }}
              >
                <ChevronRight size={22} />
              </button>
              <div className="lightbox-counter">
                {safeIndex + 1} / {images.length}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ContextReferenceChip({
  context,
  index,
  total,
  dragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: {
  context: ContextReference;
  index: number;
  total: number;
  dragging: boolean;
  onDragStart(): void;
  onDragOver(event: DragEvent<HTMLDivElement>): void;
  onDrop(): void;
  onDragEnd(): void;
}) {
  const actions = useAiActions();
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const presence = useExitPresence(open, 140);
  const popover = useAnchoredPopover({
    open: presence.visible,
    anchorRef: triggerRef,
    floatingRef: detailRef,
    preferredSide: "top"
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || detailRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      className="context-chip-drag"
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <div className={`context-chip${dragging ? " dragging" : ""}`} data-open={open || undefined}>
        <button
          ref={triggerRef}
          type="button"
          className="ui-disclosure-trigger"
          aria-label={context.path || context.label}
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((current) => !current)}
        >
          {context.kind === "file" ? <FilePlus2 size={12} /> : <Quote size={12} />}
          <span title={context.path || context.label}>{context.label}</span>
        </button>
        {presence.visible ? createPortal(
          <div
            ref={detailRef}
            id={detailId}
            className="context-chip-popover"
            role="dialog"
            aria-label={m.ai.context.detail(context.label)}
            data-leaving={presence.leaving || undefined}
            data-side={popover.side}
            style={popover.style}
          >
            <div className="context-chip-detail">
              <strong>{context.kind === "selection" ? m.ai.context.selection : context.kind}</strong>
              <span>{context.path || m.ai.context.inline}{context.content ? m.ai.context.chars(context.content.length) : ""}</span>
              {context.kind === "selection" && context.content ? <blockquote className="context-selection-preview">{context.content}</blockquote> : null}
              <footer>
                <button data-motion="icon" disabled={index === 0} onClick={() => actions.moveContext(context.id, -1)}>{m.ai.context.moveUp}</button>
                <button data-motion="icon" disabled={index === total - 1} onClick={() => actions.moveContext(context.id, 1)}>{m.ai.context.moveDown}</button>
              </footer>
            </div>
          </div>,
          document.body
        ) : null}
      </div>
      <button
        type="button"
        className="context-chip-remove"
        data-motion="icon"
        aria-label={m.ai.context.removeNamed(context.label)}
        title={m.ai.context.removeThis}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          actions.removeContext(context.id);
        }}
      >
        <X size={12} aria-hidden />
      </button>
    </div>
  );
}

/**
 * P0-CMP-3: 自定义 select —— 胶囊 chip + 下拉,替代浏览器原生 <select>。
 * 点击 chip 展开 listbox,选中后收起;点外面/Esc 关闭。
 */
function ChipSelect({ className = "", icon, label, value, options, onChange }: {
  className?: string;
  icon?: ReactNode;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const menuPresence = useExitPresence(open, 160);
  const popover = useAnchoredPopover({
    open: menuPresence.visible,
    anchorRef: triggerRef,
    floatingRef: menuRef,
    preferredSide: "top",
    align: "end"
  });
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? [])
        .find((item) => item.dataset.value === value)
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, value]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? []);
    if (!items.length || !["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Tab") {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? current < 0 || current === items.length - 1 ? 0 : current + 1
          : current <= 0 ? items.length - 1 : current - 1;
    items[next]?.focus();
  };

  return (
    <div className={`chip-select ${className}`.trim()} ref={ref} data-open={open || undefined} data-value={value}>
      <button
        ref={triggerRef}
        type="button"
        className="chip-select-trigger"
        aria-label={`${label}：${selected?.label || value}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${label}：${selected?.label || value}`}
        data-motion="selection"
        onClick={() => setOpen((current) => !current)}
      >
        {icon ? <span className="chip-select-icon" aria-hidden>{icon}</span> : null}
        <span className="chip-select-label">{label}</span>
        <span className="chip-select-value">{selected?.label || value}</span>
        <ChevronDown size={12} className="chip-select-chevron" />
      </button>
      {menuPresence.visible && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          className="chip-select-menu"
          role="listbox"
          aria-label={label}
          data-side={popover.side}
          data-leaving={menuPresence.leaving || undefined}
          style={popover.style}
          onKeyDown={onMenuKeyDown}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`chip-select-option${option.value === value ? " active" : ""}`}
              data-value={option.value}
              data-motion="selection"
              onClick={() => { onChange(option.value); setOpen(false); triggerRef.current?.focus(); }}
            >
              {option.label}
            </button>
          ))}
        </div>,
        document.body
      ) : null}
    </div>
  );
}

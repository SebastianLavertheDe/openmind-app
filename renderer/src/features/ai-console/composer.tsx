import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { ArrowUp, ChevronDown, ChevronLeft, ChevronRight, FilePlus2, FolderOpen, ListChecks, LoaderCircle, Plus, Quote, ShieldCheck, Sparkles, Square, Trash2, X } from "lucide-react";
import type { ContextReference, InteractionMode, PermissionProfile, ProjectFileMatch, SkillDefinition } from "@shared/contracts";
import { slashCommandValidationError } from "@shared/slash-commands";
import { messages as m } from "@shared/messages";
import { useAi } from "../../ai-context";
import { AnimatedDisclosure } from "../../design-system/animated-disclosure";
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
    onError(`图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），上限 2MB。`);
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
    onError("图片读取失败。");
  }
}

export function ChatComposer() {
  const ai = useAi();
  const availableProviders = ai.snapshot.providers.filter((provider) => provider.available);
  const projectName = ai.snapshot.projectRoot.split(/[\\/]/).filter(Boolean).at(-1) || ai.snapshot.projectRoot;
  const [providerId, setProviderId] = useState(availableProviders[0]?.id || "");
  const [permissionProfile, setPermissionProfile] = useState<PermissionProfile>("edit");
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("default");
  const [trigger, setTrigger] = useState<ComposerTrigger | null>(null);
  const [fileResults, setFileResults] = useState<ProjectFileMatch[]>([]);
  const [fileSearchMeta, setFileSearchMeta] = useState({ indexedCount: 0, truncated: false });
  const [fileLoading, setFileLoading] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLElement>(null);
  const searchRequest = useRef(0);
  const menuSnapRef = useRef(false);
  const menuStashRef = useRef<ReactNode>(null);
  const visibleActiveRun = ai.sessionActiveRun;
  const draftSkillInvocation = parseSkillSlashInvocation(ai.draft, ai.skills);
  const errorMessage = localError || ai.error || null;
  const { visible: errorVisible, leaving: errorLeaving } = useExitPresence(Boolean(errorMessage), 160);
  const [stashedError, setStashedError] = useState(errorMessage);
  useEffect(() => { if (errorMessage) setStashedError(errorMessage); }, [errorMessage]);

  useEffect(() => {
    if (ai.activeSession?.providerId) setProviderId(ai.activeSession.providerId);
    else if (!providerId && availableProviders[0]) setProviderId(availableProviders[0].id);
  }, [ai.activeSession?.providerId, availableProviders, providerId]);
  useEffect(() => {
    if (ai.activeSession?.permissionProfile) setPermissionProfile(ai.activeSession.permissionProfile);
  }, [ai.activeSession?.permissionProfile]);
  useEffect(() => {
    setInteractionMode(ai.activeSession?.interactionMode || "default");
  }, [ai.activeSession?.interactionMode]);
  useEffect(() => {
    setTrigger(null);
    setLocalError(null);
  }, [ai.activeSession?.id]);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(230, el.scrollHeight)}px`;
  }, [ai.draft]);
  useEffect(() => {
    if (!ai.composerFocusRequest) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [ai.composerFocusRequest]);
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
      if (!composerRef.current?.contains(event.target as Node)) setTrigger(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [trigger]);

  const skillResults = useMemo(() => {
    if (trigger?.kind !== "command") return [];
    if (!trigger.query) return [...ai.skills];
    return ai.skills
      .map((skill) => ({ skill, score: skillMatchScore(skill, trigger.query) }))
      .filter((candidate) => candidate.score >= 0)
      .sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id))
      .map((candidate) => candidate.skill);
  }, [ai.skills, trigger]);
  const suggestionCount = trigger?.kind === "mention" ? fileResults.length : trigger?.kind === "command" ? skillResults.length : 0;
  useEffect(() => {
    setActiveSuggestion(0);
  }, [trigger?.kind, trigger?.query]);
  useEffect(() => {
    if (suggestionCount && activeSuggestion >= suggestionCount) setActiveSuggestion(suggestionCount - 1);
  }, [activeSuggestion, suggestionCount]);

  const submit = async () => {
    if (!ai.draft.trim() || ai.isSending) return;
    const skillInvocation = parseSkillSlashInvocation(ai.draft, ai.skills);
    const validationError = skillInvocation ? null : slashCommandValidationError(ai.draft, ai.pendingContexts);
    if (validationError) {
      setLocalError(validationError);
      return;
    }
    setTrigger(null);
    setLocalError(null);
    try {
      await ai.send(ai.draft, { providerId, permissionProfile, interactionMode });
    } catch {
      // The controller keeps the draft and exposes the actionable error.
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
        if (file) void ingestPastedImage(file, ai.addContext, setLocalError);
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
    ai.setDraft(next.value);
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
    ai.addContext({
      id: `file:${file.path}`,
      kind: "file",
      label: file.name,
      path: file.path
    });
    applyDraftAtCaret(removeMentionTrigger(ai.draft, trigger));
  };

  const chooseSkill = (skill: SkillDefinition) => {
    if (!trigger || trigger.kind !== "command") return;
    menuSnapRef.current = true;
    applyDraftAtCaret(replaceComposerTrigger(ai.draft, trigger, `/${skill.id} `));
  };

  const browseFiles = async () => {
    const files = await window.openmind.selectOpenmindFiles();
    for (const file of files) {
      ai.addContext({
        id: `file:${file}`,
        kind: "file",
        label: file.split(/[\\/]/).at(-1) || file,
        path: file
      });
    }
    if (files.length && trigger?.kind === "mention") { menuSnapRef.current = true; applyDraftAtCaret(removeMentionTrigger(ai.draft, trigger)); }
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

  return (
    <footer className="composer" ref={composerRef}>
      <div className="composer-flow">
        {ai.pendingContexts.length ? <ContextTray contexts={ai.pendingContexts} /> : null}
        {errorVisible && stashedError ? (
          <div className="composer-error ui-overlay" data-leaving={errorLeaving || undefined} role="alert">
            <span>{stashedError}</span>
            <button data-motion="icon" aria-label={m.ai.composer.closeError} onClick={() => { setLocalError(null); ai.clearError(); }}><X size={13} /></button>
          </div>
        ) : null}
        {ai.queuedRuns.length ? (
          <AnimatedDisclosure
            className="queue-tray"
            open={queueOpen}
            onOpenChange={setQueueOpen}
            summary={m.ai.composer.queuedSummary(ai.queuedRuns.length)}
          >
            {ai.queuedRuns.map((run, index) => <div key={run.id}><span>{index + 1}</span><p>{run.prompt}</p><button data-motion="icon" aria-label={m.ai.composer.cancelQueued} onClick={() => void ai.cancel(run.id)}><X size={12} /></button></div>)}
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
            value={ai.draft}
            onChange={(event) => {
              ai.setDraft(event.target.value);
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
            placeholder={ai.activeSession ? m.ai.composer.placeholderContinue(ai.activeSession.title) : m.ai.composer.placeholderNew}
          />
          {/* P2-CMP-2: 空状态 prompt 提示 chip —— 空 draft 时显示快捷入口 */}
          {/* P2-CMP-3: textarea 到底渐变遮罩 —— 由 CSS 控制 */}
          {showMenu && menuStashRef.current ? (
            <div className="ui-overlay" data-leaving={menuLeaving || undefined}>
              {menuStashRef.current}
            </div>
          ) : null}
          <div className="composer-editor-actions">
            <button
              type="button"
              className="composer-add-context"
              onClick={() => void ai.addFiles()}
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
            <button
              data-motion="icon"
              type="button"
              className="composer-workspace"
              aria-label={m.ai.composer.openWorkspace}
              title={ai.snapshot.projectRoot}
              onClick={() => void window.openmind.openPath(".")}
            >
              <FolderOpen size={16} />
              <span>{m.ai.chat.currentProject}</span>
              <strong>{projectName}</strong>
              <ChevronDown size={13} aria-hidden />
            </button>
            <ChipSelect
              className="provider-select"
              icon={<Sparkles size={15} />}
              label={m.ai.composer.provider}
              value={providerId}
              options={availableProviders.map((provider) => ({ value: provider.id, label: provider.label }))}
              onChange={setProviderId}
            />
            {ai.draft.length ? <span className="composer-counter" aria-live="polite">{m.ai.composer.charCount(ai.draft.length)}</span> : null}
            <div className="composer-send-wrap">
              <button
                type="button"
                className={`composer-send${visibleActiveRun ? " danger" : ""}`}
                disabled={visibleActiveRun
                  ? visibleActiveRun.status === "applying"
                  : ai.isSending || !ai.draft.trim() || (!draftSkillInvocation && !ai.activeSession && !providerId)}
                aria-label={visibleActiveRun ? m.ai.composer.stop : m.ai.composer.send}
                title={visibleActiveRun ? m.ai.composer.stop : m.ai.composer.sendShortcut}
                onClick={() => visibleActiveRun ? void ai.cancel(visibleActiveRun.id) : void submit()}
              >
                {visibleActiveRun ? (
                  <span key="stop" className="composer-send-icon" aria-hidden="true"><Square size={16} /></span>
                ) : (
                  <ComposerSendIcon loading={ai.isSending} />
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
  const ai = useAi();
  const [dragId, setDragId] = useState<string | null>(null);
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
      <div className="context-chips" data-count={contexts.length || undefined}>
        {contexts.map((context, index) =>
          context.kind === "image" ? (
            <div className="context-chip image-chip" key={context.id} title={context.label}>
              <button aria-label={context.label} data-motion="icon" className="image-chip-button" onClick={() => openAt(context.id)}><img src={context.content} alt={context.label} /></button>
              <button aria-label={m.ai.context.remove} title={m.ai.context.remove} className="image-chip-remove" onClick={() => ai.removeContext(context.id)}><X size={11} /></button>
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
                if (dragId && dragId !== context.id) ai.reorderContexts(dragId, context.id);
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
        onClick={ai.clearContexts}
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
          aria-label="图片预览"
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
            aria-label="关闭预览"
            onClick={(event) => { event.stopPropagation(); close(); }}
          >
            <X size={18} />
          </button>
          {hasMultiple ? (
            <>
              <button
                data-motion="icon"
                className="lightbox-nav-btn prev"
                aria-label="上一张"
                onClick={(event) => { event.stopPropagation(); stepImage(-1); }}
              >
                <ChevronLeft size={22} />
              </button>
              <button
                data-motion="icon"
                className="lightbox-nav-btn next"
                aria-label="下一张"
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
  const ai = useAi();
  const [open, setOpen] = useState(false);
  return (
    <div
      className="context-chip-drag"
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <AnimatedDisclosure
        className={`context-chip${dragging ? " dragging" : ""}`}
        open={open}
        onOpenChange={setOpen}
        triggerAriaLabel={context.path || context.label}
        summary={<>{context.kind === "file" ? <FilePlus2 size={12} /> : <Quote size={12} />}<span title={context.path || context.label}>{context.label}</span></>}
      >
        <div>
          <strong>{context.kind === "selection" ? "引用内容" : context.kind}</strong>
          <span>{context.path || m.ai.context.inline}{context.content ? m.ai.context.chars(context.content.length) : ""}</span>
          {context.kind === "selection" && context.content ? <blockquote className="context-selection-preview">{context.content}</blockquote> : null}
          <footer>
            <button data-motion="icon" disabled={index === 0} onClick={() => ai.moveContext(context.id, -1)}>{m.ai.context.moveUp}</button>
            <button data-motion="icon" disabled={index === total - 1} onClick={() => ai.moveContext(context.id, 1)}>{m.ai.context.moveDown}</button>
          </footer>
        </div>
      </AnimatedDisclosure>
      <button
        type="button"
        className="context-chip-remove"
        data-motion="icon"
        aria-label={`删除引用：${context.label}`}
        title="删除此引用"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          ai.removeContext(context.id);
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
  const selected = options.find((option) => option.value === value);
  const menuPresence = useExitPresence(open, 160);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);
  return (
    <div className={`chip-select ${className}`.trim()} ref={ref} data-open={open || undefined} data-value={value}>
      <button
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
      {menuPresence.visible ? (
        <div className="chip-select-menu" role="listbox" data-leaving={menuPresence.leaving || undefined}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`chip-select-option${option.value === value ? " active" : ""}`}
              data-value={option.value}
              data-motion="selection"
              onClick={() => { onChange(option.value); setOpen(false); }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

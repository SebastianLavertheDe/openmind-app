import { useLocale } from "../../i18n";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { History } from "lucide-react";
import type { AiSession } from "@shared/contracts";
import { workspaceSessions } from "@shared/ai-session-scope";
import { messages as m } from "@shared/messages";
import { AUTO_MODEL, effectiveModelInfo } from "@shared/model-catalog";
import { sessionStatusLabel } from "../../ai-utils";
import { useAiActions, useAiSnapshot } from "../../ai-context";
import { ResponsiveContextBadge, VirtualList } from "../../design-system/components";
import { useResponsiveLayout } from "../../app/responsive-layout";
import { useAnchoredPopover } from "../../design-system/use-anchored-popover";
import { useExitPresence } from "../../design-system/use-exit-presence";
import { Chat, type ChatDraftSubmitHandler } from "./Chat";
import { AiFilePreviewPane } from "./AiFilePreviewPane";
import type { ConversationSurface } from "./workspace-preview-source";

export type { ConversationSurface } from "./workspace-preview-source";

export function AiWorkbench({
  restoredPreviewPath = null,
  onPreviewPathChange,
  surface = { kind: "workspace" },
  onDraftSubmit
}: {
  restoredPreviewPath?: string | null;
  onPreviewPathChange?: (path: string | null) => void;
  surface?: ConversationSurface;
  /** Lets a Project reuse the complete AI conversation UI while preserving
   * its own task creation and persistence boundary. */
  onDraftSubmit?: ChatDraftSubmitHandler;
} = {}) {
  const locale = useLocale();
  const { snapshot, activeSession } = useAiSnapshot();
  const responsiveLayout = useResponsiveLayout();
  const projectMode = surface.kind === "project-task";
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

  // 头部只展示当前会话所绑定运行时的 CLI 配置模型，不再应用应用内模型覆盖。
  const modelInfo = useMemo(() => {
    const session = activeSession;
    if (!session) return null;
    const caps = snapshot.providers.find((item) => item.id === session.providerId) ?? null;
    return effectiveModelInfo(session.provider, AUTO_MODEL, caps);
  }, [activeSession, snapshot.providers, locale]);

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
  }, [historyOpen, responsiveLayout.shell]);

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

  return (
    <>
      <AiFilePreviewPane
        surface={surface}
        restoredPreviewPath={restoredPreviewPath}
        onPreviewPathChange={onPreviewPathChange}
      >
        <header className={`conversation-header${activeSession ? "" : " is-draft"}`}>
          {activeSession ? (
            <div>
              <span className="provider-segmented">
                <span className={`provider-dot ${activeSession.provider === "claude" ? "claude" : "codex"}`} aria-hidden="true" />
                <span className="provider-name">{activeSession.provider === "claude" ? "Claude Code" : "Codex"}</span>
                {modelInfo ? <span className="provider-model" title={modelInfo.label}>{modelInfo.label}{modelInfo.oneMillion ? " · 1M" : ""}</span> : null}
                <span className="provider-sep" aria-hidden="true">·</span>
                <span className="provider-perm">{activeSession.permissionProfile}</span>
                {activeSession.interactionMode === "plan" ? <span className="provider-mode">{m.ai.mode.planActive}</span> : null}
              </span>
              <h2>{activeSession.title}</h2>
              <small title={displaySessionPath(activeSession, snapshot.projectRoot)}>{responsiveLayout.actions === "full" ? displaySessionPath(activeSession, snapshot.projectRoot) : compactPath(displaySessionPath(activeSession, snapshot.projectRoot))}</small>
            </div>
          ) : null}
          <div className="conversation-header-actions">
            {/* 仅运行、待批准或失败时显示状态徽标；idle 不渲染，与侧边栏状态点保持一致 */}
            {activeSession && activeSession.status !== "idle" ? (
              <ResponsiveContextBadge
                presentation={responsiveLayout.actions}
                priority="essential"
                label={sessionStatusLabel(activeSession.status)}
                tone={sessionStatusTone(activeSession.status)}
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
      </AiFilePreviewPane>
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
    </>
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

function compactPath(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) || value;
}

function displaySessionPath(session: AiSession, fallbackRoot: string): string {
  return session.cwd === "." ? session.projectRoot || fallbackRoot : session.cwd;
}

export function AiSessionNavigation() {
  const locale = useLocale();
  const { snapshot, activeSession } = useAiSnapshot();
  const actions = useAiActions();
  const sessions = useMemo(() => workspaceSessions(snapshot.sessions, true)
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return right.createdAt.localeCompare(left.createdAt);
    }), [snapshot.sessions, locale]);

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
  useLocale();
  const { snapshot, activeSession } = useAiSnapshot();
  const actions = useAiActions();
  const active = activeSession?.id === session.id;
  const waitingApproval = session.status === "waiting-approval" || snapshot.pendingApprovals.some((approval) => approval.sessionId === session.id);
  const dot = waitingApproval ? "waiting-approval" : session.status === "running" ? "running" : session.status === "failed" ? "failed" : "";
  return (
    <article
      className={`nav-recent-item ${active ? "active" : ""}`}
      role="option"
      aria-selected={active}
      tabIndex={0}
      onClick={() => void actions.setActiveSession(session.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void actions.setActiveSession(session.id);
        }
      }}
    >
      <span className={`nav-recent-dot${dot ? ` ${dot}` : ""}`} aria-hidden />
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

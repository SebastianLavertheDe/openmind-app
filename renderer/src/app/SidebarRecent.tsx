import { useFeedback } from "../feedback-context";
import { IconButton } from "../design-system/components";
import { useLocale } from "../i18n";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { Archive, ChevronDown, Pin, PinOff } from "lucide-react";
import type { AiSession } from "@shared/contracts";
import { isProjectTaskScope } from "@shared/ai-session-scope";
import { messages as m } from "@shared/messages";
import { useAiActions, useAiSnapshot, } from "../ai-context";
import { storageJson, writeStorage } from "../ai-utils";
import { AnimatedDisclosure } from "../design-system/animated-disclosure";
import { useMotionTokens } from "../design-system/motion-tokens";

/** 侧边栏「最近任务」区块：展示最近的 AI 会话，点击直接打开。
 * 数据源是 useAi().snapshot.sessions（现成、已在 bootstrap 注入），不新建接口。
 * 折叠态由父组件整块隐藏（侧边栏太窄无意义）；本组件内部只管展开/收起记忆。 */

const COLLAPSED_KEY = "openmind.nav.recentCollapsed.v2";

function relativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const delta = Date.now() - then;
  if (delta < 60000) return m.common.justNow;
  if (delta < 3600000) return m.common.minutesAgo(Math.floor(delta / 60000));
  if (delta < 86400000) return m.common.hoursAgo(Math.floor(delta / 3600000));
  return m.common.daysAgo(Math.floor(delta / 86400000));
}

function statusClass(status: AiSession["status"]): string {
  if (status === "waiting-approval") return "waiting-approval";
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  return "";
}

export function SidebarRecent({ activeSessionId, onOpen }: { activeSessionId: string | null; onOpen(session: AiSession): void }) {
  const locale = useLocale();
  const { snapshot } = useAiSnapshot();
  const actions = useAiActions();
  const feedback = useFeedback();
  const tokens = useMotionTokens();
  const [collapsed, setCollapsed] = useState(() => storageJson(COLLAPSED_KEY, false));
  const [busyId, setBusyId] = useState<string | null>(null);

  const recent = useMemo(() =>
    snapshot.sessions
      .filter((session) => !session.archived)
      .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || b.createdAt.localeCompare(a.createdAt)),
    [snapshot.sessions, locale]
  );
  const pendingSessionIds = useMemo(
    () => new Set(snapshot.pendingApprovals.map((approval) => approval.sessionId)),
    [snapshot.pendingApprovals, locale]
  );

  if (!recent.length) return null;

  const toggle = (next: boolean) => {
    setCollapsed(next);
    writeStorage(COLLAPSED_KEY, next);
  };

  const archiveSession = async (session: AiSession) => {
    if (busyId) return;
    setBusyId(session.id);
    try {
      const operation = actions.updateSession(session.id, { archived: true });
      if (activeSessionId === session.id) await actions.setActiveSession(null);
      await operation;
      feedback.notify(m.ai.session.archived, "success");
    } catch {
      if (activeSessionId === session.id) await actions.setActiveSession(session.id);
      feedback.notify(m.ai.session.archiveFailed, "error");
    } finally {
      setBusyId(null);
    }
  };

  const togglePinned = async (session: AiSession) => {
    if (busyId) return;
    setBusyId(session.id);
    try {
      await actions.updateSession(session.id, { pinned: !session.pinned });
      feedback.notify(session.pinned ? m.ai.session.unpinned : m.ai.session.pinned, "success");
    } catch {
      feedback.notify(m.ai.session.updateFailed, "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AnimatedDisclosure
      className="nav-recent"
      triggerClassName="nav-recent-toggle"
      open={!collapsed}
      onOpenChange={(open) => toggle(!open)}
      unmountOnExit
      exitMs={(tokens.layout.duration ?? 0) * 1000}
      summary={<>
        <span>{m.ai.session.recent} <span className="nav-recent-count">({recent.length})</span></span>
        <ChevronDown size={13} aria-hidden />
      </>}
    >
        <RecentTaskList sessions={recent} renderRow={(session) => {
            const waitingApproval = session.status === "waiting-approval" || pendingSessionIds.has(session.id);
            const dot = waitingApproval ? "waiting-approval" : statusClass(session.status);
            const projectName = isProjectTaskScope(session.scope) ? session.scope.projectName : null;
            return (
              <div className="nav-recent-row" key={session.id}>
                <button
                  type="button"
                  data-motion="selection"
                  className={`nav-recent-item${dot ? " has-status" : ""}${activeSessionId === session.id ? " active" : ""}`}
                  aria-current={activeSessionId === session.id ? "true" : undefined}
                  title={m.shell.recentOpen}
                  onClick={() => onOpen(session)}
                >
                  {/* 仅运行、待批准或失败时显示状态点；idle 不渲染，不占横向空间 */}
                  {dot ? <span className={`nav-recent-dot ${dot}`} aria-hidden /> : null}
                  <span className="nav-recent-item-main">
                    <span className="nav-recent-item-title">{session.title || m.common.unnamedTopic}</span>
                    <span className={`nav-recent-item-meta${waitingApproval ? " waiting-approval" : ""}`}>
                      {waitingApproval
                        ? m.ai.status.session.waitingApproval
                        : projectName
                          ? `${projectName} · ${relativeTime(session.createdAt)}`
                          : relativeTime(session.createdAt)}
                    </span>
                  </span>
                </button>
                <div className="nav-recent-actions">
                    <IconButton variant="ghost" size="sm"
                      type="button"
                      className={`nav-recent-action${session.pinned ? " pinned" : ""}`}
                      data-motion="icon"
                      label={`${session.pinned ? m.ai.session.unpin : m.ai.session.pin}：${session.title || m.common.unnamedTopic}`}
                      tooltip={session.pinned ? m.ai.session.unpin : m.ai.session.pin}
                      disabled={busyId === session.id}
                      onClick={(event) => { if (event.detail > 0) event.currentTarget.blur(); void togglePinned(session); }}
                    >
                      {session.pinned ? <PinOff size={13} aria-hidden /> : <Pin size={13} aria-hidden />}
                    </IconButton>
                    <IconButton variant="ghost" size="sm"
                      type="button"
                      className="nav-recent-action"
                      data-motion="icon"
                      label={m.ai.session.archiveNamed(session.title || m.common.unnamedTopic)}
                      tooltip={m.ai.session.archiveTask}
                      disabled={busyId === session.id}
                      onClick={(event) => { if (event.detail > 0) event.currentTarget.blur(); void archiveSession(session); }}
                    >
                      <Archive size={13} aria-hidden />
                    </IconButton>
                </div>
              </div>
            );
          }} />
    </AnimatedDisclosure>
  );
}

/** Only long histories virtualize; the same keyed row hosts survive threshold changes. */
function RecentTaskList({ sessions, renderRow }: { sessions: AiSession[]; renderRow(session: AiSession): ReactNode }) {
  useLocale();
  const virtual = sessions.length > 20;
  const scroller = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const pendingFocus = useRef<{ id: string; last: boolean } | null>(null);
  const focusedIndex = sessions.findIndex(session => session.id === focusedId);
  const virtualizer = useVirtualizer({
    enabled: virtual,
    count: sessions.length,
    getScrollElement: () => scroller.current,
    getItemKey: index => sessions[index].id,
    estimateSize: () => 30,
    gap: 1,
    initialRect: { width: 240, height: 260 },
    overscan: 3,
    useFlushSync: false,
    directDomUpdates: true,
    rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), ...(focusedIndex < 0 ? [] : [focusedIndex])])].sort((a, b) => a - b)
  });
  const rows = virtual ? virtualizer.getVirtualItems() : sessions.map((session, index) => ({ key: session.id, index }));
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const index = sessions.findIndex(session => session.id === pending.id);
    const buttons = scroller.current?.querySelectorAll<HTMLButtonElement>(`[data-index="${index}"] button:not(:disabled)`);
    const button = pending.last ? buttons?.[buttons.length - 1] : buttons?.[0];
    if (!button) return;
    pendingFocus.current = null;
    button.focus({ preventScroll: true });
  }, [rows, sessions]);
  const focusRow = (index: number, last = false) => {
    const session = sessions[index];
    if (!session) return;
    pendingFocus.current = { id: session.id, last };
    setFocusedId(session.id);
    virtualizer.scrollToIndex(index, { align: "auto" });
  };
  return <div ref={scroller} className={`nav-recent-list${virtual ? " is-virtual" : ""}`} role="region" aria-label={m.ai.session.recent} tabIndex={virtual ? 0 : undefined}
    onFocusCapture={event => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-recent-index]");
      if (row) setFocusedId(sessions[Number(row.dataset.recentIndex)]?.id || null);
    }}
    onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedId(null);
    }}
    onKeyDownCapture={event => {
      if (!virtual) return;
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>("[data-recent-index]");
      const index = row ? Number(row.dataset.recentIndex) : -1;
      if (event.key === "Tab" && row) {
        const controls = row.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const edge = event.shiftKey ? controls[0] : controls[controls.length - 1];
        const next = index + (event.shiftKey ? -1 : 1);
        if (target === edge && sessions[next]) {
          event.preventDefault();
          focusRow(next, event.shiftKey);
        }
        return;
      }
      if (target !== event.currentTarget && !target.matches(".nav-recent-item")) return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      focusRow(event.key === "Home" ? 0 : event.key === "End" ? sessions.length - 1
        : Math.min(sessions.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1))));
    }}>
    {/* The virtualizer caches inline geometry by DOM identity. Static layout is
        a CSS override so returning to virtual mode cannot erase cached positions. */}
    <div ref={virtual ? virtualizer.containerRef : undefined} className={virtual ? "nav-recent-virtual-content" : "nav-recent-static-content"} role="list">
      {rows.map(row => <div key={row.key} ref={virtual ? virtualizer.measureElement : undefined} data-index={row.index} data-recent-index={row.index}
        className={virtual ? "nav-recent-virtual-row" : undefined} role="listitem" aria-posinset={row.index + 1} aria-setsize={sessions.length}>
        {renderRow(sessions[row.index])}
      </div>)}
    </div>
  </div>;
}

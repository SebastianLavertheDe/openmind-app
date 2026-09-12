import { useMemo, useState } from "react";
import { Archive, ChevronDown, Pin, PinOff } from "lucide-react";
import type { AiSession } from "@shared/contracts";
import { isProjectTaskScope } from "@shared/ai-session-scope";
import { messages as m } from "@shared/messages";
import { useAiActions, useAiSnapshot, useAiUi } from "../ai-context";
import { storageJson, writeStorage } from "../ai-utils";
import { Tooltip } from "../design-system/components";

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
  const { snapshot } = useAiSnapshot();
  const actions = useAiActions();
  const ui = useAiUi();
  const [collapsed, setCollapsed] = useState(() => storageJson(COLLAPSED_KEY, false));
  const [busyId, setBusyId] = useState<string | null>(null);

  const recent = useMemo(() =>
    snapshot.sessions
      .filter((session) => !session.archived)
      .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || b.createdAt.localeCompare(a.createdAt)),
    [snapshot.sessions]
  );
  const pendingSessionIds = useMemo(
    () => new Set(snapshot.pendingApprovals.map((approval) => approval.sessionId)),
    [snapshot.pendingApprovals]
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
      ui.notify(m.ai.session.archived, "success");
    } catch {
      if (activeSessionId === session.id) await actions.setActiveSession(session.id);
      ui.notify(m.ai.session.archiveFailed, "error");
    } finally {
      setBusyId(null);
    }
  };

  const togglePinned = async (session: AiSession) => {
    if (busyId) return;
    setBusyId(session.id);
    try {
      await actions.updateSession(session.id, { pinned: !session.pinned });
      ui.notify(session.pinned ? m.ai.session.unpinned : m.ai.session.pinned, "success");
    } catch {
      ui.notify(m.ai.session.updateFailed, "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="nav-recent" aria-label={m.shell.recentTasksAria}>
      <button
        type="button"
        className="nav-recent-toggle"
        aria-expanded={!collapsed}
        onClick={() => toggle(!collapsed)}
      >
        <span>{m.ai.session.recent} <span className="nav-recent-count">({recent.length})</span></span>
        <ChevronDown size={13} aria-hidden />
      </button>
      {!collapsed ? (
        <div className="nav-recent-list">
          {recent.map((session) => {
            const waitingApproval = session.status === "waiting-approval" || pendingSessionIds.has(session.id);
            const dot = waitingApproval ? "waiting-approval" : statusClass(session.status);
            const projectName = isProjectTaskScope(session.scope) ? session.scope.projectName : null;
            return (
              <div className="nav-recent-row" key={session.id}>
                <button
                  type="button"
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
                  <Tooltip content={session.pinned ? m.ai.session.unpin : m.ai.session.pin} side="top">
                    <button
                      type="button"
                      className={`nav-recent-action${session.pinned ? " pinned" : ""}`}
                      data-motion="icon"
                      aria-label={`${session.pinned ? m.ai.session.unpin : m.ai.session.pin}：${session.title || m.common.unnamedTopic}`}
                      disabled={busyId === session.id}
                      onClick={(event) => { if (event.detail > 0) event.currentTarget.blur(); void togglePinned(session); }}
                    >
                      {session.pinned ? <PinOff size={13} aria-hidden /> : <Pin size={13} aria-hidden />}
                    </button>
                  </Tooltip>
                  <Tooltip content={m.ai.session.archiveTask} side="top">
                    <button
                      type="button"
                      className="nav-recent-action"
                      data-motion="icon"
                      aria-label={m.ai.session.archiveNamed(session.title || m.common.unnamedTopic)}
                      disabled={busyId === session.id}
                      onClick={(event) => { if (event.detail > 0) event.currentTarget.blur(); void archiveSession(session); }}
                    >
                      <Archive size={13} aria-hidden />
                    </button>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

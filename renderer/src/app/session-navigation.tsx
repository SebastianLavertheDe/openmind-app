import { createContext, useContext, useEffect } from "react";
import type { AiSession } from "@shared/contracts";
import { useAiActions } from "../ai-context";
import type { AppPage, AppRouteState } from "./routes";

export const SessionNavigationContext = createContext<((id: string) => Promise<void>) | null>(null);
export type SessionLeaveGuard = () => boolean | Promise<boolean>;
export const SessionLeaveContext = createContext<((guard: SessionLeaveGuard) => () => void) | null>(null);
export function useBeforeSessionNavigation(guard: SessionLeaveGuard) {
  const register = useContext(SessionLeaveContext);
  useEffect(() => register?.(guard), [register, guard]);
}
export function useOpenSession() {
  const open = useContext(SessionNavigationContext);
  const actions = useAiActions();
  return open || actions.setActiveSession;
}

export function sessionDestination(session: AiSession): { page: AppPage; state: AppRouteState } {
  const origin = session.origin;
  const state: AppRouteState = { restoreSessionId: session.id };
  if (session.scope.type === "project-task") {
    const fileOrigin = origin?.page === "projects" && origin.projectId === session.scope.projectId && origin.section !== "tasks" ? origin : null;
    return { page: "projects", state: { ...state, projectName: session.scope.projectName,
      projectSection: fileOrigin?.section || "tasks", projectItem: fileOrigin ? fileOrigin.filePath || undefined : session.scope.taskId,
      projectFileKind: fileOrigin?.fileKind } };
  }
  if (origin?.page === "brief") return { page: "brief", state: { ...state, filePath: origin.filePath ?? null, previewPath: origin.previewPath } };
  if (origin?.page === "creative") return { page: "creative", state: { ...state, projectDir: origin.projectDir || undefined,
    filePath: origin.filePath ?? null, previewPath: origin.previewPath, date: origin.date, stage: origin.stage, topicTitle: origin.topicTitle } };
  return { page: "ai", state };
}

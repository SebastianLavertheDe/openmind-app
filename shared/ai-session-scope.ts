import type { AiRun, AiSession, AiSessionScope } from "./contracts";

export type ScopedConversation = Pick<AiSession | AiRun, "scope">;

export function isWorkspaceScope(scope: AiSessionScope): scope is Extract<AiSessionScope, { type: "workspace" }> {
  return scope.type === "workspace";
}

export function isProjectTaskScope(scope: AiSessionScope): scope is Extract<AiSessionScope, { type: "project-task" }> {
  return scope.type === "project-task";
}

export function isWorkspaceConversation(value: ScopedConversation): boolean {
  return isWorkspaceScope(value.scope);
}

export function isProjectTaskConversation(value: ScopedConversation): boolean {
  return isProjectTaskScope(value.scope);
}

export function sameConversationScope(left: AiSessionScope, right: AiSessionScope): boolean {
  return left.type === right.type
    && (left.type === "workspace"
      || (right.type === "project-task" && left.projectId === right.projectId && left.taskId === right.taskId));
}

export function workspaceSessions(sessions: readonly AiSession[], includeArchived = false): AiSession[] {
  return sessions.filter((session) => isWorkspaceConversation(session) && (includeArchived || !session.archived));
}

export function projectTaskSession(
  sessions: readonly AiSession[],
  projectId: string,
  taskId: string
): AiSession | null {
  return sessions.find((session) => (
    isProjectTaskScope(session.scope)
    && session.scope.projectId === projectId
    && session.scope.taskId === taskId
  )) || null;
}

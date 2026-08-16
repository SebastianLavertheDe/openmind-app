export type AppPage =
  | "onboarding"
  | "sources"
  | "skills"
  | "brief"
  | "creative"
  | "projects"
  | "automation"
  | "runs"
  | "ai"
  | "settings";

export type AppRouteState = {
  date?: string;
  contentPath?: string;
  projectDir?: string;
  sessionId?: string;
  runId?: string;
  skillId?: string;
  stage?: "today" | "drafting" | "review" | "ready" | "published";
  sourceId?: string;
  openSkillImport?: boolean;
  search?: string;
  settingsSection?: "general" | "providers" | "runtime" | "skills" | "mcp" | "browser" | "permissions" | "workflow" | "sources" | "storage" | "sessions";
};

export type Navigate = (page: AppPage, state?: AppRouteState) => void;

export interface AppRoute {
  page: AppPage;
  state: AppRouteState;
  nonce: number;
}

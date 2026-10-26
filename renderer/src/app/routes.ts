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

export function isDefaultSkillsPage(page: AppPage): boolean {
  return page === "creative" || page === "brief";
}

export type AppRouteState = {
  skillLibraryMode?: "explore" | "mine";
  skillReturnSessionId?: string | null;
  date?: string;
  projectDir?: string;
  projectName?: string;
  projectSection?: "tasks" | "materials" | "outputs";
  projectItem?: string;
  runId?: string;
  skillId?: string;
  stage?: "today" | "drafting" | "review" | "ready" | "published";
  openSkillImport?: boolean;
  providerCategory?: "text" | "image";
  settingsSection?: "general" | "providers" | "runtime" | "skills" | "mcp" | "browser" | "permissions" | "workflow" | "sources" | "sessions";
};

export type Navigate = (page: AppPage, state?: AppRouteState) => void;

export interface AppRoute {
  page: AppPage;
  state: AppRouteState;
  nonce: number;
}

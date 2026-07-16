export type AppPage =
  | "sources"
  | "brief"
  | "creative"
  | "projects"
  | "automation"
  | "ai"
  | "settings";

export type AppRouteState = {
  date?: string;
  contentPath?: string;
  projectDir?: string;
  sessionId?: string;
  skillId?: string;
  stage?: "today" | "drafting" | "review" | "ready" | "published";
  sourceId?: string;
  search?: string;
};

export type Navigate = (page: AppPage, state?: AppRouteState) => void;

export interface AppRoute {
  page: AppPage;
  state: AppRouteState;
  nonce: number;
}

import { lazy, type ReactNode } from "react";
import {
  CalendarDays,
  Command,
  Database,
  FilePenLine,
  Settings,
  SquarePen,
  type LucideIcon
} from "lucide-react";
import type { AiSnapshot, AppBootstrap } from "@shared/contracts";
import { navLabel } from "@shared/display-labels";
import { messages } from "@shared/messages";
import type { AppPage, AppRoute, Navigate } from "./routes";

const SourcesPage = lazy(() => import("../features/sources").then((module) => ({ default: module.SourcesPage })));
const DailyBriefPage = lazy(() => import("../features/daily-brief").then((module) => ({ default: module.DailyBriefPage })));
const CreativeWorkspacePage = lazy(() => import("../features/creative").then((module) => ({ default: module.CreativeWorkspacePage })));
const AutomationPage = lazy(() => import("../features/automation").then((module) => ({ default: module.AutomationPage })));
const AiWorkbench = lazy(() => import("../features/ai-console").then((module) => ({ default: module.AiWorkbench })));
const SettingsPage = lazy(() => import("../features/settings").then((module) => ({ default: module.SettingsPage })));

/** MOTION-P0-001: 各 lazy route 的 chunk 引用，用于导航 hover/focus 时预取，消除首次切换的空白闪烁。 */
const ROUTE_LAZY: Record<AppPage, () => Promise<unknown>> = {
  sources: () => import("../features/sources"),
  brief: () => import("../features/daily-brief"),
  creative: () => import("../features/creative"),
  projects: () => import("../features/creative"),
  automation: () => import("../features/automation"),
  ai: () => import("../features/ai-console"),
  settings: () => import("../features/settings"),
};

const preloaded = new Set<AppPage>();
/** 预取指定页面的 chunk（幂等，已预取则跳过）。供导航 hover/focus 调用。 */
export function preloadRoute(page: AppPage): void {
  if (preloaded.has(page)) return;
  preloaded.add(page);
  void ROUTE_LAZY[page]?.();
}

export type RouteBootstrap = AppBootstrap;

export type RouteRenderProps = {
  route: AppRoute;
  bootstrap: RouteBootstrap;
  navigate: Navigate;
  providers: AiSnapshot["providers"];
  aiFilePreviewPath: string | null;
  onAiFilePreviewPathChange: (path: string | null) => void;
  onRepo: () => void;
  onExitSettings: () => void;
};

/** 侧边栏导航分组：create（新建任务，顶部强入口）/ core（核心功能）/ system（设置，沉底）。 */
export type NavGroup = "create" | "core" | "system";

type RouteDefinition = {
  page: AppPage;
  needsRepo: boolean;
  nav?: { label: string; icon: LucideIcon; group: NavGroup };
  render: (props: RouteRenderProps) => ReactNode;
};

export const ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  { page: "ai", needsRepo: true, nav: { label: navLabel("ai"), icon: SquarePen, group: "create" }, render: ({ route, aiFilePreviewPath, onAiFilePreviewPathChange }) => <AiWorkbench key={route.nonce} restoredPreviewPath={aiFilePreviewPath} onPreviewPathChange={onAiFilePreviewPathChange} /> },
  { page: "creative", needsRepo: true, nav: { label: navLabel("creative"), icon: FilePenLine, group: "core" }, render: ({ route }) => <CreativeWorkspacePage key={route.nonce} initialDate={route.state.date} initialStage={route.state.stage} initialProjectDir={route.state.projectDir} /> },
  { page: "brief", needsRepo: true, nav: { label: navLabel("brief"), icon: CalendarDays, group: "core" }, render: ({ route, navigate }) => <DailyBriefPage key={route.nonce} go={navigate} initialDate={route.state.date} /> },
  { page: "sources", needsRepo: true, nav: { label: navLabel("sources"), icon: Database, group: "core" }, render: ({ route }) => <SourcesPage key={route.nonce} initialSourceId={route.state.sourceId} /> },
  { page: "automation", needsRepo: true, nav: { label: navLabel("automation"), icon: Command, group: "core" }, render: ({ route, bootstrap, navigate }) => <AutomationPage key={route.nonce} skills={bootstrap.skills} initialSkillId={route.state.skillId} go={navigate} /> },
  { page: "projects", needsRepo: true, render: ({ route }) => <CreativeWorkspacePage key={route.nonce} initialDate={route.state.date} initialStage={route.state.stage} initialProjectDir={route.state.projectDir} /> },
  { page: "settings", needsRepo: false, nav: { label: navLabel("settings"), icon: Settings, group: "system" }, render: ({ route, bootstrap, providers, onRepo, onExitSettings, navigate }) => <SettingsPage key={route.nonce} repoRoot={bootstrap.repoRoot} runtime={bootstrap.runtime} providers={providers} onRepo={onRepo} onBack={onExitSettings} onOpenSession={() => navigate("ai")} /> }
];

export type NavItem = { id: AppPage; label: string; icon: LucideIcon; group: NavGroup };

export const NAV_ITEMS: readonly NavItem[] = ROUTE_DEFINITIONS.flatMap((route) =>
  route.nav ? [{ id: route.page, label: route.nav.label, icon: route.nav.icon, group: route.nav.group }] : []
);

export function renderActiveRoute(props: RouteRenderProps): ReactNode {
  const entry = ROUTE_DEFINITIONS.find((route) => route.page === props.route.page);
  if (!entry) return null;
  if (entry.needsRepo && props.bootstrap.validRepo === false) {
    const { navigate } = props;
    return (
      <div className="repo-required">
        <strong>{messages.repoRequired.title}</strong>
        <p>{messages.repoRequired.body}</p>
        <button className="primary-button" onClick={() => navigate("settings")}>{messages.repoRequired.action}</button>
      </div>
    );
  }
  return entry.render(props);
}

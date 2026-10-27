import { useLocale } from "../i18n";
import { messages as uiMessages } from "@shared/messages";
import { lazy, useEffect, type ReactNode } from "react";
import {
  CalendarDays,
  Rss,
  Command,
  FilePenLine,
  FolderKanban,
  Settings,
  SquarePen,
  type LucideIcon
} from "lucide-react";
import type { AiSnapshot, AppBootstrap } from "@shared/contracts";
import { navLabel } from "@shared/display-labels";
import type { AppPage, AppRoute, Navigate } from "./routes";
import type { ConfirmAction } from "../feedback-context";

const OnboardingPage = lazy(() => import("../features/onboarding").then((module) => ({ default: module.OnboardingPage })));
const DailyBriefPage = lazy(() => import("../features/daily-brief").then((module) => ({ default: module.DailyBriefPage })));
const CreativeWorkspacePage = lazy(() => import("../features/creative").then((module) => ({ default: module.CreativeWorkspacePage })));
const ProjectsPage = lazy(() => import("../features/projects").then((module) => ({ default: module.ProjectsPage })));
const AutomationPage = lazy(() => import("../features/automation").then((module) => ({ default: module.AutomationPage })));
const RunsPage = lazy(() => import("../features/runs").then((module) => ({ default: module.RunsPage })));
const AiWorkbench = lazy(() => import("../features/ai-console").then((module) => ({ default: module.AiWorkbench })));
const SourcesPage = lazy(() => import("../features/sources").then((module) => ({ default: module.SourcesPage })));
const SettingsPage = lazy(() => import("../features/settings").then((module) => ({ default: module.SettingsPage })));

/** MOTION-P0-001: 各 lazy route 的 chunk 引用，用于导航 hover/focus 时预取，消除首次切换的空白闪烁。 */
const ROUTE_LAZY: Record<AppPage, () => Promise<unknown>> = {
  onboarding: () => import("../features/onboarding"),
  sources: () => import("../features/sources"),
  skills: () => import("../features/settings"),
  brief: () => import("../features/daily-brief"),
  creative: () => import("../features/creative"),
  projects: () => import("../features/projects"),
  automation: () => import("../features/automation"),
  runs: () => import("../features/runs"),
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
  openSession?(id: string): Promise<void>;
  providers: AiSnapshot["providers"];
  aiFilePreviewPath: string | null;
  onAiFilePreviewPathChange: (path: string | null) => void;
  embeddedFilePreviewPath: string | null;
  onCloseEmbeddedFilePreview: () => void;
  onRepo: (root?: string) => Promise<RouteBootstrap>;
  onExitSettings: () => void;
  confirmAction?: ConfirmAction;
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
  { page: "onboarding", needsRepo: false, render: ({ route, bootstrap, navigate, onRepo }) => <OnboardingPage key={route.nonce} bootstrap={bootstrap} go={navigate} onRefresh={onRepo} /> },
  { page: "ai", needsRepo: true, nav: { get label() { return navLabel("ai"); }, icon: SquarePen, group: "create" }, render: ({ route, aiFilePreviewPath, onAiFilePreviewPathChange }) => <AiWorkbench key={route.nonce} restoredPreviewPath={aiFilePreviewPath} onPreviewPathChange={onAiFilePreviewPathChange} /> },
  { page: "projects", needsRepo: true, nav: { get label() { return uiMessages.interface.projects; }, icon: FolderKanban, group: "core" }, render: ({ route }) => <ProjectsPage key={route.nonce} initialProjectName={route.state.projectName} initialSection={route.state.projectSection} initialItem={route.state.projectItem} initialFileKind={route.state.projectFileKind} restoreSelection={Boolean(route.state.restoreSessionId)} /> },
  { page: "creative", needsRepo: true, nav: { get label() { return navLabel("creative"); }, icon: FilePenLine, group: "core" }, render: ({ route, embeddedFilePreviewPath, onCloseEmbeddedFilePreview }) => <CreativeWorkspacePage key={route.nonce} initialDate={route.state.date} initialStage={route.state.stage} initialProjectDir={route.state.projectDir} initialFilePath={route.state.filePath} initialTopicTitle={route.state.topicTitle} embeddedFilePreviewPath={embeddedFilePreviewPath} onCloseEmbeddedFilePreview={onCloseEmbeddedFilePreview} /> },
  { page: "brief", needsRepo: true, nav: { get label() { return navLabel("brief"); }, icon: CalendarDays, group: "core" }, render: ({ route, embeddedFilePreviewPath, onCloseEmbeddedFilePreview, navigate }) => <DailyBriefPage onManageSources={() => navigate("sources")} key={route.nonce} initialFilePath={route.state.filePath} initialDate={route.state.date} embeddedFilePreviewPath={embeddedFilePreviewPath} onCloseEmbeddedFilePreview={onCloseEmbeddedFilePreview} /> },
  { page: "sources", needsRepo: true, nav: { get label() { return navLabel("sources"); }, icon: Rss, group: "core" }, render: ({ route, navigate }) => <SourcesPage key={route.nonce} onRuns={() => navigate("runs", { skillId: "rss-article-saver" })} /> },
  { page: "skills", needsRepo: false, render: ({ route, bootstrap, providers, onRepo, onExitSettings, navigate, openSession }) => <SettingsPage key={route.nonce} repoRoot={bootstrap.repoRoot} providers={providers} onRepo={onRepo} onBack={onExitSettings} onOpenSession={(id) => id && openSession ? void openSession(id) : route.state.projectName ? navigate("projects", { projectName: route.state.projectName, projectSection: "tasks", projectItem: route.state.projectItem }) : navigate("ai")} initialSkillLibraryMode={route.state.skillLibraryMode} skillReturnSessionId={route.state.skillReturnSessionId} initialSection="skills" initialSkillId={route.state.skillId} initialSkillImportOpen={route.state.openSkillImport} /> },
  { page: "automation", needsRepo: true, nav: { get label() { return navLabel("automation"); }, icon: Command, group: "core" }, render: ({ route, confirmAction }) => <AutomationPage key={route.nonce} initialSkillId={route.state.skillId} confirmAction={confirmAction} /> },
  { page: "runs", needsRepo: true, render: ({ route, confirmAction }) => <RunsPage key={route.nonce} initialRunId={route.state.runId} initialSkillId={route.state.skillId} confirmAction={confirmAction} /> },
  { page: "settings", needsRepo: false, nav: { get label() { return navLabel("settings"); }, icon: Settings, group: "system" }, render: ({ route, bootstrap, providers, onRepo, onExitSettings, navigate, openSession }) => <SettingsPage key={route.nonce} repoRoot={bootstrap.repoRoot} providers={providers} onRepo={onRepo} onBack={onExitSettings} onOpenSession={(id) => id && openSession ? void openSession(id) : route.state.projectName ? navigate("projects", { projectName: route.state.projectName, projectSection: "tasks", projectItem: route.state.projectItem }) : navigate("ai")} initialSkillLibraryMode={route.state.skillLibraryMode} skillReturnSessionId={route.state.skillReturnSessionId} initialSection={route.state.settingsSection === "sources" ? "skills" : route.state.settingsSection} initialProviderCategory={route.state.providerCategory} initialSkillId={route.state.skillId} initialSkillImportOpen={route.state.openSkillImport} /> }
];

export type NavItem = { id: AppPage; label: string; icon: LucideIcon; group: NavGroup };

export const NAV_ITEMS: readonly NavItem[] = ROUTE_DEFINITIONS.flatMap((route) =>
  route.nav ? [{ id: route.page, get label() { return route.nav!.label; }, icon: route.nav.icon, group: route.nav.group }] : []
);

export function renderActiveRoute(props: RouteRenderProps): ReactNode {
  const entry = ROUTE_DEFINITIONS.find((route) => route.page === props.route.page);
  if (!entry) return null;
  if (entry.needsRepo && !props.bootstrap.validRepo) {
    // An unbound openmind root routes the user back to onboarding instead of
    // rendering a dead-end panel.
    return <RouteToOnboarding navigate={props.navigate} />;
  }
  return entry.render(props);
}

/** Render-phase redirect: navigation happens in an effect, never during render. */
function RouteToOnboarding({ navigate }: { navigate: Navigate }): ReactNode {
  useLocale();
  useEffect(() => { navigate("onboarding"); }, [navigate]);
  return <div className="route-loading" role="status" aria-live="polite"><div className="route-loading-skeleton" /></div>;
}

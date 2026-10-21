import { Profiler, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AiSession, AiSnapshot, DesktopApi, McpServerDefinition, ProvidersYamlView, SkillDefinition } from "@shared/contracts";
import { AiProvider } from "../../../renderer/src/ai-context";
import { AppShell } from "../../../renderer/src/app/AppShell";
import { SidebarRecent } from "../../../renderer/src/app/SidebarRecent";
import { ResponsiveLayoutProvider } from "../../../renderer/src/app/responsive-layout";
import { AiProvidersSettingsSection, SkillSettingsSection } from "../../../renderer/src/features/settings/settings-sections";
import { ProjectEditDialog } from "../../../renderer/src/features/projects/ProjectAppearance";
import type { ProjectSummary } from "../../../renderer/src/features/projects/types";
import "../../../renderer/src/styles/index.css";

const project: ProjectSummary = { id: "fixture", name: "合成项目", description: "", status: "active", materialCount: 0, taskCount: 0, outputCount: 0, createdAt: "", updatedAt: "" };
const skills: SkillDefinition[] = Array.from({ length: 3 }, (_, i) => ({ id: `fixture-${i}`, title: `合成 Skill ${i}`, description: "用于局部折叠验证", cwd: "/fixtures/motion", command: "echo fixture", permission: "read-only" }));
const servers: McpServerDefinition[] = skills.map(skill => ({ id: skill.id, title: skill.title.replace("Skill", "MCP"), description: "合成工具", backend: "fixture", transport: "stdio", connection: "fixture", enabled: false, available: true, status: "disabled", diagnostic: "未启用", providers: [], tools: [], settingsSection: "browser" }));
const providers: ProvidersYamlView = { schemaVersion: 1, default: "fixture", providers: [{ id: "fixture", name: "合成 Provider", enabled: true, protocol: "openai-chat", authMode: "bearer", apiKeySet: false, baseUrl: "https://example.invalid", model: "fixture", proxyUrl: "", proxyPolicy: "system", tlsPolicy: "verify" }] };
const sessions = Array.from({ length: 400 }, (_, i): AiSession => ({ schemaVersion: 1, id: `session-${i}`, projectId: "fixture", scope: { type: "workspace" }, projectRoot: "/fixtures/motion", provider: "codex", providerId: "fixture", providerSessionId: null, cwd: "/fixtures/motion", title: `合成任务 ${i}`, permissionProfile: "edit", status: "idle", pinned: false, archived: false, createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z", lastRunId: null }));
const snapshot: AiSnapshot = { projectRoot: "/fixtures/motion", providers: [], runs: [], pendingApprovals: [], sessions };
const listeners = new Set<(message: unknown) => void>();
window.openmind = { onAiEvent: (listener: (message: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); }, getProviderApiKey: async () => "", openPath: async () => "" } as unknown as DesktopApi;
const probe = { commits: [] as Array<{ time: number; duration: number }>, opened: "", saves: [] as unknown[] };
function Fixture() {
  const [scene, setScene] = useState("skills");
  const [dialogOpen, setDialogOpen] = useState(true);
  useLayoutEffect(() => { Object.assign(window, { followupMotion: { probe,
    historySize: (size: number) => listeners.forEach(listener => listener({ kind: "snapshot", snapshot: { ...snapshot, sessions: sessions.slice(0, size) } })),
    scene: (next: string) => { setDialogOpen(true); setScene(next); }
  } }); }, []);
  const count = scene === "recent40" ? 40 : 400;
  return <Profiler id="followup" onRender={(_id, _phase, duration) => probe.commits.push({ time: performance.now(), duration })}>
    {scene.startsWith("recent") || scene === "drawer" ? <AiProvider key={scene} initial={{ ...snapshot, sessions: sessions.slice(0, count) }}>
      <AppShell page="brief" navigate={() => {}} onOpenSearch={() => {}} navCollapsed={false} setNavCollapsed={() => {}}
        repoRoot="/fixtures/motion" environment={{ mode: "preview", platform: "linux" }} pendingApprovals={0} aiMode="collapsed"
        recentTasks={<SidebarRecent activeSessionId={null} onOpen={session => { probe.opened = session.id; }} />}>
        <button data-motion="action" data-followup-outside>正文操作</button>
      </AppShell>
    </AiProvider> : scene === "icon" ? <ProjectEditDialog project={dialogOpen ? project : null} busy={false} onClose={() => setDialogOpen(false)} onSave={value => { probe.saves.push(value); }} />
      : <div className="settings-page" style={{ display: "block", padding: 0, width: "min(980px, calc(100% - 48px))", margin: "24px auto" }}>
        {scene === "provider" ? <AiProvidersSettingsSection view={providers} busy={false} onSave={async value => { probe.saves.push(value); }} notify={() => {}} />
          : <SkillSettingsSection key={scene} mode={scene === "mcp" ? "mcp" : "skills"} skills={skills} mcpServers={servers} refreshing={false} onRefresh={() => {}} onCopy={() => {}} onOpenDirectory={() => {}} onOpenMcpSettings={() => {}} />}
      </div>}
  </Profiler>;
}
createRoot(document.getElementById("root")!).render(<ResponsiveLayoutProvider><Fixture /></ResponsiveLayoutProvider>);

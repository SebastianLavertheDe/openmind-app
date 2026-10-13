import { Profiler, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AiSnapshot, ContextReference, DesktopApi, ProvidersYamlView } from "@shared/contracts";
import { AiProvider, useAiActions } from "../../../renderer/src/ai-context";
import { ChatComposer } from "../../../renderer/src/features/ai-console/composer";
import { ProjectsPage } from "../../../renderer/src/features/projects/ProjectsPage";
import { AiProvidersSettingsSection } from "../../../renderer/src/features/settings/settings-sections";
import type { ProjectSummary } from "../../../renderer/src/features/projects/types";
import "../../../renderer/src/styles/index.css";

// Production components, isolated synthetic state. No provider or filesystem IPC.
const snapshot: AiSnapshot = { projectRoot: "/fixtures/motion", providers: [], sessions: [], runs: [], pendingApprovals: [] };
const projects: ProjectSummary[] = Array.from({ length: 12 }, (_, i) => ({
  id: `fixture-project-${i}`, name: `项目 ${String(i).padStart(2, "0")}`, description: "Motion fixture",
  status: "active", favorite: i === 0, materialCount: 0, taskCount: 0, outputCount: 0,
  createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z"
}));
window.openmind = {
  onAiEvent: () => () => {},
  listProjects: async () => [...projects],
  updateProject: async ({ projectName, ...patch }: Partial<ProjectSummary> & { projectName: string }) => {
    const index = projects.findIndex(p => p.name === projectName);
    projects[index] = { ...projects[index], ...patch };
    return projects[index];
  },
  getProviderApiKey: async () => "fixture-only-key"
} as unknown as DesktopApi;
const providerView = {
  schemaVersion: 1, default: "fixture", cli: { claude: null, codex: null },
  providers: [{ id: "fixture", name: "Fixture Provider", enabled: true, protocol: "openai-chat", authMode: "bearer", apiKeySet: true,
    baseUrl: "https://example.invalid", model: "fixture", proxyUrl: "", proxyPolicy: "system", tlsPolicy: "verify" }]
} as ProvidersYamlView;
const probe = { commits: [] as Array<{ scene: string; time: number; duration: number }> };
function Fixture() {
  const actions = useAiActions();
  const [scene, setScene] = useState("contexts");
  useLayoutEffect(() => {
    Object.assign(window, { incrementalMotion: {
      probe, scene: setScene,
      contexts: (count: number, images = false) => {
        actions.clearContexts();
        for (let i = 0; i < count; i++) actions.addContext({ id: `context-${i}`, kind: images ? "image" : "selection", label: `引用 ${i}`,
          content: images ? 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48"%3E%3Crect width="48" height="48" fill="%233c8"/%3E%3C/svg%3E' : `合成引用 ${i}`, path: `fixture-${i}.md` } as ContextReference);
      },
      remove: actions.removeContext,
      reorder: actions.reorderContexts
    } });
  }, [actions]);
  return <div style={{ height: "100vh", padding: 24 }}>
    <Profiler id={scene} onRender={(id, _phase, duration) => probe.commits.push({ scene: id, time: performance.now(), duration })}>
      {scene === "contexts" ? <div style={{ width: 620, maxWidth: "100%", marginTop: 200 }}><ChatComposer /></div>
        : scene === "projects" ? <ProjectsPage />
        : <AiProvidersSettingsSection view={providerView} busy={false} onSave={async () => {}} notify={() => {}} />}
    </Profiler>
  </div>;
}
createRoot(document.getElementById("root")!).render(<AiProvider initial={snapshot}><Fixture /></AiProvider>);

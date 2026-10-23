import { Profiler, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AiSnapshot, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../../renderer/src/ai-context";
import { ResponsiveLayoutProvider } from "../../../renderer/src/app/responsive-layout";
import { FeedbackHost } from "../../../renderer/src/components/FeedbackHost";
import { ProjectsPage } from "../../../renderer/src/features/projects/ProjectsPage";
import { DailyBriefPage } from "../../../renderer/src/features/daily-brief/DailyBriefPage";
import type { ProjectSummary } from "../../../renderer/src/features/projects/types";
import "../../../renderer/src/styles/index.css";

// Only synthetic in-memory IPC. No developer content, credentials or filesystem.
const snapshot: AiSnapshot = { projectRoot: "/fixtures", providers: [], sessions: [], runs: [], pendingApprovals: [] };
const now = "2026-09-17T00:00:00Z";
let projects: ProjectSummary[] = [];
const makeProjects = (count: number) => { projects = Array.from({ length: count }, (_, i) => ({
  id: `project-${i}`, name: `项目 ${i}`, description: "Fixture", status: "active", favorite: i === 0,
  materialCount: 20, outputCount: 1, taskCount: 0, createdAt: now, updatedAt: now
})); };
makeProjects(8);
let materials = Array.from({ length: 20 }, (_, i) => ({ relativePath: `materials/${i}.md`, title: `资料 ${i}`, kind: "document", status: "ready", createdAt: now, updatedAt: now }));
const output = { relativePath: "outputs/draft.md", title: "文档草稿", createdAt: now, updatedAt: now };
const briefFiles = Array.from({ length: 20 }, (_, i) => ({ path: `daily-summary/brief-${i}.md`, name: `简报 ${i}.md`, size: 1024, modifiedAt: now }));
const briefContent = new Map<string, string>();
const probe = { commits: [] as Array<{ scene: string; time: number; duration: number }>, slow: false, materialReads: 0, outputReads: 0 };
const latency = () => probe.slow ? new Promise(resolve => setTimeout(resolve, 250)) : Promise.resolve();
window.openmind = {
  onAiEvent: () => () => {}, onSkillEvent: () => () => {},
  aiRefresh: async () => snapshot, aiGetEvents: async () => [],
  listProjects: async () => [...projects], getProject: async (name: string) => projects.find(p => p.name === name),
  archiveProject: async ({ projectName }: { projectName: string }) => {
    const index = projects.findIndex(p => p.name === projectName);
    projects[index] = { ...projects[index], status: "archived" };
    return projects[index];
  },
  updateProject: async ({ projectName, ...patch }: Partial<ProjectSummary> & { projectName: string }) => {
    const index = projects.findIndex(p => p.name === projectName);
    projects[index] = { ...projects[index], ...patch }; return projects[index];
  },
  listProjectTasks: async () => [],
  listProjectMaterials: async () => { await latency(); return [...materials]; },
  listProjectOutputs: async () => [output],
  readProjectMaterial: async ({ relativePath }: { relativePath: string }) => {
    probe.materialReads++; return { material: materials.find(m => m.relativePath === relativePath), content: "# 合成资料\n\n" + "测试内容。\n".repeat(100), truncated: false };
  },
  renameProjectMaterial: async ({ relativePath, newTitle }: { relativePath: string; newTitle: string }) => {
    materials = materials.map(m => m.relativePath === relativePath ? { ...m, title: newTitle } : m);
    return materials.find(m => m.relativePath === relativePath);
  },
  readProjectOutput: async () => { probe.outputReads++; return { output, content: "# 保留编辑草稿\n\n合成内容。" }; },
  saveProjectOutput: async ({ title, content }: { title: string; content: string }) => ({ output: { ...output, title }, content }),
  listContent: async () => { await latency(); return briefFiles; },
  readContent: async (path: string) => ({ path, name: "合成简报", content: briefContent.get(path) ?? "# 合成简报\n\n" + "用于验证刷新。\n".repeat(80), truncated: false }),
  writeContent: async (path: string, content: string) => {
    briefContent.set(path, content);
    return { path, name: "合成简报", content, truncated: false };
  }
} as unknown as DesktopApi;

function Fixture() {
  const [scene, setScene] = useState("projects");
  const [revision, setRevision] = useState(0);
  useLayoutEffect(() => {
    Object.assign(window, { workspaceMotion: { probe, scene: (next: string) => { setScene(next); setRevision(n => n + 1); },
      projects: (count: number) => { makeProjects(count); setScene("projects"); setRevision(n => n + 1); }
    } });
  }, []);
  const projectPage = <ProjectsPage key={revision} initialProjectName={scene === "projects" ? undefined : "项目 0"}
    initialSection={scene === "files" ? "materials" : "outputs"} initialItem={scene === "files" ? "materials/0.md" : "outputs/draft.md"} />;
  return <div style={{ height: "100vh", padding: 16 }}>
    <Profiler id={scene} onRender={(id, _phase, duration) => probe.commits.push({ scene: id, time: performance.now(), duration })}>
      {scene === "brief" ? <DailyBriefPage key={revision} /> : scene === "compact" ? <ResponsiveLayoutProvider>{projectPage}</ResponsiveLayoutProvider> : projectPage}
      <FeedbackHost />
    </Profiler>
  </div>;
}
createRoot(document.getElementById("root")!).render(<AiProvider initial={snapshot}><Fixture /></AiProvider>);

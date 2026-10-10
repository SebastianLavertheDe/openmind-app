import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunScheduler } from "./scheduler";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { SkillPackageService } from "../skills/skill-package-service";
import type { AiEvent, AiRun, AiSession, AiSessionSkillSnapshotEntry, ProviderCapabilities } from "../../shared/contracts";
import type { ProviderRunContext } from "./providers/types";
import { SkillToolRegistry } from "./skill-tool-registry";
import { ProjectService } from "../project/project-service";

const roots: string[] = [];
const workspaceScope = { type: "workspace" } as const;

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-scheduler-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("RunScheduler input boundaries", () => {
  it("upgrades an existing Codex thread once and preserves its conversation history", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined, undefined, createRoot(), root);
    const internals = schedulerInternals(scheduler);
    const provider: ProviderCapabilities = { id: "codex-native", provider: "codex", label: "Codex", runtime: "native", available: true, version: "fixture", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null };
    internals.registry.detect = () => [provider];
    const attempts: Array<{ prompt: string; thread: string | null }> = [];
    internals.adapters.codex.run = async context => {
      attempts.push({ prompt: context.prompt, thread: context.session.providerSessionId });
      context.updateProviderSession("thread-with-image-tool", 1);
      await context.emit("assistant-message", { text: "continued", phase: "final" });
    };
    let session = internals.store.createSession({ provider: "codex", providerId: provider.id, cwd: ".", title: "Existing conversation", permissionProfile: "edit", scope: workspaceScope });
    session = internals.store.updateSession(session.id, { providerSessionId: "legacy-thread" });
    let oldRun = internals.store.createRun(session, "Earlier request", []);
    await internals.store.beginTurn(oldRun);
    await internals.store.appendEvent(oldRun, "assistant-message", { text: "Earlier answer", phase: "final" });
    oldRun = internals.store.updateRun(oldRun.id, { status: "completed", completedAt: new Date().toISOString() });
    await internals.store.completeTurn(oldRun);
    for (const prompt of ["continue", "continue again"]) {
      const { run } = scheduler.startRun({ sessionId: session.id, providerId: provider.id, permissionProfile: "edit", cwd: ".", prompt, contexts: [] });
      await waitUntil(() => scheduler.snapshot().runs.find(value => value.id === run.id)?.status === "completed");
    }
    expect(attempts[0].thread).toBeNull();
    expect(attempts[0].prompt).toContain("Earlier answer");
    expect(attempts[1].thread).toBe("thread-with-image-tool");
    expect(attempts[1].prompt).not.toContain('source="local_rollout"');
    expect(internals.store.getSession(session.id).appToolsVersion).toBe(1);
  });

  it("freezes each turn's image selection while later turns and forks keep their own settings", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined, undefined, createRoot(), root);
    const internals = schedulerInternals(scheduler);
    const provider = { id: "claude-native", provider: "claude", label: "Claude", runtime: "native", available: true, version: "fixture", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null } as ProviderCapabilities;
    internals.registry.detect = () => [provider];
    const seen: unknown[] = [];
    internals.adapters.claude.run = async context => { seen.push(context.run.imageGeneration); await context.emit("assistant-message", { text: "done", phase: "final" }); };
    const selection = { provider: "volcengine" as const, model: "doubao-seedream-5-0-flash-260915" };
    const first = scheduler.startRun({ providerId: provider.id, permissionProfile: "auto", cwd: ".", prompt: "first", contexts: [], imageGeneration: selection });
    await waitUntil(() => scheduler.snapshot().runs.find(run => run.id === first.run.id)?.status === "completed");
    const second = scheduler.startRun({ sessionId: first.session.id, providerId: provider.id, permissionProfile: "auto", cwd: ".", prompt: "second", contexts: [], imageGeneration: null });
    await waitUntil(() => scheduler.snapshot().runs.find(run => run.id === second.run.id)?.status === "completed");
    expect(seen).toEqual([selection, null]);
    expect(scheduler.snapshot().runs.find(run => run.id === first.run.id)?.imageGeneration).toEqual(selection);
    const fork = await scheduler.forkSession(first.session.id);
    expect(fork.imageGeneration).toBeNull();
    expect(internals.store.listRuns(fork.id).find(run => run.prompt === "first")?.imageGeneration).toEqual(selection);
  });
  it("rejects a working directory outside the selected project before provider startup", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    expect(() => scheduler.startRun({
      providerId: "codex-native",
      permissionProfile: "edit",
      cwd: "../outside",
      prompt: "test",
      contexts: []
    })).toThrow("工作目录超出项目范围");
  });

  it("rejects attachment context paths outside the selected project before provider startup", () => {
    const root = createRoot();
    const outside = path.join(path.dirname(root), "outside.txt");
    const scheduler = new RunScheduler(root, () => undefined);
    expect(() => scheduler.startRun({
      providerId: "codex-native",
      permissionProfile: "edit",
      cwd: ".",
      prompt: "test",
      contexts: [{ id: "file:outside", kind: "file", label: "outside.txt", path: outside }]
    })).toThrow("上下文文件超出项目目录");
  });

  it("allows generic Workspace cwd and contexts inside app-managed projects for reads", async () => {
    const root = createRoot();
    const projectsRoot = path.join(root, "projects");
    fs.mkdirSync(path.join(projectsRoot, "Research", "materials"), { recursive: true });
    fs.writeFileSync(path.join(projectsRoot, "Research", "materials", "note.md"), "private");
    const scheduler = new RunScheduler(root, () => undefined, undefined, createRoot(), root, 1, projectsRoot);
    const provider: ProviderCapabilities = {
      id: "claude-native", provider: "claude", label: "Claude Code", runtime: "native",
      available: true, version: "test", supportsApprovals: true, supportsResume: true,
      supportsImages: true, diagnostic: null
    };
    const internals = schedulerInternals(scheduler);
    internals.registry.detect = () => [provider];
    internals.adapters.claude.run = async (context) => {
      await context.emit("assistant-message", { text: "readable", phase: "final" });
    };

    const { session, run } = scheduler.startRun({
      providerId: "claude-native",
      permissionProfile: "edit",
      cwd: "projects/Research",
      prompt: "test",
      contexts: [{
        id: "project-note",
        kind: "file",
        label: "note.md",
        path: "projects/Research/materials/note.md"
      }]
    });

    expect(session.cwd).toBe(path.join("projects", "Research"));
    expect(run.contexts[0].path).toBe(path.join("projects", "Research", "materials", "note.md"));
    await waitUntil(() => scheduler.snapshot().runs.find((item) => item.id === run.id)?.status === "completed");
  });

  it("rejects invalid slash commands before creating a provider run", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    expect(() => scheduler.startRun({
      providerId: "codex-native",
      permissionProfile: "edit",
      cwd: ".",
      prompt: "/search",
      contexts: []
    })).toThrow("缺少必要参数");
    expect(() => scheduler.startRun({
      providerId: "codex-native",
      permissionProfile: "edit",
      cwd: ".",
      prompt: "/not-a-command value",
      contexts: []
    })).toThrow("未知命令");
  });
});

describe("RunScheduler Project Task scope", () => {
  const claudeProvider: ProviderCapabilities = {
    id: "claude-native", provider: "claude", label: "Claude Code", runtime: "native",
    available: true, version: "test", supportsApprovals: true, supportsResume: true,
    supportsImages: true, diagnostic: null
  };

  function projectScheduler(providerId = "claude-native") {
    const workspace = createRoot();
    const stateRoot = createRoot();
    const contentRoot = createRoot();
    vi.stubEnv("OPENMIND_USER_DATA_DIR", stateRoot);
    const projects = new ProjectService(contentRoot, { stateRoot });
    const project = projects.createProject({ name: "AI安全", description: "" }).project;
    const task = projects.createProjectTask(project.name, "Project task", providerId);
    const projectsRoot = projects.paths.projectsRoot;
    const projectRoot = projects.resolveProjectRoot(project.name);
    return {
      workspace,
      stateRoot,
      projectsRoot,
      projectRoot,
      contentRoot,
      project,
      task,
      scheduler: new RunScheduler(workspace, () => undefined, undefined, stateRoot, contentRoot, 1, projectsRoot)
    };
  }

  it.each([
    ["claude", false], ["claude", true], ["codex", false], ["codex", true]
  ] as const)("automatically discovers enabled Skills without a slash command for %s Project=%s and refreshes on continuation", async (provider, projectScoped) => {
    const fixture = projectScheduler(`${provider}-native`);
    const paths = buildAppPaths(fixture.stateRoot, path.join(fixture.contentRoot, ".agent", "skills"));
    ensureAppPaths(paths);
    const packages = new SkillPackageService(paths);
    const source = path.join(createRoot(), "skill");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "SKILL.md"), "---\nname: browser-skill\ndescription: Read logged-in browser pages\n---\n# BrowserSkill\nUse bsk for this task.\n");
    const installed = packages.install(source);
    const internals = schedulerInternals(fixture.scheduler);
    const selectedProvider = { ...claudeProvider, provider, id: `${provider}-native` };
    internals.registry.detect = () => [selectedProvider];
    let expectedEnabled = true;
    let observedCatalog = false;
    internals.adapters[provider] = {
      run: async (context) => {
        expect(context.skillInvocation).toBeNull();
        expect(context.skillCatalog?.map((entry) => entry.id)).toEqual(expectedEnabled ? ["browser-skill"] : []);
        if (expectedEnabled) {
          const entry = context.skillCatalog![0];
          expect(entry.description).toBe("Read logged-in browser pages");
          expect(fs.readFileSync(entry.skillPath, "utf8")).toContain("Use bsk for this task.");
        }
        observedCatalog = true;
        await context.emit("assistant-message", { text: "done", phase: "final" });
      }
    };
    const first = projectScoped
      ? fixture.scheduler.startProjectRun({ projectRoot: fixture.projectRoot, projectId: fixture.project.id, projectName: fixture.project.name, taskId: fixture.task.taskId, providerId: selectedProvider.id, prompt: "读取网页" })
      : fixture.scheduler.startRun({ providerId: selectedProvider.id, permissionProfile: "auto", cwd: ".", prompt: "读取网页", contexts: [] });
    await waitUntil(() => fixture.scheduler.snapshot().runs.find((item) => item.id === first.run.id)?.status === "completed");
    expect(observedCatalog).toBe(true);
    expect(first.session.skillSnapshot?.map((entry) => entry.definition.id)).toEqual(["browser-skill"]);
    packages.setEnabled(installed.key, installed.digest, false);
    expectedEnabled = false;
    observedCatalog = false;
    const next = projectScoped
      ? fixture.scheduler.startProjectRun({ sessionId: first.session.id, permissionProfile: first.session.permissionProfile, prompt: "继续", contexts: [] })
      : fixture.scheduler.startRun({ sessionId: first.session.id, providerId: selectedProvider.id, permissionProfile: first.session.permissionProfile, cwd: first.session.cwd, prompt: "继续", contexts: [] });
    await waitUntil(() => fixture.scheduler.snapshot().runs.find((item) => item.id === next.run.id)?.status === "completed");
    expect(observedCatalog).toBe(true);
    expect(next.session.skillSnapshot).toEqual([]);
  });

  it("persists complete final articles as Project outputs with provenance and preserves edits on retries", async () => {
    const fixture = projectScheduler();
    const internals = schedulerInternals(fixture.scheduler);
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = {
      run: async (context) => {
        await context.emit("assistant-message", { text: "~~~~openmind-artifact\n# 过程说明\n不要保存\n~~~~", phase: "commentary" });
        await context.emit("assistant-message", {
          text: "开场说明\n~~~~openmind-artifact\n# 同名文章\n\n第一篇正文\n~~~~\n~~~~openmind-artifact\n# 同名文章\n\n第二篇正文\n~~~~\n~~~~openmind-artifact\n# 未完成\n未完整正文", phase: "final"
        });
      }
    };
    const { run, session } = fixture.scheduler.startProjectRun({
      projectRoot: fixture.projectRoot, projectId: fixture.project.id, projectName: fixture.project.name,
      taskId: fixture.task.taskId, providerId: "claude-native", prompt: "写两篇文章"
    });
    await waitUntil(() => fixture.scheduler.activeProjectTaskRunCount(fixture.project.id, fixture.task.taskId) === 0);
    expect(internals.store.getRun(run.id).status).toBe("completed");
    const projects = new ProjectService(fixture.contentRoot, { stateRoot: fixture.stateRoot });
    const outputs = projects.listProjectOutputs(fixture.project.name);
    expect(outputs).toHaveLength(2);
    expect(outputs.map((output) => projects.readProjectOutput(fixture.project.name, output.relativePath).content).sort())
      .toEqual(["# 同名文章\n\n第一篇正文", "# 同名文章\n\n第二篇正文"].sort());
    const finalMessage = projects.listProjectTaskMessages(fixture.project.name, fixture.task.taskId).find((message) => message.role === "assistant")!;
    expect(outputs).toEqual(expect.arrayContaining([0, 1].map((sourceArtifactIndex) => expect.objectContaining({
      sourceTaskId: fixture.task.taskId, sourceSessionId: session.id, sourceMessageId: finalMessage.id, sourceArtifactIndex
    }))));
    projects.saveProjectOutput({ projectName: fixture.project.name, relativePath: outputs[0].relativePath, title: "编辑后的标题", content: "编辑后的正文" });
    projects.saveProjectMessageArtifacts(fixture.project.name, fixture.task.taskId, session.id, finalMessage.id);
    expect(projects.listProjectOutputs(fixture.project.name)).toHaveLength(2);
    expect(projects.readProjectOutput(fixture.project.name, outputs[0].relativePath).content).toBe("编辑后的正文");
    expect(projects.getProject(fixture.project.name).project.outputCount).toBe(2);
    expect(fs.existsSync(path.join(fixture.workspace, "outputs"))).toBe(false);
  });

  it.each(["read-only", "failed"] as const)("keeps %s article generation in chat without saving outputs", async (mode) => {
    const fixture = projectScheduler();
    const internals = schedulerInternals(fixture.scheduler);
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = {
      run: async (context) => {
        await context.emit("assistant-message", { text: "~~~~openmind-artifact\n# 文章\n正文\n~~~~", phase: "final" });
        if (mode === "failed") throw new Error("generation failed");
      }
    };
    const { run } = fixture.scheduler.startProjectRun({
      projectRoot: fixture.projectRoot, projectId: fixture.project.id, projectName: fixture.project.name,
      taskId: fixture.task.taskId, providerId: "claude-native", prompt: "写文章",
      permissionProfile: mode === "read-only" ? "read-only" : "auto"
    });
    await waitUntil(() => fixture.scheduler.activeProjectTaskRunCount(fixture.project.id, fixture.task.taskId) === 0);
    expect(internals.store.getRun(run.id).status).toBe(mode === "failed" ? "failed" : "completed");
    const projects = new ProjectService(fixture.contentRoot, { stateRoot: fixture.stateRoot });
    expect(projects.listProjectOutputs(fixture.project.name)).toEqual([]);
    expect(projects.listProjectTaskMessages(fixture.project.name, fixture.task.taskId).at(-1)?.content).toContain("正文");
  });

  it("retains the final answer and reports a Project output write failure", async () => {
    const fixture = projectScheduler();
    const internals = schedulerInternals(fixture.scheduler);
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = {
      run: async (context) => { await context.emit("assistant-message", { text: "~~~~openmind-artifact\n# 文章\n正文\n~~~~", phase: "final" }); }
    };
    const save = vi.spyOn(ProjectService.prototype, "saveProjectMessageArtifacts").mockImplementation(() => { throw new Error("磁盘写入失败"); });
    try {
      const { run, session } = fixture.scheduler.startProjectRun({
        projectRoot: fixture.projectRoot, projectId: fixture.project.id, projectName: fixture.project.name,
        taskId: fixture.task.taskId, providerId: "claude-native", prompt: "写文章"
      });
      await waitUntil(() => fixture.scheduler.activeProjectTaskRunCount(fixture.project.id, fixture.task.taskId) === 0);
      expect(internals.store.getRun(run.id).status).toBe("completed");
      expect(fixture.scheduler.getEvents(session.id)).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "assistant-message", payload: expect.objectContaining({ text: expect.stringContaining("正文") }) }),
        expect.objectContaining({ kind: "system", payload: expect.objectContaining({ subtype: "project_output_save_failed", text: expect.stringContaining("磁盘写入失败") }) })
      ]));
    } finally { save.mockRestore(); }
  });

  it("defaults a trusted Project session to auto execution and continues only from its frozen identity", async () => {
    const fixture = projectScheduler();
    fs.writeFileSync(path.join(fixture.projectRoot, "materials", "report.md"), "MATERIAL_BODY_MUST_NOT_BE_AUTO_INJECTED");
    fs.writeFileSync(path.join(fixture.projectRoot, "materials", "cover.png"), "png");
    const internals = schedulerInternals(fixture.scheduler);
    internals.registry.detect = () => [claudeProvider];
    const executions: Array<{ cwd: string; openmindRoot: string; prompt: string; session: AiSession; images: ProviderRunContext["images"] }> = [];
    internals.adapters.claude = {
      run: async (context) => {
        executions.push({ cwd: context.cwd, openmindRoot: context.openmindRoot, prompt: context.prompt, session: context.session, images: context.images });
        await context.emit("assistant-message", { text: "done", phase: "final" });
      }
    };

    const first = fixture.scheduler.startProjectRun({
      projectRoot: fixture.projectRoot,
      projectId: fixture.project.id,
      projectName: fixture.project.name,
      taskId: fixture.task.taskId,
      providerId: "claude-native",
      prompt: "根据资料写报告",
      contexts: [{ id: "cover", kind: "image", label: "cover", path: "materials/cover.png", mediaType: "image/png" }]
    });
    await waitUntil(() => fixture.scheduler.snapshot().runs.find((item) => item.id === first.run.id)?.status === "completed");

    expect(first.session).toMatchObject({
      projectRoot: fs.realpathSync.native(fixture.projectRoot),
      cwd: ".",
      permissionProfile: "auto",
      scope: { type: "project-task", projectId: fixture.project.id, projectName: fixture.project.name, taskId: fixture.task.taskId }
    });
    expect(first.run).toMatchObject({ projectId: first.session.projectId, scope: first.session.scope, permissionProfile: "auto" });
    expect(executions[0].cwd).toBe(first.session.projectRoot);
    expect(executions[0].openmindRoot).toBe(fixture.contentRoot);
    expect(executions[0].images).toEqual([{ id: "cover", path: path.join(first.session.projectRoot, "materials", "cover.png"), mediaType: "image/png" }]);
    expect(executions[0].prompt).toContain("./materials");
    expect(executions[0].prompt).not.toContain("MATERIAL_BODY_MUST_NOT_BE_AUTO_INJECTED");
    expect(() => fixture.scheduler.startRun({
      sessionId: first.session.id,
      providerId: first.session.providerId,
      permissionProfile: "read-only",
      interactionMode: "default",
      cwd: ".",
      prompt: "不得绕过 Project 专用入口",
      contexts: []
    })).toThrow("必须通过专用入口");
    await expect(fixture.scheduler.forkSession(first.session.id)).rejects.toThrow("不能通过全局 AI fork");

    for (const forbiddenIdentity of [
      { projectRoot: fixture.workspace },
      { providerId: "codex-native" },
      { projectName: "other" },
      { taskId: "task-2" }
    ]) {
      expect(() => fixture.scheduler.startProjectRun({
        sessionId: first.session.id,
        prompt: "不得覆盖已冻结身份",
        ...forbiddenIdentity
      } as never)).toThrow();
    }

    // Simulate a Project Claude session id persisted by an older build. The
    // current execution must discard it and rebuild from app-private rollout
    // rather than resume ~/.claude/projects state.
    internals.store.updateSession(first.session.id, { providerSessionId: "legacy-global-claude-session" });
    const second = fixture.scheduler.startProjectRun({ sessionId: first.session.id, prompt: "继续完善" });
    await waitUntil(() => fixture.scheduler.snapshot().runs.find((item) => item.id === second.run.id)?.status === "completed");
    expect(second.session.id).toBe(first.session.id);
    expect(second.session.projectRoot).toBe(first.session.projectRoot);
    expect(second.session.providerId).toBe(first.session.providerId);
    expect(second.session.scope).toEqual(first.session.scope);
    expect(executions[1].cwd).toBe(first.session.projectRoot);
    expect(executions[1].session.providerSessionId).toBeNull();
    expect(executions[1].prompt).toContain("done");
  });

  it("counts active work only for the matching Project Task", async () => {
    const fixture = projectScheduler();
    const otherTaskId = crypto.randomUUID();
    const internals = schedulerInternals(fixture.scheduler);
    internals.registry.detect = () => [claudeProvider];
    let releaseRun!: () => void;
    const runBarrier = new Promise<void>((resolve) => { releaseRun = resolve; });
    internals.adapters.claude = {
      run: async (context) => {
        await runBarrier;
        await context.emit("assistant-message", { text: "done", phase: "final" });
      }
    };

    const { run } = fixture.scheduler.startProjectRun({
      projectRoot: fixture.projectRoot,
      projectId: fixture.project.id,
      projectName: fixture.project.name,
      taskId: fixture.task.taskId,
      providerId: "claude-native",
      prompt: "start"
    });
    await waitUntil(() => fixture.scheduler.snapshot().runs.find((item) => item.id === run.id)?.status === "running");

    expect(fixture.scheduler.activeProjectTaskRunCount(fixture.project.id, fixture.task.taskId)).toBe(1);
    expect(fixture.scheduler.activeProjectTaskRunCount(fixture.project.id, otherTaskId)).toBe(0);

    releaseRun();
    await waitUntil(() => fixture.scheduler.snapshot().runs.find((item) => item.id === run.id)?.status === "completed");
    expect(fixture.scheduler.activeProjectTaskRunCount(fixture.project.id, fixture.task.taskId)).toBe(0);
  });

  it("rejects untrusted, mismatched and symlink Project roots before provider startup", () => {
    const fixture = projectScheduler();
    const outside = createRoot();
    const alias = path.join(fixture.projectsRoot, "alias");
    fs.symlinkSync(fixture.projectRoot, alias, process.platform === "win32" ? "junction" : "dir");

    expect(() => fixture.scheduler.startProjectRun({
      projectRoot: outside,
      projectId: fixture.project.id,
      projectName: fixture.project.name,
      taskId: fixture.task.taskId,
      providerId: "claude-native",
      prompt: "unsafe"
    })).toThrow(/不匹配/);
    expect(() => fixture.scheduler.startProjectRun({
      projectRoot: fixture.projectRoot,
      projectId: fixture.project.id,
      projectName: "wrong",
      taskId: fixture.task.taskId,
      providerId: "claude-native",
      prompt: "unsafe"
    })).toThrow(/不匹配/);
    expect(() => fixture.scheduler.startProjectRun({
      projectRoot: alias,
      projectId: fixture.project.id,
      projectName: "alias",
      taskId: fixture.task.taskId,
      providerId: "claude-native",
      prompt: "unsafe"
    })).toThrow(/符号链接/);
  });

  it("prewarms a Project session at its cwd while retaining openmindRoot as the file boundary", async () => {
    const fixture = projectScheduler();
    const internals = schedulerInternals(fixture.scheduler);
    internals.registry.detect = () => [claudeProvider];
    const prewarm = vi.fn(async () => true);
    internals.adapters.claude = {
      run: async (context) => { await context.emit("assistant-message", { text: "done", phase: "final" }); }
    };
    const { session, run } = fixture.scheduler.startProjectRun({
      projectRoot: fixture.projectRoot,
      projectId: fixture.project.id,
      projectName: fixture.project.name,
      taskId: fixture.task.taskId,
      providerId: "claude-native",
      prompt: "start"
    });
    await waitUntil(() => fixture.scheduler.snapshot().runs.find((item) => item.id === run.id)?.status === "completed");
    internals.adapters.claude = { run: async () => undefined, prewarm };

    await expect(fixture.scheduler.prewarmClaude(session.id)).resolves.toBe(true);
    expect(prewarm).toHaveBeenCalledWith(expect.objectContaining({ session: expect.objectContaining({ id: session.id }), cwd: session.projectRoot, openmindRoot: fixture.contentRoot }));
    expect(prewarm.mock.calls[0][0].cwd).not.toBe(fixture.workspace);
  });
});

describe("RunScheduler 会话/运行管理", () => {
  const claudeProvider: ProviderCapabilities = {
    id: "claude-native", provider: "claude", label: "Claude Code", runtime: "native",
    available: true, version: "test", supportsApprovals: true, supportsResume: true,
    supportsImages: true, diagnostic: null
  };

  it("forkSession:有活跃 run 时抛错", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = { run: async () => undefined };
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "T", permissionProfile: "edit", scope: workspaceScope });
    const run = internals.store.createRun(session, "p", []);
    internals.store.updateRun(run.id, { status: "running" });
    await expect(scheduler.forkSession(session.id)).rejects.toThrow("Cannot fork");
  });

  it("forkSession:成功返回新 session", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = { run: async () => undefined };
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "T", permissionProfile: "edit", scope: workspaceScope });
    const fork = await scheduler.forkSession(session.id);
    expect(fork.id).not.toBe(session.id);
    expect(fork.providerId).toBe("claude-native");
  });

  it("cancelRun:不存在的 run 返回 false", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    await expect(scheduler.cancelRun("nonexistent")).resolves.toBe(false);
  });

  it("cancelRun:排队中的 run 被取消返回 true", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = { run: async () => undefined };
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "T", permissionProfile: "edit", scope: workspaceScope });
    // 用 startRun 创建一个排队的 run(adapter run 不 resolve 让它卡在 active)
    // 但更简单:直接造一个 queued run
    const run = internals.store.createRun(session, "p", []);
    internals.store.updateRun(run.id, { status: "queued" });
    // 模拟 queue 入队
    const queueInternals = scheduler as unknown as { queue: string[] };
    queueInternals.queue.push(run.id);
    const result = await scheduler.cancelRun(run.id);
    expect(result).toBe(true);
    expect(scheduler.snapshot().runs.find((r) => r.id === run.id)?.status).toBe("cancelled");
  });

  it("resolveApproval:不存在的 approval 返回 false", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    await expect(scheduler.resolveApproval("nonexistent", "accept")).resolves.toBe(false);
  });

  it("updateSession 更新标题并 publish", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    internals.adapters.claude = { run: async () => undefined };
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "旧标题", permissionProfile: "edit", scope: workspaceScope });
    const updated = scheduler.updateSession(session.id, { title: "新标题" });
    expect(updated.title).toBe("新标题");
    expect(scheduler.snapshot().sessions.find((s) => s.id === session.id)?.title).toBe("新标题");
  });

  it("fresh session freezes the current Skill catalog", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const snapshot = sessionSkillSnapshot();
    const captureSessionSnapshot = vi.fn(() => snapshot);
    internals.skillTools.captureSessionSnapshot = captureSessionSnapshot;
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = {
      run: async (context) => { await context.emit("assistant-message", { text: "done" }); }
    };

    const { session, run } = scheduler.startRun({
      providerId: "claude-native",
      permissionProfile: "edit",
      cwd: ".",
      prompt: "start a new conversation",
      contexts: []
    });
    await waitUntil(() => scheduler.snapshot().runs.find((item) => item.id === run.id)?.status === "completed");

    expect(captureSessionSnapshot).toHaveBeenCalledWith();
    expect(internals.store.getSession(session.id).skillSnapshot).toEqual(snapshot);
  });

  it("existing session refreshes enabled Skills before its next turn", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const snapshot = sessionSkillSnapshot();
    const session = internals.store.createSession({
      provider: "claude",
      providerId: "claude-native",
      cwd: ".",
      title: "Frozen",
      permissionProfile: "edit",
      scope: workspaceScope,
      skillSnapshot: []
    });
    const listDefinitions = vi.fn(() => []);
    const captureSessionSnapshot = vi.fn(() => snapshot);
    const providerSkillBridge = vi.fn(() => null);
    internals.skillTools.listDefinitions = listDefinitions;
    internals.skillTools.captureSessionSnapshot = captureSessionSnapshot;
    internals.skillTools.providerSkillBridge = providerSkillBridge;
    internals.registry.detect = () => [claudeProvider];
    let invokedSkill = "";
    internals.adapters.claude = {
      run: async (context) => {
        invokedSkill = context.skillInvocation?.name || "";
        await context.emit("assistant-message", { text: "done" });
      }
    };

    const { run } = scheduler.startRun({
      sessionId: session.id,
      providerId: "claude-native",
      permissionProfile: "edit",
      cwd: ".",
      prompt: "/creative-writing keep the old capability",
      contexts: []
    });
    await waitUntil(() => scheduler.snapshot().runs.find((item) => item.id === run.id)?.status === "completed");

    expect(invokedSkill).toBe("creative-writing");
    expect(listDefinitions).not.toHaveBeenCalled();
    expect(captureSessionSnapshot).toHaveBeenCalledWith();
    expect(providerSkillBridge).toHaveBeenCalledWith(snapshot[0]);
    expect(providerSkillBridge).toHaveBeenCalledTimes(3);
  });

  it.each([
    { provider: claudeProvider, adapter: "claude" as const },
    { provider: { ...claudeProvider, id: "codex-native", provider: "codex" as const, label: "Codex" }, adapter: "codex" as const }
  ])("does not let a rejected Installed snapshot fall back to $adapter workspace Skills", async ({ provider, adapter }) => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const session = internals.store.createSession({
      provider: provider.provider,
      providerId: provider.id,
      cwd: ".",
      title: "No legacy fallback",
      permissionProfile: "edit",
      scope: workspaceScope,
      skillSnapshot: sessionSkillSnapshot()
    });
    const adapterRun = vi.fn(async () => undefined);
    internals.adapters[adapter] = { run: adapterRun };
    internals.registry.detect = () => [provider];
    internals.skillTools.captureSessionSnapshot = () => sessionSkillSnapshot();
    internals.skillTools.providerSkillBridge = vi.fn(() => {
      throw new Error("会话 Skill 不是 Agent 类型");
    });

    const { run } = scheduler.startRun({
      sessionId: session.id,
      providerId: provider.id,
      permissionProfile: "edit",
      cwd: ".",
      prompt: "/creative-writing do not fall back",
      contexts: []
    });
    await waitUntil(() => scheduler.snapshot().runs.find((item) => item.id === run.id)?.status === "failed");

    expect(adapterRun).not.toHaveBeenCalled();
    expect(scheduler.snapshot().runs.find((item) => item.id === run.id)?.error).toContain("不是 Agent 类型");
  });

  it("scheduler startup persists the enabled catalog for legacy conversations", () => {
    const root = createRoot();
    const first = new RunScheduler(root, () => undefined);
    const firstInternals = schedulerInternals(first);
    const legacy = firstInternals.store.createSession({
      provider: "claude",
      providerId: "claude-native",
      cwd: ".",
      title: "Legacy",
      permissionProfile: "edit",
      scope: workspaceScope
    });
    const sessionFile = path.join(root, ".openmind", "ai", "sessions", legacy.id, "session.json");
    const persisted = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    delete persisted.skillSnapshot;
    fs.writeFileSync(sessionFile, JSON.stringify(persisted), "utf8");
    const snapshot = sessionSkillSnapshot();
    const capture = vi.spyOn(SkillToolRegistry.prototype, "captureSessionSnapshot")
      .mockReturnValue(snapshot);

    const restarted = new RunScheduler(root, () => undefined);

    expect(capture).toHaveBeenCalledWith();
    expect(restarted.snapshot().sessions.find((item) => item.id === legacy.id)?.skillSnapshot).toEqual(snapshot);
    expect(JSON.parse(fs.readFileSync(sessionFile, "utf8")).skillSnapshot).toEqual(snapshot);
  });

  it("scheduler startup refreshes an explicitly workspace-scoped Skill snapshot", () => {
    const root = createRoot();
    const first = new RunScheduler(root, () => undefined);
    schedulerInternals(first).store.createSession({
      provider: "claude",
      providerId: "claude-native",
      cwd: ".",
      title: "Already frozen",
      permissionProfile: "edit",
      scope: workspaceScope,
      skillSnapshot: []
    });
    const capture = vi.spyOn(SkillToolRegistry.prototype, "captureSessionSnapshot");

    new RunScheduler(root, () => undefined);

    expect(capture).toHaveBeenCalledWith();
  });

  it("startRun:provider 不可用时抛错", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    internals.registry.detect = () => [{ ...claudeProvider, available: false, diagnostic: "未安装" }];
    internals.adapters.claude = { run: async () => undefined };
    expect(() => scheduler.startRun({
      sessionId: undefined, providerId: "claude-native", permissionProfile: "edit",
      cwd: ".", prompt: "hi", contexts: []
    })).toThrow("未安装");
  });

  it("startRun:切换已锁定 provider 时抛错", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = { run: async () => undefined };
    // 先建一个 claude session
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "T", permissionProfile: "edit", scope: workspaceScope });
    // 用 codex providerId 启动同一 session → 抛"已锁定"
    const codexProvider = { ...claudeProvider, id: "codex-native", provider: "codex" as const, label: "Codex" };
    internals.registry.detect = () => [codexProvider];
    expect(() => scheduler.startRun({
      sessionId: session.id, providerId: "codex-native", permissionProfile: "edit",
      cwd: ".", prompt: "hi", contexts: []
    })).toThrow("锁定");
  });
});

describe("RunScheduler Claude prewarm", () => {
  const claudeProvider: ProviderCapabilities = {
    id: "claude-native",
    provider: "claude",
    label: "Claude Code",
    runtime: "native",
    available: true,
    version: "test",
    supportsApprovals: true,
    supportsResume: true,
    supportsImages: true,
    diagnostic: null
  };

  it("prewarms an idle Claude session without expiring it by time", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const calls: Array<{ sessionId: string | null; cwd: string; providerSessionId: string | null }> = [];
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = {
      prewarm: async (context) => {
        calls.push({ sessionId: context.session?.id || null, cwd: context.cwd, providerSessionId: context.providerSessionId });
        return true;
      },
      run: async () => undefined
    };
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "Claude", permissionProfile: "edit", scope: workspaceScope });

    await expect(scheduler.prewarmClaude(session.id)).resolves.toBe(true);

    expect(calls).toEqual([{ sessionId: session.id, cwd: root, providerSessionId: null }]);
  });

  it("does not prewarm a Claude session while a run is active", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const prewarm = vi.fn(async () => true);
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = { prewarm, run: async () => undefined };
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "Claude", permissionProfile: "edit", scope: workspaceScope });
    internals.store.createRun(session, "hello", []);

    await expect(scheduler.prewarmClaude(session.id)).resolves.toBe(false);

    expect(prewarm).not.toHaveBeenCalled();
  });

  it("captures and injects fresh turn context for every resumed Claude run", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    let providerPrompt = "";
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = {
      needsTurnContext: true,
      run: async (context) => {
        providerPrompt = context.prompt;
        await context.emit("assistant-message", { text: "done" });
      }
    };

    const { session, run } = scheduler.startRun({
      providerId: "claude-native",
      permissionProfile: "edit",
      cwd: ".",
      prompt: "总结下今天的内容",
      contexts: []
    });
    await waitUntil(() => scheduler.snapshot().runs.find((item) => item.id === run.id)?.status === "completed");

    const completed = scheduler.snapshot().runs.find((item) => item.id === run.id);
    expect(completed?.turnContext).toMatchObject({
      cwd: root,
      currentDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      timezone: expect.any(String),
      capturedAt: expect.any(String)
    });
    expect(providerPrompt).toContain(`<current_date>${completed?.turnContext?.currentDate}</current_date>`);
    expect(providerPrompt.endsWith("总结下今天的内容")).toBe(true);
    expect(scheduler.getEvents(session.id).find((event) => event.kind === "user-message")?.payload.text)
      .toBe("总结下今天的内容");
  });

  it("publishes a chunked final reply to the renderer as one canonical event", async () => {
    const root = createRoot();
    const published: unknown[] = [];
    const scheduler = new RunScheduler(root, (message) => published.push(message));
    const internals = schedulerInternals(scheduler);
    const finalText = "x".repeat(300_000);
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = {
      run: async (context) => {
        await context.emit("assistant-message", { text: finalText, phase: "final" });
      }
    };

    const { run } = scheduler.startRun({
      providerId: "claude-native",
      permissionProfile: "edit",
      cwd: ".",
      prompt: "large answer",
      contexts: []
    });
    await waitUntil(() => scheduler.snapshot().runs.find((item) => item.id === run.id)?.status === "completed");

    const liveAnswers = published
      .map((message) => message as { kind?: string; event?: AiEvent })
      .filter((message) => message.kind === "event" && message.event?.runId === run.id && message.event.kind === "assistant-message")
      .map((message) => message.event!);
    expect(liveAnswers).toHaveLength(1);
    expect(liveAnswers[0].payload.text).toBe(finalText);
    expect(liveAnswers[0].payload.chunk).toBeUndefined();
  });

  it("marks a provider protocol failure when the run ends without a final reply", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = {
      run: async (context) => {
        await context.emit("assistant-message", { text: "still working", phase: "commentary" });
        await context.emit("reasoning-summary", { text: "checked the repository" });
      }
    };

    const { session, run } = scheduler.startRun({
      providerId: "claude-native",
      permissionProfile: "edit",
      cwd: ".",
      prompt: "return no final",
      contexts: []
    });
    await waitUntil(() => scheduler.snapshot().runs.find((item) => item.id === run.id)?.status === "failed");

    const failed = scheduler.snapshot().runs.find((item) => item.id === run.id);
    expect(failed?.error).toContain("未返回最终回复");
    expect(scheduler.getEvents(session.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "error", payload: expect.objectContaining({ text: expect.stringContaining("未返回最终回复") }) }),
      expect.objectContaining({ kind: "status", payload: expect.objectContaining({ state: "failed" }) })
    ]));
  });

  it("rebuilds context from the local rollout when provider resume fails before output", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const prompts: string[] = [];
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = {
      run: async (context) => {
        prompts.push(context.prompt);
        if (prompts.length === 1) throw new Error("session not found");
        await context.emit("assistant-message", { text: "recovered" });
      }
    };
    let session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "Claude", permissionProfile: "edit", scope: workspaceScope });
    session = internals.store.updateSession(session.id, { providerSessionId: "stale-session" });
    let oldRun = internals.store.createRun(session, "old prompt", []);
    await internals.store.beginTurn(oldRun);
    await internals.store.appendEvent(oldRun, "assistant-message", { text: "old answer" });
    oldRun = internals.store.updateRun(oldRun.id, { status: "completed", completedAt: new Date().toISOString() });
    await internals.store.completeTurn(oldRun);

    const { run } = scheduler.startRun({
      sessionId: session.id,
      providerId: "claude-native",
      permissionProfile: "edit",
      cwd: ".",
      prompt: "continue",
      contexts: []
    });
    await waitUntil(() => scheduler.snapshot().runs.find((item) => item.id === run.id)?.status === "completed");

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('source="local_rollout"');
    expect(prompts[1]).toContain("old answer");
    expect(internals.store.getSession(session.id).providerSessionId).toBeNull();
  });

  it("clears legacy generic Claude session ids and rebuilds the first attempt from local rollout", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const prompts: string[] = [];
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = {
      usesExternalSession: false,
      run: async (context) => {
        prompts.push(context.prompt);
        await context.emit("assistant-message", { text: "recovered", phase: "final" });
      }
    };
    let session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "Claude", permissionProfile: "edit", scope: workspaceScope });
    session = internals.store.updateSession(session.id, { providerSessionId: "legacy-global-session" });
    let oldRun = internals.store.createRun(session, "old prompt", []);
    await internals.store.beginTurn(oldRun);
    await internals.store.appendEvent(oldRun, "assistant-message", { text: "old answer", phase: "final" });
    oldRun = internals.store.updateRun(oldRun.id, { status: "completed", completedAt: new Date().toISOString() });
    await internals.store.completeTurn(oldRun);

    const { run } = scheduler.startRun({
      sessionId: session.id,
      providerId: "claude-native",
      permissionProfile: "edit",
      cwd: ".",
      prompt: "continue",
      contexts: []
    });
    await waitUntil(() => scheduler.snapshot().runs.find((item) => item.id === run.id)?.status === "completed");

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('source="local_rollout"');
    expect(prompts[0]).toContain("old answer");
    expect(internals.store.getSession(session.id).providerSessionId).toBeNull();
  });
});

type SchedulerInternals = {
  registry: { detect(): ProviderCapabilities[] };
  adapters: {
    codex: { run: (context: ProviderRunContext) => Promise<void> };
    claude: {
      usesExternalSession?: boolean;
      prewarm?: (context: { session: { id: string } | null; cwd: string; providerSessionId: string | null }) => Promise<boolean>;
      disposeSession?: (sessionId: string) => void;
      disposeWarmSlots?: () => void;
      run: (context: ProviderRunContext) => Promise<void>;
    };
  };
  store: {
    createSession(input: { provider: "claude" | "codex"; providerId: string; cwd: string; title: string; permissionProfile: "edit"; scope: typeof workspaceScope; skillSnapshot?: AiSessionSkillSnapshotEntry[] }): AiSession;
    updateSession(sessionId: string, patch: Partial<AiSession>): AiSession;
    getSession(sessionId: string): AiSession;
    createRun(session: AiSession, prompt: string, contexts: []): AiRun;
    getRun(runId: string): AiRun;
    updateRun(runId: string, patch: Partial<AiRun>): AiRun;
    beginTurn(run: AiRun): Promise<unknown>;
    appendEvent(run: AiRun, kind: "assistant-message", payload: Record<string, unknown>): Promise<unknown>;
    completeTurn(run: AiRun): Promise<void>;
    readEvents(sessionId: string): unknown[];
    listTurns(sessionId: string, params: unknown): unknown;
    getContextState(sessionId: string): unknown;
    search(query: string): AiSession[];
    listSessions(): AiSession[];
    listRuns(sessionId?: string): AiRun[];
  };
  skillTools: {
    listDefinitions(): unknown[];
    captureSessionSnapshot(includeDisabled?: boolean): AiSessionSkillSnapshotEntry[];
    providerSkillBridge(entry: AiSessionSkillSnapshotEntry): unknown;
  };
  manualSkills: {
    startSkill(skillId: string, date?: string): boolean;
    startSource(sourceId: string, skillId: string, date?: string, url?: string, name?: string): boolean;
    stopSkill(skillId: string): Promise<boolean>;
    stopSource(sourceId: string): Promise<boolean>;
  };
  changeApplications: {
    applyChange(runId: string, patch?: string): Promise<{ applied: boolean }>;
    revertChange(runId: string, patch: string): Promise<{ applied: boolean }>;
    discardChange(runId: string, patch: string): Promise<unknown>;
    discardRun(runId: string): Promise<boolean>;
  };
};

describe("RunScheduler 公共委托方法", () => {
  it("getEvents 委托 store.readEvents", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const readEvents = vi.fn(() => []);
    internals.store.readEvents = readEvents as never;
    scheduler.getEvents("sess-1");
    expect(readEvents).toHaveBeenCalledWith("sess-1");
  });

  it("getTurns 委托 store.listTurns", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const listTurns = vi.fn(() => ({ items: [], nextCursor: null }));
    internals.store.listTurns = listTurns as never;
    scheduler.getTurns("sess-1", { limit: 10 });
    expect(listTurns).toHaveBeenCalledWith("sess-1", { limit: 10 });
  });

  it("searchSessions 委托 store.search", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const search = vi.fn(() => []);
    internals.store.search = search as never;
    scheduler.searchSessions("query");
    expect(search).toHaveBeenCalledWith("query");
  });

  it("listSkills 委托 skillTools.listDefinitions", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const listDefinitions = vi.fn(() => []);
    internals.skillTools.listDefinitions = listDefinitions as never;
    scheduler.listSkills();
    expect(listDefinitions).toHaveBeenCalled();
  });

  it("updateSession 委托 store.updateSession", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "T", permissionProfile: "edit", scope: workspaceScope });
    const updated = scheduler.updateSession(session.id, { title: "新标题" });
    expect(updated.title).toBe("新标题");
  });

  it("refreshProviders 调 registry.refresh", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    // registry.refresh 返回 providers;detect 应反映
    const providers: ProviderCapabilities[] = [{
      id: "claude-native", provider: "claude", label: "Claude", runtime: "native",
      available: true, version: "1", supportsApprovals: true, supportsResume: true,
      supportsImages: true, diagnostic: null, detectedModel: null, contextWindow: null, oneMillion: false
    }];
    const refresh = vi.fn(async () => providers);
    internals.registry = { detect: () => providers, refresh } as never;
    const disposeWarmSlots = vi.fn();
    internals.adapters.claude.disposeWarmSlots = disposeWarmSlots;
    await scheduler.refreshProviders();
    expect(disposeWarmSlots).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(true);
    expect(scheduler.snapshot().providers).toEqual(providers);
  });
});

function schedulerInternals(scheduler: RunScheduler): SchedulerInternals {
  return scheduler as unknown as SchedulerInternals;
}

function sessionSkillSnapshot(): AiSessionSkillSnapshotEntry[] {
  return [{
    definition: {
      id: "creative-writing",
      title: "Creative Writing",
      description: "Write content",
      cwd: "installed/openmind/creative-writing/1.0.0",
      command: "managed-runtime"
    },
    installed: {
      key: "openmind/creative-writing",
      version: "1.0.0",
      digest: "a".repeat(64)
    }
  }];
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for scheduler");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

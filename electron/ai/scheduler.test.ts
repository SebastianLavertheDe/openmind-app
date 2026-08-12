import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunScheduler } from "./scheduler";
import type { AiEvent, AiRun, AiSession, ProviderCapabilities } from "../../shared/contracts";
import type { ProviderRunContext } from "./providers/types";

const roots: string[] = [];

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-scheduler-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("RunScheduler input boundaries", () => {
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

describe("RunScheduler 会话/运行管理", () => {
  const claudeProvider: ProviderCapabilities = {
    id: "claude-native", provider: "claude", label: "Claude Code", runtime: "native",
    available: true, version: "test", supportsApprovals: true, supportsResume: true,
    supportsImages: true, diagnostic: null
  };

  it("deleteSession:有未完成 run 时抛错", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = { run: async () => undefined };
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "T", permissionProfile: "edit" });
    const run = internals.store.createRun(session, "p", []);
    internals.store.updateRun(run.id, { status: "running" });
    expect(() => scheduler.deleteSession(session.id)).toThrow("运行中");
  });

  it("deleteSession:无未完成 run 时返回 true 并 dispose", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const disposeSession = vi.fn();
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = { disposeSession, run: async () => undefined };
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "T", permissionProfile: "edit" });
    expect(scheduler.deleteSession(session.id)).toBe(true);
    expect(disposeSession).toHaveBeenCalledWith(session.id);
  });

  it("forkSession:有活跃 run 时抛错", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    internals.registry.detect = () => [claudeProvider];
    internals.adapters.claude = { run: async () => undefined };
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "T", permissionProfile: "edit" });
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
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "T", permissionProfile: "edit" });
    const fork = await scheduler.forkSession(session.id);
    expect(fork.id).not.toBe(session.id);
    expect(fork.providerId).toBe("claude-native");
  });

  it("rollbackTurns:无删除项时返回 false", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    internals.adapters.claude = { run: async () => undefined };
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "T", permissionProfile: "edit" });
    // 无 run → rollbackTurns 返回 false
    await expect(scheduler.rollbackTurns(session.id, 1)).resolves.toBe(false);
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
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "T", permissionProfile: "edit" });
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
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "旧标题", permissionProfile: "edit" });
    const updated = scheduler.updateSession(session.id, { title: "新标题" });
    expect(updated.title).toBe("新标题");
    expect(scheduler.snapshot().sessions.find((s) => s.id === session.id)?.title).toBe("新标题");
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
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "T", permissionProfile: "edit" });
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
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "Claude", permissionProfile: "edit" });

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
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "Claude", permissionProfile: "edit" });
    internals.store.createRun(session, "hello", []);

    await expect(scheduler.prewarmClaude(session.id)).resolves.toBe(false);

    expect(prewarm).not.toHaveBeenCalled();
  });

  it("disposes Claude prewarm state when deleting a session", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const disposeSession = vi.fn();
    internals.adapters.claude = { disposeSession, run: async () => undefined };
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "Claude", permissionProfile: "edit" });

    expect(scheduler.deleteSession(session.id)).toBe(true);

    expect(disposeSession).toHaveBeenCalledWith(session.id);
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
      expect.objectContaining({ kind: "error", payload: expect.objectContaining({ text: expect.stringContaining("未返回最终回复") }) })
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
    let session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "Claude", permissionProfile: "edit" });
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

  it("detaches stale provider history after an append-only rollback", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const disposeSession = vi.fn();
    internals.adapters.claude = { disposeSession, run: async () => undefined };
    let session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "Claude", permissionProfile: "edit" });
    session = internals.store.updateSession(session.id, { providerSessionId: "provider-history" });
    let run = internals.store.createRun(session, "remove me", []);
    await internals.store.beginTurn(run);
    run = internals.store.updateRun(run.id, { status: "completed", completedAt: new Date().toISOString() });
    await internals.store.completeTurn(run);

    await expect(scheduler.rollbackTurns(session.id, 1)).resolves.toBe(true);

    expect(internals.store.getSession(session.id).providerSessionId).toBeNull();
    expect(disposeSession).toHaveBeenCalledWith(session.id);
  });
});

type SchedulerInternals = {
  registry: { detect(): ProviderCapabilities[] };
  adapters: {
    claude: {
      prewarm?: (context: { session: { id: string } | null; cwd: string; providerSessionId: string | null }) => Promise<boolean>;
      disposeSession?: (sessionId: string) => void;
      disposeWarmSlots?: () => void;
      run: (context: ProviderRunContext) => Promise<void>;
    };
  };
  store: {
    createSession(input: { provider: "claude"; providerId: string; cwd: string; title: string; permissionProfile: "edit" }): AiSession;
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
    listRuns(): AiRun[];
  };
  skillTools: { listDefinitions(): unknown[] };
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

  it("getContextState 委托 store", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const getContextState = vi.fn(() => ({ contexts: [] }));
    internals.store.getContextState = getContextState as never;
    scheduler.getContextState("sess-1");
    expect(getContextState).toHaveBeenCalledWith("sess-1");
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

  it("startSkill 委托 manualSkills.startSkill", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const startSkill = vi.fn(() => true);
    internals.manualSkills.startSkill = startSkill;
    expect(scheduler.startSkill("rss", "20260708")).toBe(true);
    expect(startSkill).toHaveBeenCalledWith("rss", "20260708");
  });

  it("startSource 委托 manualSkills.startSource", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const startSource = vi.fn(() => true);
    internals.manualSkills.startSource = startSource;
    scheduler.startSource("src-1", "rss", "20260708", "http://x", "name");
    expect(startSource).toHaveBeenCalledWith("src-1", "rss", "20260708", "http://x", "name");
  });

  it("stopSkill / stopSource 委托 manualSkills", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const stopSkill = vi.fn(async () => true);
    const stopSource = vi.fn(async () => true);
    internals.manualSkills.stopSkill = stopSkill;
    internals.manualSkills.stopSource = stopSource;
    await scheduler.stopSkill("rss");
    await scheduler.stopSource("src-1");
    expect(stopSkill).toHaveBeenCalledWith("rss");
    expect(stopSource).toHaveBeenCalledWith("src-1");
  });

  it("updateSession 委托 store.updateSession", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "T", permissionProfile: "edit" });
    const updated = scheduler.updateSession(session.id, { title: "新标题" });
    expect(updated.title).toBe("新标题");
  });

  it("deleteSession 返回 true 并清除 session", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "T", permissionProfile: "edit" });
    expect(scheduler.deleteSession(session.id)).toBe(true);
    expect(scheduler.snapshot().sessions.find((s) => s.id === session.id)).toBeUndefined();
  });

  it("getChangeSet 返回 run 的 changeSet", () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const session = internals.store.createSession({ provider: "claude", providerId: "claude-native", cwd: ".", title: "T", permissionProfile: "edit" });
    const run = internals.store.createRun(session, "p", []);
    expect(scheduler.getChangeSet(run.id)).toBe(run.changeSet);
  });

  it("applyChange / revertChange / discardChange / discardRun 委托 changeApplications", async () => {
    const root = createRoot();
    const scheduler = new RunScheduler(root, () => undefined);
    const internals = schedulerInternals(scheduler);
    const applyChange = vi.fn(async () => ({ applied: true }));
    const revertChange = vi.fn(async () => ({ applied: true }));
    const discardChange = vi.fn(async () => null);
    const discardRun = vi.fn(async () => true);
    internals.changeApplications.applyChange = applyChange;
    internals.changeApplications.revertChange = revertChange;
    internals.changeApplications.discardChange = discardChange;
    internals.changeApplications.discardRun = discardRun;
    await scheduler.applyChange("run-1", "p1");
    await scheduler.revertChange("run-1", "p1");
    await scheduler.discardChange("run-1", "p1");
    await scheduler.discardRun("run-1");
    expect(applyChange).toHaveBeenCalledWith("run-1", "p1");
    expect(revertChange).toHaveBeenCalledWith("run-1", "p1");
    expect(discardChange).toHaveBeenCalledWith("run-1", "p1");
    expect(discardRun).toHaveBeenCalledWith("run-1");
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

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for scheduler");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

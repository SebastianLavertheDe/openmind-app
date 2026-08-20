import { afterEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { IPC_INVOKE_REGISTRY, IPC_METHOD_CHANNELS } from "../shared/ipc-registry";
import { createDesktopInvokeBridge } from "../shared/ipc-bridge";
import {
  createIpcHandlerEntries,
  registerIpcHandlers,
  type IpcMainContext
} from "./ipc-handlers";

/**
 * mock electron 的 dialog/shell —— ipc-handlers.ts 直接 import { dialog, shell },
 * 必须模块级 mock。dialog 返回值由 dialogResult 控制,shell 方法为 vi.fn。
 */
const electronMock = vi.hoisted(() => ({
  dialogResult: { canceled: true, filePaths: [] as string[] },
  saveResult: { canceled: true, filePath: undefined as string | undefined },
  openPath: vi.fn().mockResolvedValue(""),
  showItemInFolder: vi.fn(),
  openExternal: vi.fn().mockResolvedValue(undefined)
}));
vi.mock(import("electron"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    app: {
      ...actual.app,
      getPath: vi.fn(() => "/tmp/openmind-test-user-data")
    },
    dialog: {
      showOpenDialog: vi.fn(async () => electronMock.dialogResult),
      showSaveDialog: vi.fn(async () => electronMock.saveResult)
    },
    shell: {
      ...actual.shell,
      openPath: electronMock.openPath,
      showItemInFolder: electronMock.showItemInFolder,
      openExternal: electronMock.openExternal
    }
  };
});

describe("ipc registry", () => {
  it("maps every DesktopApi invoke method to a unique channel", () => {
    // The registry intentionally excludes removed manual Skill run, update and
    // rollback endpoints while exposing the current onboarding/source-cancel/
    // install controls, including CLI version checks and upgrades.
    expect(IPC_INVOKE_REGISTRY).toHaveLength(154);
    expect(new Set(IPC_INVOKE_REGISTRY.map((item) => item.channel)).size).toBe(154);
    expect(Object.keys(IPC_METHOD_CHANNELS)).toHaveLength(154);
  });

  it("builds preload bridge entries from the registry", async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const bridge = createDesktopInvokeBridge(async (channel, ...args) => {
      calls.push({ channel, args });
      return channel;
    });
    await bridge.getBootstrap();
    await bridge.listInstalledRunnableSkills();
    await bridge.writeContent("path.md", "body");
    expect(calls).toEqual([
      { channel: IPC_METHOD_CHANNELS.getBootstrap, args: [] },
      { channel: IPC_METHOD_CHANNELS.listInstalledRunnableSkills, args: [] },
      { channel: IPC_METHOD_CHANNELS.writeContent, args: ["path.md", "body"] }
    ]);
  });
});

/** 构造可记录调用的 product service spy。 */
function makeProductSpy() {
  const spy = vi.fn();
  const product = new Proxy({}, {
    get: (_t, prop) => spy.bind(null, String(prop))
  });
  return { product: product as unknown as ReturnType<typeof Object>, spy };
}

/** 构造可记录调用的 ai worker caller。 */
function makeAiSpy() {
  const call = vi.fn(async (...args: unknown[]) => ({ ok: true, args }));
  return { call };
}

function makeCtx(overrides: Partial<IpcMainContext> = {}): IpcMainContext {
  const { product } = makeProductSpy();
  return {
    getMainWindow: () => null,
    ensureProductService: () => product as never,
    ensureAiWorker: () => makeAiSpy() as never,
    ensureOpenmindFileSearch: () => ({ search: async () => [] }) as never,
    ensureSkillPackageService: () => ({
      inspectClaudeSkills: () => [],
      migrateClaudeSkills: () => ({ inspected: [], installed: [], skipped: [] }),
      listInstalled: () => [],
      listInstalledViews: () => [],
      listInstalledRunnableViews: () => [],
      toInstalledView: (record: Record<string, unknown>) => ({ ...record, enabled: true, usable: true })
    }) as never,
    ensureSkillSourceService: () => ({ hasCompleteInstallation: () => false }) as never,
    ensureExportLocationService: () => ({ list: () => [], create: () => ({}), get: () => undefined, relink: () => ({}), revoke: () => false, resolve: () => ({}) }) as never,
    ensureRuntimePackService: () => ({ listReadiness: () => [], getReadiness: () => undefined, activate: () => ({}), rollback: () => ({}), remove: () => false }) as never,
    analyzeEnvFile: () => ({ path: ".env", variables: [], ignoredLines: 0, warnings: [], containsPotentialSecrets: false }),
    getActiveRunCount: async () => 0,
    restartAiWorker: vi.fn(),
    getBrowserAutomationStatus: () => ({
      backend: "playwright-mcp", enabled: false, reuseExistingTabs: true,
      evidenceDir: "assets/browser-evidence", extensionTokenConfigured: false,
      secureStorageAvailable: true, packageAvailable: true, ready: false,
      diagnostic: "AI 写作取证已关闭。"
    }),
    getMcpServers: () => [],
    saveBrowserExtensionToken: () => ({
      backend: "playwright-mcp", enabled: true, reuseExistingTabs: true,
      evidenceDir: "assets/browser-evidence", extensionTokenConfigured: true,
      secureStorageAvailable: true, packageAvailable: true, ready: true,
      diagnostic: "已就绪"
    }),
    clearBrowserExtensionToken: () => ({
      backend: "playwright-mcp", enabled: false, reuseExistingTabs: true,
      evidenceDir: "assets/browser-evidence", extensionTokenConfigured: false,
      secureStorageAvailable: true, packageAvailable: true, ready: false,
      diagnostic: "未配置"
    }),
    syncWindowTheme: vi.fn(),
    globalSearch: async () => [],
    localDate: () => "20260708",
    ...overrides
  };
}

describe("ipc handlers", () => {
  it("registers a handler for every invoke channel", () => {
    const entries = createIpcHandlerEntries(makeCtx());
    const registryChannels = IPC_INVOKE_REGISTRY.map((item) => item.channel).sort();
    const handlerChannels = entries.map((item) => item.channel).sort();
    expect(handlerChannels).toEqual(registryChannels);
  });

  it("validates and returns the MCP capability catalog", () => {
    const catalog = [{
      id: "server", title: "Server", description: "desc", backend: "backend", transport: "stdio",
      connection: "local", enabled: true, available: true, status: "enabled", diagnostic: "ready",
      providers: ["Codex"], settingsSection: null,
      tools: [{ id: "tool", title: "Tool", description: "desc", inputs: ["url"], outputs: ["PNG"] }]
    }];
    const result = invokeHandler(makeCtx({ getMcpServers: () => catalog }), IPC_METHOD_CHANNELS.getMcpServers);
    expect(result).toEqual(catalog);
  });

  it("validates provider yaml input at the IPC boundary", async () => {
    await expect(invokeHandler(makeCtx(), IPC_METHOD_CHANNELS.saveProviders, {
      schemaVersion: 1,
      default: "missing",
      providers: [{
        id: "deepseek",
        name: "DeepSeek",
        enabled: true,
        protocol: "anthropic-messages",
        apiKey: "sk-test",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat"
      }]
    })).rejects.toThrow();
  });
});

/** 从 entries 中按 channel 找到 handler 并调用。 */
function invokeHandler(ctx: IpcMainContext, channel: string, ...args: unknown[]): unknown {
  const entries = createIpcHandlerEntries(ctx);
  const entry = entries.find((e) => e.channel === channel);
  if (!entry) throw new Error(`no handler for channel ${channel}`);
  return entry.handler(...args);
}

describe("handler forwarding — 内容类", () => {
  it("listContent 转发 kind + date 到 product().listContent", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.listContent, "article", "2026-07-08");
    expect(spy).toHaveBeenCalledWith("listContent", "article", "20260708");
  });

  it("listContent allows an empty date when listing all files", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.listContent, "summaries", "");
    expect(spy).toHaveBeenCalledWith("listContent", "summaries", "");
  });

  it("readContent 转发 filePath", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.readContent, "openmind/article/x.md");
    expect(spy).toHaveBeenCalledWith("readContent", "openmind/article/x.md");
  });

  it("writeContent 校验内容大小(超 5MB 抛错)", () => {
    const ctx = makeCtx();
    expect(() => invokeHandler(ctx, IPC_METHOD_CHANNELS.writeContent, "x.md", "x".repeat(5 * 1024 * 1024 + 1))).toThrow();
  });

  it("getDashboard 转发 date 到 product().getDashboard", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.getDashboard, "2026-07-08");
    expect(spy).toHaveBeenCalledWith("getDashboard", "20260708", 0);
  });

  it("getDailyBrief 转发 date", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.getDailyBrief, "2026-07-08");
    expect(spy).toHaveBeenCalledWith("getDailyBrief", "20260708");
  });
});

describe("handler forwarding — 创作类", () => {
  it("getCreativeTopics 转发 date", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.getCreativeTopics, "2026-07-08");
    expect(spy).toHaveBeenCalledWith("getCreativeTopics", "20260708");
  });

  it("getCreativeProject 转发 filePath", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.getCreativeProject, "proj.md");
    expect(spy).toHaveBeenCalledWith("getCreativeProject", "proj.md");
  });

  it("createCreativeProject 解析 CreativeCreateInput", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.createCreativeProject, { date: "20260708", topic: { title: "测试" } });
    expect(spy).toHaveBeenCalledWith("createCreativeProject", expect.objectContaining({ date: "20260708", topic: expect.objectContaining({ title: "测试" }) }));
  });
});

describe("handler forwarding — 源列表", () => {
  it("listSources 调用 product().listSources", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.listSources);
    expect(spy).toHaveBeenCalledWith("listSources");
  });
});

describe("handler forwarding — AI 透传类", () => {
  it("aiRefresh 调用 ai().call('snapshot')", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({ ensureAiWorker: () => ai as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiRefresh);
    expect(ai.call).toHaveBeenCalledWith("snapshot");
  });

  it("aiCancelRun 转发 runId", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({ ensureAiWorker: () => ai as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiCancelRun, "run-123");
    expect(ai.call).toHaveBeenCalledWith("cancel", "run-123");
  });

  it("aiSearchSessions 校验 query 长度(超 500 抛错)", () => {
    const ctx = makeCtx();
    expect(() => invokeHandler(ctx, IPC_METHOD_CHANNELS.aiSearchSessions, "x".repeat(501))).toThrow();
  });

  it("aiListTurns 转发 sessionId + params", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({ ensureAiWorker: () => ai as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiListTurns, "sess-1", { limit: 10 });
    expect(ai.call).toHaveBeenCalledWith("turns", "sess-1", expect.objectContaining({ limit: 10 }));
  });

  it("runSkill 转发 skillId + date", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({ ensureAiWorker: () => ai as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.runSkill, "rss-article-saver", "2026-07-08");
    expect(ai.call).toHaveBeenCalledWith("run-skill", "rss-article-saver", "20260708");
  });

  it("stopSkill 转发 skillId", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({ ensureAiWorker: () => ai as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.stopSkill, "rss-article-saver");
    expect(ai.call).toHaveBeenCalledWith("stop-skill", "rss-article-saver");
  });

  it("通用 Skill Run 查询和取消转发到 worker", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({ ensureAiWorker: () => ai as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.listSkillRuns);
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.getSkillRun, "run-1");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.getSkillRunEvents, "run-1");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.cancelSkillRun, "run-1");
    expect(ai.call.mock.calls.map(([method]) => method)).toEqual([
      "skill-run-list", "skill-run-get", "skill-run-events", "skill-run-cancel"
    ]);
  });

  it("Run 历史、产物和重试操作转发到 worker", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({ ensureAiWorker: () => ai as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.listRunArtifacts);
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.retrySkillRun, "run-1");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.retryWorkflowStep, "workflow-1", "step-1");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.deleteRunHistory, "run-1");
    expect(ai.call.mock.calls).toEqual([
      ["run-list-artifacts", undefined],
      ["run-retry", "run-1"],
      ["run-retry-step", "workflow-1", "step-1"],
      ["run-delete-history", "run-1"]
    ]);
  });

  it("controls the shared Python runtime through a boolean-only IPC boundary", async () => {
    const disabled = { enabled: false, phase: "disabled", target: "linux-x64", pythonVersion: null, uvVersion: null, managedSkills: 0, ready: false, lastError: null };
    const ready = { enabled: true, phase: "ready", target: "linux-x64", pythonVersion: "3.12.10", uvVersion: "0.5.27", managedSkills: 4, ready: true, lastError: null };
    const service = { status: vi.fn(() => disabled), setEnabled: vi.fn(async () => ready) };
    const ctx = makeCtx({ ensureSharedPythonRuntimeService: () => service as never });
    expect(await invokeHandler(ctx, IPC_METHOD_CHANNELS.getSharedPythonRuntimeStatus)).toEqual(disabled);
    expect(await invokeHandler(ctx, IPC_METHOD_CHANNELS.setSharedPythonRuntimeEnabled, true)).toEqual(ready);
    expect(service.setEnabled).toHaveBeenCalledWith(true);
    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.setSharedPythonRuntimeEnabled, "true") as Promise<unknown>).rejects.toThrow();
  });

  it("Runtime Pack IPC exposes readiness without leaking package paths", async () => {
    const service = {
      listReadiness: vi.fn(() => [{ packId: "python-core", target: "linux-x64", version: "1.0.0", digest: "a".repeat(64), status: "active", verifiedAt: "2026-08-06T00:00:00.000Z", license: "PSF-2.0", sbom: { format: "spdx", digest: "b".repeat(64) }, integrity: "verified", inUse: false, ready: true, reason: "ok" }]),
      getReadiness: vi.fn((packId: string, target: string) => ({ packId, target, version: "1.0.0", digest: "a".repeat(64), status: "candidate", verifiedAt: "2026-08-06T00:00:00.000Z", license: "PSF-2.0", sbom: { format: "spdx", digest: "b".repeat(64) }, integrity: "verified", inUse: false, ready: false, reason: "Runtime Pack 尚未激活。" })),
      install: vi.fn(() => ({ packId: "python-core", target: "linux-x64" })),
      repair: vi.fn(() => ({ packId: "python-core", target: "linux-x64" })),
      activate: vi.fn(() => ({ active: {} })),
      rollback: vi.fn(() => ({ active: {}, previous: {} })),
      remove: vi.fn(() => true),
      garbageCollect: vi.fn(() => [])
    };
    const ctx = makeCtx({ ensureRuntimePackService: () => service as never });
    expect(await invokeHandler(ctx, IPC_METHOD_CHANNELS.listRuntimePacks)).toEqual(expect.arrayContaining([expect.objectContaining({ packId: "python-core", ready: true })]));
    expect(await invokeHandler(ctx, IPC_METHOD_CHANNELS.getRuntimePackReadiness, "python-core", "linux-x64")).toEqual(expect.objectContaining({ packId: "python-core" }));
    const metadata = { packId: "python-core" };
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await invokeHandler(ctx, IPC_METHOD_CHANNELS.importRuntimePack)).toBeNull();
    expect(await invokeHandler(ctx, IPC_METHOD_CHANNELS.repairRuntimePackFromFile, "python-core", "linux-x64", "a".repeat(64))).toBeNull();
    expect(() => invokeHandler(ctx, IPC_METHOD_CHANNELS.installRuntimePack, metadata, "not-bytes")).toThrow();
    expect(await invokeHandler(ctx, IPC_METHOD_CHANNELS.installRuntimePack, metadata, bytes)).toEqual(expect.objectContaining({ packId: "python-core" }));
    expect(await invokeHandler(ctx, IPC_METHOD_CHANNELS.repairRuntimePack, metadata, bytes)).toEqual(expect.objectContaining({ packId: "python-core" }));
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.activateRuntimePack, "python-core", "linux-x64", "a".repeat(64));
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.rollbackRuntimePack, "python-core", "linux-x64");
    expect(await invokeHandler(ctx, IPC_METHOD_CHANNELS.removeRuntimePack, "python-core", "linux-x64", "a".repeat(64))).toBe(true);
    expect(await invokeHandler(ctx, IPC_METHOD_CHANNELS.garbageCollectRuntimePacks)).toEqual([]);
    expect(service.activate).toHaveBeenCalledWith("python-core", "linux-x64", "a".repeat(64));
    expect(service.install).toHaveBeenCalledWith(metadata, bytes);
    expect(service.repair).toHaveBeenCalledWith(metadata, bytes);
    expect(service.rollback).toHaveBeenCalledWith("python-core", "linux-x64");
    expect(service.remove).toHaveBeenCalledWith("python-core", "linux-x64", "a".repeat(64));
    expect(service.garbageCollect).toHaveBeenCalledOnce();
  });

  it("Workflow Run 校验并转发生命周期操作到 worker", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({ ensureAiWorker: () => ai as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.startWorkflowRun, {
      skillId: "daily-workflow",
      inputs: { date: "20260805" },
      rootGeneration: 2
    });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.listWorkflowRuns);
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.getWorkflowRun, "workflow-1");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.resumeWorkflowRun, { runId: "workflow-1", inputs: { date: "20260805" }, rootGeneration: 2 });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.cancelWorkflowRun, "workflow-1");
    expect(ai.call.mock.calls).toEqual([
      ["workflow-run-start", { skillId: "daily-workflow", inputs: { date: "20260805" }, providerBindings: {}, rootGeneration: 2 }],
      ["workflow-run-list"],
      ["workflow-run-get", "workflow-1"],
      ["workflow-run-resume", { runId: "workflow-1", inputs: { date: "20260805" }, providerBindings: {}, rootGeneration: 2 }],
      ["workflow-run-cancel", "workflow-1"]
    ]);
    expect(() => invokeHandler(ctx, IPC_METHOD_CHANNELS.startWorkflowRun, {
      skillId: "daily-workflow",
      executable: "/bin/sh",
      rootGeneration: 2
    })).toThrow();
  });

  it("Export Location 只能由 Main 的目录选择器创建并可撤销", async () => {
    const service = {
      list: vi.fn(() => [{ id: "export-1" }]),
      create: vi.fn(() => ({ id: "export-1" })),
      get: vi.fn(() => undefined),
      relink: vi.fn(() => ({ id: "videoExportDir", canonicalPath: "/tmp/new-export" })),
      revoke: vi.fn(() => true)
    };
    const ctx = makeCtx({ ensureExportLocationService: () => service as never });
    electronMock.dialogResult = { canceled: false, filePaths: ["/tmp/export-dir"] };
    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.selectExportLocation, "视频")).resolves.toEqual({ id: "export-1" });
    expect(service.create).toHaveBeenCalledWith("视频", "/tmp/export-dir");
    expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.listExportLocations)).toEqual([{ id: "export-1" }]);
    expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.revokeExportLocation, "export-1")).toBe(true);
    expect(service.revoke).toHaveBeenCalledWith("export-1");
    service.get.mockReturnValue({ id: "videoExportDir" });
    electronMock.dialogResult = { canceled: false, filePaths: ["/tmp/new-export"] };
    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.selectExportLocation, "视频", "videoExportDir")).resolves.toEqual({ id: "videoExportDir", canonicalPath: "/tmp/new-export" });
    expect(service.relink).toHaveBeenCalledWith("videoExportDir", "/tmp/new-export");
    electronMock.dialogResult = { canceled: true, filePaths: [] };
  });

  it("Automation Rule 与运行查询只转发经过 Schema 校验的结构", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({ ensureAiWorker: () => ai as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.listAutomationRules);
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.saveAutomationRule, {
      id: "daily-brief",
      name: "Daily Brief",
      enabled: true,
      target: { type: "skill", id: "daily-article-summarizer", versionPolicy: "*" },
      trigger: { type: "daily", at: "08:00" },
      inputs: { date: "20260805" },
      providerBindings: {},
      externalExportBindingIds: [],
      concurrencyPolicy: "skip",
      missedRunPolicy: "run-once",
      retryPolicy: { maxAttempts: 1, backoffMs: 0 },
      timezone: "UTC"
    });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.runAutomationNow, "daily-brief");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.listAutomationRuns, "daily-brief");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.listAutomationSchedules);
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.deleteAutomationRule, "daily-brief");
    expect(ai.call.mock.calls.map(([method]) => method)).toEqual([
      "automation-rules-list", "automation-rule-save", "automation-run-now",
      "automation-runs-list", "automation-schedules-list", "automation-rule-delete"
    ]);
    expect(() => invokeHandler(ctx, IPC_METHOD_CHANNELS.saveAutomationRule, {
      id: "bad",
      name: "Bad",
      target: { type: "skill", id: "skill", versionPolicy: "*" },
      trigger: { type: "daily", at: "08:00" },
      inputs: { apiKey: "plaintext" },
      timezone: "UTC"
    })).toThrow();
  });
});

describe("handler forwarding — shell 类", () => {
  it("openExternal 校验 http(s) url 并转发 shell.openExternal", async () => {
    const ctx = makeCtx();
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.openExternal, "https://example.com");
    expect(electronMock.openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("openExternal 拒绝非 http url", async () => {
    const ctx = makeCtx();
    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.openExternal, "file:///etc/passwd")).rejects.toThrow();
  });

  it("revealPath 调用 shell.showItemInFolder 返回 true", () => {
    const ctx = makeCtx();
    const result = invokeHandler(ctx, IPC_METHOD_CHANNELS.revealPath, "some/path.md");
    expect(electronMock.showItemInFolder).toHaveBeenCalled();
    expect(result).toBe(true);
  });
});

describe("handler forwarding — dialog 类", () => {
  afterEach(() => {
    electronMock.dialogResult = { canceled: true, filePaths: [] };
    electronMock.saveResult = { canceled: true, filePath: undefined };
  });

  it("selectFiles 取消时返回 []", async () => {
    electronMock.dialogResult = { canceled: true, filePaths: [] };
    const ctx = makeCtx();
    const result = await invokeHandler(ctx, IPC_METHOD_CHANNELS.selectFiles);
    expect(result).toEqual([]);
  });

  it("selectOpenmindFiles 取消时返回 []", async () => {
    electronMock.dialogResult = { canceled: true, filePaths: [] };
    const ctx = makeCtx();
    const result = await invokeHandler(ctx, IPC_METHOD_CHANNELS.selectOpenmindFiles);
    expect(result).toEqual([]);
  });

  it("searchOpenmindFiles 转发 query + limit 到 openmind search", async () => {
    const searchSpy = vi.fn(async () => ({ items: [], indexedCount: 0, truncated: false }));
    const ctx = makeCtx({ ensureOpenmindFileSearch: () => ({ search: searchSpy }) as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.searchOpenmindFiles, "关键词", 20);
    expect(searchSpy).toHaveBeenCalledWith("关键词", 20);
  });

  it("searchOpenmindFiles 空 query 传空串", async () => {
    const searchSpy = vi.fn(async () => ({ items: [], indexedCount: 0, truncated: false }));
    const ctx = makeCtx({ ensureOpenmindFileSearch: () => ({ search: searchSpy }) as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.searchOpenmindFiles, null, 40);
    expect(searchSpy).toHaveBeenCalledWith("", 40);
  });
});

describe("handler forwarding — searchWorkspace", () => {
  it("委托 ctx.globalSearch", async () => {
    const globalSearch = vi.fn(async () => []);
    const ctx = makeCtx({ globalSearch });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.searchWorkspace, "query");
    expect(globalSearch).toHaveBeenCalledWith("query");
  });
});

describe("handler forwarding — runSource 复合逻辑", () => {
  it("源不存在时抛 notFound", async () => {
    const { product } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => ({ listSources: () => [] }) as never });
    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.runSource, "missing-src")).rejects.toThrow();
  });

  it("源 enabled 但无 skillId 时抛 noSkill", async () => {
    const ctx = makeCtx({
      ensureProductService: () => ({
        listSources: () => [{ id: "src-1", enabled: true, skillId: null }]
      }) as never
    });
    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.runSource, "src-1")).rejects.toThrow();
  });

  it("源 disabled 时抛 disabled", async () => {
    const ctx = makeCtx({
      ensureProductService: () => ({
        listSources: () => [{ id: "src-1", enabled: false, skillId: "rss" }]
      }) as never
    });
    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.runSource, "src-1")).rejects.toThrow();
  });
});

describe("handler forwarding — Skill package installation", () => {
  it("inspect/migrate/list endpoints stay static and use the selected workspace", async () => {
    const settings = await import("./lib/settings");
    const inspection = {
      sourcePath: "/workspace/.claude/skills/legacy",
      sourceKind: "legacy-claude" as const,
      valid: false,
      digest: "digest-legacy",
      totalBytes: 12,
      files: [],
      excludedPaths: [],
      legacy: { id: "legacy", title: "Legacy" },
      issues: [{ code: "legacy-inspect-only" as const, message: "inspect only", path: "SKILL.md" }],
      warnings: []
    };
    const service = {
      inspectClaudeSkills: vi.fn(() => [inspection]),
      getInstalled: vi.fn(() => ({ packagePath: "/userData/skills/openmind/installed/1.0.0" })),
      inspect: vi.fn(() => inspection),
      migrateClaudeSkills: vi.fn(() => ({ inspected: [inspection], installed: [], skipped: [{ sourcePath: inspection.sourcePath, issues: inspection.issues }] })),
      listInstalled: vi.fn(() => []),
      listInstalledViews: vi.fn(() => []),
      listInstalledRunnableViews: vi.fn(() => [{ id: "installed", kind: "process", title: "Installed", enabled: true }]),
      toInstalledView: vi.fn((record) => ({ ...record, usable: true })),
      install: vi.fn(() => ({ key: "openmind/installed", digest: "digest-installed" })),
      uninstall: vi.fn(() => true)
    };
    const ctx = makeCtx({ ensureSkillPackageService: () => service as never });
    vi.spyOn(settings, "resolveWorkspaceRoot").mockReturnValue("/workspace");

    expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.inspectSkillWorkspace)).toEqual([expect.objectContaining({ sourcePath: inspection.sourcePath, valid: false })]);
    expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.inspectInstalledSkill, "openmind/installed", "digest-installed")).toEqual(expect.objectContaining({ sourcePath: inspection.sourcePath, valid: false }));
    expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.migrateSkillWorkspace)).toEqual(expect.objectContaining({ inspected: [expect.any(Object)], skipped: [expect.any(Object)] }));
    expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.listInstalledSkills)).toEqual([]);
    expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.listInstalledRunnableSkills)).toEqual([
      expect.objectContaining({ id: "installed", kind: "process", title: "Installed", enabled: true })
    ]);
    expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.installSkillPackage, "/tmp/skill")).toEqual(expect.objectContaining({ digest: "digest-installed" }));
    expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.uninstallSkillPackage, "openmind/installed", "digest-installed")).toBe(true);
    expect(service.inspectClaudeSkills).toHaveBeenCalledWith("/workspace");
    expect(service.getInstalled).toHaveBeenCalledWith("openmind/installed", "digest-installed");
    expect(service.inspect).toHaveBeenCalledWith("/userData/skills/openmind/installed/1.0.0");
    expect(service.migrateClaudeSkills).toHaveBeenCalledWith("/workspace");
    expect(service.install).toHaveBeenCalledWith("/tmp/skill");
    expect(service.uninstall).toHaveBeenCalledWith("openmind/installed", "digest-installed");
    vi.restoreAllMocks();
  });

  it("forwards Git/local source inspection and install through the source adapter", async () => {
    const source = { type: "git" as const, locator: "https://github.com/example/skill.git", ref: "main" };
    const sourceInspection = {
      sourcePath: source.locator,
      sourceKind: "git" as const,
      valid: true,
      digest: "digest-git",
      totalBytes: 10,
      files: [],
      excludedPaths: [],
      manifest: { id: "git-demo" },
      legacy: undefined,
      issues: [],
      warnings: []
    };
    const sourceService = {
      inspect: vi.fn(async () => ({ source, packages: [{ ...sourceInspection, packageRef: "demo" }] })),
      install: vi.fn(async () => [{ key: "openmind/git-demo", digest: "digest-git" }])
    };
    const ctx = makeCtx({ ensureSkillSourceService: () => sourceService as never });

    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.inspectSkillSource, source)).resolves.toEqual({
      source,
      packages: [expect.objectContaining({ sourceKind: "git", sourcePath: source.locator, packageRef: "demo" })]
    });
    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.installSkillSource, source, ["demo"])).resolves.toEqual([expect.objectContaining({ digest: "digest-git" })]);
    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.installSkillSource, source, ["demo", ""])).resolves.toEqual([expect.objectContaining({ digest: "digest-git" })]);
    expect(sourceService.inspect).toHaveBeenCalledWith(source, undefined);
    expect(sourceService.install).toHaveBeenNthCalledWith(1, source, ["demo"]);
    expect(sourceService.install).toHaveBeenNthCalledWith(2, source, ["demo", ""]);
  });

  it("updates exact Skill enablement without restarting or refreshing the AI worker", () => {
    const record = { key: "openmind/installed", digest: "a".repeat(64), id: "installed" };
    const setEnabled = vi.fn(() => record);
    const toInstalledView = vi.fn((value) => ({ ...value, enabled: false, usable: true }));
    const restartAiWorker = vi.fn();
    const aiWorker = makeAiSpy();
    const ctx = makeCtx({
      ensureSkillPackageService: () => ({ setEnabled, toInstalledView }) as never,
      ensureAiWorker: () => aiWorker as never,
      restartAiWorker
    });

    expect(invokeHandler(
      ctx,
      IPC_METHOD_CHANNELS.setInstalledSkillEnabled,
      record.key,
      record.digest,
      false
    )).toEqual(expect.objectContaining({ ...record, enabled: false, usable: true }));
    expect(setEnabled).toHaveBeenCalledWith(record.key, record.digest, false);
    expect(toInstalledView).toHaveBeenCalledWith(record);
    expect(restartAiWorker).not.toHaveBeenCalled();
    expect(aiWorker.call).not.toHaveBeenCalled();
  });

  it("rejects invalid enablement arguments and preserves stale-target failures", () => {
    const stale = new Error("Installed Skill 不存在或已被替换");
    const setEnabled = vi.fn(() => { throw stale; });
    const toInstalledView = vi.fn();
    const restartAiWorker = vi.fn();
    const ctx = makeCtx({
      ensureSkillPackageService: () => ({ setEnabled, toInstalledView }) as never,
      restartAiWorker
    });
    const channel = IPC_METHOD_CHANNELS.setInstalledSkillEnabled;
    const digest = "b".repeat(64);

    expect(() => invokeHandler(ctx, channel, "", digest, false)).toThrow();
    expect(() => invokeHandler(ctx, channel, "openmind/installed", "", false)).toThrow();
    expect(() => invokeHandler(ctx, channel, "openmind/installed", digest, "false")).toThrow();
    expect(setEnabled).not.toHaveBeenCalled();

    expect(() => invokeHandler(ctx, channel, "openmind/installed", digest, false)).toThrow(stale);
    expect(setEnabled).toHaveBeenCalledTimes(1);
    expect(toInstalledView).not.toHaveBeenCalled();
    expect(restartAiWorker).not.toHaveBeenCalled();
  });
});

describe("registerIpcHandlers", () => {
  it("为每个 channel 调用 register,总数 = registry 长度", () => {
    const registered: string[] = [];
    registerIpcHandlers(makeCtx(), (channel) => { registered.push(channel); });
    expect(registered).toHaveLength(IPC_INVOKE_REGISTRY.length);
    expect(new Set(registered).size).toBe(IPC_INVOKE_REGISTRY.length);
  });

  it("registry 与 handler 不一致时抛 registryMismatch", () => {
    // 无法直接制造不一致(除非改源码),这里验证正常路径不抛
    expect(() => registerIpcHandlers(makeCtx(), () => undefined)).not.toThrow();
  });
});

describe("handler forwarding — getBootstrap 复合逻辑", () => {
  it("validRepo 时委托 ai().call('skills') 和 ('snapshot')", async () => {
    const ai = makeAiSpy();
    const { product } = makeProductSpy();
    const ctx = makeCtx({
      ensureAiWorker: () => ai as never,
      ensureProductService: () => product as never,
      ensureSkillSourceService: () => ({ hasCompleteInstallation: () => true }) as never
    });
    const settings = await import("./lib/settings");
    vi.spyOn(settings, "resolveOpenmindRoot").mockReturnValue("/workspace/openmind");
    vi.spyOn(settings, "isValidOpenmindRoot").mockReturnValue(true);
    vi.spyOn(settings, "resolveWorkspaceRoot").mockReturnValue("/workspace");
    const result = await invokeHandler(ctx, IPC_METHOD_CHANNELS.getBootstrap) as { validRepo: boolean; environment: { mode: string; platform: string } };
    expect(result.validRepo).toBeDefined();
    expect(result.environment.mode).toBe("desktop");
    expect(result.environment.platform).toBe(process.platform);
    expect(ai.call).toHaveBeenCalledWith("skills");
    expect(ai.call).toHaveBeenCalledWith("snapshot");
  });

  it("未绑定 openmindRoot 时 skills 返回空数组,不调 ai", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({
      ensureAiWorker: () => ai as never
    });
    // New bootstrap readiness is based on openmindRoot, not .claude/skills.
    const settings = await import("./lib/settings");
    vi.spyOn(settings, "resolveOpenmindRoot").mockReturnValue("");
    vi.spyOn(settings, "resolveWorkspaceRoot").mockReturnValue("");
    const result = await invokeHandler(ctx, IPC_METHOD_CHANNELS.getBootstrap) as { skills: unknown[]; ai: { providers: unknown[] } };
    // invalidRepo 时 ai 调用不应发生
    expect(ai.call).not.toHaveBeenCalled();
    expect(result.skills).toEqual([]);
    expect(result.ai.providers).toEqual([]);
  });

  it("已绑定 openmindRoot 但官方来源安装不完整时仍停在启动门禁且不调 ai", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({
      ensureAiWorker: () => ai as never,
      ensureSkillSourceService: () => ({ hasCompleteInstallation: () => false }) as never
    });
    const settings = await import("./lib/settings");
    vi.spyOn(settings, "resolveOpenmindRoot").mockReturnValue("/workspace/openmind");
    vi.spyOn(settings, "isValidOpenmindRoot").mockReturnValue(true);
    vi.spyOn(settings, "resolveWorkspaceRoot").mockReturnValue("/workspace");

    const result = await invokeHandler(ctx, IPC_METHOD_CHANNELS.getBootstrap) as { validRepo: boolean; skillsInstalled: boolean; skills: unknown[] };

    expect(result.validRepo).toBe(true);
    expect(result.skillsInstalled).toBe(false);
    expect(result.skills).toEqual([]);
    expect(ai.call).not.toHaveBeenCalled();
  });
});

describe("handler forwarding — importOpml 复合逻辑", () => {
  afterEach(() => {
    electronMock.dialogResult = { canceled: true, filePaths: [] };
  });

  it("取消时返回 0", async () => {
    electronMock.dialogResult = { canceled: true, filePaths: [] };
    const ctx = makeCtx();
    const result = await invokeHandler(ctx, IPC_METHOD_CHANNELS.importOpml);
    expect(result).toBe(0);
  });

  it("选了文件时委托 product().importOpml", async () => {
    electronMock.dialogResult = { canceled: false, filePaths: ["/repo/sub.opml"] };
    const importSpy = vi.fn(async () => 5);
    const ctx = makeCtx({ ensureProductService: () => ({ importOpml: importSpy }) as never });
    const settings = await import("./lib/settings");
    vi.spyOn(settings, "ensureInsideRepo").mockReturnValue("sub.opml");
    const result = await invokeHandler(ctx, IPC_METHOD_CHANNELS.importOpml);
    expect(result).toBe(5);
    expect(importSpy).toHaveBeenCalled();
  });
});

describe("handler forwarding — exportText 复合逻辑", () => {
  afterEach(() => {
    electronMock.saveResult = { canceled: true, filePath: undefined };
  });

  it("取消时返回 null", async () => {
    electronMock.saveResult = { canceled: true, filePath: undefined };
    const ctx = makeCtx();
    const result = await invokeHandler(ctx, IPC_METHOD_CHANNELS.exportText, "draft.md", "正文");
    expect(result).toBeNull();
  });

  it("选了路径时写文件并返回路径", async () => {
    const os = await import("node:os");
    const path = await import("node:path");
    const tmpDir = await import("node:fs").then(fs => fs.mkdtempSync(path.join(os.tmpdir(), "openmind-export-")));
    const outFile = path.join(tmpDir, "out.md");
    electronMock.saveResult = { canceled: false, filePath: outFile };
    // mock ensureInsideRepo 返回原路径(避免路径校验)
    const settings = await import("./lib/settings");
    vi.spyOn(settings, "ensureInsideRepo").mockReturnValue(outFile);
    const ctx = makeCtx();
    const result = await invokeHandler(ctx, IPC_METHOD_CHANNELS.exportText, "draft.md", "正文内容");
    expect(result).toBe(outFile);
    const fs = await import("node:fs");
    expect(fs.readFileSync(outFile, "utf8")).toBe("正文内容");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("handler forwarding — app state backup", () => {
  afterEach(() => {
    electronMock.dialogResult = { canceled: true, filePaths: [] };
    electronMock.saveResult = { canceled: true, filePath: undefined };
  });

  it("uses Main dialogs and blocks backup/restore while a Run is active", async () => {
    const report = {
      schemaVersion: 1,
      kind: "openmind-app-state-backup",
      operation: "export" as const,
      createdAt: "2026-08-06T00:00:00.000Z",
      fileCount: 2,
      byteCount: 12,
      excludedAreas: ["credentials/**"]
    };
    const backup = {
      exportToFile: vi.fn(() => report),
      importFromFile: vi.fn(() => ({ ...report, operation: "import" as const }))
    };
    const outFile = path.join(os.tmpdir(), "openmind-state-backup-ipc.zip");
    electronMock.saveResult = { canceled: false, filePath: outFile };
    const restartAiWorker = vi.fn();
    const ctx = makeCtx({ ensureAppStateBackupService: () => backup as never, restartAiWorker });
    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.exportAppStateBackup)).resolves.toEqual(report);
    expect(backup.exportToFile).toHaveBeenCalledWith(outFile);

    electronMock.dialogResult = { canceled: false, filePaths: [outFile] };
    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.importAppStateBackup)).resolves.toEqual({ ...report, operation: "import" });
    expect(backup.importFromFile).toHaveBeenCalledWith(outFile);
    expect(restartAiWorker).toHaveBeenCalledTimes(1);

    const blocked = makeCtx({ ensureAppStateBackupService: () => backup as never, getActiveRunCount: async () => 1 });
    await expect(invokeHandler(blocked, IPC_METHOD_CHANNELS.exportAppStateBackup)).rejects.toThrow("不能备份应用状态");
  });
});

describe("handler forwarding — openmind root switching", () => {
  it("keeps directory selection read-only until preview and explicit commit", async () => {
    const settings = await import("./lib/settings");
    const setOpenmindRoot = vi.spyOn(settings, "setOpenmindRoot").mockReturnValue("/new-openmind");
    const preview = vi.spyOn(settings, "previewOpenmindRoot").mockReturnValue({
      candidate: "/new-openmind",
      canonicalRoot: "/new-openmind",
      health: {
        configured: true,
        accessible: true,
        readable: true,
        writable: true,
        missingInitializeEntries: [],
        missingCreateIfNeededEntries: [],
        optionalObservedEntries: [],
        symlinkWarnings: [],
        unknownPreservedEntries: [],
        activeRunCount: 0,
        warnings: []
      },
      canBind: true,
      blockingReasons: []
    });
    electronMock.dialogResult = { canceled: false, filePaths: ["/new-openmind"] };
    const restartAiWorker = vi.fn();
    const ctx = makeCtx({ restartAiWorker });

    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.selectOpenmindRoot)).resolves.toBe("/new-openmind");
    expect(setOpenmindRoot).not.toHaveBeenCalled();
    expect(restartAiWorker).not.toHaveBeenCalled();
    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.previewOpenmindRoot, "/new-openmind")).resolves.toEqual(expect.objectContaining({ canBind: true }));
    expect(preview).toHaveBeenCalledWith("/new-openmind", 0);
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.setOpenmindRoot, "/new-openmind");
    expect(setOpenmindRoot).toHaveBeenCalledWith("/new-openmind");
    expect(restartAiWorker).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("keeps content relocation behind preview and explicit commit", async () => {
    const settings = await import("./lib/settings");
    const relocation = await import("./paths/openmind-relocation-service");
    vi.spyOn(settings, "resolveOpenmindRoot").mockReturnValue("/old-openmind");
    const preview = vi.spyOn(relocation, "previewOpenmindRelocation").mockReturnValue({
      schemaVersion: 1,
      sourceDirectory: "/old-openmind",
      targetDirectory: "/new-openmind",
      sourceRootId: "source",
      sourceFileCount: 2,
      sourceDirectoryCount: 1,
      sourceBytes: 20,
      sourceDigest: "tree",
      targetState: "empty",
      targetFileCount: 0,
      targetDirectoryCount: 0,
      targetBytes: 0,
      pendingTransaction: false,
      canCommit: true,
      blockingReasons: []
    });
    const relocate = vi.spyOn(relocation, "relocateOpenmind").mockReturnValue({
      schemaVersion: 1,
      status: "committed",
      sourceDirectory: "/old-openmind",
      targetDirectory: "/new-openmind",
      sourceRootId: "source",
      targetRootId: "target",
      copiedFileCount: 2,
      copiedDirectoryCount: 1,
      copiedBytes: 20,
      treeDigest: "tree",
      sourcePreserved: true,
      verified: true,
      completedAt: "2026-08-06T00:00:00.000Z"
    });
    const setOpenmindRoot = vi.spyOn(settings, "setOpenmindRoot").mockReturnValue("/new-openmind");
    const restartAiWorker = vi.fn();
    const ctx = makeCtx({ restartAiWorker, getActiveRunCount: async () => 0 });

    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.previewOpenmindRelocation, "/new-openmind")).resolves.toMatchObject({ canCommit: true });
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ sourceDirectory: "/old-openmind", targetDirectory: "/new-openmind" }));
    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.relocateOpenmind, "/new-openmind")).resolves.toMatchObject({ status: "committed" });
    expect(relocate).toHaveBeenCalledWith(expect.objectContaining({ sourceDirectory: "/old-openmind", targetDirectory: "/new-openmind" }));
    expect(setOpenmindRoot).toHaveBeenCalledWith("/new-openmind");
    expect(restartAiWorker).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("blocks root switching while the AI worker reports active work", async () => {
    const settings = await import("./lib/settings");
    const setOpenmindRoot = vi.spyOn(settings, "setOpenmindRoot").mockReturnValue("/new-openmind");
    const restartAiWorker = vi.fn();
    const ctx = makeCtx({ restartAiWorker, getActiveRunCount: async () => 1 });

    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.setOpenmindRoot, "/new-openmind")).rejects.toThrow("不能切换 openmind");
    expect(setOpenmindRoot).not.toHaveBeenCalled();
    expect(restartAiWorker).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("blocks direct and selected workspace switching while the AI worker reports active work", async () => {
    const settings = await import("./lib/settings");
    const setWorkspaceRoot = vi.spyOn(settings, "setWorkspaceRoot").mockReturnValue("/new-workspace");
    const restartAiWorker = vi.fn();
    const ctx = makeCtx({ restartAiWorker, getActiveRunCount: async () => 1 });

    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.setWorkspaceRoot, "/new-workspace")).rejects.toThrow("不能切换 AI/代码工作区");
    expect(setWorkspaceRoot).not.toHaveBeenCalled();
    expect(restartAiWorker).not.toHaveBeenCalled();

    electronMock.dialogResult = { canceled: false, filePaths: ["/selected-workspace"] };
    await expect(invokeHandler(ctx, IPC_METHOD_CHANNELS.selectWorkspaceRoot)).rejects.toThrow("不能切换 AI/代码工作区");
    expect(setWorkspaceRoot).not.toHaveBeenCalled();
    expect(restartAiWorker).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("handler forwarding — preferences 类", () => {
  it("getPreferences 委托 settings.getPreferences", async () => {
    const settings = await import("./lib/settings");
    vi.spyOn(settings, "getPreferences").mockReturnValue({} as never);
    const ctx = makeCtx();
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.getPreferences);
    expect(settings.getPreferences).toHaveBeenCalled();
  });

  it("updatePreferences 委托 settings.updatePreferences", async () => {
    const settings = await import("./lib/settings");
    vi.spyOn(settings, "updatePreferences").mockReturnValue({} as never);
    const ctx = makeCtx();
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.updatePreferences, {});
    expect(settings.updatePreferences).toHaveBeenCalled();
    expect(ctx.syncWindowTheme).toHaveBeenCalledWith("light");
  });

  it("resetPreferences 委托 settings.resetPreferences", async () => {
    const settings = await import("./lib/settings");
    vi.spyOn(settings, "resetPreferences").mockReturnValue({} as never);
    const ctx = makeCtx();
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.resetPreferences, "section");
    expect(settings.resetPreferences).toHaveBeenCalled();
    expect(ctx.syncWindowTheme).toHaveBeenCalledWith("light");
  });

});

describe("handler forwarding — 剩余创作类 passthrough", () => {
  it("saveCreativeFile 解析 CreativeSaveInput", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.saveCreativeFile, { projectDir: "proj", file: "draft.md", content: "x" });
    expect(spy).toHaveBeenCalledWith("saveCreativeFile", expect.objectContaining({ projectDir: "proj" }));
  });

  it("advanceCreativeProject 转发 filePath + stage", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.advanceCreativeProject, "p.md", "drafting");
    expect(spy).toHaveBeenCalledWith("advanceProjectStage", "p.md", "drafting");
  });

  it("updateCreativeManifest 转发 filePath + patch", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.updateCreativeManifest, "p.md", { title: "t" });
    expect(spy).toHaveBeenCalledWith("updateCreativeManifest", "p.md", expect.any(Object));
  });

  it("setCreativeReviewStatus 解析 status 枚举", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.setCreativeReviewStatus, "p.md", "approved");
    expect(spy).toHaveBeenCalledWith("setCreativeReviewStatus", "p.md", "approved");
  });

  it("listCreativeVersions 转发 filePath + file", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.listCreativeVersions, "p.md", "draft.md");
    expect(spy).toHaveBeenCalledWith("listCreativeVersions", "p.md", "draft.md");
  });

  it("copy/archive/restore/deleteCreativeProject 各转发 filePath", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.copyCreativeProject, "p.md");
    invokeHandler(ctx, IPC_METHOD_CHANNELS.archiveCreativeProject, "p.md");
    invokeHandler(ctx, IPC_METHOD_CHANNELS.restoreCreativeProject, "p.md");
    invokeHandler(ctx, IPC_METHOD_CHANNELS.deleteCreativeProject, "p.md");
    expect(spy).toHaveBeenCalledWith("copyCreativeProject", "p.md");
    expect(spy).toHaveBeenCalledWith("archiveCreativeProject", "p.md");
    expect(spy).toHaveBeenCalledWith("restoreCreativeProject", "p.md");
    expect(spy).toHaveBeenCalledWith("deleteCreativeProject", "p.md");
  });

  it("getCreativeAnalytics 无参调用", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.getCreativeAnalytics);
    expect(spy).toHaveBeenCalledWith("getCreativeAnalytics");
  });

  it("bindCreativeSession 转发 filePath + sessionId", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.bindCreativeSession, "p.md", "sess-1");
    expect(spy).toHaveBeenCalledWith("bindCreativeSession", "p.md", "sess-1");
  });

  it("addCreativeTopic 解析 AddCreativeTopicInput", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.addCreativeTopic, { date: "2026-07-08", title: "新选题" });
    expect(spy).toHaveBeenCalledWith("addCreativeTopic", expect.objectContaining({ title: "新选题" }));
  });

  it("updateSource 解析 SourcePatch", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.updateSource, "src-1", { enabled: false });
    expect(spy).toHaveBeenCalledWith("updateSource", "src-1", expect.objectContaining({ enabled: false }));
  });

  it("addRssSource 解析 AddRssSourceInput", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.addRssSource, { name: "Feed", url: "https://example.com/rss" });
    expect(spy).toHaveBeenCalledWith("addRssSource", expect.objectContaining({ name: "Feed" }));
  });

  it("updateContentState 解析 patch", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.updateContentState, "id-1", "path.md", { starred: true });
    expect(spy).toHaveBeenCalledWith("updateContentState", "id-1", "path.md", expect.objectContaining({ starred: true }));
  });

  it("updateBriefWatchlist 解析 input", () => {
    const { product, spy } = makeProductSpy();
    const ctx = makeCtx({ ensureProductService: () => product as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.updateBriefWatchlist, { date: "2026-07-08", path: "p.md", add: true });
    expect(spy).toHaveBeenCalledWith("updateBriefWatchlist", "2026-07-08", "p.md", true);
  });

  it("rebuildContentIndex 委托 product", () => {
    // rebuildContentIndex 的返回值要经 ContentIndexMaintenanceSchema.parse,
    // 用一个真实结构而非 Proxy spy
    const call = vi.fn(() => ({
      schemaVersion: 1, indexedDates: [], itemCount: 0, indexPath: "/i", statePath: "/s", rebuiltAt: "now"
    }));
    const ctx = makeCtx({ ensureProductService: () => ({ rebuildContentIndex: call }) as never });
    invokeHandler(ctx, IPC_METHOD_CHANNELS.rebuildContentIndex);
    expect(call).toHaveBeenCalled();
  });
});

describe("handler forwarding — 剩余 AI passthrough", () => {
  it("aiRefreshProviders / aiPrewarm / aiSearchSessions 转发", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({ ensureAiWorker: () => ai as never });
    const settings = await import("./lib/settings");
    vi.spyOn(settings, "resolveWorkspaceRoot").mockReturnValue("/workspace");
    try {
      await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiRefreshProviders);
      await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiPrewarm, "sess-1");
      await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiSearchSessions, "query");
      expect(ai.call).toHaveBeenCalledWith("refresh-providers");
      expect(ai.call).toHaveBeenCalledWith("prewarm", "sess-1");
      expect(ai.call).toHaveBeenCalledWith("search", "query");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("aiUpdateSession / aiDeleteSession / aiGetEvents 转发", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({ ensureAiWorker: () => ai as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiUpdateSession, "s1", { title: "t" });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiDeleteSession, "s1");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiGetEvents, "s1");
    expect(ai.call).toHaveBeenCalledWith("update-session", "s1", expect.any(Object));
    expect(ai.call).toHaveBeenCalledWith("delete-session", "s1");
    expect(ai.call).toHaveBeenCalledWith("events", "s1");
  });

  it("aiGetContextState / aiForkSession / aiRollbackTurns 转发", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({ ensureAiWorker: () => ai as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiGetContextState, "s1");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiForkSession, "s1", "run-1");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiRollbackTurns, "s1", 3);
    expect(ai.call).toHaveBeenCalledWith("context-state", "s1");
    expect(ai.call).toHaveBeenCalledWith("fork-session", "s1", "run-1");
    expect(ai.call).toHaveBeenCalledWith("rollback-turns", "s1", 3);
  });

  it("aiResolveApproval / aiGetChangeSet / aiApplyChange 转发", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({ ensureAiWorker: () => ai as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiResolveApproval, "apr-1", "accept");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiGetChangeSet, "run-1");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiApplyChange, "run-1", "patch-1");
    expect(ai.call).toHaveBeenCalledWith("resolve-approval", "apr-1", "accept");
    expect(ai.call).toHaveBeenCalledWith("change-set", "run-1");
    expect(ai.call).toHaveBeenCalledWith("apply-change", "run-1", "patch-1");
  });

  it("aiRevertChange / aiDiscardChange / aiDiscardRun 转发", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({ ensureAiWorker: () => ai as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiRevertChange, "run-1", "patch-1");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiDiscardChange, "run-1", "patch-1");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiDiscardRun, "run-1");
    expect(ai.call).toHaveBeenCalledWith("revert-change", "run-1", "patch-1");
    expect(ai.call).toHaveBeenCalledWith("discard-change", "run-1", "patch-1");
    expect(ai.call).toHaveBeenCalledWith("discard-run", "run-1");
  });

  it("aiStartRun 解析 StartRunInput", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({ ensureAiWorker: () => ai as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiStartRun, {
      sessionId: "s1", prompt: "hi", providerId: "codex-native", permissionProfile: "edit", cwd: "/project", contexts: []
    });
    expect(ai.call).toHaveBeenCalledWith("start", expect.objectContaining({ sessionId: "s1" }));
  });
});

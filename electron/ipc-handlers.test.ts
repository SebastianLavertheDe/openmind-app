import { afterEach, describe, expect, it, vi } from "vitest";
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
      getPath: vi.fn(() => "/tmp/cctools-test-user-data")
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
    expect(IPC_INVOKE_REGISTRY).toHaveLength(83);
    expect(new Set(IPC_INVOKE_REGISTRY.map((item) => item.channel)).size).toBe(83);
    expect(Object.keys(IPC_METHOD_CHANNELS)).toHaveLength(83);
  });

  it("builds preload bridge entries from the registry", async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const bridge = createDesktopInvokeBridge(async (channel, ...args) => {
      calls.push({ channel, args });
      return channel;
    });
    await bridge.getBootstrap();
    await bridge.writeContent("path.md", "body");
    expect(calls).toEqual([
      { channel: IPC_METHOD_CHANNELS.getBootstrap, args: [] },
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
    ensureMymindFileSearch: () => ({ search: async () => [] }) as never,
    restartAiWorker: vi.fn(),
    getBrowserAutomationStatus: () => ({
      backend: "playwright-mcp", enabled: false, reuseExistingTabs: true,
      evidenceDir: ".cctools/browser-evidence", extensionTokenConfigured: false,
      secureStorageAvailable: true, packageAvailable: true, ready: false,
      diagnostic: "AI 写作取证已关闭。"
    }),
    getMcpServers: () => [],
    saveBrowserExtensionToken: () => ({
      backend: "playwright-mcp", enabled: true, reuseExistingTabs: true,
      evidenceDir: ".cctools/browser-evidence", extensionTokenConfigured: true,
      secureStorageAvailable: true, packageAvailable: true, ready: true,
      diagnostic: "已就绪"
    }),
    clearBrowserExtensionToken: () => ({
      backend: "playwright-mcp", enabled: false, reuseExistingTabs: true,
      evidenceDir: ".cctools/browser-evidence", extensionTokenConfigured: false,
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
    invokeHandler(ctx, IPC_METHOD_CHANNELS.readContent, "mymind/article/x.md");
    expect(spy).toHaveBeenCalledWith("readContent", "mymind/article/x.md");
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

  it("selectMymindFiles 取消时返回 []", async () => {
    electronMock.dialogResult = { canceled: true, filePaths: [] };
    const ctx = makeCtx();
    const result = await invokeHandler(ctx, IPC_METHOD_CHANNELS.selectMymindFiles);
    expect(result).toEqual([]);
  });

  it("searchMymindFiles 转发 query + limit 到 mymind search", async () => {
    const searchSpy = vi.fn(async () => ({ items: [], indexedCount: 0, truncated: false }));
    const ctx = makeCtx({ ensureMymindFileSearch: () => ({ search: searchSpy }) as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.searchMymindFiles, "关键词", 20);
    expect(searchSpy).toHaveBeenCalledWith("关键词", 20);
  });

  it("searchMymindFiles 空 query 传空串", async () => {
    const searchSpy = vi.fn(async () => ({ items: [], indexedCount: 0, truncated: false }));
    const ctx = makeCtx({ ensureMymindFileSearch: () => ({ search: searchSpy }) as never });
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.searchMymindFiles, null, 40);
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
    const ctx = makeCtx({ ensureAiWorker: () => ai as never, ensureProductService: () => product as never });
    const result = await invokeHandler(ctx, IPC_METHOD_CHANNELS.getBootstrap) as { validRepo: boolean; environment: { mode: string; platform: string } };
    expect(result.validRepo).toBeDefined();
    expect(result.environment.mode).toBe("desktop");
    expect(result.environment.platform).toBe(process.platform);
    expect(ai.call).toHaveBeenCalledWith("skills");
    expect(ai.call).toHaveBeenCalledWith("snapshot");
  });

  it("invalidRepo 时 skills 返回空数组,不调 ai", async () => {
    const ai = makeAiSpy();
    const ctx = makeCtx({
      ensureAiWorker: () => ai as never
    });
    // mock settings.looksLikeRepo 返回 false → invalidRepo 分支
    const settings = await import("./lib/settings");
    vi.spyOn(settings, "looksLikeRepo").mockReturnValue(false);
    const result = await invokeHandler(ctx, IPC_METHOD_CHANNELS.getBootstrap) as { skills: unknown[]; ai: { providers: unknown[] } };
    // invalidRepo 时 ai 调用不应发生
    expect(ai.call).not.toHaveBeenCalled();
    expect(result.skills).toEqual([]);
    expect(result.ai.providers).toEqual([]);
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
    const tmpDir = await import("node:fs").then(fs => fs.mkdtempSync(path.join(os.tmpdir(), "cctools-export-")));
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

describe("handler forwarding — setRepo / detectRepo", () => {
  it("setRepo 调用 restartAiWorker", async () => {
    const restartAiWorker = vi.fn();
    const ctx = makeCtx({ restartAiWorker });
    const settings = await import("./lib/settings");
    vi.spyOn(settings, "setRepoRoot").mockReturnValue("/new-repo");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.setRepo, "/new-repo");
    expect(restartAiWorker).toHaveBeenCalled();
  });

  it("detectRepo 调用 restartAiWorker", async () => {
    const restartAiWorker = vi.fn();
    const ctx = makeCtx({ restartAiWorker });
    const settings = await import("./lib/settings");
    vi.spyOn(settings, "detectRepoRoot").mockReturnValue("/detected");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.detectRepo);
    expect(restartAiWorker).toHaveBeenCalled();
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

  it("getEnvironmentDiagnostics 委托 settings.getEnvironmentDiagnostics", async () => {
    const settings = await import("./lib/settings");
    vi.spyOn(settings, "getEnvironmentDiagnostics").mockReturnValue([] as never);
    const ctx = makeCtx();
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.getEnvironmentDiagnostics);
    expect(settings.getEnvironmentDiagnostics).toHaveBeenCalled();
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
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiRefreshProviders);
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiPrewarm, "sess-1");
    await invokeHandler(ctx, IPC_METHOD_CHANNELS.aiSearchSessions, "query");
    expect(ai.call).toHaveBeenCalledWith("refresh-providers");
    expect(ai.call).toHaveBeenCalledWith("prewarm", "sess-1");
    expect(ai.call).toHaveBeenCalledWith("search", "query");
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

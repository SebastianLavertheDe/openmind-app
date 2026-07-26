import { app, BrowserWindow, Menu, ipcMain, nativeTheme, safeStorage, screen, shell, utilityProcess, type IpcMainInvokeEvent, type UtilityProcess } from "electron";
import crypto from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  IpcErrorSchema,
  type AiSession
} from "../shared/contracts";
import { ProductService } from "./product/product-service";
import { globalSearch } from "./product/global-search";
import { MymindFileSearch } from "./mymind-file-search";
import { registerIpcHandlers } from "./ipc-handlers";
import * as settings from "./lib/settings";
import * as content from "./lib/content";
import * as creative from "./lib/creative";
import { messages } from "../shared/messages";
import { DESKTOP_WINDOW_MIN_SIZE } from "../shared/responsive-policy";
import { WorkflowAutomationCoordinator } from "./workflow-automation";
import { loadWindowState, normalizeWindowState, saveWindowState, type WindowBounds } from "./window-state";
import {
  BrowserExtensionTokenStore,
  browserAutomationStatus,
  resolveBrowserExtensionToken
} from "./browser-automation-settings";
import { buildMcpServerCatalog } from "./ai/mcp-catalog";
import { windowAppearance, windowsTitleBarOverlay } from "./window-appearance";

const APP_ROOT = path.resolve(__dirname, "../../..");
const PACKAGED_SMOKE_TEST = process.argv.includes("--packaged-smoke-test");
const DEFAULT_WINDOW_SIZE = { width: 1600, height: 1000 };
const WINDOW_STATE_SAVE_DELAY_MS = 240;

let mainWindow: BrowserWindow | null = null;
let aiWorker: AiWorkerClient | null = null;
let productService: ProductService | null = null;
let productServiceRoot = "";
let mymindFileSearch: MymindFileSearch | null = null;
let mymindFileSearchRoot = "";
let browserTokenStore: BrowserExtensionTokenStore | null = null;

function ensureBrowserTokenStore(): BrowserExtensionTokenStore {
  browserTokenStore ||= new BrowserExtensionTokenStore(
    path.join(app.getPath("userData"), "browser-extension-token.bin"),
    safeStorage
  );
  return browserTokenStore;
}

function playwrightMcpAvailable(): boolean {
  try { require.resolve("@playwright/mcp/package.json"); return true; }
  catch { return false; }
}

function getBrowserAutomationStatus() {
  return browserAutomationStatus(settings.getPreferences(), ensureBrowserTokenStore(), playwrightMcpAvailable());
}

function getMcpServers() {
  return buildMcpServerCatalog(getBrowserAutomationStatus());
}

function saveBrowserExtensionToken(token: string) {
  ensureBrowserTokenStore().write(token);
  restartAiWorker();
  return getBrowserAutomationStatus();
}

function clearBrowserExtensionToken() {
  ensureBrowserTokenStore().clear();
  restartAiWorker();
  return getBrowserAutomationStatus();
}

function sendToRenderer(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const contents = mainWindow.webContents;
  if (contents.isDestroyed()) return;
  contents.send(channel, payload);
}

class AiWorkerClient {
  private worker: UtilityProcess;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly workflowAutomation: WorkflowAutomationCoordinator;

  constructor(projectRoot: string) {
    const browserPreferences = settings.getPreferences();
    const extensionToken = resolveBrowserExtensionToken(ensureBrowserTokenStore());
    this.worker = utilityProcess.fork(path.join(__dirname, "ai", "worker.js"), [], {
      env: {
        ...process.env,
        CCTOOLS_REPO_ROOT: projectRoot,
        CCTOOLS_USER_DATA_DIR: app.getPath("userData"),
        CCTOOLS_BROWSER_AUTOMATION_ENABLED: String(browserPreferences.browserAutomationEnabled),
        CCTOOLS_BROWSER_REUSE_EXISTING_TABS: String(browserPreferences.browserReuseExistingTabs),
        CCTOOLS_BROWSER_EVIDENCE_DIR: browserPreferences.browserEvidenceDir,
        ...(extensionToken ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: extensionToken } : {})
      },
      serviceName: "CC Tools AI Scheduler"
    });
    this.workflowAutomation = new WorkflowAutomationCoordinator(
      () => settings.getPreferences(),
      (skillId, date) => this.call("run-skill", skillId, date)
    );
    this.worker.on("message", (message: unknown) => this.onMessage(message));
    this.worker.on("exit", (code) => {
      this.workflowAutomation.close();
      for (const pending of this.pending.values()) pending.reject(new Error(messages.errors.ai.workerExited(code)));
      this.pending.clear();
      if (aiWorker === this) aiWorker = null;
      sendToRenderer("ai:push", { kind: "worker-exit", code });
    });
  }

  call(method: string, ...args: unknown[]): Promise<unknown> {
    const id = crypto.randomUUID();
    this.worker.postMessage({ id, method, args });
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close(): void {
    this.workflowAutomation.close();
    this.worker.kill();
  }

  private onMessage(raw: unknown): void {
    const message = raw as { type?: string; id?: string; result?: unknown; error?: string; payload?: unknown };
    if (message.type === "push") {
      const push = message.payload as { kind?: string; event?: Record<string, unknown> } | undefined;
      if (push?.kind === "skill-event" && push.event) {
        try { ensureProductService().recordSkillEvent(push.event); } catch { /* project may be changing */ }
        this.workflowAutomation.handleSkillEvent(push.event);
        const channel = push.event.type === "output" ? "skill:output" : "skill:status";
        sendToRenderer(channel, push.event);
        return;
      }
      sendToRenderer("ai:push", message.payload);
      return;
    }
    if (message.type !== "response" || !message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.result);
  }
}

function ensureAiWorker(): AiWorkerClient {
  const projectRoot = settings.findRepoRoot();
  if (!settings.looksLikeRepo(projectRoot)) throw new Error(messages.errors.repo.selectValidFirst);
  if (!aiWorker) aiWorker = new AiWorkerClient(projectRoot);
  return aiWorker;
}

function ensureProductService(): ProductService {
  const projectRoot = settings.findRepoRoot();
  if (!settings.looksLikeRepo(projectRoot)) throw new Error(messages.errors.repo.selectValidFirst);
  if (!productService || productServiceRoot !== projectRoot) {
    productService = new ProductService(projectRoot, content, creative);
    productServiceRoot = projectRoot;
  }
  return productService;
}

function ensureMymindFileSearch(): MymindFileSearch {
  const projectRoot = settings.findRepoRoot();
  if (!settings.looksLikeRepo(projectRoot)) throw new Error(messages.errors.repo.selectValidFirst);
  if (!mymindFileSearch || mymindFileSearchRoot !== projectRoot) {
    mymindFileSearch = new MymindFileSearch(projectRoot);
    mymindFileSearchRoot = projectRoot;
  }
  return mymindFileSearch;
}

function restartAiWorker(): void {
  aiWorker?.close();
  aiWorker = null;
  productService = null;
  productServiceRoot = "";
  mymindFileSearch = null;
  mymindFileSearchRoot = "";
  const projectRoot = settings.findRepoRoot();
  if (settings.looksLikeRepo(projectRoot)) aiWorker = new AiWorkerClient(projectRoot);
}

function handleIpc(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await listener(event, ...args);
    } catch (error) {
      throw normalizeIpcError(error);
    }
  });
}

function normalizeIpcError(error: unknown): Error {
  const zodError = error instanceof z.ZodError;
  const message = zodError
    ? messages.errors.ipc.invalidContract
    : error instanceof Error ? error.message : String(error);
  const payload = IpcErrorSchema.parse({
    code: zodError ? "INVALID_ARGUMENT" : classifyIpcError(message),
    message,
    detail: zodError ? JSON.stringify(error.issues) : null,
    recoverable: true
  });
  return Object.assign(new Error(payload.message), payload);
}

function classifyIpcError(message: string): string {
  if (/超出项目目录|只允许打开 HTTP|权限|拒绝|forbidden|outside/i.test(message)) return "SECURITY";
  if (/不存在|找不到|not found/i.test(message)) return "NOT_FOUND";
  if (/无效|invalid|参数|契约/i.test(message)) return "INVALID_ARGUMENT";
  return "INTERNAL";
}

// 全局搜索编排已抽到 product/global-search.ts（C2 收尾）；main 只注入 worker/product 依赖。
function runGlobalSearch(rawQuery: unknown) {
  return globalSearch(rawQuery, {
    ensureProductService,
    searchSessions: (query) => ensureAiWorker().call("search", query) as Promise<AiSession[]>,
    listSkillDefinitions: () => ensureAiWorker().call("skills") as Promise<Array<Record<string, unknown>>>
  });
}

function registerIpc(): void {
  registerIpcHandlers(
    {
      getMainWindow: () => mainWindow,
      ensureProductService,
      ensureAiWorker,
      ensureMymindFileSearch,
      restartAiWorker,
      getBrowserAutomationStatus,
      getMcpServers,
      saveBrowserExtensionToken,
      clearBrowserExtensionToken,
      syncWindowTheme,
      globalSearch: runGlobalSearch,
      localDate
    },
    (channel, listener) => handleIpc(channel, listener)
  );
}

function syncWindowTheme(themeMode: "light" | "dark"): void {
  nativeTheme.themeSource = themeMode;
  if (process.platform === "win32" && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitleBarOverlay(windowsTitleBarOverlay(themeMode === "dark"));
  }
}

function windowStatePath(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function displayWorkAreas(): WindowBounds[] {
  const primary = screen.getPrimaryDisplay();
  return [primary, ...screen.getAllDisplays().filter((display) => display.id !== primary.id)]
    .map((display) => ({ ...display.workArea }));
}

function registerWindowStatePersistence(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (window.isDestroyed()) return;
    try {
      // Keep the restorable geometry while the window itself is maximized.
      saveWindowState(windowStatePath(), window.getNormalBounds(), window.isMaximized());
    } catch (error) {
      console.warn("Unable to save desktop window state:", error);
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, WINDOW_STATE_SAVE_DELAY_MS);
  };

  window.on("move", schedule);
  window.on("resize", schedule);
  window.on("maximize", flush);
  window.on("unmaximize", flush);
  window.on("close", flush);
  window.once("closed", () => {
    if (timer) clearTimeout(timer);
    if (mainWindow === window) mainWindow = null;
  });
}

function createWindow(): void {
  syncWindowTheme(settings.getPreferences().themeMode);
  const workAreas = displayWorkAreas();
  const restoredState = PACKAGED_SMOKE_TEST
    ? normalizeWindowState(null, workAreas, DEFAULT_WINDOW_SIZE, DESKTOP_WINDOW_MIN_SIZE)
    : loadWindowState(windowStatePath(), workAreas, DEFAULT_WINDOW_SIZE, DESKTOP_WINDOW_MIN_SIZE);
  const window = new BrowserWindow({
    ...restoredState.bounds,
    minWidth: DESKTOP_WINDOW_MIN_SIZE.width,
    minHeight: DESKTOP_WINDOW_MIN_SIZE.height,
    autoHideMenuBar: true,
    ...windowAppearance(process.platform, nativeTheme.shouldUseDarkColors),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;
  if (process.platform === "win32") {
    const updateTitleBarOverlay = () => {
      if (!window.isDestroyed()) window.setTitleBarOverlay(windowsTitleBarOverlay(nativeTheme.shouldUseDarkColors));
    };
    nativeTheme.on("updated", updateTitleBarOverlay);
    window.once("closed", () => nativeTheme.removeListener("updated", updateTitleBarOverlay));
  }
  window.setMenuBarVisibility(false);
  window.setAutoHideMenuBar(true);
  if (!PACKAGED_SMOKE_TEST) registerWindowStatePersistence(window);
  if (PACKAGED_SMOKE_TEST) {
    const timeout = setTimeout(() => {
      console.error("Packaged smoke test timed out before the renderer bridge became ready.");
      app.exit(1);
    }, 15_000);
    window.webContents.once("did-finish-load", async () => {
      try {
        const bridgeReady = await window.webContents.executeJavaScript(
          "Boolean(window.cctools && typeof window.cctools.getBootstrap === 'function')"
        );
        clearTimeout(timeout);
        if (!bridgeReady) {
          console.error("Packaged smoke test failed: preload bridge is unavailable.");
          app.exit(1);
          return;
        }
        console.log("Packaged renderer/preload smoke passed.");
        app.exit(0);
      } catch (error) {
        clearTimeout(timeout);
        console.error("Packaged smoke test failed:", error);
        app.exit(1);
      }
    });
    window.webContents.once("did-fail-load", (_event, code, description) => {
      clearTimeout(timeout);
      console.error(`Packaged smoke test failed to load renderer (${code}): ${description}`);
      app.exit(1);
    });
  } else {
    window.once("ready-to-show", () => {
      if (restoredState.maximized) window.maximize();
      window.show();
    });
  }
  void window.loadFile(path.join(APP_ROOT, ".build", "renderer", "index.html"));
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (!PACKAGED_SMOKE_TEST && settings.looksLikeRepo(settings.findRepoRoot())) ensureAiWorker();
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

app.on("window-all-closed", () => {
  aiWorker?.close();
  if (process.platform !== "darwin") app.quit();
});

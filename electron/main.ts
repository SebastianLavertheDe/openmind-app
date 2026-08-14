import { app, BrowserWindow, Menu, ipcMain, nativeTheme, safeStorage, screen, shell, utilityProcess, type IpcMainInvokeEvent, type UtilityProcess } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
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
import { loadWindowState, normalizeWindowState, saveWindowState, type WindowBounds } from "./window-state";
import {
  BrowserExtensionTokenStore,
  browserAutomationStatus,
  resolveBrowserExtensionToken
} from "./browser-automation-settings";
import { buildMcpServerCatalog } from "./ai/mcp-catalog";
import { buildAiWorkerEnvironment } from "./ai/worker-environment";
import { windowAppearance, windowsTitleBarOverlay } from "./window-appearance";
import { ensureAppPaths, getAppPaths } from "./paths/app-paths-service";
import { migrateLegacyState } from "./paths/legacy-state-migration";
import { recoverPendingMymindRelocations } from "./paths/mymind-relocation-service";
import { SkillPackageService } from "./skills/skill-package-service";
import { SkillSourceService } from "./skills/skill-source-service";
import { logRedactor } from "./security/log-redactor";
import { EnvFileAnalyzer } from "./security/env-file-analyzer";
import { ExportLocationService } from "./execution/export-location-service";
import { RuntimePackService } from "./runtime/runtime-pack-service";
import { loadRuntimeTrustRoots } from "./runtime/runtime-pack-trust";
import { AppStateBackupService } from "./backup/app-state-backup";
import { RuntimePackDownloadService } from "./runtime/runtime-pack-download-service";
import { CliInstallerService, resolveNpmCliPath, type ManagedNodeRuntime } from "./install/cli-installer-service";
import { RuntimeManager } from "./runtime/runtime-manager";
import { detectRuntimeTarget } from "../shared/runtime-targets";
import { SharedPythonRuntimeService } from "./runtime/shared-python-runtime";
import { listInstalledPythonProjects } from "./runtime/installed-python-projects";
import { IPC } from "../shared/ipc-channels";

const APP_ROOT = path.resolve(__dirname, "../../..");
const PACKAGED_SMOKE_TEST = process.argv.includes("--packaged-smoke-test");
const DESKTOP_E2E_TEST = process.argv.includes("--e2e-test");
if (DESKTOP_E2E_TEST) {
  // Keep E2E state isolated from a developer's normal Electron profile.
  const e2eUserData = process.env.CCTOOLS_E2E_USER_DATA_DIR?.trim();
  if (e2eUserData) app.setPath("userData", path.resolve(e2eUserData));
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu");
}
const DEFAULT_WINDOW_SIZE = { width: 1600, height: 1000 };
const WINDOW_STATE_SAVE_DELAY_MS = 240;

let mainWindow: BrowserWindow | null = null;
let aiWorker: AiWorkerClient | null = null;
let productService: ProductService | null = null;
let productServiceRoot = "";
let mymindFileSearch: MymindFileSearch | null = null;
let mymindFileSearchRoot = "";
let skillPackageService: SkillPackageService | null = null;
let skillSourceService: SkillSourceService | null = null;
let browserTokenStore: BrowserExtensionTokenStore | null = null;
let exportLocationService: ExportLocationService | null = null;
let runtimePackService: RuntimePackService | null = null;
let runtimePackDownloadService: RuntimePackDownloadService | null = null;
let sharedPythonRuntimeService: SharedPythonRuntimeService | null = null;
let appStateBackupService: AppStateBackupService | null = null;
const envFileAnalyzer = new EnvFileAnalyzer();

function ensureRuntimePackService(): RuntimePackService {
  ensureAppPaths(getAppPaths());
  // The packaged release channel supplies this resource. Development builds
  // intentionally have no key and therefore fail closed on pack import.
  const resourcesRoot = app.isPackaged ? process.resourcesPath : path.join(APP_ROOT, "resources");
  runtimePackService ||= new RuntimePackService(
    getAppPaths(),
    loadRuntimeTrustRoots(path.join(resourcesRoot, "runtime-trust-roots.json"))
  );
  return runtimePackService;
}

function ensureRuntimePackDownloadService(): RuntimePackDownloadService {
  ensureAppPaths(getAppPaths());
  runtimePackDownloadService ||= new RuntimePackDownloadService(
    getAppPaths(),
    ensureRuntimePackService(),
    (job) => sendToRenderer(IPC.APP_RUNTIME_PACK_DOWNLOAD_EVENT, job)
  );
  return runtimePackDownloadService;
}

let cliInstallerService: CliInstallerService | null = null;

function ensureCliInstallerService(): CliInstallerService {
  ensureAppPaths(getAppPaths());
  cliInstallerService ||= new CliInstallerService(getAppPaths(), {
    resolveNodeRuntime: resolveManagedNodeRuntime,
    onProgress: (progress) => sendToRenderer(IPC.CLI_TOOL_INSTALL_EVENT, progress)
  });
  return cliInstallerService;
}

function resolveManagedNodeRuntime(): ManagedNodeRuntime | null {
  const target = detectRuntimeTarget({ platform: process.platform, arch: process.arch });
  if (!target) return null;
  try {
    const manager = new RuntimeManager(getAppPaths(), { target });
    const nodeExecutable = manager.resolveManagedPackExecutable("node-22", target, "node");
    const npmCliPath = resolveNpmCliPath(nodeExecutable);
    return npmCliPath ? { nodeExecutable, npmCliPath } : null;
  } catch {
    return null;
  }
}

function bundledPythonAssetRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "python-runtime")
    : path.join(APP_ROOT, "resources", "python-runtime");
}

function ensureSharedPythonRuntimeService(): SharedPythonRuntimeService {
  ensureAppPaths(getAppPaths());
  sharedPythonRuntimeService ||= new SharedPythonRuntimeService(getAppPaths(), {
    bundledAssetRoot: bundledPythonAssetRoot(),
    projects: () => listInstalledPythonProjects(ensureSkillPackageService())
  });
  return sharedPythonRuntimeService;
}

function ensureAppStateBackupService(): AppStateBackupService {
  ensureAppPaths(getAppPaths());
  appStateBackupService ||= new AppStateBackupService(getAppPaths());
  return appStateBackupService;
}

function analyzeEnvFile(filePath: string) {
  return envFileAnalyzer.analyze(settings.ensureInsideRepo(filePath));
}

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

  constructor(projectRoot: string, stateRoot?: string) {
    const browserPreferences = settings.getPreferences();
    const extensionToken = resolveBrowserExtensionToken(ensureBrowserTokenStore());
    this.worker = utilityProcess.fork(path.join(__dirname, "ai", "worker.js"), [], {
      env: buildAiWorkerEnvironment(process.env, {
        CCTOOLS_REPO_ROOT: projectRoot,
        CCTOOLS_USER_DATA_DIR: app.getPath("userData"),
        ...(stateRoot ? { CCTOOLS_STATE_ROOT: stateRoot } : {}),
        ...(settings.resolveMymindRoot() ? { CCTOOLS_MYMIND_ROOT: settings.resolveMymindRoot() } : {}),
        CCTOOLS_ROOT_GENERATION: String(settings.getMymindRootSnapshot()?.rootGeneration || 1),
        CCTOOLS_PYTHON_RUNTIME_ASSET_ROOT: bundledPythonAssetRoot(),
        CCTOOLS_BROWSER_AUTOMATION_ENABLED: String(browserPreferences.browserAutomationEnabled),
        CCTOOLS_BROWSER_REUSE_EXISTING_TABS: String(browserPreferences.browserReuseExistingTabs),
        CCTOOLS_BROWSER_EVIDENCE_DIR: browserPreferences.browserEvidenceDir,
        ...(extensionToken ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: extensionToken } : {})
      }),
      serviceName: "CC Tools AI Scheduler"
    });
    this.worker.on("message", (message: unknown) => this.onMessage(message));
    this.worker.on("exit", (code) => {
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

  activeRunCount(): Promise<number> {
    return this.call("active-count").then((value) => Number(value) || 0);
  }

  close(): void {
    this.worker.kill();
  }

  private onMessage(raw: unknown): void {
    const message = raw as { type?: string; id?: string; result?: unknown; error?: string; payload?: unknown };
    if (message.type === "push") {
      const push = message.payload as { kind?: string; event?: Record<string, unknown> } | undefined;
      if (push?.kind === "skill-event" && push.event) {
        try { ensureProductService().recordSkillEvent(push.event); } catch { /* project may be changing */ }
        const channel = push.event.type === "output" ? "skill:output" : "skill:status";
        sendToRenderer(channel, push.event);
        return;
      }
      if (push?.kind === "skill-run-event" && push.event) {
        sendToRenderer("skill:run-event", push.event);
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
  const projectRoot = settings.resolveWorkspaceRoot();
  if (!projectRoot) throw new Error("请先选择 AI/代码工作区。");
  if (!aiWorker) aiWorker = new AiWorkerClient(projectRoot, resolveAiStateRoot());
  return aiWorker;
}

function ensureProductService(): ProductService {
  // ADR-001: resolve the actual mymind content dir + app-private state root.
  const mymindRoot = settings.resolveMymindRoot();
  if (!mymindRoot || !settings.isValidMymindRoot(mymindRoot)) throw new Error(messages.errors.repo.selectValidFirst);
  const workspaceRoot = settings.resolveWorkspaceRoot();
  const stateRoot = path.join(getAppPaths().state, rootStateId(mymindRoot));
  ensureDir(stateRoot);
  if (workspaceRoot && settings.looksLikeRepo(workspaceRoot)) {
    migrateLegacyState({
      legacyRepoRoot: workspaceRoot,
      targetStateRoot: stateRoot,
      stagingRoot: getAppPaths().staging,
      rootId: rootStateId(mymindRoot)
    });
  }
  const cacheKey = `${workspaceRoot}\0${mymindRoot}`;
  if (!productService || productServiceRoot !== cacheKey) {
    // ProductService wires SourceRegistry/BriefService internally with the
    // optional workspace as the skill-source root and the userData state
    // root, so app-private state no longer lands inside mymind (ADR-001 §1.3).
    productService = new ProductService(mymindRoot, content, creative, {
      skillSourcesRoot: workspaceRoot || undefined,
      stateRoot
    });
    productServiceRoot = cacheKey;
  }
  return productService;
}

function ensureMymindFileSearch(): MymindFileSearch {
  const mymindRoot = settings.resolveMymindRoot();
  if (!mymindRoot || !settings.isValidMymindRoot(mymindRoot)) throw new Error(messages.errors.repo.selectValidFirst);
  if (!mymindFileSearch || mymindFileSearchRoot !== mymindRoot) {
    mymindFileSearch = new MymindFileSearch(mymindRoot, { rootKind: "mymind" });
    mymindFileSearchRoot = mymindRoot;
  }
  return mymindFileSearch;
}

function ensureSkillPackageService(): SkillPackageService {
  ensureAppPaths(getAppPaths());
  if (!skillPackageService) skillPackageService = new SkillPackageService(getAppPaths());
  return skillPackageService;
}

function ensureSkillSourceService(): SkillSourceService {
  ensureAppPaths(getAppPaths());
  if (!skillSourceService) skillSourceService = new SkillSourceService(ensureSkillPackageService(), getAppPaths());
  return skillSourceService;
}

function ensureExportLocationService(): ExportLocationService {
  ensureAppPaths(getAppPaths());
  exportLocationService ||= new ExportLocationService(
    path.join(getAppPaths().settings, "export-bindings.json"),
    () => [getAppPaths().userData, ...(settings.resolveMymindRoot() ? [settings.resolveMymindRoot()!] : [])]
  );
  return exportLocationService;
}

/** Ensure a directory exists (idempotent). */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Stable per-root state dir id (ADR-001 §5.1: userData/state/<root-id>/). */
function rootStateId(mymindRoot: string): string {
  // Cheap deterministic id; matches the resolver's computeRootId shape.
  let h = 0x811c9dc5;
  for (let i = 0; i < mymindRoot.length; i++) {
    h ^= mymindRoot.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `root-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** AI/session state is app-private and scoped to the selected content root. */
function resolveAiStateRoot(): string {
  const mymindRoot = settings.resolveMymindRoot();
  const rootId = mymindRoot && settings.isValidMymindRoot(mymindRoot) ? rootStateId(mymindRoot) : "workspace";
  const stateRoot = path.join(getAppPaths().state, rootId);
  ensureDir(stateRoot);
  return stateRoot;
}

function restartAiWorker(): void {
  aiWorker?.close();
  aiWorker = null;
  productService = null;
  productServiceRoot = "";
  mymindFileSearch = null;
  mymindFileSearchRoot = "";
  const workspaceRoot = settings.resolveWorkspaceRoot();
  if (workspaceRoot) aiWorker = new AiWorkerClient(workspaceRoot, resolveAiStateRoot());
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
  const rawMessage = zodError
    ? messages.errors.ipc.invalidContract
    : error instanceof Error ? error.message : String(error);
  const message = logRedactor.redact(rawMessage);
  const explicitCode = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? String((error as { code: string }).code)
    : null;
  const payload = IpcErrorSchema.parse({
    code: zodError ? "INVALID_ARGUMENT" : explicitCode && /^(?:git-|cancelled|platform-|runtime-|install-)/.test(explicitCode) ? explicitCode : classifyIpcError(message),
    message,
    detail: zodError ? logRedactor.redact(JSON.stringify(error.issues)) : null,
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
      ensureCliInstallerService,
      ensureSkillPackageService,
      ensureSkillSourceService,
      ensureExportLocationService,
      ensureRuntimePackService,
      ensureRuntimePackDownloadService,
      ensureSharedPythonRuntimeService,
      ensureAppStateBackupService,
      analyzeEnvFile,
      getActiveRunCount: () => aiWorker?.activeRunCount() || Promise.resolve(0),
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
  const restoredState = PACKAGED_SMOKE_TEST || DESKTOP_E2E_TEST
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
  if (!PACKAGED_SMOKE_TEST && !DESKTOP_E2E_TEST) registerWindowStatePersistence(window);
  if (DESKTOP_E2E_TEST) {
    const timeout = setTimeout(() => {
      console.error("Desktop E2E timed out before the real preload bridge became ready.");
      app.exit(1);
    }, 20_000);
    window.webContents.once("did-finish-load", () => {
      void runDesktopE2e(window, timeout);
    });
    window.webContents.once("did-fail-load", (_event, code, description) => {
      clearTimeout(timeout);
      console.error(`Desktop E2E failed to load renderer (${code}): ${description}`);
      app.exit(1);
    });
  } else if (PACKAGED_SMOKE_TEST) {
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
  if (!PACKAGED_SMOKE_TEST && !DESKTOP_E2E_TEST && settings.resolveWorkspaceRoot()) ensureAiWorker();
}

async function runDesktopE2e(window: BrowserWindow, timeout: NodeJS.Timeout): Promise<void> {
  try {
    const date = localDate();
    const result = await window.webContents.executeJavaScript(`(async () => {
      const api = window.cctools;
      if (!api || typeof api.getBootstrap !== "function") throw new Error("preload bridge is unavailable");
      const bootstrap = await api.getBootstrap();
      const preferences = await api.getPreferences();
      const articles = await api.listContent("articles", ${JSON.stringify(date)});
      const index = await api.rebuildContentIndex();
      const browser = await api.getBrowserAutomationStatus();
      return {
        documentReady: document.readyState,
        rootMounted: Boolean(document.querySelector("#root")),
        validRepo: bootstrap.validRepo,
        mymindRoot: bootstrap.mymindRoot,
        articleCount: Array.isArray(articles) ? articles.length : 0,
        indexPath: index.indexPath,
        themeMode: preferences.themeMode,
        browserStatus: browser?.state || null
      };
    })()`, true) as {
      documentReady?: string;
      rootMounted?: boolean;
      validRepo?: boolean;
      mymindRoot?: string;
      articleCount?: number;
      indexPath?: string;
    };
    if (result.documentReady !== "complete" || !result.rootMounted) throw new Error("renderer did not mount");
    if (!result.validRepo || !result.mymindRoot) throw new Error("bootstrap did not resolve the E2E mymind root");
    if (!result.articleCount || result.indexPath !== ".cctools/content-index.json") {
      throw new Error(`IPC content contract failed: ${JSON.stringify(result)}`);
    }
    clearTimeout(timeout);
    console.log(`Desktop Electron E2E passed: ${JSON.stringify(result)}`);
    app.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    console.error("Desktop Electron E2E failed:", error);
    app.exit(1);
  }
}

app.whenReady().then(() => {
  // ADR-001: ensure all app-private directories under userData exist before
  // any service reads or writes them. Idempotent.
  ensureAppPaths(getAppPaths());
  // Recover a state-restore transaction before exposing the renderer. This
  // keeps an interrupted restore from waiting until the next backup action.
  ensureAppStateBackupService();
  // Complete or safely restore an interrupted copy-only mymind relocation
  // before exposing root actions. Inconsistent user-visible content is kept
  // for diagnosis instead of being merged or overwritten automatically.
  try {
    recoverPendingMymindRelocations(getAppPaths());
  } catch (error) {
    console.error("mymind relocation recovery requires attention", error);
  }
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

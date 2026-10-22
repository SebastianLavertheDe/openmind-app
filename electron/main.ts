import { app, BrowserWindow, Menu, clipboard, ipcMain, nativeTheme, protocol, safeStorage, screen, shell, utilityProcess, type IpcMainInvokeEvent, type UtilityProcess } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  IpcErrorSchema,
  type AiSession
} from "../shared/contracts";
import { ProductService } from "./product/product-service";
import { ProjectService } from "./project/project-service";
import { createDefaultProjectMaterialConverters } from "./project/converters/project-material-converters";
import { BrowserYoutubeDownloader } from "./project/converters/youtube-downloader";
import { BilibiliSubtitleImporter } from "./project/converters/bilibili-subtitles";
import { createVideoMediaHandler } from "./project/video-media-protocol";
import { PROJECT_MEDIA_SCHEME } from "../shared/youtube-import";
import { registerYoutubeEmbedRequestPolicy } from "./project/youtube-embed-request";
import { globalSearch } from "./product/global-search";
import { OpenmindFileSearch } from "./openmind-file-search";
import { registerIpcHandlers } from "./ipc-handlers";
import * as settings from "./lib/settings";
import * as content from "./lib/content";
import * as creative from "./lib/creative";
import { getLocale, messages, setLocale, subscribeLocale } from "../shared/messages";
import { DESKTOP_WINDOW_MIN_SIZE } from "../shared/responsive-policy";
import { loadWindowState, normalizeWindowState, saveWindowState, type WindowBounds } from "./window-state";
import { browserSkillStatus, resolveBrowserSkillExecutable, installBrowserSkillPackage } from "./browser-skill";
import { buildAiWorkerEnvironment } from "./ai/worker-environment";
import { windowAppearance, windowsTitleBarOverlay } from "./window-appearance";
import { buildAppPaths, ensureAppPaths, getAppPaths, resolveSkillStoreRoot, type AppPaths } from "./paths/app-paths-service";
import { ensureClaudeAgentLink, ensureClaudeSkillAliases } from "./paths/claude-agent-link";
import { SkillPackageService } from "./skills/skill-package-service";
import { SkillSourceService } from "./skills/skill-source-service";
import { logRedactor } from "./security/log-redactor";
import { AppStateBackupService } from "./backup/app-state-backup";
import { CliInstallerService } from "./install/cli-installer-service";
import { YoutubeToolsService } from "./install/youtube-tools-service";
import { SharedPythonRuntimeService } from "./runtime/shared-python-runtime";
import { listInstalledPythonProjects } from "./runtime/installed-python-projects";
import { IPC } from "../shared/ipc-channels";
import { configureUserDataPath } from "./paths/user-data-bootstrap";
import { WechatAccountStore } from "./wechat/wechat-account-store";
import { WechatService } from "./wechat/wechat-service";

const APP_ROOT = path.resolve(__dirname, "../../..");
protocol.registerSchemesAsPrivileged([{ scheme: PROJECT_MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
const PACKAGED_SMOKE_TEST = process.argv.includes("--packaged-smoke-test");
const DESKTOP_E2E_TEST = process.argv.includes("--e2e-test");
const e2eUserData = DESKTOP_E2E_TEST
  ? process.env.OPENMIND_E2E_USER_DATA_DIR?.trim()
  : undefined;
if (e2eUserData) {
  // Keep E2E state isolated from a developer's normal Electron profile.
  app.setPath("userData", path.resolve(e2eUserData));
} else {
  configureUserDataPath(app);
}
if (DESKTOP_E2E_TEST) {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu");
}
// 1.55–1.65 的桌面工作区宽高比（1536×960 = 1.6），与四栏横向信息架构匹配；
// 首次启动在小于该尺寸的 workArea 上按比例等比缩小（见 window-state.ts）。
const DEFAULT_WINDOW_SIZE = { width: 1536, height: 960 };
const WINDOW_STATE_SAVE_DELAY_MS = 240;

let mainWindow: BrowserWindow | null = null;
let aiWorker: AiWorkerClient | null = null;
subscribeLocale(() => aiWorker?.syncLocale());
let productService: ProductService | null = null;
let productServiceRoot = "";
let projectService: ProjectService | null = null;
let projectServiceRoot = "";
let openmindFileSearch: OpenmindFileSearch | null = null;
let openmindFileSearchRoot = "";
let skillPackageService: SkillPackageService | null = null;
let skillSourceService: SkillSourceService | null = null;
// `.claude` 链接与 native alias 只依赖当前 openmind 根绑定，完成后不会因
// 后续 IPC 而变化；记住已处理过的根，避免每个 skill 类 IPC 都同步扫描整棵
// skills 目录树。根切换经 restartAiWorker() 失效。
let claudeAgentLinkEnsuredRoot: string | null = null;
let sharedPythonRuntimeService: SharedPythonRuntimeService | null = null;

let cliInstallerService: CliInstallerService | null = null;
let youtubeToolsService: YoutubeToolsService | null = null;

function ensureYoutubeToolsService(): YoutubeToolsService {
  youtubeToolsService ||= new YoutubeToolsService(getAppPaths());
  return youtubeToolsService;
}

function ensureCliInstallerService(): CliInstallerService {
  ensureAppPaths(getAppPaths());
  cliInstallerService ||= new CliInstallerService(getAppPaths(), {
    onProgress: (progress) => sendToRenderer(IPC.CLI_TOOL_INSTALL_EVENT, progress)
  });
  return cliInstallerService;
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

async function getBrowserSkillStatus() {
  return browserSkillStatus(ensureSkillPackageService(), resolveBrowserSkillExecutable(app.getPath("userData")), undefined, true);
}

function getMcpServers() {
  return [];
}

async function installBrowserSkill() {
  await installBrowserSkillPackage(ensureSkillSourceService(), ensureSkillPackageService());
  if (aiWorker) await aiWorker.call("refresh-skills");
  return getBrowserSkillStatus();
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
  private retired = false;

  constructor(projectRoot: string, stateRoot?: string) {
    const browserCli = resolveBrowserSkillExecutable(app.getPath("userData"));
    if (browserCli) void getBrowserSkillStatus().catch(() => undefined);
    this.worker = utilityProcess.fork(path.join(__dirname, "ai", "worker.js"), [], {
      env: buildAiWorkerEnvironment(process.env, {
        OPENMIND_REPO_ROOT: projectRoot,
        OPENMIND_USER_DATA_DIR: app.getPath("userData"),
        OPENMIND_UI_LANGUAGE: getLocale(),
        ...(stateRoot ? { OPENMIND_STATE_ROOT: stateRoot } : {}),
        ...(settings.resolveOpenmindRoot() ? { OPENMIND_ROOT: settings.resolveOpenmindRoot() } : {}),
        OPENMIND_ROOT_GENERATION: String(settings.getOpenmindRootSnapshot()?.rootGeneration || 1),
        OPENMIND_PYTHON_RUNTIME_ASSET_ROOT: bundledPythonAssetRoot(),
        ...(browserCli ? {
          OPENMIND_BROWSER_SKILL_CLI: browserCli,
          PATH: [path.dirname(browserCli), process.env.PATH || process.env.Path || ""].join(path.delimiter)
        } : {}),
        ...(process.env.BSK_HOME ? { BSK_HOME: process.env.BSK_HOME } : {})
      }),
      serviceName: "OpenMind AI Scheduler"
    });
    this.worker.on("message", (message: unknown) => this.onMessage(message));
    this.worker.on("exit", (code) => {
      const expectedRetirement = this.retired;
      this.retired = true;
      for (const pending of this.pending.values()) pending.reject(new Error(messages.errors.ai.workerExited(code)));
      this.pending.clear();
      if (aiWorker === this) aiWorker = null;
      // A replaced root/workspace can still have buffered exit/message events.
      // Never inject those into the Renderer state owned by the next worker.
      if (!expectedRetirement) sendToRenderer("ai:push", { kind: "worker-exit", code });
    });
  }

  call(method: string, ...args: unknown[]): Promise<unknown> {
    if (this.retired) return Promise.reject(new Error("AI Worker 已关闭。"));
    const id = crypto.randomUUID();
    this.worker.postMessage({ id, method, args, locale: getLocale() });
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  syncLocale(): void {
    if (!this.retired) this.worker.postMessage({ type: "locale", locale: getLocale() });
  }

  activeRunCount(): Promise<number> {
    return this.call("active-count").then((value) => Number(value) || 0);
  }

  close(): void {
    if (this.retired) return;
    this.retired = true;
    for (const pending of this.pending.values()) pending.reject(new Error("AI Worker 已重启。"));
    this.pending.clear();
    this.worker.kill();
  }

  private onMessage(raw: unknown): void {
    if (this.retired) return;
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
  if (aiWorker) return aiWorker;
  if (!hasRequiredStartupConfiguration()) {
    throw new Error(messages.errors.repo.selectValidFirst);
  }
  // AI file access is deliberately rooted at the selected OpenMind content
  // directory. The legacy optional code-workspace preference is not an AI
  // filesystem authority and must never widen this boundary.
  const openmindRoot = settings.resolveOpenmindRoot();
  if (!openmindRoot) throw new Error("请先绑定内容目录后再使用 AI 会话。");
  aiWorker = new AiWorkerClient(openmindRoot, resolveAiStateRoot());
  return aiWorker;
}

function ensureProductService(): ProductService {
  // ADR-001: resolve the actual openmind content dir + app-private state root.
  const openmindRoot = settings.resolveOpenmindRoot();
  if (!openmindRoot || !settings.isValidOpenmindRoot(openmindRoot)) throw new Error(messages.errors.repo.selectValidFirst);
  const stateRoot = path.join(getAppPaths().state, rootStateId(openmindRoot));
  ensureDir(stateRoot);
  const cacheKey = openmindRoot;
  if (!productService || productServiceRoot !== cacheKey) {
    // ProductService wires SourceRegistry/BriefService internally with the
    // userData state root, so app-private state no longer lands inside
    // openmind (ADR-001 §1.3). Skill-backed sources come from the installed
    // store under the root, not from any workspace scan.
    productService?.dispose();
    productService = new ProductService(openmindRoot, content, creative, { stateRoot });
    productServiceRoot = cacheKey;
  }
  return productService;
}

function ensureProjectService(): ProjectService {
  const openmindRoot = settings.resolveOpenmindRoot();
  if (!openmindRoot || !settings.isValidOpenmindRoot(openmindRoot)) throw new Error(messages.errors.repo.selectValidFirst);
  if (!projectService || projectServiceRoot !== openmindRoot) {
    projectService = new ProjectService(openmindRoot, {
      stateRoot: resolveAiStateRoot(),
      materialConverters: createDefaultProjectMaterialConverters({ video: {
        youtubeDownloader: new BrowserYoutubeDownloader({
          tempRoot: path.join(app.getPath("userData"), "tmp", "youtube-imports"),
          getBrowser: () => settings.getPreferences().youtubeBrowser,
          resolveTools: () => ensureYoutubeToolsService().resolveTools()
        }),
        bilibiliSubtitles: new BilibiliSubtitleImporter({
          tempRoot: path.join(app.getPath("userData"), "tmp", "bilibili-subtitles"),
          getYtDlp: () => ensureYoutubeToolsService().resolveTool("yt-dlp")
        })
      } })
    });
    projectServiceRoot = openmindRoot;
  }
  return projectService;
}

function ensureOpenmindFileSearch(): OpenmindFileSearch {
  const openmindRoot = settings.resolveOpenmindRoot();
  if (!openmindRoot || !settings.isValidOpenmindRoot(openmindRoot)) throw new Error(messages.errors.repo.selectValidFirst);
  if (!openmindFileSearch || openmindFileSearchRoot !== openmindRoot) {
    openmindFileSearch?.dispose();
    openmindFileSearch = new OpenmindFileSearch(openmindRoot, { rootKind: "openmind" });
    openmindFileSearchRoot = openmindRoot;
  }
  return openmindFileSearch;
}

/**
 * AppPaths for the current binding: the skill store follows the bound openmind
 * root (`.agent/skills`); everything else stays userData-derived. Rebuilt per
 * call — callers construct services lazily and are invalidated together with
 * the openmind root (see restartAiWorker).
 */
function buildCurrentAppPaths(): AppPaths {
  return buildAppPaths(undefined, resolveSkillStoreRoot(settings.resolveOpenmindRoot() || null));
}

function ensureSkillPackageService(): SkillPackageService {
  const paths = buildCurrentAppPaths();
  ensureAppPaths(paths);
  const openmindRoot = settings.resolveOpenmindRoot();
  if (openmindRoot && paths.skills && claudeAgentLinkEnsuredRoot !== openmindRoot) {
    ensureClaudeAgentLink(openmindRoot);
    ensureClaudeSkillAliases(paths.skills);
    claudeAgentLinkEnsuredRoot = openmindRoot;
  }
  if (!skillPackageService) skillPackageService = new SkillPackageService(paths);
  return skillPackageService;
}

function ensureSkillSourceService(): SkillSourceService {
  const paths = buildCurrentAppPaths();
  ensureAppPaths(paths);
  if (!skillSourceService) skillSourceService = new SkillSourceService(ensureSkillPackageService(), paths);
  return skillSourceService;
}

/** Skills are optional; startup only needs a usable content root. */
function hasRequiredStartupConfiguration(): boolean {
  const openmindRoot = settings.resolveOpenmindRoot();
  return Boolean(openmindRoot && settings.isValidOpenmindRoot(openmindRoot));
}

/** Ensure a directory exists (idempotent). */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Stable per-root state dir id (ADR-001 §5.1: userData/state/<root-id>/). */
function rootStateId(openmindRoot: string): string {
  // Cheap deterministic id; matches the resolver's computeRootId shape.
  let h = 0x811c9dc5;
  for (let i = 0; i < openmindRoot.length; i++) {
    h ^= openmindRoot.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `root-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** AI/session state is app-private and scoped to the selected content root. */
function resolveAiStateRoot(): string {
  const openmindRoot = settings.resolveOpenmindRoot();
  const rootId = openmindRoot && settings.isValidOpenmindRoot(openmindRoot) ? rootStateId(openmindRoot) : "workspace";
  const stateRoot = path.join(getAppPaths().state, rootId);
  ensureDir(stateRoot);
  return stateRoot;
}

function restartAiWorker(): void {
  aiWorker?.close();
  aiWorker = null;
  productService = null;
  productServiceRoot = "";
  projectService = null;
  projectServiceRoot = "";
  openmindFileSearch = null;
  openmindFileSearchRoot = "";
  // The skill store lives under the openmind root; drop the singletons bound to
  // the previous root so the next ensure* rebuilds against the new one.
  skillPackageService = null;
  skillSourceService = null;
  claudeAgentLinkEnsuredRoot = null;
  sharedPythonRuntimeService = null;
  const openmindRoot = settings.resolveOpenmindRoot();
  if (openmindRoot && hasRequiredStartupConfiguration()) {
    aiWorker = new AiWorkerClient(openmindRoot, resolveAiStateRoot());
  }
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
    ensureProjectService,
    searchSessions: (query) => ensureAiWorker().call("search", query) as Promise<AiSession[]>,
    listSkillDefinitions: () => ensureAiWorker().call("skills") as Promise<Array<Record<string, unknown>>>
  });
}

let wechatService: WechatService | null = null;
function ensureWechatService(): WechatService {
  wechatService ??= new WechatService({
    accountStore: new WechatAccountStore(app.getPath("userData"), safeStorage),
    writeClipboard: (input) => clipboard.write(input),
    resolveArticle: (projectName, outputPath) => {
      const service = ensureProjectService();
      service.resolveProjectExportFile(projectName, "output", outputPath);
      return {
        resolveImage: (source) => service.paths.resolveInsideProject(
          projectName,
          path.posix.normalize(path.posix.join(path.posix.dirname(outputPath), source)),
          { allowedTopLevels: ["outputs", "materials"] }
        )
      };
    }
  });
  return wechatService;
}

function registerIpc(): void {
  registerIpcHandlers(
    {
      getMainWindow: () => mainWindow,
      ensureProductService,
      ensureProjectService,
      ensureAiWorker,
      ensureOpenmindFileSearch,
      ensureCliInstallerService,
      ensureYoutubeToolsService,
      ensureSkillPackageService,
      ensureSkillSourceService,
      ensureSharedPythonRuntimeService,
      ensureWechatService,
      hasRequiredStartupConfiguration,
      getActiveRunCount: () => aiWorker?.activeRunCount() || Promise.resolve(0),
      restartAiWorker,
      getBrowserSkillStatus,
      installBrowserSkill,
      getMcpServers,
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
  registerYoutubeEmbedRequestPolicy(window.webContents.session);
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
          "Boolean(window.openmind && typeof window.openmind.getBootstrap === 'function')"
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
  // 开发模式：OPENMIND_DEV_SERVER_URL 指向 vite dev server（npm run dev）时走热更新，
  // 其余情况始终加载构建产物。
  let devServerUrl: URL | null = null;
  try {
    devServerUrl = process.env.OPENMIND_DEV_SERVER_URL ? new URL(process.env.OPENMIND_DEV_SERVER_URL) : null;
  } catch {
    devServerUrl = null;
  }
  if (devServerUrl && (devServerUrl.protocol === "http:" || devServerUrl.protocol === "https:")) {
    void window.loadURL(devServerUrl.toString());
  } else {
    void window.loadFile(path.join(APP_ROOT, ".build", "renderer", "index.html"));
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // The renderer bootstrap owns lazy worker startup after the configuration
  // gate succeeds. Do not create schedulers while onboarding is still active.
}

async function runDesktopE2e(window: BrowserWindow, timeout: NodeJS.Timeout): Promise<void> {
  try {
    const date = localDate();
    const result = await window.webContents.executeJavaScript(`(async () => {
      const api = window.openmind;
      if (!api || typeof api.getBootstrap !== "function") throw new Error("preload bridge is unavailable");
      const bootstrap = await api.getBootstrap();
      const preferences = await api.getPreferences();
      const articles = await api.listContent("articles", ${JSON.stringify(date)});
      const article = articles[0] ? await api.readContent(articles[0].path) : null;
      const fileSearch = await api.searchOpenmindFiles("desktop-e2e", 10);
      const browser = await api.getBrowserSkillStatus();
      const defaultSkillsEnabled = await api.getDefaultSkillsEnabled();
      const automationRules = await api.listAutomationRules();
      if (defaultSkillsEnabled || automationRules.length) throw new Error("Fresh startup enabled default Skills or schedules");
      if (await api.setDefaultSkillsEnabled(false)) throw new Error("Default Skills opt-out failed");
      return {
        documentReady: document.readyState,
        rootMounted: Boolean(document.querySelector("#root")),
        validRepo: bootstrap.validRepo,
        openmindRoot: bootstrap.openmindRoot,
        articleCount: Array.isArray(articles) ? articles.length : 0,
        articleReadable: Boolean(article?.content?.includes("real Electron preload and IPC bridge")),
        fileSearchCount: Array.isArray(fileSearch?.items) ? fileSearch.items.length : 0,
        themeMode: preferences.themeMode,
        browserStatus: browser?.ready ?? false
      };
    })()`, true) as {
      documentReady?: string;
      rootMounted?: boolean;
      validRepo?: boolean;
      openmindRoot?: string;
      articleCount?: number;
      articleReadable?: boolean;
      fileSearchCount?: number;
    };
    if (result.documentReady !== "complete" || !result.rootMounted) throw new Error("renderer did not mount");
    if (!result.validRepo || !result.openmindRoot) throw new Error("bootstrap did not resolve the E2E openmind root");
    if (!result.articleCount || !result.articleReadable || !result.fileSearchCount) {
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
  setLocale(settings.getPreferences().uiLanguage);
  protocol.handle(PROJECT_MEDIA_SCHEME, createVideoMediaHandler((projectName, relativePath) => ensureProjectService().materials.resolveVideoFile(projectName, relativePath)));
  // The backup UI/IPC surface is retired, but a restore transaction created
  // by an older release may still need one final startup rollback.
  new AppStateBackupService(getAppPaths());
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

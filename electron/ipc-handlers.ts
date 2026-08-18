import { dialog, shell, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  ApprovalDecisionSchema,
  AppStateBackupReportSchema,
  AddRssSourceInputSchema,
  ContentFacetsQuerySchema,
  ContentQuerySchema,
  ContentStatePatchSchema,
  AddCreativeTopicInputSchema,
  BriefWatchlistInputSchema,
  CreativeCreateInputSchema,
  CreativeManifestPatchSchema,
  CreativeSaveInputSchema,
  CreativeStageSchema,
  CreativeTopicStatePatchSchema,
  ContentIndexMaintenanceSchema,
  ProjectFileSearchResultSchema,
  PreferencesImportResultSchema,
  SourcePatchSchema,
  SessionPatchSchema,
  StartRunInputSchema,
  AiTurnListParamsSchema,
  BrowserAutomationStatusSchema,
  BrowserExtensionTokenSchema,
  McpServerCatalogSchema,
  OnboardingStateSchema,
  UserPreferencesSchema,
  EnvFileAnalysisSchema,
  ProvidersYamlInputSchema,
  ProvidersYamlViewSchema,
  SharedPythonRuntimeStatusSchema,
  type GlobalSearchResult
} from "../shared/contracts";
import { SkillPackageSourceInputSchema } from "../shared/skill-package-sources";
import { IPC_INVOKE_REGISTRY, IPC_METHOD_CHANNELS } from "../shared/ipc-registry";
import type { ProductService } from "./product/product-service";
import type { MymindFileSearch } from "./mymind-file-search";
import type { SkillPackageService } from "./skills/skill-package-service";
import { toSkillPackageInspectionView } from "./skills/skill-package-service";
import type { InstalledSkillRecord } from "./skills/installed-skill-repository";
import type { SkillSourceService } from "./skills/skill-source-service";
import { SkillSourceService as SkillSourceServiceImpl } from "./skills/skill-source-service";
import { deleteProviderEntry, listProvidersForUi, saveProvidersFromInput } from "./config/providers-yaml";
import type { RuntimePackService } from "./runtime/runtime-pack-service";
import type { RuntimePackDownloadService } from "./runtime/runtime-pack-download-service";
import type { SharedPythonRuntimeService } from "./runtime/shared-python-runtime";
import type { AppStateBackupService } from "./backup/app-state-backup";
import { normalizeMymindSelection } from "./mymind-file-search";
import { getAppPaths } from "./paths/app-paths-service";
import { previewMymindRelocation, relocateMymind } from "./paths/mymind-relocation-service";
import * as settings from "./lib/settings";
import { messages } from "../shared/messages";
import { WorkflowResumeRequestSchema, WorkflowStartRequestSchema } from "../shared/execution-contracts";
import { AutomationRuleInputSchema } from "../shared/automation-contracts";
import { RuntimePackIdSchema, RuntimePackMetadataSchema, RuntimeTargetSchema, type RuntimePackMetadata } from "../shared/runtime-targets";

const StringArgSchema = z.string().min(1).max(4096);
const IdentifierArgSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const OptionalStringArgSchema = z.string().min(1).max(4096).optional();
const RequestIdSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/);
const ExportLabelSchema = z.string().trim().min(1).max(160);
const FileContentSchema = z.string().max(5 * 1024 * 1024, messages.errors.file.tooLarge);
const RuntimePackBytesSchema = z.instanceof(Uint8Array).refine((value) => value.byteLength <= 2 * 1024 * 1024 * 1024, "Runtime Pack 超过单包大小限制。");
const DateArgSchema = z.string().regex(/^\d{4}-?\d{2}-?\d{2}$/).transform((value) => value.replaceAll("-", ""));
const HttpUrlArgSchema = z.string().url().refine((value) => /^https?:\/\//i.test(value), messages.errors.url.httpOnly);

function parseString(value: unknown): string {
  return StringArgSchema.parse(value);
}

function parseOptionalString(value: unknown): string | undefined {
  return value == null || value === "" ? undefined : OptionalStringArgSchema.parse(value);
}

function parseCliToolId(value: unknown): "claude" | "codex" {
  if (value !== "claude" && value !== "codex") throw new Error("CLI 必须是 claude 或 codex。 ");
  return value;
}

function parseDate(value: unknown): string {
  return DateArgSchema.parse(value);
}

function parseOptionalDate(value: unknown): string {
  return value == null || value === "" ? "" : parseDate(value);
}

/** Installing is the user's explicit execution decision. Static package
 * validation happens before this point; a successful install is promoted
 * atomically and can run immediately once its Runtime is ready. */
function makeInstalledSkillUsable(service: SkillPackageService, record: InstalledSkillRecord): InstalledSkillRecord {
  // Lightweight test/source adapters may expose only install/list operations.
  // In production SkillPackageService supplies the full promotion lifecycle.
  if (typeof service.markReadiness !== "function" || typeof service.activate !== "function") return record;
  let current = record;
  if (current.readiness !== "ready") current = service.markReadiness(current.key, current.digest, "ready");
  if (current.status !== "active") current = service.activate(current.key, current.digest).active;
  return current;
}

/** One-time compatibility for candidates imported by older builds. If a Skill
 * has no active version, promote its newest installed copy on first read. */
function listInstalledSkillsUsable(service: SkillPackageService): InstalledSkillRecord[] {
  const records = service.listInstalled();
  for (const key of new Set(records.map((record) => record.key))) {
    const versions = records.filter((record) => record.key === key);
    if (versions.some((record) => record.status === "active")) continue;
    const newest = versions.slice().sort((left, right) => right.installedAt.localeCompare(left.installedAt))[0];
    if (!newest) continue;
    try { makeInstalledSkillUsable(service, newest); } catch { /* Keep an invalid legacy candidate inspectable. */ }
  }
  return service.listInstalled();
}

async function assertNoActiveTasks(ctx: IpcMainContext, message = "有运行中的任务，暂时不能切换 mymind 根目录。"): Promise<void> {
  const count = await ctx.getActiveRunCount();
  if (count > 0) throw new Error(message);
}

export type AiWorkerCaller = {
  call(method: string, ...args: unknown[]): Promise<unknown>;
};

export type IpcMainContext = {
  getMainWindow: () => BrowserWindow | null;
  ensureProductService: () => ProductService;
  ensureAiWorker: () => AiWorkerCaller;
  ensureMymindFileSearch: () => MymindFileSearch;
  ensureCliInstallerService?: () => import("./install/cli-installer-service").CliInstallerService;
  ensureSkillPackageService: () => SkillPackageService;
  ensureSkillSourceService?: () => SkillSourceService;
  ensureExportLocationService: () => import("./execution/export-location-service").ExportLocationService;
  ensureRuntimePackService?: () => RuntimePackService;
  ensureRuntimePackDownloadService?: () => RuntimePackDownloadService;
  ensureSharedPythonRuntimeService?: () => SharedPythonRuntimeService;
  ensureAppStateBackupService?: () => AppStateBackupService;
  analyzeEnvFile: (filePath: string) => unknown;
  getActiveRunCount: () => Promise<number>;
  restartAiWorker: () => void;
  getBrowserAutomationStatus: () => unknown;
  getMcpServers: () => unknown;
  saveBrowserExtensionToken: (token: string) => unknown;
  clearBrowserExtensionToken: () => unknown;
  syncWindowTheme: (themeMode: "light" | "dark") => void;
  globalSearch: (rawQuery: unknown) => Promise<GlobalSearchResult[]>;
  localDate: () => string;
};

export type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;

export type IpcHandlerEntry = {
  channel: string;
  handler: IpcHandler;
};

/** 单一 ipcHandlers 表：channel → validate(Zod 内联) + invoke（E3 完整落地）。 */
export function createIpcHandlerEntries(ctx: IpcMainContext): IpcHandlerEntry[] {
  const C = IPC_METHOD_CHANNELS;
  const product = () => ctx.ensureProductService();
  const ai = () => ctx.ensureAiWorker();
  const skillPackages = () => ctx.ensureSkillPackageService();
  const skillSources = () => ctx.ensureSkillSourceService?.() || new SkillSourceServiceImpl(skillPackages());
  const runtimePacks = () => {
    if (!ctx.ensureRuntimePackService) throw new Error("Runtime Pack 服务尚未初始化。 ");
    return ctx.ensureRuntimePackService();
  };
  const runtimeDownloads = () => {
    if (!ctx.ensureRuntimePackDownloadService) throw new Error("Runtime Pack 下载服务尚未初始化。 ");
    return ctx.ensureRuntimePackDownloadService();
  };
  const sharedPython = () => {
    if (!ctx.ensureSharedPythonRuntimeService) throw new Error("内置 Python 运行时服务尚未初始化。 ");
    return ctx.ensureSharedPythonRuntimeService();
  };
  const stateBackup = () => {
    if (!ctx.ensureAppStateBackupService) throw new Error("应用状态备份服务尚未初始化。 ");
    return ctx.ensureAppStateBackupService();
  };
  const selectRuntimePack = async (): Promise<{ metadata: RuntimePackMetadata; bytes: Uint8Array } | null> => {
    const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
      title: "选择 Runtime Pack Manifest",
      properties: ["openFile"],
      filters: [{ name: "Runtime Pack Manifest", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const manifestPath = result.filePaths[0];
    const metadata = RuntimePackMetadataSchema.parse(JSON.parse(await fs.readFile(manifestPath, "utf8")));
    const packagePath = path.join(path.dirname(manifestPath), metadata.filename);
    const stat = await fs.stat(packagePath);
    if (!stat.isFile()) throw new Error("Runtime Pack 文件不是普通文件。");
    if (stat.size > 2 * 1024 * 1024 * 1024) throw new Error("Runtime Pack 超过单包大小限制。");
    return { metadata, bytes: new Uint8Array(await fs.readFile(packagePath)) };
  };

  return [
    {
      channel: C.getBootstrap,
      handler: async () => {
        const repoRoot = settings.findRepoRoot();
        const date = ctx.localDate();
        // ADR-001: surface the resolved mymind/workspace roots so the renderer
        // can drive the new path settings UI without re-deriving them.
        const mymindRoot = settings.resolveMymindRoot();
        const workspaceRoot = settings.resolveWorkspaceRoot();
        // `validRepo` is retained in the wire contract for one release, but
        // content readiness is now determined by mymindRoot alone. A .claude
        // checkout is optional; skills may be installed into SkillStore later.
        const validRepo = Boolean(mymindRoot && settings.isValidMymindRoot(mymindRoot));
        const aiWorkspace = workspaceRoot || (settings.looksLikeRepo(repoRoot) ? repoRoot : "");
        const hasAiWorkspace = Boolean(aiWorkspace);
        return {
          repoRoot,
          validRepo,
          onboardingCompleted: settings.getOnboardingState().completed,
          mymindRoot,
          workspaceRoot,
          runtime: settings.parseWslRepoPath(repoRoot) ? "Windows → WSL" : process.platform,
          environment: { mode: "desktop", platform: process.platform },
          overview: validRepo ? product().getOverview(date) : { repoRoot, metrics: {}, recent: [] },
          skills: hasAiWorkspace ? await ai().call("skills") : [],
          ai: hasAiWorkspace ? await ai().call("snapshot") : {
            projectRoot: aiWorkspace || mymindRoot,
            providers: [],
            sessions: [],
            runs: [],
            pendingApprovals: []
          }
        };
      }
    },
    { channel: C.listContent, handler: (kind, date) => product().listContent(parseString(kind), parseOptionalDate(date)) },
    { channel: C.readContent, handler: (filePath) => product().readContent(parseString(filePath)) },
    {
      channel: C.writeContent,
      handler: (filePath, rawContent) => product().writeContent(parseString(filePath), FileContentSchema.parse(rawContent))
    },
    { channel: C.listInbox, handler: (query) => product().listInbox(ContentQuerySchema.parse(query)) },
    { channel: C.getInboxFacets, handler: (query) => product().getInboxFacets(ContentFacetsQuerySchema.parse(query)) },
    {
      channel: C.updateContentState,
      handler: (id, filePath, patch) =>
        product().updateContentState(parseString(id), parseString(filePath), ContentStatePatchSchema.parse(patch))
    },
    { channel: C.listSources, handler: () => product().listSources() },
    { channel: C.updateSource, handler: (id, patch) => product().updateSource(parseString(id), SourcePatchSchema.parse(patch)) },
    { channel: C.deleteSource, handler: (id) => product().deleteSource(parseString(id)) },
    { channel: C.addRssSource, handler: (input) => product().addRssSource(AddRssSourceInputSchema.parse(input)) },
    {
      channel: C.importOpml,
      handler: async () => {
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: messages.dialogs.importOpml,
          properties: ["openFile"],
          filters: [{ name: "OPML", extensions: ["opml", "xml"] }]
        });
        if (result.canceled || !result.filePaths[0]) return 0;
        return product().importOpml(settings.ensureInsideRepo(result.filePaths[0]));
      }
    },
    { channel: C.listSourceRuns, handler: (sourceId) => product().listSourceRuns(parseOptionalString(sourceId)) },
    {
      channel: C.runSource,
      handler: async (sourceId, date) => {
        const parsedSourceId = parseString(sourceId);
        const source = product().listSources().find((item) => item.id === parsedSourceId);
        if (!source) throw new Error(messages.errors.source.notFound);
        if (!source.enabled) throw new Error(messages.errors.source.disabled);
        if (!source.skillId) throw new Error(messages.errors.source.noSkill);
        return ai().call("run-source", source.id, source.skillId, {
          date: date ? parseDate(date) : undefined,
          url: source.url || undefined,
          name: source.name
        });
      }
    },
    { channel: C.stopSource, handler: (sourceId) => ai().call("stop-source", parseString(sourceId)) },
    { channel: C.getDailyBrief, handler: (date) => product().getDailyBrief(parseDate(date)) },
    {
      channel: C.updateBriefWatchlist,
      handler: (input) => {
        const parsed = BriefWatchlistInputSchema.parse(input);
        return product().updateBriefWatchlist(parsed.date, parsed.path, parsed.add);
      }
    },
    { channel: C.getDashboard, handler: (date) => product().getDashboard(parseDate(date), 0) },
    { channel: C.searchWorkspace, handler: (rawQuery) => ctx.globalSearch(rawQuery) },
    { channel: C.getCreativeTopics, handler: (date) => product().getCreativeTopics(parseDate(date)) },
    { channel: C.getAllCreativeTopics, handler: () => product().getAllCreativeTopics() },
    { channel: C.addCreativeTopic, handler: (input) => product().addCreativeTopic(AddCreativeTopicInputSchema.parse(input)) },
    { channel: C.getCreativeProjects, handler: () => product().listCreativeProjects() },
    { channel: C.getCreativeProject, handler: (filePath) => product().getCreativeProject(parseString(filePath)) },
    { channel: C.createCreativeProject, handler: (input) => product().createCreativeProject(CreativeCreateInputSchema.parse(input)) },
    { channel: C.saveCreativeFile, handler: (input) => product().saveCreativeFile(CreativeSaveInputSchema.parse(input)) },
    {
      channel: C.advanceCreativeProject,
      handler: (filePath, stage) => product().advanceProjectStage(parseString(filePath), CreativeStageSchema.parse(stage))
    },
    {
      channel: C.updateCreativeManifest,
      handler: (filePath, patch) => product().updateCreativeManifest(parseString(filePath), CreativeManifestPatchSchema.parse(patch))
    },
    {
      channel: C.updateCreativeTopicState,
      handler: (date, topicId, patch) =>
        product().updateCreativeTopicState(parseDate(date), parseString(topicId), CreativeTopicStatePatchSchema.parse(patch))
    },
    { channel: C.reviewCreativeProject, handler: (filePath) => product().reviewCreativeProject(parseString(filePath)) },
    {
      channel: C.setCreativeReviewStatus,
      handler: (filePath, status) =>
        product().setCreativeReviewStatus(parseString(filePath), z.enum(["pending", "changes-requested", "approved"]).parse(status))
    },
    {
      channel: C.listCreativeVersions,
      handler: (filePath, file) => product().listCreativeVersions(parseString(filePath), parseString(file))
    },
    { channel: C.readCreativeVersion, handler: (filePath) => product().readCreativeVersion(parseString(filePath)) },
    {
      channel: C.restoreCreativeVersion,
      handler: (projectPath, file, versionPath) =>
        product().restoreCreativeVersion(parseString(projectPath), parseString(file), parseString(versionPath))
    },
    { channel: C.getCreativeReleaseLog, handler: (filePath) => product().getCreativeReleaseLog(parseString(filePath)) },
    { channel: C.copyCreativeProject, handler: (filePath) => product().copyCreativeProject(parseString(filePath)) },
    { channel: C.archiveCreativeProject, handler: (filePath) => product().archiveCreativeProject(parseString(filePath)) },
    { channel: C.restoreCreativeProject, handler: (filePath) => product().restoreCreativeProject(parseString(filePath)) },
    { channel: C.deleteCreativeProject, handler: (filePath) => product().deleteCreativeProject(parseString(filePath)) },
    { channel: C.getCreativeAnalytics, handler: () => product().getCreativeAnalytics() },
    {
      channel: C.bindCreativeSession,
      handler: (filePath, sessionId) => product().bindCreativeSession(parseString(filePath), parseString(sessionId))
    },
    {
      channel: C.selectFiles,
      handler: async () => {
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: messages.dialogs.selectProjectFile,
          properties: ["openFile", "multiSelections"]
        });
        if (result.canceled) return [];
        const projectRoot = settings.findRepoRoot();
        return result.filePaths.map((filePath) =>
          path.relative(projectRoot, settings.ensureInsideRepo(filePath)).split(path.sep).join("/")
        );
      }
    },
    {
      channel: C.selectMymindFiles,
      handler: async () => {
        const mymindRoot = settings.resolveMymindRoot();
        if (!mymindRoot || !settings.isValidMymindRoot(mymindRoot)) return [];
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: messages.dialogs.selectMymindFile,
          defaultPath: mymindRoot,
          properties: ["openFile", "multiSelections"]
        });
        return result.canceled
          ? []
          : result.filePaths.map((filePath) => normalizeMymindSelection(mymindRoot, filePath, { rootKind: "mymind" }));
      }
    },
    {
      channel: C.searchMymindFiles,
      handler: async (rawQuery, rawLimit) => {
        const query = z.string().max(240).parse(rawQuery || "").trim();
        const limit = z.number().int().min(1).max(100).default(40).parse(rawLimit);
        return ProjectFileSearchResultSchema.parse(await ctx.ensureMymindFileSearch().search(query, limit));
      }
    },
    {
      channel: C.openPath,
      handler: (value) => shell.openPath(settings.ensureInsideRepo(value == null || value === "" ? "." : parseString(value)))
    },
    {
      channel: C.revealPath,
      handler: (value) => {
        shell.showItemInFolder(settings.ensureInsideRepo(value == null || value === "" ? "." : parseString(value)));
        return true;
      }
    },
    {
      channel: C.openExternal,
      handler: async (value) => {
        const url = HttpUrlArgSchema.parse(value);
        await shell.openExternal(url);
        return true;
      }
    },
    {
      channel: C.exportText,
      handler: async (defaultName, text) => {
        const parsed = z.tuple([z.string().min(1).max(220), z.string()]).parse([defaultName, text]);
        const result = await dialog.showSaveDialog(ctx.getMainWindow()!, {
          title: messages.dialogs.exportMarkdown,
          defaultPath: parsed[0],
          filters: [{ name: "Markdown", extensions: ["md"] }, { name: "Text", extensions: ["txt"] }]
        });
        if (result.canceled || !result.filePath) return null;
        const fs = await import("node:fs/promises");
        const outputPath = settings.ensureInsideRepo(result.filePath);
        await fs.writeFile(outputPath, parsed[1], "utf8");
        return outputPath;
      }
    },
    {
      channel: C.setRepo,
      handler: (value) => {
        const result = settings.setRepoRoot(parseString(value));
        ctx.restartAiWorker();
        return result;
      }
    },
    {
      channel: C.detectRepo,
      handler: () => {
        const result = settings.detectRepoRoot();
        ctx.restartAiWorker();
        return result;
      }
    },
    {
      channel: C.selectRepo,
      handler: async () => {
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: messages.dialogs.selectRepo,
          properties: ["openDirectory"]
        });
        if (result.canceled || !result.filePaths[0]) return null;
        const repoRoot = settings.setRepoRoot(result.filePaths[0]);
        ctx.restartAiWorker();
        return repoRoot;
      }
    },
    // --- ADR-001 mymindRoot / workspaceRoot handlers ---
    {
      channel: C.setMymindRoot,
      handler: async (value) => {
        await assertNoActiveTasks(ctx);
        const result = settings.setMymindRoot(parseString(value));
        ctx.restartAiWorker();
        return result;
      }
    },
    {
      channel: C.selectMymindRoot,
      handler: async () => {
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: "选择 mymind 内容根目录",
          properties: ["openDirectory"]
        });
        if (result.canceled || !result.filePaths[0]) return null;
        // Selection is deliberately read-only. The renderer must preview the
        // candidate and explicitly commit it through setMymindRoot.
        return result.filePaths[0];
      }
    },
    {
      channel: C.previewMymindRoot,
      handler: async (value) => settings.previewMymindRoot(parseString(value), await ctx.getActiveRunCount())
    },
    {
      channel: C.selectMymindRelocationTarget,
      handler: async () => {
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: "选择 mymind 搬迁目标（必须为空目录）",
          properties: ["openDirectory"]
        });
        if (result.canceled || !result.filePaths[0]) return null;
        return result.filePaths[0];
      }
    },
    {
      channel: C.previewMymindRelocation,
      handler: async (value) => {
        const sourceDirectory = settings.resolveMymindRoot();
        if (!sourceDirectory) throw new Error(messages.errors.repo.selectValidFirst);
        return previewMymindRelocation({
          sourceDirectory,
          targetDirectory: parseString(value),
          paths: getAppPaths(),
          activeRunCount: await ctx.getActiveRunCount()
        });
      }
    },
    {
      channel: C.relocateMymind,
      handler: async (value) => {
        await assertNoActiveTasks(ctx, "有运行中的任务，暂时不能搬迁 mymind 内容。");
        const sourceDirectory = settings.resolveMymindRoot();
        if (!sourceDirectory) throw new Error(messages.errors.repo.selectValidFirst);
        const report = relocateMymind({
          sourceDirectory,
          targetDirectory: parseString(value),
          paths: getAppPaths(),
          activeRunCount: await ctx.getActiveRunCount()
        });
        // Content copy and root binding are separate operations. Only after
        // the copy has passed its source/target tree verification do we bind
        // the new root and restart the worker snapshot.
        settings.setMymindRoot(report.targetDirectory);
        ctx.restartAiWorker();
        return report;
      }
    },
    {
      channel: C.getMymindRoot,
      handler: () => ({
        mymindRoot: settings.resolveMymindRoot(),
        workspaceRoot: settings.resolveWorkspaceRoot(),
        migration: settings.getLegacyStateMigrationStatus(),
        health: settings.getMymindRootHealth(),
        snapshot: settings.getMymindRootSnapshot()
      })
    },
    {
      channel: C.setWorkspaceRoot,
      handler: (value) => {
        const result = settings.setWorkspaceRoot(parseString(value));
        ctx.restartAiWorker();
        return result;
      }
    },
    {
      channel: C.selectWorkspaceRoot,
      handler: async () => {
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: "选择 AI/代码工作区目录",
          properties: ["openDirectory"]
        });
        if (result.canceled || !result.filePaths[0]) return null;
        const workspaceRoot = settings.setWorkspaceRoot(result.filePaths[0]);
        ctx.restartAiWorker();
        return workspaceRoot;
      }
    },
    { channel: C.getPreferences, handler: () => UserPreferencesSchema.parse(settings.getPreferences()) },
    { channel: C.getOnboardingState, handler: () => OnboardingStateSchema.parse(settings.getOnboardingState()) },
    {
      channel: C.updateOnboardingState,
      handler: (patch) => OnboardingStateSchema.parse(settings.updateOnboardingState(OnboardingStateSchema.partial().parse(patch)))
    },
    {
      channel: C.updatePreferences,
      handler: (patch) => {
        const previous = settings.getPreferences();
        const next = UserPreferencesSchema.parse(settings.updatePreferences(UserPreferencesSchema.partial().parse(patch)));
        if (browserPreferencesChanged(previous, next)) ctx.restartAiWorker();
        ctx.syncWindowTheme(next.themeMode);
        return next;
      }
    },
    {
      channel: C.resetPreferences,
      handler: (section) => {
        const previous = settings.getPreferences();
        const next = UserPreferencesSchema.parse(settings.resetPreferences(parseOptionalString(section)));
        if (browserPreferencesChanged(previous, next)) ctx.restartAiWorker();
        ctx.syncWindowTheme(next.themeMode);
        return next;
      }
    },
    {
      channel: C.importPreferences,
      handler: (filePath) =>
        PreferencesImportResultSchema.parse(settings.importPreferences(settings.ensureInsideRepo(parseString(filePath))))
    },
    {
      channel: C.exportAppStateBackup,
      handler: async () => {
        const result = await dialog.showSaveDialog(ctx.getMainWindow()!, {
          title: "备份应用状态",
          defaultPath: "cctools-state-backup.zip",
          filters: [{ name: "CC Tools 应用状态备份", extensions: ["zip"] }]
        });
        if (result.canceled || !result.filePath) return null;
        await assertNoActiveTasks(ctx, "有运行中的任务，暂时不能备份应用状态。 ");
        return AppStateBackupReportSchema.parse(stateBackup().exportToFile(result.filePath));
      }
    },
    {
      channel: C.importAppStateBackup,
      handler: async () => {
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: "恢复应用状态",
          properties: ["openFile"],
          filters: [{ name: "CC Tools 应用状态备份", extensions: ["zip"] }]
        });
        if (result.canceled || !result.filePaths[0]) return null;
        await assertNoActiveTasks(ctx, "有运行中的任务，暂时不能恢复应用状态。 ");
        const report = AppStateBackupReportSchema.parse(stateBackup().importFromFile(result.filePaths[0]));
        ctx.restartAiWorker();
        return report;
      }
    },
    {
      channel: C.getBrowserAutomationStatus,
      handler: () => BrowserAutomationStatusSchema.parse(ctx.getBrowserAutomationStatus())
    },
    {
      channel: C.getMcpServers,
      handler: () => McpServerCatalogSchema.parse(ctx.getMcpServers())
    },
    {
      channel: C.saveBrowserExtensionToken,
      handler: (token) => BrowserAutomationStatusSchema.parse(ctx.saveBrowserExtensionToken(BrowserExtensionTokenSchema.parse(token)))
    },
    {
      channel: C.clearBrowserExtensionToken,
      handler: () => BrowserAutomationStatusSchema.parse(ctx.clearBrowserExtensionToken())
    },
    {
      channel: C.analyzeEnvFile,
      handler: (filePath) => EnvFileAnalysisSchema.parse(ctx.analyzeEnvFile(parseString(filePath)))
    },
    {
      channel: C.getProviders,
      handler: () => ProvidersYamlViewSchema.parse(listProvidersForUi())
    },
    {
      channel: C.saveProviders,
      handler: async (input) => {
        saveProvidersFromInput(ProvidersYamlInputSchema.parse(input));
        await ai().call("refresh-providers");
        return ProvidersYamlViewSchema.parse(listProvidersForUi());
      }
    },
    {
      channel: C.deleteProvider,
      handler: async (id) => {
        deleteProviderEntry(parseString(id));
        await ai().call("refresh-providers");
        return ProvidersYamlViewSchema.parse(listProvidersForUi());
      }
    },
    {
      channel: C.getSharedPythonRuntimeStatus,
      handler: () => SharedPythonRuntimeStatusSchema.parse(sharedPython().status())
    },
    {
      channel: C.setSharedPythonRuntimeEnabled,
      handler: async (enabled) => SharedPythonRuntimeStatusSchema.parse(await sharedPython().setEnabled(z.boolean().parse(enabled)))
    },
    { channel: C.listRuntimePacks, handler: () => runtimePacks().listReadiness() },
    {
      channel: C.getRuntimePackReadiness,
      handler: (packId, target) => runtimePacks().getReadiness(RuntimePackIdSchema.parse(packId), RuntimeTargetSchema.parse(target)) || null
    },
    {
      channel: C.importRuntimePack,
      handler: async () => {
        const selected = await selectRuntimePack();
        if (!selected) return null;
        const service = runtimePacks();
        const record = service.install(selected.metadata, RuntimePackBytesSchema.parse(selected.bytes));
        const readiness = service.getReadiness(record.packId, record.target);
        if (!readiness) throw new Error("Runtime Pack 导入后无法读取 readiness。");
        return readiness;
      }
    },
    {
      channel: C.repairRuntimePackFromFile,
      handler: async (packId, target, digest) => {
        const selected = await selectRuntimePack();
        if (!selected) return null;
        const expectedPackId = RuntimePackIdSchema.parse(packId);
        const expectedTarget = RuntimeTargetSchema.parse(target);
        const expectedDigest = parseString(digest).toLowerCase();
        if (selected.metadata.packId !== expectedPackId || selected.metadata.target !== expectedTarget || selected.metadata.sha256 !== expectedDigest) {
          throw new Error("选择的 Runtime Pack Manifest 与待修复版本不匹配。");
        }
        const service = runtimePacks();
        const record = service.repair(selected.metadata, RuntimePackBytesSchema.parse(selected.bytes));
        const readiness = service.getReadiness(record.packId, record.target);
        if (!readiness) throw new Error("Runtime Pack repair 后无法读取 readiness。");
        return readiness;
      }
    },
    {
      channel: C.installRuntimePack,
      handler: (metadata, bytes) => {
        const service = runtimePacks();
        const record = service.install(metadata, RuntimePackBytesSchema.parse(bytes));
        const readiness = service.getReadiness(record.packId, record.target);
        if (!readiness) throw new Error("Runtime Pack 安装后无法读取 readiness。");
        return readiness;
      }
    },
    {
      channel: C.repairRuntimePack,
      handler: (metadata, bytes) => {
        const service = runtimePacks();
        const record = service.repair(metadata, RuntimePackBytesSchema.parse(bytes));
        const readiness = service.getReadiness(record.packId, record.target);
        if (!readiness) throw new Error("Runtime Pack repair 后无法读取 readiness。");
        return readiness;
      }
    },
    {
      channel: C.activateRuntimePack,
      handler: (packId, target, digest) => {
        runtimePacks().activate(RuntimePackIdSchema.parse(packId), RuntimeTargetSchema.parse(target), parseString(digest));
        return runtimePacks().listReadiness();
      }
    },
    {
      channel: C.rollbackRuntimePack,
      handler: (packId, target) => {
        runtimePacks().rollback(RuntimePackIdSchema.parse(packId), RuntimeTargetSchema.parse(target));
        return runtimePacks().listReadiness();
      }
    },
    {
      channel: C.removeRuntimePack,
      handler: (packId, target, digest) => runtimePacks().remove(RuntimePackIdSchema.parse(packId), RuntimeTargetSchema.parse(target), parseString(digest))
    },
    {
      channel: C.garbageCollectRuntimePacks,
      handler: () => runtimePacks().garbageCollect()
    },
    {
      channel: C.selectRuntimePackDownloadManifest,
      handler: async () => {
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: "选择可下载 Runtime Pack Manifest",
          properties: ["openFile"],
          filters: [{ name: "Runtime Pack Manifest", extensions: ["json"] }]
        });
        if (result.canceled || !result.filePaths[0]) return null;
        const metadata = JSON.parse(await fs.readFile(result.filePaths[0], "utf8"));
        return runtimeDownloads().describe(metadata);
      }
    },
    {
      channel: C.listRuntimePackDownloads,
      handler: () => runtimeDownloads().list()
    },
    {
      channel: C.startRuntimePackDownload,
      handler: (metadata) => runtimeDownloads().start(metadata)
    },
    {
      channel: C.pauseRuntimePackDownload,
      handler: (id) => runtimeDownloads().pause(parseString(id))
    },
    {
      channel: C.resumeRuntimePackDownload,
      handler: (id) => runtimeDownloads().resume(parseString(id))
    },
    {
      channel: C.removeRuntimePackDownload,
      handler: (id) => runtimeDownloads().remove(parseString(id))
    },
    {
      channel: C.rebuildContentIndex,
      handler: () => ContentIndexMaintenanceSchema.parse(product().rebuildContentIndex())
    },
    { channel: C.aiRefresh, handler: () => ai().call("snapshot") },
    { channel: C.aiRefreshProviders, handler: () => ai().call("refresh-providers") },
    {
      channel: C.installCliTool,
      handler: async (cli) => {
        const service = ctx.ensureCliInstallerService?.();
        if (!service) throw new Error("当前环境不支持一键安装 CLI。 ");
        return service.install(parseCliToolId(cli));
      }
    },
    {
      channel: C.upgradeCliTool,
      handler: async (cli) => {
        const service = ctx.ensureCliInstallerService?.();
        if (!service) throw new Error("当前环境不支持升级 CLI。 ");
        return service.upgrade(parseCliToolId(cli));
      }
    },
    {
      channel: C.checkCliToolUpdate,
      handler: async (cli) => {
        const service = ctx.ensureCliInstallerService?.();
        if (!service) throw new Error("当前环境不支持检查 CLI 版本。 ");
        return service.checkForUpdate(parseCliToolId(cli));
      }
    },
    {
      channel: C.cancelCliToolInstall,
      handler: (cli) => ctx.ensureCliInstallerService?.()?.cancel(parseCliToolId(cli)) ?? false
    },
    {
      channel: C.listCliToolStatuses,
      handler: () => ctx.ensureCliInstallerService?.()?.list() ?? []
    },
    {
      channel: C.openCliLogin,
      handler: (cli) => {
        const { openCliLoginTerminal } = require("./install/cli-login") as typeof import("./install/cli-login");
        openCliLoginTerminal(parseCliToolId(cli));
      }
    },
    { channel: C.aiRefreshSkills, handler: () => ai().call("refresh-skills") },
    {
      channel: C.inspectSkillWorkspace,
      handler: () => {
        const workspaceRoot = settings.resolveWorkspaceRoot();
        return workspaceRoot ? skillPackages().inspectClaudeSkills(workspaceRoot).map(toSkillPackageInspectionView) : [];
      }
    },
    {
      channel: C.inspectInstalledSkill,
      handler: (key, digest) => {
        const record = skillPackages().getInstalled(parseString(key), parseOptionalString(digest));
        if (!record) return null;
        const inspection = skillPackages().inspect(record.packagePath);
        return toSkillPackageInspectionView({
          ...inspection,
          sourcePath: record.sourceLocator || inspection.sourcePath,
          sourceKind: record.sourceType === "git" ? "git" : inspection.sourceKind
        });
      }
    },
    {
      channel: C.migrateSkillWorkspace,
      handler: () => {
        const workspaceRoot = settings.resolveWorkspaceRoot();
        if (!workspaceRoot) return { inspected: [], installed: [], skipped: [] };
        const report = skillPackages().migrateClaudeSkills(workspaceRoot);
        return {
          inspected: report.inspected.map(toSkillPackageInspectionView),
          installed: report.installed.map((record) => makeInstalledSkillUsable(skillPackages(), record)),
          skipped: report.skipped
        };
      }
    },
    { channel: C.listInstalledSkills, handler: () => listInstalledSkillsUsable(skillPackages()) },
    { channel: C.installSkillPackage, handler: (sourcePath) => makeInstalledSkillUsable(skillPackages(), skillPackages().install(parseString(sourcePath))) },
    {
      channel: C.selectSkillPackageSource,
      handler: async () => {
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: "选择 Skill 目录或 ZIP",
          properties: ["openFile", "openDirectory"],
          filters: [{ name: "Skill package", extensions: ["zip"] }]
        });
        if (result.canceled || !result.filePaths[0]) return null;
        const locator = result.filePaths[0];
        let stat;
        try { stat = await fs.stat(locator); } catch { throw new Error("所选 Skill 来源不可读取。 "); }
        if (stat.isDirectory()) return { type: "directory" as const, locator };
        if (stat.isFile() && path.extname(locator).toLocaleLowerCase() === ".zip") return { type: "zip" as const, locator };
        throw new Error("Skill 来源必须是目录或 .zip 文件。 ");
      }
    },
    {
      channel: C.inspectSkillSource,
      handler: (input, requestId) => skillSources().inspect(
        SkillPackageSourceInputSchema.parse(input),
        requestId == null ? undefined : RequestIdSchema.parse(requestId)
      ).then((result) => ({
        source: result.source,
        packages: result.packages.map(toSkillPackageInspectionView)
      }))
    },
    {
      channel: C.cancelSkillSourceInspection,
      handler: (requestId) => skillSources().cancelInspection(RequestIdSchema.parse(requestId))
    },
    {
      channel: C.installSkillSource,
      handler: async (input, selected) => {
        const refs = Array.isArray(selected)
          ? selected.filter((ref): ref is string => typeof ref === "string" && ref.length > 0)
          : undefined;
        const records = await skillSources().install(SkillPackageSourceInputSchema.parse(input), refs);
        return records.map((record) => makeInstalledSkillUsable(skillPackages(), record));
      }
    },
    { channel: C.rollbackSkillPackage, handler: (key) => skillPackages().rollback(parseString(key)) },
    {
      channel: C.uninstallSkillPackage,
      handler: (key, digest) => skillPackages().uninstall(parseString(key), parseOptionalString(digest))
    },
    { channel: C.listSkillRuns, handler: () => ai().call("skill-run-list") },
    { channel: C.getSkillRun, handler: (runId) => ai().call("skill-run-get", parseString(runId)) },
    { channel: C.getSkillRunEvents, handler: (runId) => ai().call("skill-run-events", parseString(runId)) },
    { channel: C.listRunArtifacts, handler: (runId) => ai().call("run-list-artifacts", parseOptionalString(runId)) },
    { channel: C.retrySkillRun, handler: (runId) => ai().call("run-retry", parseString(runId)) },
    { channel: C.retryWorkflowStep, handler: (runId, stepId) => ai().call("run-retry-step", parseString(runId), parseString(stepId)) },
    { channel: C.deleteRunHistory, handler: (runId) => ai().call("run-delete-history", parseString(runId)) },
    { channel: C.cancelSkillRun, handler: (runId) => ai().call("skill-run-cancel", parseString(runId)) },
    { channel: C.startWorkflowRun, handler: (input) => ai().call("workflow-run-start", WorkflowStartRequestSchema.parse(input)) },
    { channel: C.listWorkflowRuns, handler: () => ai().call("workflow-run-list") },
    { channel: C.getWorkflowRun, handler: (runId) => ai().call("workflow-run-get", parseString(runId)) },
    { channel: C.resumeWorkflowRun, handler: (input) => ai().call("workflow-run-resume", WorkflowResumeRequestSchema.parse(input)) },
    { channel: C.cancelWorkflowRun, handler: (runId) => ai().call("workflow-run-cancel", parseString(runId)) },
    { channel: C.listAutomationRules, handler: () => ai().call("automation-rules-list") },
    { channel: C.saveAutomationRule, handler: (input) => ai().call("automation-rule-save", AutomationRuleInputSchema.parse(input)) },
    { channel: C.deleteAutomationRule, handler: (id) => ai().call("automation-rule-delete", IdentifierArgSchema.parse(id)) },
    { channel: C.runAutomationNow, handler: (id) => ai().call("automation-run-now", IdentifierArgSchema.parse(id)) },
    { channel: C.listAutomationRuns, handler: (ruleId) => ai().call("automation-runs-list", ruleId == null || ruleId === "" ? undefined : IdentifierArgSchema.parse(ruleId)) },
    { channel: C.listAutomationSchedules, handler: () => ai().call("automation-schedules-list") },
    { channel: C.listExportLocations, handler: () => ctx.ensureExportLocationService().list() },
    {
      channel: C.selectExportLocation,
      handler: async (label, bindingId) => {
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: "选择 Skill 导出目录",
          properties: ["openDirectory", "createDirectory"]
        });
        if (result.canceled || !result.filePaths[0]) return null;
        const service = ctx.ensureExportLocationService();
        const requestedBindingId = bindingId == null || bindingId === "" ? undefined : IdentifierArgSchema.parse(bindingId);
        if (requestedBindingId && service.get(requestedBindingId)) return service.relink(requestedBindingId, result.filePaths[0]);
        return requestedBindingId
          ? service.create(ExportLabelSchema.parse(label), result.filePaths[0], requestedBindingId)
          : service.create(ExportLabelSchema.parse(label), result.filePaths[0]);
      }
    },
    { channel: C.revokeExportLocation, handler: (id) => ctx.ensureExportLocationService().revoke(parseString(id)) },
    {
      channel: C.aiPrewarm,
      handler: (sessionId) => settings.resolveWorkspaceRoot()
        ? ai().call("prewarm", parseOptionalString(sessionId))
        : false
    },
    { channel: C.aiSearchSessions, handler: (query) => ai().call("search", z.string().max(500).parse(query || "")) },
    { channel: C.aiStartRun, handler: (input) => ai().call("start", StartRunInputSchema.parse(input)) },
    { channel: C.aiCancelRun, handler: (runId) => ai().call("cancel", parseString(runId)) },
    {
      channel: C.aiUpdateSession,
      handler: (sessionId, patch) => ai().call("update-session", parseString(sessionId), SessionPatchSchema.parse(patch))
    },
    { channel: C.aiDeleteSession, handler: (sessionId) => ai().call("delete-session", parseString(sessionId)) },
    { channel: C.aiGetEvents, handler: (sessionId) => ai().call("events", parseString(sessionId)) },
    {
      channel: C.aiListTurns,
      handler: (sessionId, params) => ai().call("turns", parseString(sessionId), AiTurnListParamsSchema.parse(params || {}))
    },
    { channel: C.aiGetContextState, handler: (sessionId) => ai().call("context-state", parseString(sessionId)) },
    {
      channel: C.aiForkSession,
      handler: (sessionId, throughRunId) => ai().call("fork-session", parseString(sessionId), parseOptionalString(throughRunId))
    },
    {
      channel: C.aiRollbackTurns,
      handler: (sessionId, numTurns) => ai().call("rollback-turns", parseString(sessionId), z.number().int().min(1).max(100).parse(numTurns))
    },
    {
      channel: C.aiResolveApproval,
      handler: (approvalId, decision) => ai().call("resolve-approval", parseString(approvalId), ApprovalDecisionSchema.parse(decision))
    },
    { channel: C.aiGetChangeSet, handler: (runId) => ai().call("change-set", parseString(runId)) },
    {
      channel: C.aiApplyChange,
      handler: (runId, patch) => ai().call("apply-change", parseString(runId), parseOptionalString(patch))
    },
    {
      channel: C.aiRevertChange,
      handler: (runId, patch) => ai().call("revert-change", parseString(runId), parseString(patch))
    },
    {
      channel: C.aiDiscardChange,
      handler: (runId, patch) => ai().call("discard-change", parseString(runId), parseString(patch))
    },
    { channel: C.aiDiscardRun, handler: (runId) => ai().call("discard-run", parseString(runId)) },
    { channel: C.runSkill, handler: (skillId, date) => ai().call("run-skill", parseString(skillId), date ? parseDate(date) : undefined) },
    { channel: C.stopSkill, handler: (skillId) => ai().call("stop-skill", parseString(skillId)) }
  ];
}

function browserPreferencesChanged(previous: z.infer<typeof UserPreferencesSchema>, next: z.infer<typeof UserPreferencesSchema>): boolean {
  return previous.browserAutomationEnabled !== next.browserAutomationEnabled
    || previous.browserReuseExistingTabs !== next.browserReuseExistingTabs
    || previous.browserEvidenceDir !== next.browserEvidenceDir;
}

export function registerIpcHandlers(
  ctx: IpcMainContext,
  register: (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void
): void {
  const entries = createIpcHandlerEntries(ctx);
  const registryChannels = new Set(IPC_INVOKE_REGISTRY.map((item) => item.channel));
  const handlerChannels = new Set(entries.map((item) => item.channel));
  if (registryChannels.size !== handlerChannels.size || [...registryChannels].some((channel) => !handlerChannels.has(channel))) {
    throw new Error(messages.errors.ipc.registryMismatch);
  }
  for (const { channel, handler } of entries) {
    register(channel, (_, ...args) => handler(...args));
  }
}

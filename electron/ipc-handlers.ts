import { dialog, shell, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { z } from "zod";
import {
  ApprovalDecisionSchema,
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
  EnvironmentDiagnosticSchema,
  ProjectFileSearchResultSchema,
  PreferencesImportResultSchema,
  SourcePatchSchema,
  SessionPatchSchema,
  StartRunInputSchema,
  AiTurnListParamsSchema,
  BrowserAutomationStatusSchema,
  BrowserExtensionTokenSchema,
  McpServerCatalogSchema,
  UserPreferencesSchema,
  type GlobalSearchResult
} from "../shared/contracts";
import { IPC_INVOKE_REGISTRY, IPC_METHOD_CHANNELS } from "../shared/ipc-registry";
import type { ProductService } from "./product/product-service";
import type { MymindFileSearch } from "./mymind-file-search";
import { normalizeMymindSelection } from "./mymind-file-search";
import * as settings from "./lib/settings";
import { messages } from "../shared/messages";

const StringArgSchema = z.string().min(1).max(4096);
const OptionalStringArgSchema = z.string().min(1).max(4096).optional();
const FileContentSchema = z.string().max(5 * 1024 * 1024, messages.errors.file.tooLarge);
const DateArgSchema = z.string().regex(/^\d{4}-?\d{2}-?\d{2}$/).transform((value) => value.replaceAll("-", ""));
const HttpUrlArgSchema = z.string().url().refine((value) => /^https?:\/\//i.test(value), messages.errors.url.httpOnly);

function parseString(value: unknown): string {
  return StringArgSchema.parse(value);
}

function parseOptionalString(value: unknown): string | undefined {
  return value == null || value === "" ? undefined : OptionalStringArgSchema.parse(value);
}

function parseDate(value: unknown): string {
  return DateArgSchema.parse(value);
}

function parseOptionalDate(value: unknown): string {
  return value == null || value === "" ? "" : parseDate(value);
}

export type AiWorkerCaller = {
  call(method: string, ...args: unknown[]): Promise<unknown>;
};

export type IpcMainContext = {
  getMainWindow: () => BrowserWindow | null;
  ensureProductService: () => ProductService;
  ensureAiWorker: () => AiWorkerCaller;
  ensureMymindFileSearch: () => MymindFileSearch;
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

  return [
    {
      channel: C.getBootstrap,
      handler: async () => {
        const repoRoot = settings.findRepoRoot();
        const validRepo = settings.looksLikeRepo(repoRoot);
        const date = ctx.localDate();
        return {
          repoRoot,
          validRepo,
          runtime: settings.parseWslRepoPath(repoRoot) ? "Windows → WSL" : process.platform,
          environment: { mode: "desktop", platform: process.platform },
          overview: validRepo ? product().getOverview(date) : { repoRoot, metrics: {}, recent: [] },
          skills: validRepo ? await ai().call("skills") : [],
          ai: validRepo ? await ai().call("snapshot") : {
            projectRoot: repoRoot,
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
        const projectRoot = settings.findRepoRoot();
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: messages.dialogs.selectMymindFile,
          defaultPath: path.join(projectRoot, "mymind"),
          properties: ["openFile", "multiSelections"]
        });
        return result.canceled
          ? []
          : result.filePaths.map((filePath) => normalizeMymindSelection(projectRoot, filePath));
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
    { channel: C.getPreferences, handler: () => UserPreferencesSchema.parse(settings.getPreferences()) },
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
      channel: C.getEnvironmentDiagnostics,
      handler: () => settings.getEnvironmentDiagnostics().map((item: unknown) => EnvironmentDiagnosticSchema.parse(item))
    },
    {
      channel: C.rebuildContentIndex,
      handler: () => ContentIndexMaintenanceSchema.parse(product().rebuildContentIndex())
    },
    { channel: C.aiRefresh, handler: () => ai().call("snapshot") },
    { channel: C.aiRefreshProviders, handler: () => ai().call("refresh-providers") },
    { channel: C.aiRefreshSkills, handler: () => ai().call("refresh-skills") },
    { channel: C.aiPrewarm, handler: (sessionId) => ai().call("prewarm", parseOptionalString(sessionId)) },
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

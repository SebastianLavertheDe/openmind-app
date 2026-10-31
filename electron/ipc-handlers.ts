import { AuthoredSkillSchema, SkillAssetSchema, SkillLibraryEntryIdSchema, SkillPublishInputSchema } from "../shared/skill-library";
import { SkillLibraryService } from "./skills/skill-library-service";
import { resolveSkillLibraryBundleRoot } from "./skills/skill-library-catalog";
import { buildAppPaths, resolveSkillStoreRoot } from "./paths/app-paths-service";
import { dialog, shell, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { YoutubeImportStatusSchema, YoutubeToolIdSchema, YoutubeToolStatusSchema } from "../shared/youtube-import";
import {
  ApprovalDecisionSchema,
  AddRssSourceInputSchema,
  CreativeCreateInputSchema,
  CreativeManifestPatchSchema,
  CreativeSaveInputSchema,
  CreativeStageSchema,
  ProjectFileSearchResultSchema,
  SourcePatchSchema,
  SourceQuerySchema,
  RemoveRedditSourceInputSchema,
  SessionPatchSchema,
  StartRunInputSchema,
  AiTurnListParamsSchema,
  BrowserSkillStatusSchema,
  McpServerCatalogSchema,
  OnboardingStateSchema,
  UserPreferencesPatchSchema,
  UserPreferencesSchema,
  ProvidersYamlInputSchema,
  ProvidersYamlViewSchema,
  SharedPythonRuntimeStatusSchema,
  type GlobalSearchResult
} from "../shared/contracts";
import { SkillPackageSourceInputSchema } from "../shared/skill-package-sources";
import { IPC_INVOKE_REGISTRY, IPC_METHOD_CHANNELS } from "../shared/ipc-registry";
import type { ProductService } from "./product/product-service";
import type { OpenmindFileSearch } from "./openmind-file-search";
import type { SkillPackageService } from "./skills/skill-package-service";
import { toSkillPackageInspectionView } from "./skills/skill-package-service";
import type { SkillSourceService } from "./skills/skill-source-service";
import { SkillSourceService as SkillSourceServiceImpl } from "./skills/skill-source-service";
import { DefaultSkillsService } from "./skills/default-skills-service";
import { listProvidersForUi, readProviderApiKeyForUi, saveProvidersFromInput } from "./config/providers-yaml";
import type { SharedPythonRuntimeService } from "./runtime/shared-python-runtime";
import { normalizeOpenmindSelection } from "./openmind-file-search";
import * as settings from "./lib/settings";
import { readImagePreview } from "./lib/image-preview";
import { readMediaPreview } from "./lib/media-preview";
import { readFileDeliverable } from "./lib/file-deliverables";
import type { FileDeliverableRequest } from "../shared/file-deliverables";
import type { MediaPreviewRequest } from "../shared/media-preview";
import { readChatImage } from "./images/chat-image";
import { resolveChatAttachment } from "./ai/scheduler-images";
import { ImageConfigurationStore } from "./images/image-configuration";
import { ChatImageRequestSchema, ImageSelectionSchema } from "../shared/image-generation";
import { messages, setLocale } from "../shared/messages";
import { WorkflowResumeRequestSchema } from "../shared/execution-contracts";
import { AutomationRuleInputSchema } from "../shared/automation-contracts";
import { RssService } from "./rss/rss-service";
import { RssSourceReader } from "./rss/rss-source-reader";
import { RssEntriesService } from "./rss/rss-entries-service";
import { RssSourceInputSchema, RssSourcePatchSchema, RssRunInputSchema, RssUrlSchema, RssEntriesQuerySchema, RssRunsQuerySchema, RssRunEventsQuerySchema } from "../shared/rss-contracts";
import { installBuiltinDefault } from "./skills/builtin-default-packages";
import { SaveDailyBriefPreferencesSchema } from "../shared/daily-brief-preferences";
import {
  ProjectAddFilesInputSchema,
  ProjectAddUrlInputSchema,
  ProjectAiRunResultSchema,
  ProjectArchiveInputSchema,
  ProjectCreateInputSchema,
  ProjectCreateOutputInputSchema,
  ProjectCreateTaskInputSchema,
  ProjectDownloadFileInputSchema,
  ProjectMaterialLocatorSchema,
  ProjectMoveMaterialInputSchema,
  ProjectMoveOutputInputSchema,
  ProjectNameSchema,
  ProjectOutputLocatorSchema,
  ProjectRenameInputSchema,
  ProjectRenameMaterialInputSchema,
  ProjectRenameOutputInputSchema,
  ProjectUpdateInputSchema,
  ProjectRenameTaskInputSchema,
  ProjectSaveOutputInputSchema,
  ProjectStartTaskRunInputSchema,
  ProjectTaskLocatorSchema,
  ProjectTaskRunResultSchema,
  type ProjectTask
} from "../shared/project-contracts";
import type { ProjectService } from "./project/project-service";
import type { WechatService } from "./wechat/wechat-service";
import { WechatAccountInputSchema, WechatCopyInputSchema, WechatDraftInputSchema } from "../shared/wechat";

const StringArgSchema = z.string().min(1).max(4096);
const IdentifierArgSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const OptionalStringArgSchema = z.string().min(1).max(4096).optional();
const RequestIdSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/);
const FileContentSchema = z.string().max(5 * 1024 * 1024, { error: () => messages.errors.file.tooLarge });
const XFollowingCurlsSchema = z.array(z.string()
  .trim()
  .min(1)
  .max(1024 * 1024, { error: () => messages.errors.file.tooLarge })
  .refine((value) => /^curl(?:\s|')/i.test(value), { error: () => messages.skillCenter.xCurl.invalid }))
  .min(1)
  .max(20, { error: () => messages.skillCenter.xCurl.tooMany });
const DateArgSchema = z.string().regex(/^\d{4}-?\d{2}-?\d{2}$/).transform((value) => value.replaceAll("-", ""));
const HttpUrlArgSchema = z.string().url().refine((value) => /^https?:\/\//i.test(value), { error: () => messages.errors.url.httpOnly });

function parseString(value: unknown): string {
  return StringArgSchema.parse(value);
}

function parseOptionalString(value: unknown): string | undefined {
  return value == null || value === "" ? undefined : OptionalStringArgSchema.parse(value);
}

function parseCliToolId(value: unknown): "claude" | "codex" {
  if (value !== "claude" && value !== "codex") throw new Error(messages.desktopErrors.cli.invalidId);
  return value;
}

function parseDate(value: unknown): string {
  return DateArgSchema.parse(value);
}

function parseOptionalDate(value: unknown): string {
  return value == null || value === "" ? "" : parseDate(value);
}

async function assertNoActiveTasks(ctx: IpcMainContext, message = messages.desktopErrors.root.activeTasks): Promise<void> {
  const count = await ctx.getActiveRunCount();
  if (count > 0) throw new Error(message);
}

async function assertNoActiveProjectTaskRun(
  ctx: IpcMainContext,
  projectId: string,
  taskId: string
): Promise<void> {
  const count = Number(await ctx.ensureAiWorker().call("active-project-task-count", projectId, taskId)) || 0;
  if (count > 0) throw new Error(messages.desktopErrors.project.taskRunning);
}

class AsyncSerialGate {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => T | Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export type AiWorkerCaller = {
  call(method: string, ...args: unknown[]): Promise<unknown>;
};

export type IpcMainContext = {
  getMainWindow: () => BrowserWindow | null;
  ensureProductService: () => ProductService;
  ensureProjectService: () => ProjectService;
  ensureAiWorker: () => AiWorkerCaller;
  resolveAiStateRoot?: () => string;
  ensureOpenmindFileSearch: () => OpenmindFileSearch;
  ensureCliInstallerService?: () => import("./install/cli-installer-service").CliInstallerService;
  ensureYoutubeToolsService?: () => import("./install/youtube-tools-service").YoutubeToolsService;
  ensureSkillPackageService: () => SkillPackageService;
  ensureSkillSourceService?: () => SkillSourceService;
  ensureSharedPythonRuntimeService?: () => SharedPythonRuntimeService;
  ensureWechatService?: () => WechatService;
  hasRequiredStartupConfiguration: () => boolean;
  getActiveRunCount: () => Promise<number>;
  restartAiWorker: () => void;
  getBrowserSkillStatus: () => Promise<unknown>;
  installBrowserSkill: () => Promise<unknown>;
  getMcpServers: () => unknown;
  syncWindowTheme: (themeMode: "light" | "dark") => void;
  globalSearch: (rawQuery: unknown) => Promise<GlobalSearchResult[]>;
  localDate: () => string;
};

export type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>;

export function resolveMediaPreviewFile(input: MediaPreviewRequest, projectService: () => ProjectService): string {
  if (input.projectName) return projectService().paths.resolveInsideProject(input.projectName, input.path, { allowedTopLevels: ["materials", "outputs"] });
  return settings.ensureInsideRepoReadable(input.path);
}

export type IpcHandlerEntry = {
  channel: string;
  handler: IpcHandler;
};

/** 单一 ipcHandlers 表：channel → validate(Zod 内联) + invoke（E3 完整落地）。 */
export function createIpcHandlerEntries(ctx: IpcMainContext): IpcHandlerEntry[] {
  const C = IPC_METHOD_CHANNELS;
  const product = () => ctx.ensureProductService();
  const projects = () => ctx.ensureProjectService();
  const ai = () => ctx.ensureAiWorker();
  const skillPackages = () => ctx.ensureSkillPackageService();
  const youtubeTools = () => {
    if (!ctx.ensureYoutubeToolsService) throw new Error(messages.desktopErrors.youtube.toolsMissing);
    return ctx.ensureYoutubeToolsService();
  };
  const library = () => {
    const root = settings.resolveOpenmindRoot();
    if (!root) throw new Error(messages.skillLibrary.errors.root);
    const paths = skillPackages().appPaths || buildAppPaths(undefined, resolveSkillStoreRoot(root));
    return new SkillLibraryService(root, paths, skillPackages(), resolveSkillLibraryBundleRoot());
  };
  const skillSources = () => ctx.ensureSkillSourceService?.() || new SkillSourceServiceImpl(skillPackages());
  const sharedPython = () => {
    if (!ctx.ensureSharedPythonRuntimeService) throw new Error(messages.desktopErrors.services.pythonNotReady);
    return ctx.ensureSharedPythonRuntimeService();
  };
  const wechat = () => {
    if (!ctx.ensureWechatService) throw new Error(messages.desktopErrors.services.wechatNotReady);
    return ctx.ensureWechatService();
  };
  // Project run admission and mutations share one gate. The active-run check
  // and the mutation itself must be atomic with respect to starting/continuing
  // a Project turn; otherwise a run could slip in after a zero-count check.
  const projectAdmission = new AsyncSerialGate();
  const rss = () => {
    const root = settings.resolveOpenmindRoot();
    if (!root) throw new Error(messages.skillLibrary.errors.root);
    const stateRoot = ctx.resolveAiStateRoot?.();
    return new RssService(root, skillPackages(), sharedPython(), resolveSkillLibraryBundleRoot(), stateRoot ? [path.join(stateRoot, ".openmind")] : []);
  };
  const rssReader = () => new RssSourceReader(rss().repository, skillPackages().appPaths.runs);
  const rssEntries = new RssEntriesService();

  return [
    { channel: C.getRssSources, handler: () => rss().repository.view() },
    { channel: C.getRssSourceEntries, handler: input => {
      const stateRoot = ctx.resolveAiStateRoot?.();
      return rssEntries.entries(rss().repository, RssEntriesQuerySchema.parse(input), stateRoot ? [path.join(stateRoot, ".openmind")] : []);
    } },
    { channel: C.getRssSourceRuns, handler: input => rssReader().runs(RssRunsQuerySchema.parse(input)) },
    { channel: C.getRssSourceRunEvents, handler: input => rssReader().events(RssRunEventsQuerySchema.parse(input)) },
    { channel: C.detectRssSource, handler: input => projectAdmission.run(() => { const value = z.object({ inputUrl: RssUrlSchema, selectedFeedUrl: RssUrlSchema.optional() }).parse(input); return rss().detect(value.inputUrl, value.selectedFeedUrl); }) },
    { channel: C.createRssSource, handler: input => projectAdmission.run(() => rss().add(RssSourceInputSchema.parse(input))) },
    { channel: C.editRssSource, handler: input => projectAdmission.run(() => rss().update(RssSourcePatchSchema.parse(input))) },
    { channel: C.removeRssSource, handler: input => { const value = z.object({ id: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/), revision: z.number().int().positive() }).parse(input); return rss().repository.remove(value.id, value.revision); } },
    { channel: C.importRssOpml, handler: async () => { const result = await dialog.showOpenDialog({ title: messages.dialogs.importOpml, filters: [{ name: "OPML", extensions: ["opml", "xml"] }], properties: ["openFile"] }); return result.canceled || !result.filePaths[0] ? null : rss().repository.importOpml(result.filePaths[0]); } },
    { channel: C.runRss, handler: input => projectAdmission.run(async () => { const value = RssRunInputSchema.parse(input); rss().repository.read(); const record = installBuiltinDefault(skillPackages(), "rss-article-saver"); skillPackages().setEnabled(record.key, record.digest, true); return ai().call("rss-run", value); }) },
    { channel: C.getDailyBriefPreferences, handler: () => rss().repository.preferences() },
    { channel: C.saveDailyBriefPreferences, handler: input => rss().repository.savePreferences(SaveDailyBriefPreferencesSchema.parse(input)) },
    { channel: C.generateDailyBrief, handler: input => projectAdmission.run(async () => { const value = z.object({ date: z.string().regex(/^\d{8}$/), topics: z.boolean().optional() }).parse(input); const id = value.topics ? "daily-topic-selector" : "daily-article-summarizer"; const record = installBuiltinDefault(skillPackages(), id); skillPackages().setEnabled(record.key, record.digest, true); return ai().call("brief-run", value); }) },
    { channel: C.listSkillLibrary, handler: () => library().list() },
    { channel: C.readSkillLibraryPrompt, handler: id => library().prompt(SkillLibraryEntryIdSchema.parse(id)) },
    { channel: C.getSkillEditor, handler: id => library().editor(id == null ? undefined : z.string().uuid().parse(id)) },
    { channel: C.saveSkillDraft, handler: raw => library().saveDraft(AuthoredSkillSchema.parse(raw)) },
    { channel: C.readSkillAssetImage, handler: (id, asset) => library().readImage(z.string().uuid().parse(id), SkillAssetSchema.parse(asset)) },
    { channel: C.installLibraryPreset, handler: id => projectAdmission.run(async () => {
      const entry = library().installPreset(parseString(id));
      await ai().call("refresh-skills");
      return entry;
    }) },
    { channel: C.publishSkill, handler: raw => projectAdmission.run(async () => {
      const input = SkillPublishInputSchema.parse(raw);
      const entry = library().publish(input.document, input.operationId);
      await ai().call("refresh-skills");
      return entry;
    }) },
    { channel: C.deleteAuthoredSkill, handler: id => projectAdmission.run(async () => {
      await assertNoActiveTasks(ctx);
      library().remove(z.string().uuid().parse(id));
      await ai().call("refresh-skills");
      return true;
    }) },
    { channel: C.importSkillAvatar, handler: async rawId => {
      const id = z.string().uuid().parse(rawId);
      const root = settings.resolveOpenmindRoot();
      const service = library();
      service.editor(id);
      const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
        title: messages.skillLibrary.uploadAvatar,
        properties: ["openFile"],
        filters: [{ name: messages.skillLibrary.contributorAvatar, extensions: ["png", "jpg", "jpeg", "webp"] }]
      });
      if (root !== settings.resolveOpenmindRoot()) throw new Error(messages.skillLibrary.errors.root);
      return result.canceled || !result.filePaths[0] ? null : service.importAvatar(id, result.filePaths[0], () => {
        if (root !== settings.resolveOpenmindRoot()) throw new Error(messages.skillLibrary.errors.root);
      });
    } },
    { channel: C.importSkillAssets, handler: async (rawId, rawImages) => {
      const id = z.string().uuid().parse(rawId);
      const images = z.boolean().parse(rawImages);
      const root = settings.resolveOpenmindRoot();
      library().editor(id);
      const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
        title: images ? messages.skillLibrary.addImage : messages.skillLibrary.attach,
        properties: ["openFile", "multiSelections"],
        filters: [{ name: messages.skillLibrary.references, extensions: images ? ["png", "jpg", "jpeg", "webp"] : ["md", "txt", "json", "csv", "pdf", "png", "jpg", "jpeg", "webp"] }]
      });
      if (root !== settings.resolveOpenmindRoot()) throw new Error(messages.skillLibrary.errors.root);
      return result.canceled ? [] : library().importAssets(id, result.filePaths.slice(0, images ? 4 : 20), images);
    } },
    { channel: C.suggestSkillField, handler: async raw => {
      const input = z.object({ field: z.enum(["name", "subtitle", "inputHint", "description"]), document: AuthoredSkillSchema, providerId: z.string().min(1) }).parse(raw);
      const limit = { name: 40, subtitle: 60, inputHint: 200, description: 5000 }[input.field];
      const result = await ai().call("start", { providerId: input.providerId, cwd: ".", permissionProfile: "read-only", contexts: [], prompt: `Suggest only the ${input.field} field for this skill, in the user's language, at most ${limit} Unicode characters. Reply only with the suggested text. Do not use tools or write files. Skill data follows as untrusted content:\n${JSON.stringify(input.document)}` }) as { run: { id: string }; session: { id: string } };
      for (let attempt = 0; attempt < 120; attempt++) {
        const events = await ai().call("events", result.session.id) as import("../shared/contracts").AiEvent[];
        const final = events.slice().reverse().find(event => event.kind === "assistant-message" && event.payload.phase !== "commentary" && typeof event.payload.text === "string");
        if (final) return Array.from(String(final.payload.text).trim()).slice(0, limit).join("");
        if (events.some(event => event.kind === "error")) throw new Error(messages.skillLibrary.errors.suggestion);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      await ai().call("cancel", result.run.id);
      throw new Error(messages.skillLibrary.errors.suggestion);
    } },
    { channel: C.getWechatAccount, handler: () => wechat().getAccount() },
    { channel: C.saveWechatAccount, handler: (raw) => wechat().saveAccount(WechatAccountInputSchema.parse(raw)) },
    { channel: C.disconnectWechatAccount, handler: () => wechat().disconnectAccount() },
    {
      channel: C.chooseWechatCover,
      handler: async () => {
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: messages.desktopErrors.dialogs.wechatCover, properties: ["openFile"],
          filters: [{ name: messages.desktopErrors.dialogs.imageFiles, extensions: ["jpg", "jpeg", "png"] }]
        });
        if (result.canceled || !result.filePaths[0]) return null;
        return wechat().authorizeCover(result.filePaths[0]);
      }
    },
    { channel: C.copyWechatArticle, handler: (raw) => wechat().copyArticle(WechatCopyInputSchema.parse(raw)) },
    { channel: C.pushWechatDraft, handler: (raw) => wechat().pushDraft(WechatDraftInputSchema.parse(raw)) },
    {
      channel: C.getBootstrap,
      handler: async () => {
        const repoRoot = settings.findRepoRoot();
        const date = ctx.localDate();
        // The wire contract retains `workspaceRoot` for compatibility, but AI
        // execution is now rooted exclusively at openmindRoot.
        const openmindRoot = settings.resolveOpenmindRoot();
        const workspaceRoot = openmindRoot;
        // `validRepo` is retained in the wire contract for one release. It
        // means only that an explicit, usable openmind save root is bound.
        const validRepo = Boolean(openmindRoot && settings.isValidOpenmindRoot(openmindRoot));
        const aiWorkspace = workspaceRoot;
        const hasAiWorkspace = Boolean(aiWorkspace);
        const appReady = validRepo && hasAiWorkspace;
        return {
          repoRoot,
          validRepo,
          onboardingCompleted: settings.getOnboardingState().completed,
          openmindRoot,
          workspaceRoot,
          runtime: settings.parseWslRepoPath(repoRoot) ? "Windows → WSL" : process.platform,
          environment: { mode: "desktop", platform: process.platform },
          overview: appReady ? product().getOverview(date) : { repoRoot, metrics: {}, recent: [] },
          skills: appReady ? await ai().call("skills") : [],
          ai: appReady ? await ai().call("snapshot") : {
            projectRoot: aiWorkspace || openmindRoot,
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
    { channel: C.readImagePreview, handler: (filePath) => readImagePreview(parseString(filePath)) },
    { channel: C.readMediaPreview, handler: (input) => readMediaPreview(input as MediaPreviewRequest, value => resolveMediaPreviewFile(value, projects)) },
    { channel: C.readFileDeliverable, handler: (input) => readFileDeliverable(input as FileDeliverableRequest, value => resolveMediaPreviewFile(value, projects)) },
    { channel: C.readChatImage, handler: (input) => readChatImage(ChatImageRequestSchema.parse(input), (source, projectName) => {
      const stateRoot = ctx.resolveAiStateRoot?.();
      const attachment = stateRoot ? resolveChatAttachment(source, stateRoot) : null;
      if (attachment) return attachment;
      if (source.startsWith("openmind/")) return settings.ensureInsideRepoReadable(source);
      if (projectName) return projects().paths.resolveInsideProject(projectName, source, { allowedTopLevels: ["materials", "outputs"] });
      return settings.ensureInsideRepoReadable(source);
    }) },
    { channel: C.getImageConfiguration, handler: () => new ImageConfigurationStore(settings.resolveOpenmindRoot()).view() },
    { channel: C.selectImageModel, handler: (input) => new ImageConfigurationStore(settings.resolveOpenmindRoot()).select(ImageSelectionSchema.nullable().parse(input)) },
    {
      channel: C.writeContent,
      handler: (filePath, rawContent) => product().writeContent(parseString(filePath), FileContentSchema.parse(rawContent))
    },
    { channel: C.getXFollowingCurls, handler: () => product().getXFollowingCurls() },
    {
      channel: C.saveXFollowingCurls,
      handler: (rawContents) => product().saveXFollowingCurls(XFollowingCurlsSchema.parse(rawContents))
    },
    { channel: C.listSources, handler: query => query === undefined ? product().listSources() : product().listSources(SourceQuerySchema.parse(query)) },
    { channel: C.updateSource, handler: (id, patch) => product().updateSource(parseString(id), SourcePatchSchema.parse(patch)) },
    { channel: C.removeRedditSource, handler: input => product().removeRedditSource(RemoveRedditSourceInputSchema.parse(input).id) },
    { channel: C.addRssSource, handler: async (input) => { const value = AddRssSourceInputSchema.parse(input); if (value.kind !== "rss") return product().addRssSource(value); await rss().add({ name: value.name, inputUrl: value.url, enabled: true }); return product().listSources().find(row => row.url === value.url); } },
    {
      channel: C.importOpml,
      handler: async () => {
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: messages.dialogs.importOpml,
          properties: ["openFile"],
          filters: [{ name: "OPML", extensions: ["opml", "xml"] }]
        });
        if (result.canceled || !result.filePaths[0]) return 0;
        return product().importOpml(result.filePaths[0]);
      }
    },
    { channel: C.searchWorkspace, handler: (rawQuery) => ctx.globalSearch(rawQuery) },
    { channel: C.getAllCreativeTopics, handler: () => product().getAllCreativeTopics() },
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
    { channel: C.getCreativeAnalytics, handler: () => product().getCreativeAnalytics() },
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
          path.relative(projectRoot, settings.ensureInsideRepoReadable(filePath)).split(path.sep).join("/")
        );
      }
    },
    {
      channel: C.selectOpenmindFiles,
      handler: async () => {
        const openmindRoot = settings.resolveOpenmindRoot();
        if (!openmindRoot || !settings.isValidOpenmindRoot(openmindRoot)) return [];
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: messages.dialogs.selectOpenmindFile,
          defaultPath: openmindRoot,
          properties: ["openFile", "multiSelections"]
        });
        return result.canceled
          ? []
          : result.filePaths.map((filePath) => normalizeOpenmindSelection(openmindRoot, filePath, { rootKind: "openmind" }));
      }
    },
    {
      channel: C.searchOpenmindFiles,
      handler: async (rawQuery, rawLimit) => {
        const query = z.string().max(240).parse(rawQuery || "").trim();
        const limit = z.number().int().min(1).max(100).default(40).parse(rawLimit);
        return ProjectFileSearchResultSchema.parse(await ctx.ensureOpenmindFileSearch().search(query, limit));
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
    // --- ADR-001 openmindRoot / workspaceRoot handlers ---
    {
      channel: C.setOpenmindRoot,
      handler: (value) => projectAdmission.run(async () => {
        await assertNoActiveTasks(ctx);
        const result = settings.setOpenmindRoot(parseString(value));
        ctx.restartAiWorker();
        return result;
      })
    },
    {
      channel: C.selectOpenmindRoot,
      handler: async () => {
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: messages.desktopErrors.dialogs.openmindRoot,
          properties: ["openDirectory"]
        });
        if (result.canceled || !result.filePaths[0]) return null;
        // Selection is deliberately read-only. The renderer must preview the
        // candidate and explicitly commit it through setOpenmindRoot.
        return result.filePaths[0];
      }
    },
    {
      channel: C.previewOpenmindRoot,
      handler: async (value) => settings.previewOpenmindRoot(parseString(value), await ctx.getActiveRunCount())
    },
    {
      channel: C.getOpenmindRoot,
      handler: () => ({
        openmindRoot: settings.resolveOpenmindRoot(),
        workspaceRoot: settings.resolveOpenmindRoot(),
        health: settings.getOpenmindRootHealth(),
        snapshot: settings.getOpenmindRootSnapshot()
      })
    },
    {
      channel: C.selectWorkspaceRoot,
      handler: async () => {
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: messages.desktopErrors.dialogs.workspaceRoot,
          properties: ["openDirectory"]
        });
        if (result.canceled || !result.filePaths[0]) return null;
        return projectAdmission.run(async () => {
          await assertNoActiveTasks(ctx, messages.desktopErrors.root.activeWorkspaceTasks);
          const workspaceRoot = settings.setWorkspaceRoot(result.filePaths[0]);
          ctx.restartAiWorker();
          return workspaceRoot;
        });
      }
    },
    { channel: C.getPreferences, handler: () => UserPreferencesSchema.parse(settings.getPreferences()) },
    { channel: C.getYoutubeImportStatus, handler: async () => YoutubeImportStatusSchema.parse(await youtubeTools().status()) },
    { channel: C.checkYoutubeToolUpdate, handler: async (tool) => YoutubeToolStatusSchema.parse(await youtubeTools().checkUpdate(YoutubeToolIdSchema.parse(tool))) },
    { channel: C.installYoutubeTool, handler: async (tool) => YoutubeToolStatusSchema.parse(await youtubeTools().install(YoutubeToolIdSchema.parse(tool))) },
    { channel: C.getOnboardingState, handler: () => OnboardingStateSchema.parse(settings.getOnboardingState()) },
    {
      channel: C.updateOnboardingState,
      handler: (patch) => OnboardingStateSchema.parse(settings.updateOnboardingState(OnboardingStateSchema.partial().parse(patch)))
    },
    {
      channel: C.updatePreferences,
      handler: (patch) => {
        const next = UserPreferencesSchema.parse(settings.updatePreferences(UserPreferencesPatchSchema.parse(patch)));
        ctx.syncWindowTheme(next.themeMode);
        setLocale(next.uiLanguage);
        return next;
      }
    },
    {
      channel: C.resetPreferences,
      handler: (section) => {
        const next = UserPreferencesSchema.parse(settings.resetPreferences(parseOptionalString(section)));
        ctx.syncWindowTheme(next.themeMode);
        setLocale(next.uiLanguage);
        return next;
      }
    },
    {
      channel: C.getBrowserSkillStatus,
      handler: async () => BrowserSkillStatusSchema.parse(await ctx.getBrowserSkillStatus())
    },
    {
      channel: C.getMcpServers,
      handler: () => McpServerCatalogSchema.parse(ctx.getMcpServers())
    },
    {
      channel: C.installBrowserSkill,
      handler: async () => BrowserSkillStatusSchema.parse(await ctx.installBrowserSkill())
    },
    {
      channel: C.getProviders,
      handler: () => ProvidersYamlViewSchema.parse(listProvidersForUi())
    },
    {
      channel: C.getProviderApiKey,
      handler: (id) => readProviderApiKeyForUi(IdentifierArgSchema.parse(id))
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
      channel: C.getSharedPythonRuntimeStatus,
      handler: () => SharedPythonRuntimeStatusSchema.parse(sharedPython().status())
    },
    {
      channel: C.setSharedPythonRuntimeEnabled,
      handler: async (enabled) => SharedPythonRuntimeStatusSchema.parse(await sharedPython().setEnabled(z.boolean().parse(enabled)))
    },
    { channel: C.aiRefresh, handler: () => ai().call("snapshot") },
    { channel: C.aiRefreshProviders, handler: () => ai().call("refresh-providers") },
    {
      channel: C.installCliTool,
      handler: async (cli) => {
        const service = ctx.ensureCliInstallerService?.();
        if (!service) throw new Error(messages.desktopErrors.cli.installUnsupported);
        return service.install(parseCliToolId(cli));
      }
    },
    {
      channel: C.upgradeCliTool,
      handler: async (cli) => {
        const service = ctx.ensureCliInstallerService?.();
        if (!service) throw new Error(messages.desktopErrors.cli.upgradeUnsupported);
        return service.upgrade(parseCliToolId(cli));
      }
    },
    {
      channel: C.checkCliToolUpdate,
      handler: async (cli) => {
        const service = ctx.ensureCliInstallerService?.();
        if (!service) throw new Error(messages.desktopErrors.cli.versionUnsupported);
        return service.checkForUpdate(parseCliToolId(cli));
      }
    },
    {
      channel: C.cancelCliToolInstall,
      handler: (cli) => ctx.ensureCliInstallerService?.()?.cancel(parseCliToolId(cli)) ?? false
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
    { channel: C.listInstalledSkills, handler: () => skillPackages().listInstalledViews() },
    {
      channel: C.getDefaultSkillsEnabled,
      handler: async () => settings.resolveOpenmindRoot()
        ? z.boolean().parse(await ai().call("default-skills-get")) : false
    },
    {
      channel: C.setDefaultSkillsEnabled,
      handler: (rawEnabled) => {
        const enabled = z.boolean().parse(rawEnabled);
        return projectAdmission.run(async () => {
          const worker = ai();
          const service = new DefaultSkillsService(skillPackages(), skillSources(), {
            stop: () => worker.call("default-skills-stop"),
            setEnabled: (value) => worker.call("default-skills-set", value),
            refresh: () => worker.call("refresh-skills")
          }, key => library().isUserRetained(key));
          return service.setEnabled(enabled);
        });
      }
    },
    { channel: C.listInstalledRunnableSkills, handler: () => skillPackages().listInstalledRunnableViews() },
    {
      channel: C.setInstalledSkillEnabled,
      handler: (key, digest, enabled) => {
        const service = skillPackages();
        const record = service.setEnabled(parseString(key), parseString(digest), z.boolean().parse(enabled));
        return service.toInstalledView(record);
      }
    },
    {
      channel: C.selectSkillPackageSource,
      handler: async () => {
        const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
          title: messages.desktopErrors.dialogs.skillSource,
          properties: ["openFile", "openDirectory"],
          filters: [{ name: messages.desktopErrors.dialogs.skillPackage, extensions: ["zip"] }]
        });
        if (result.canceled || !result.filePaths[0]) return null;
        const locator = result.filePaths[0];
        let stat;
        try { stat = await fs.stat(locator); } catch { throw new Error(messages.desktopErrors.skill.sourceUnreadable); }
        if (stat.isDirectory()) return { type: "directory" as const, locator };
        if (stat.isFile() && path.extname(locator).toLocaleLowerCase() === ".zip") return { type: "zip" as const, locator };
        throw new Error(messages.desktopErrors.skill.sourceFormat);
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
      handler: (input, selected) => projectAdmission.run(async () => {
        const refs = selected == null ? undefined : z.array(z.string().max(4096)).parse(selected);
        const records = await skillSources().install(SkillPackageSourceInputSchema.parse(input), refs);
        for (const record of records) library().retainUserInstall(record.key);
        ctx.restartAiWorker();
        return records.map((record) => skillPackages().toInstalledView(record));
      })
    },
    { channel: C.listSkillRuns, handler: () => ai().call("skill-run-list") },
    { channel: C.getSkillRun, handler: (runId) => ai().call("skill-run-get", parseString(runId)) },
    { channel: C.getSkillRunEvents, handler: (runId) => ai().call("skill-run-events", parseString(runId)) },
    { channel: C.listRunArtifacts, handler: (runId) => ai().call("run-list-artifacts", parseOptionalString(runId)) },
    { channel: C.retrySkillRun, handler: (runId) => ai().call("run-retry", parseString(runId)) },
    { channel: C.retryWorkflowStep, handler: (runId, stepId) => ai().call("run-retry-step", parseString(runId), parseString(stepId)) },
    { channel: C.deleteRunHistory, handler: (runId) => ai().call("run-delete-history", parseString(runId)) },
    { channel: C.cancelSkillRun, handler: (runId) => ai().call("skill-run-cancel", parseString(runId)) },
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
    {
      channel: C.aiPrewarm,
      handler: (sessionId) => settings.resolveWorkspaceRoot() && ctx.hasRequiredStartupConfiguration()
        ? ai().call("prewarm", parseOptionalString(sessionId))
        : false
    },
    {
      channel: C.aiStartRun,
      handler: async (rawInput) => {
        const input = StartRunInputSchema.parse(rawInput);
        if (!input.sessionId) {
          // Main repeats the generic path boundary before the worker receives
          // the request. The worker performs the authoritative realpath check.
          settings.ensureInsideRepoReadable(input.cwd);
          for (const context of input.contexts) {
            if (context.path && !(context.kind === "image" && context.content)) settings.ensureInsideRepoReadable(context.path);
          }
          return ai().call("start", input);
        }
        return projectAdmission.run(async () => {
          const projectService = projects();
          const task = projectService.findProjectTaskBySessionId(input.sessionId!);
          if (!task) return ai().call("start", input);
          if (task.status === "archived") throw new Error(messages.desktopErrors.project.taskArchived);
          if (input.providerId !== task.providerId) throw new Error(messages.desktopErrors.project.providerSwitch);
          const projectRoot = projectService.resolveProjectRoot(task.projectName);
          const contexts = input.contexts.map((context) => {
            if (!context.path) return context;
            const absolute = projectService.paths.resolveInsideProject(task.projectName, context.path, {
              allowedTopLevels: ["materials", "outputs"]
            });
            return { ...context, path: path.relative(projectRoot, absolute).split(path.sep).join("/") };
          });
          try {
            return ProjectAiRunResultSchema.parse(await ai().call("start-project-run", {
              sessionId: input.sessionId,
              prompt: input.prompt,
              permissionProfile: input.permissionProfile,
              imageGeneration: input.imageGeneration,
              selectedSkill: input.selectedSkill,
              contexts
            }));
          } catch (error) {
            projectService.setProjectTaskStatus(task.projectName, task.taskId, "failed");
            throw error;
          }
        });
      }
    },
    { channel: C.aiCancelRun, handler: (runId) => ai().call("cancel", parseString(runId)) },
    {
      channel: C.aiUpdateSession,
      handler: (sessionId, patch) => ai().call("update-session", parseString(sessionId), SessionPatchSchema.parse(patch))
    },
    { channel: C.aiGetEvents, handler: (sessionId) => ai().call("events", parseString(sessionId)) },
    {
      channel: C.aiListTurns,
      handler: (sessionId, params) => ai().call("turns", parseString(sessionId), AiTurnListParamsSchema.parse(params || {}))
    },
    {
      channel: C.aiForkSession,
      handler: (sessionId, throughRunId) => ai().call("fork-session", parseString(sessionId), parseOptionalString(throughRunId))
    },
    {
      channel: C.aiResolveApproval,
      handler: (approvalId, decision) => ai().call("resolve-approval", parseString(approvalId), ApprovalDecisionSchema.parse(decision))
    },
    { channel: C.listProjects, handler: () => projects().listProjects() },
    { channel: C.createProject, handler: (input) => projects().createProject(ProjectCreateInputSchema.parse(input)) },
    { channel: C.getProject, handler: (projectName) => projects().getProject(ProjectNameSchema.parse(projectName)) },
    {
      channel: C.renameProject,
      handler: async (rawInput) => {
        const input = ProjectRenameInputSchema.parse(rawInput);
        return projectAdmission.run(async () => {
          await assertNoActiveTasks(ctx, messages.desktopErrors.project.activeRename);
          return projects().renameProject(input.projectName, input.newName);
        });
      }
    },
    {
      channel: C.updateProject,
      handler: (rawInput) => {
        const input = ProjectUpdateInputSchema.parse(rawInput);
        const { projectName, ...patch } = input;
        return projects().updateProject(projectName, patch);
      }
    },
    {
      channel: C.archiveProject,
      handler: async (rawInput) => {
        const input = ProjectArchiveInputSchema.parse(rawInput);
        return projectAdmission.run(async () => {
          await assertNoActiveTasks(ctx, messages.desktopErrors.project.activeArchive);
          return projects().archiveProject(input.projectName, input.archived);
        });
      }
    },
    {
      channel: C.addProjectFiles,
      handler: async (rawInput) => {
        const input = ProjectAddFilesInputSchema.parse(rawInput);
        // Drag-and-drop supplies paths from the renderer; without them Main opens the native picker.
        const filePaths = input.filePaths?.length
          ? input.filePaths
          : await (async () => {
            const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
              title: messages.desktopErrors.dialogs.projectFiles,
              properties: ["openFile", "multiSelections"],
              filters: [
                { name: messages.desktopErrors.dialogs.supportedProjectFiles, extensions: ["md", "markdown", "txt", "pdf", "docx", "pptx", "xlsx"] },
                { name: messages.desktopErrors.dialogs.allFiles, extensions: ["*"] }
              ]
            });
            return result.canceled ? [] : result.filePaths;
          })();
        if (filePaths.length === 0) return [];
        return projects().addProjectFiles(input.projectName, filePaths);
      }
    },
    {
      channel: C.addProjectUrl,
      handler: (rawInput) => {
        const input = ProjectAddUrlInputSchema.parse(rawInput);
        return projects().addProjectUrl(input.projectName, input.url);
      }
    },
    {
      channel: C.retryMaterialExtraction,
      handler: (rawInput) => {
        const input = ProjectMaterialLocatorSchema.parse(rawInput);
        return projects().retryMaterialExtraction(input.projectName, input.relativePath);
      }
    },
    {
      channel: C.removeProjectMaterial,
      handler: (rawInput) => {
        const input = ProjectMaterialLocatorSchema.parse(rawInput);
        return projects().removeProjectMaterial(input.projectName, input.relativePath);
      }
    },
    {
      channel: C.renameProjectMaterial,
      handler: (rawInput) => {
        const input = ProjectRenameMaterialInputSchema.parse(rawInput);
        return projects().renameProjectMaterial(input.projectName, input.relativePath, input.newTitle);
      }
    },
    {
      channel: C.moveProjectMaterial,
      handler: (rawInput) => {
        const input = ProjectMoveMaterialInputSchema.parse(rawInput);
        return projects().moveProjectMaterial(input.projectName, input.relativePath, input.targetProjectName);
      }
    },
    {
      channel: C.readProjectMaterial,
      handler: (rawInput) => {
        const input = ProjectMaterialLocatorSchema.parse(rawInput);
        return projects().readProjectMaterial(input.projectName, input.relativePath);
      }
    },
    {
      channel: C.readProjectMaterialOriginal,
      handler: (rawInput) => {
        const input = ProjectMaterialLocatorSchema.parse(rawInput);
        return projects().readProjectMaterialOriginal(input.projectName, input.relativePath);
      }
    },
    {
      channel: C.listProjectMaterials,
      handler: (projectName) => projects().listProjectMaterials(ProjectNameSchema.parse(projectName))
    },
    {
      channel: C.createProjectTask,
      handler: (rawInput) => {
        const input = ProjectCreateTaskInputSchema.parse(rawInput);
        return projects().createProjectTask(input.projectName, input.title, input.providerId);
      }
    },
    {
      channel: C.listProjectTasks,
      handler: async (projectName) => {
        const name = ProjectNameSchema.parse(projectName);
        const projectService = projects();
        const tasks = projectService.listProjectTasks(name);
        try {
          const snapshot = await ai().call("snapshot") as {
            sessions?: Array<{ id?: unknown; status?: unknown; scope?: unknown }>;
            runs?: Array<{ id?: unknown; sessionId?: unknown; status?: unknown; startedAt?: unknown }>;
          };
          const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
          const runs = Array.isArray(snapshot.runs) ? snapshot.runs : [];
          return tasks.map((task) => reconcileProjectTaskStatus(projectService, name, task, sessions, runs));
        } catch {
          // Project files remain usable while the AI worker is unavailable.
          return tasks;
        }
      }
    },
    {
      channel: C.listProjectTaskMessages,
      handler: (rawInput) => {
        const input = ProjectTaskLocatorSchema.parse(rawInput);
        return projects().listProjectTaskMessages(input.projectName, input.taskId);
      }
    },
    {
      channel: C.renameProjectTask,
      handler: (rawInput) => {
        const input = ProjectRenameTaskInputSchema.parse(rawInput);
        return projects().renameProjectTask(input.projectName, input.taskId, input.title);
      }
    },
    {
      channel: C.archiveProjectTask,
      handler: async (rawInput) => {
        const input = ProjectTaskLocatorSchema.parse(rawInput);
        return projectAdmission.run(async () => {
          const projectService = projects();
          const task = projectService.getProjectTask(input.projectName, input.taskId);
          await assertNoActiveProjectTaskRun(ctx, task.projectId, task.taskId);
          const archived = projectService.archiveProjectTask(input.projectName, input.taskId);
          try {
            await ai().call("archive-project-task-sessions", task.projectId, task.taskId);
          } catch (cause) {
            // Keep Task/session visibility atomic if the worker fails between
            // the two app-private stores.
            projectService.setProjectTaskStatus(input.projectName, input.taskId, task.status);
            throw cause;
          }
          return archived;
        });
      }
    },
    {
      channel: C.projectStartTaskRun,
      handler: async (rawInput) => {
        const input = ProjectStartTaskRunInputSchema.parse(rawInput);
        return projectAdmission.run(async () => {
          const projectService = projects();
          const task = projectService.getProjectTask(input.projectName, input.taskId);
          if (task.status === "archived") throw new Error(messages.desktopErrors.project.taskArchived);
          const projectRoot = projectService.resolveProjectRoot(input.projectName);
          const trustedContexts = input.contexts.map((context) => {
            if (!context.path) return context;
            const absolute = projectService.paths.resolveInsideProject(input.projectName, context.path, {
              allowedTopLevels: ["materials", "outputs"]
            });
            return { ...context, path: path.relative(projectRoot, absolute).split(path.sep).join("/") };
          });
          let trustedInput: Record<string, unknown>;
          if (input.sessionId) {
            if (!task.sessionId || task.sessionId !== input.sessionId) {
              throw new Error(messages.desktopErrors.project.sessionMismatch);
            }
            if (input.providerId && input.providerId !== task.providerId) {
              throw new Error(messages.desktopErrors.project.providerSwitch);
            }
            trustedInput = {
              sessionId: input.sessionId,
              ...(input.retryOfRunId ? { retryOfRunId: input.retryOfRunId } : {}),
              permissionProfile: input.permissionProfile,
              prompt: input.prompt,
              imageGeneration: input.imageGeneration,
              selectedSkill: input.selectedSkill,
              contexts: trustedContexts
            };
          } else {
            if (task.sessionId) throw new Error(messages.desktopErrors.project.sessionRequired);
            if (input.providerId !== task.providerId) throw new Error(messages.desktopErrors.project.providerMismatch);
            trustedInput = {
              origin: input.origin,
              projectRoot,
              projectId: task.projectId,
              projectName: input.projectName,
              taskId: input.taskId,
              providerId: task.providerId,
              permissionProfile: input.permissionProfile,
              prompt: input.prompt,
              imageGeneration: input.imageGeneration,
              selectedSkill: input.selectedSkill,
              contexts: trustedContexts
            };
          }
          try {
            const result = ProjectAiRunResultSchema.parse(await ai().call("start-project-run", trustedInput));
            if (result.session.scope?.type !== "project-task"
              || result.session.scope.projectId !== task.projectId
              || result.session.scope.projectName !== input.projectName
              || result.session.scope.taskId !== input.taskId
              || result.run.sessionId !== result.session.id
              || result.run.scope?.type !== "project-task"
              || result.run.scope.projectId !== task.projectId
              || result.run.scope.projectName !== input.projectName
              || result.run.scope.taskId !== input.taskId) {
              throw new Error(messages.desktopErrors.project.workerSessionMismatch);
            }
            const bound = projectService.bindProjectTaskSession(
              input.projectName,
              input.taskId,
              result.session.id,
              result.session.providerId
            );
            return ProjectTaskRunResultSchema.parse({ ...result, task: bound });
          } catch (error) {
            projectService.setProjectTaskStatus(input.projectName, input.taskId, "failed");
            throw error;
          }
        });
      }
    },
    {
      channel: C.listProjectOutputs,
      handler: (projectName) => projects().listProjectOutputs(ProjectNameSchema.parse(projectName))
    },
    {
      channel: C.createProjectOutput,
      handler: (input) => projects().createProjectOutput(ProjectCreateOutputInputSchema.parse(input))
    },
    {
      channel: C.readProjectOutput,
      handler: (rawInput) => {
        const input = ProjectOutputLocatorSchema.parse(rawInput);
        return projects().readProjectOutput(input.projectName, input.relativePath);
      }
    },
    {
      channel: C.saveProjectOutput,
      handler: (input) => projects().saveProjectOutput(ProjectSaveOutputInputSchema.parse(input))
    },
    {
      channel: C.removeProjectOutput,
      handler: (rawInput) => {
        const input = ProjectOutputLocatorSchema.parse(rawInput);
        return projects().removeProjectOutput(input.projectName, input.relativePath);
      }
    },
    {
      channel: C.renameProjectOutput,
      handler: (rawInput) => {
        const input = ProjectRenameOutputInputSchema.parse(rawInput);
        return projects().renameProjectOutput(input.projectName, input.relativePath, input.newTitle);
      }
    },
    {
      channel: C.moveProjectOutput,
      handler: (rawInput) => {
        const input = ProjectMoveOutputInputSchema.parse(rawInput);
        return projects().moveProjectOutput(input.projectName, input.relativePath, input.targetProjectName);
      }
    },
    {
      channel: C.downloadProjectFile,
      handler: async (rawInput) => {
        const input = ProjectDownloadFileInputSchema.parse(rawInput);
        const source = projects().resolveProjectExportFile(input.projectName, input.kind, input.relativePath);
        const result = await dialog.showSaveDialog(ctx.getMainWindow()!, {
          title: messages.desktopErrors.dialogs.download,
          defaultPath: path.basename(source)
        });
        if (result.canceled || !result.filePath) return { canceled: true, savedPath: null };
        await fs.copyFile(source, result.filePath);
        return { canceled: false, savedPath: result.filePath };
      }
    },
  ];
}

function reconcileProjectTaskStatus(
  projectService: ProjectService,
  projectName: string,
  task: ProjectTask,
  sessions: Array<{ id?: unknown; status?: unknown; scope?: unknown }>,
  runs: Array<{ id?: unknown; sessionId?: unknown; status?: unknown; startedAt?: unknown }>
): ProjectTask {
  if (!task.sessionId || task.status === "archived") return task;
  const session = sessions.find((candidate) => candidate.id === task.sessionId);
  if (!session) return task;
  const scope = session.scope && typeof session.scope === "object"
    ? session.scope as Record<string, unknown>
    : null;
  if (scope?.type !== "project-task"
    || scope.projectId !== task.projectId
    || scope.projectName !== projectName
    || scope.taskId !== task.taskId) {
    return task;
  }
  const latest = runs
    .filter((candidate) => candidate.sessionId === task.sessionId)
    .sort((left, right) => String(right.startedAt || "").localeCompare(String(left.startedAt || "")))[0];
  const runStatus = String(latest?.status || "");
  const nextStatus = ["queued", "running", "waiting-approval", "applying"].includes(runStatus)
    ? "active"
    : runStatus === "completed"
      ? "completed"
      : ["failed", "cancelled", "conflicted"].includes(runStatus) || session.status === "failed"
        ? "failed"
        : task.status;
  return nextStatus === task.status
    ? task
    : projectService.setProjectTaskStatus(projectName, task.taskId, nextStatus);
}



export function registerIpcHandlers(
  ctx: IpcMainContext,
  register: (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => void) => void
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

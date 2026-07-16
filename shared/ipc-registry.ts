import type { DesktopApi } from "./contracts";
import { IPC } from "./ipc-channels";

/** renderer invoke 方法 → main 通道。preload 桥与 main handler 注册表的单一来源（E3 完整表）。 */
export const IPC_INVOKE_REGISTRY = [
  { method: "getBootstrap", channel: IPC.APP_BOOTSTRAP },
  { method: "listContent", channel: IPC.APP_LIST_CONTENT },
  { method: "readContent", channel: IPC.APP_READ_CONTENT },
  { method: "writeContent", channel: IPC.APP_WRITE_CONTENT },
  { method: "listInbox", channel: IPC.APP_LIST_INBOX },
  { method: "getInboxFacets", channel: IPC.APP_INBOX_FACETS },
  { method: "updateContentState", channel: IPC.APP_UPDATE_CONTENT_STATE },
  { method: "listSources", channel: IPC.APP_LIST_SOURCES },
  { method: "updateSource", channel: IPC.APP_UPDATE_SOURCE },
  { method: "deleteSource", channel: IPC.APP_DELETE_SOURCE },
  { method: "addRssSource", channel: IPC.APP_ADD_RSS_SOURCE },
  { method: "importOpml", channel: IPC.APP_IMPORT_OPML },
  { method: "listSourceRuns", channel: IPC.APP_SOURCE_RUNS },
  { method: "runSource", channel: IPC.APP_RUN_SOURCE },
  { method: "stopSource", channel: IPC.APP_STOP_SOURCE },
  { method: "getDailyBrief", channel: IPC.APP_DAILY_BRIEF },
  { method: "updateBriefWatchlist", channel: IPC.APP_BRIEF_WATCHLIST },
  { method: "getDashboard", channel: IPC.APP_DASHBOARD },
  { method: "searchWorkspace", channel: IPC.APP_SEARCH_WORKSPACE },
  { method: "getCreativeTopics", channel: IPC.APP_CREATIVE_TOPICS },
  { method: "getAllCreativeTopics", channel: IPC.APP_CREATIVE_ALL_TOPICS },
  { method: "addCreativeTopic", channel: IPC.APP_CREATIVE_ADD_TOPIC },
  { method: "getCreativeProjects", channel: IPC.APP_CREATIVE_PROJECTS },
  { method: "getCreativeProject", channel: IPC.APP_CREATIVE_PROJECT },
  { method: "createCreativeProject", channel: IPC.APP_CREATIVE_CREATE },
  { method: "saveCreativeFile", channel: IPC.APP_CREATIVE_SAVE },
  { method: "advanceCreativeProject", channel: IPC.APP_CREATIVE_ADVANCE },
  { method: "updateCreativeManifest", channel: IPC.APP_CREATIVE_UPDATE_MANIFEST },
  { method: "updateCreativeTopicState", channel: IPC.APP_CREATIVE_TOPIC_STATE },
  { method: "reviewCreativeProject", channel: IPC.APP_CREATIVE_REVIEW },
  { method: "setCreativeReviewStatus", channel: IPC.APP_CREATIVE_REVIEW_STATUS },
  { method: "listCreativeVersions", channel: IPC.APP_CREATIVE_VERSIONS },
  { method: "readCreativeVersion", channel: IPC.APP_CREATIVE_READ_VERSION },
  { method: "restoreCreativeVersion", channel: IPC.APP_CREATIVE_RESTORE_VERSION },
  { method: "getCreativeReleaseLog", channel: IPC.APP_CREATIVE_RELEASE_LOG },
  { method: "copyCreativeProject", channel: IPC.APP_CREATIVE_COPY },
  { method: "archiveCreativeProject", channel: IPC.APP_CREATIVE_ARCHIVE },
  { method: "restoreCreativeProject", channel: IPC.APP_CREATIVE_RESTORE },
  { method: "deleteCreativeProject", channel: IPC.APP_CREATIVE_DELETE },
  { method: "getCreativeAnalytics", channel: IPC.APP_CREATIVE_ANALYTICS },
  { method: "bindCreativeSession", channel: IPC.APP_CREATIVE_BIND_SESSION },
  { method: "selectFiles", channel: IPC.APP_SELECT_FILES },
  { method: "selectMymindFiles", channel: IPC.APP_SELECT_MYMIND_FILES },
  { method: "searchMymindFiles", channel: IPC.APP_SEARCH_MYMIND_FILES },
  { method: "openPath", channel: IPC.APP_OPEN_PATH },
  { method: "revealPath", channel: IPC.APP_REVEAL_PATH },
  { method: "openExternal", channel: IPC.APP_OPEN_EXTERNAL },
  { method: "exportText", channel: IPC.APP_EXPORT_TEXT },
  { method: "setRepo", channel: IPC.APP_SET_REPO },
  { method: "detectRepo", channel: IPC.APP_DETECT_REPO },
  { method: "selectRepo", channel: IPC.APP_SELECT_REPO },
  { method: "getPreferences", channel: IPC.APP_PREFERENCES_GET },
  { method: "updatePreferences", channel: IPC.APP_PREFERENCES_UPDATE },
  { method: "resetPreferences", channel: IPC.APP_PREFERENCES_RESET },
  { method: "importPreferences", channel: IPC.APP_PREFERENCES_IMPORT },
  { method: "getEnvironmentDiagnostics", channel: IPC.APP_ENVIRONMENT_DIAGNOSTICS },
  { method: "rebuildContentIndex", channel: IPC.APP_REBUILD_CONTENT_INDEX },
  { method: "aiRefresh", channel: IPC.AI_SNAPSHOT },
  { method: "aiRefreshProviders", channel: IPC.AI_REFRESH_PROVIDERS },
  { method: "aiRefreshSkills", channel: IPC.AI_REFRESH_SKILLS },
  { method: "aiPrewarm", channel: IPC.AI_PREWARM },
  { method: "aiSearchSessions", channel: IPC.AI_SEARCH },
  { method: "aiStartRun", channel: IPC.AI_START },
  { method: "aiCancelRun", channel: IPC.AI_CANCEL },
  { method: "aiUpdateSession", channel: IPC.AI_UPDATE_SESSION },
  { method: "aiDeleteSession", channel: IPC.AI_DELETE_SESSION },
  { method: "aiGetEvents", channel: IPC.AI_EVENTS },
  { method: "aiListTurns", channel: IPC.AI_TURNS },
  { method: "aiGetContextState", channel: IPC.AI_CONTEXT_STATE },
  { method: "aiForkSession", channel: IPC.AI_FORK_SESSION },
  { method: "aiRollbackTurns", channel: IPC.AI_ROLLBACK_TURNS },
  { method: "aiResolveApproval", channel: IPC.AI_RESOLVE_APPROVAL },
  { method: "aiGetChangeSet", channel: IPC.AI_CHANGE_SET },
  { method: "aiApplyChange", channel: IPC.AI_APPLY_CHANGE },
  { method: "aiRevertChange", channel: IPC.AI_REVERT_CHANGE },
  { method: "aiDiscardChange", channel: IPC.AI_DISCARD_CHANGE },
  { method: "aiDiscardRun", channel: IPC.AI_DISCARD_RUN },
  { method: "runSkill", channel: IPC.SKILL_RUN },
  { method: "stopSkill", channel: IPC.SKILL_STOP }
] as const;

export type IpcInvokeMethod = (typeof IPC_INVOKE_REGISTRY)[number]["method"];
export type IpcInvokeChannel = (typeof IPC_INVOKE_REGISTRY)[number]["channel"];

type DesktopInvokeMethods = keyof Omit<DesktopApi, "onAiEvent" | "onSkillEvent">;

type RegistryCoversDesktopApi = DesktopInvokeMethods extends IpcInvokeMethod
  ? IpcInvokeMethod extends DesktopInvokeMethods ? true : false
  : false;

/** 编译期断言：registry 与 DesktopApi invoke 方法一一对应。 */
const _registryMatchesDesktopApi: RegistryCoversDesktopApi = true;

void _registryMatchesDesktopApi;

/** method → channel 查找表（preload / 工具用）。 */
export const IPC_METHOD_CHANNELS = Object.fromEntries(
  IPC_INVOKE_REGISTRY.map(({ method, channel }) => [method, channel])
) as Record<IpcInvokeMethod, IpcInvokeChannel>;

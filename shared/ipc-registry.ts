import type { DesktopApi } from "./contracts";
import { IPC } from "./ipc-channels";

/** renderer invoke 方法 → main 通道。preload 桥与 main handler 注册表的单一来源（E3 完整表）。 */
export const IPC_INVOKE_REGISTRY = [
  { method: "getBootstrap", channel: IPC.APP_BOOTSTRAP },
  { method: "listContent", channel: IPC.APP_LIST_CONTENT },
  { method: "readContent", channel: IPC.APP_READ_CONTENT },
  { method: "writeContent", channel: IPC.APP_WRITE_CONTENT },
  { method: "listSources", channel: IPC.APP_LIST_SOURCES },
  { method: "updateSource", channel: IPC.APP_UPDATE_SOURCE },
  { method: "addRssSource", channel: IPC.APP_ADD_RSS_SOURCE },
  { method: "importOpml", channel: IPC.APP_IMPORT_OPML },
  { method: "searchWorkspace", channel: IPC.APP_SEARCH_WORKSPACE },
  { method: "getAllCreativeTopics", channel: IPC.APP_CREATIVE_ALL_TOPICS },
  { method: "getCreativeProjects", channel: IPC.APP_CREATIVE_PROJECTS },
  { method: "getCreativeProject", channel: IPC.APP_CREATIVE_PROJECT },
  { method: "createCreativeProject", channel: IPC.APP_CREATIVE_CREATE },
  { method: "saveCreativeFile", channel: IPC.APP_CREATIVE_SAVE },
  { method: "advanceCreativeProject", channel: IPC.APP_CREATIVE_ADVANCE },
  { method: "updateCreativeManifest", channel: IPC.APP_CREATIVE_UPDATE_MANIFEST },
  { method: "listCreativeVersions", channel: IPC.APP_CREATIVE_VERSIONS },
  { method: "readCreativeVersion", channel: IPC.APP_CREATIVE_READ_VERSION },
  { method: "restoreCreativeVersion", channel: IPC.APP_CREATIVE_RESTORE_VERSION },
  { method: "getCreativeReleaseLog", channel: IPC.APP_CREATIVE_RELEASE_LOG },
  { method: "copyCreativeProject", channel: IPC.APP_CREATIVE_COPY },
  { method: "archiveCreativeProject", channel: IPC.APP_CREATIVE_ARCHIVE },
  { method: "getCreativeAnalytics", channel: IPC.APP_CREATIVE_ANALYTICS },
  { method: "selectFiles", channel: IPC.APP_SELECT_FILES },
  { method: "selectOpenmindFiles", channel: IPC.APP_SELECT_OPENMIND_FILES },
  { method: "searchOpenmindFiles", channel: IPC.APP_SEARCH_OPENMIND_FILES },
  { method: "openPath", channel: IPC.APP_OPEN_PATH },
  { method: "revealPath", channel: IPC.APP_REVEAL_PATH },
  { method: "openExternal", channel: IPC.APP_OPEN_EXTERNAL },
  { method: "exportText", channel: IPC.APP_EXPORT_TEXT },
  { method: "setOpenmindRoot", channel: IPC.APP_SET_OPENMIND_ROOT },
  { method: "selectOpenmindRoot", channel: IPC.APP_SELECT_OPENMIND_ROOT },
  { method: "previewOpenmindRoot", channel: IPC.APP_PREVIEW_OPENMIND_ROOT },
  { method: "getOpenmindRoot", channel: IPC.APP_GET_OPENMIND_ROOT },
  { method: "selectWorkspaceRoot", channel: IPC.APP_SELECT_WORKSPACE_ROOT },
  { method: "getPreferences", channel: IPC.APP_PREFERENCES_GET },
  { method: "getOnboardingState", channel: IPC.APP_ONBOARDING_GET },
  { method: "updateOnboardingState", channel: IPC.APP_ONBOARDING_UPDATE },
  { method: "updatePreferences", channel: IPC.APP_PREFERENCES_UPDATE },
  { method: "resetPreferences", channel: IPC.APP_PREFERENCES_RESET },
  { method: "getBrowserAutomationStatus", channel: IPC.APP_BROWSER_AUTOMATION_STATUS },
  { method: "getMcpServers", channel: IPC.APP_MCP_SERVERS_GET },
  { method: "saveBrowserExtensionToken", channel: IPC.APP_BROWSER_EXTENSION_TOKEN_SAVE },
  { method: "clearBrowserExtensionToken", channel: IPC.APP_BROWSER_EXTENSION_TOKEN_CLEAR },
  { method: "getProviders", channel: IPC.APP_PROVIDERS_GET },
  { method: "saveProviders", channel: IPC.APP_PROVIDERS_SAVE },
  { method: "getSharedPythonRuntimeStatus", channel: IPC.APP_SHARED_PYTHON_STATUS },
  { method: "setSharedPythonRuntimeEnabled", channel: IPC.APP_SHARED_PYTHON_ENABLE },
  { method: "aiRefresh", channel: IPC.AI_SNAPSHOT },
  { method: "aiRefreshProviders", channel: IPC.AI_REFRESH_PROVIDERS },
  { method: "installCliTool", channel: IPC.CLI_TOOL_INSTALL },
  { method: "upgradeCliTool", channel: IPC.CLI_TOOL_UPGRADE },
  { method: "checkCliToolUpdate", channel: IPC.CLI_TOOL_UPDATE_CHECK },
  { method: "cancelCliToolInstall", channel: IPC.CLI_TOOL_INSTALL_CANCEL },
  { method: "openCliLogin", channel: IPC.CLI_OPEN_LOGIN },
  { method: "aiRefreshSkills", channel: IPC.AI_REFRESH_SKILLS },
  { method: "inspectInstalledSkill", channel: IPC.SKILL_INSPECT_INSTALLED },
  { method: "listInstalledSkills", channel: IPC.SKILL_LIST_INSTALLED },
  { method: "listInstalledRunnableSkills", channel: IPC.SKILL_LIST_RUNNABLE },
  { method: "setInstalledSkillEnabled", channel: IPC.SKILL_SET_ENABLED },
  { method: "selectSkillPackageSource", channel: IPC.SKILL_SOURCE_SELECT },
  { method: "inspectSkillSource", channel: IPC.SKILL_SOURCE_INSPECT },
  { method: "cancelSkillSourceInspection", channel: IPC.SKILL_SOURCE_INSPECT_CANCEL },
  { method: "installSkillSource", channel: IPC.SKILL_SOURCE_INSTALL },
  { method: "listSkillRuns", channel: IPC.SKILL_RUN_LIST },
  { method: "getSkillRun", channel: IPC.SKILL_RUN_GET },
  { method: "getSkillRunEvents", channel: IPC.SKILL_RUN_EVENTS },
  { method: "listRunArtifacts", channel: IPC.RUN_LIST_ARTIFACTS },
  { method: "retrySkillRun", channel: IPC.RUN_RETRY },
  { method: "retryWorkflowStep", channel: IPC.RUN_RETRY_STEP },
  { method: "deleteRunHistory", channel: IPC.RUN_DELETE_HISTORY },
  { method: "cancelSkillRun", channel: IPC.SKILL_RUN_CANCEL },
  { method: "listWorkflowRuns", channel: IPC.WORKFLOW_RUN_LIST },
  { method: "getWorkflowRun", channel: IPC.WORKFLOW_RUN_GET },
  { method: "resumeWorkflowRun", channel: IPC.WORKFLOW_RUN_RESUME },
  { method: "cancelWorkflowRun", channel: IPC.WORKFLOW_RUN_CANCEL },
  { method: "listAutomationRules", channel: IPC.AUTOMATION_RULES_LIST },
  { method: "saveAutomationRule", channel: IPC.AUTOMATION_RULE_SAVE },
  { method: "deleteAutomationRule", channel: IPC.AUTOMATION_RULE_DELETE },
  { method: "runAutomationNow", channel: IPC.AUTOMATION_RUN_NOW },
  { method: "listAutomationRuns", channel: IPC.AUTOMATION_RUNS_LIST },
  { method: "listAutomationSchedules", channel: IPC.AUTOMATION_SCHEDULES_LIST },
  { method: "aiPrewarm", channel: IPC.AI_PREWARM },
  { method: "aiStartRun", channel: IPC.AI_START },
  { method: "aiCancelRun", channel: IPC.AI_CANCEL },
  { method: "aiUpdateSession", channel: IPC.AI_UPDATE_SESSION },
  { method: "aiGetEvents", channel: IPC.AI_EVENTS },
  { method: "aiListTurns", channel: IPC.AI_TURNS },
  { method: "aiForkSession", channel: IPC.AI_FORK_SESSION },
  { method: "aiResolveApproval", channel: IPC.AI_RESOLVE_APPROVAL },
] as const;

export type IpcInvokeMethod = (typeof IPC_INVOKE_REGISTRY)[number]["method"];
export type IpcInvokeChannel = (typeof IPC_INVOKE_REGISTRY)[number]["channel"];

type DesktopInvokeMethods = keyof Omit<DesktopApi, "onAiEvent" | "onSkillEvent" | "onSkillRunEvent" | "onCliInstallProgress">;

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

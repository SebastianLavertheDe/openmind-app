import type { TranslationOf } from "../types";
import type { desktopErrorMessages as zhCN } from "../zh-CN/desktop-errors";

export const desktopErrorMessages = {
  desktopErrors: {
    bilibili: {
      invalidUrl: "Use a Bilibili BV or AV video link, or a b23.tv short link.",
      shortUrlFailed: "Could not resolve the Bilibili short link. Retry or use the full BV or AV video link.",
      toolsMissing: "Embedded playback is available. Captions require yt-dlp; install it in Settings → Built-in runtime → Video import.",
      loginRequired: "Bilibili requires sign-in for these captions. Only anonymous fetching is supported. The embedded player has been kept.",
      timeout: "Fetching Bilibili captions timed out. Try again later. Embedded playback remains available.",
      captionsFailed: "Could not fetch Bilibili captions. Try again. Embedded playback remains available.",
      noCaptions: "No Bilibili captions were available anonymously. The video may have no captions, or anonymous access may be restricted."
    },
    youtube: {
      selectBrowser: "Select a browser for YouTube imports in Settings → Built-in runtime → Video import first.",
      browserMissing: "The selected browser is unavailable. Scan and select a browser again in Settings → Built-in runtime → Video import.",
      toolsMissing: "YouTube download tools are missing. Check yt-dlp, FFmpeg, and the JavaScript runtime in Settings → Built-in runtime → Video import.",
      downloadFailed: "YouTube download failed. Check your connection, update yt-dlp, and try again.",
      cookiesFailed: "Could not read browser sign-in. Sign in to YouTube in the selected browser, close it, and retry. If the system cannot decrypt cookies, try Firefox.",
      loginRequired: "YouTube requires sign-in or verification. Open this video in the selected browser, complete verification, and retry.",
      timeout: "The YouTube download timed out. Try again later.",
      invalidOutput: "The download did not produce a playable video or valid metadata. Update the download tools and retry.",
      noCaptions: "The video was downloaded, but YouTube did not provide captions.",
      captionsFailed: "The video was downloaded, but captions could not be extracted. You can retry later."
    },
    cli: { invalidId: "CLI must be claude or codex.", installUnsupported: "One-click CLI installation is not supported in this environment.", upgradeUnsupported: "CLI upgrades are not supported in this environment.", versionUnsupported: "CLI version checks are not supported in this environment." },
    services: { pythonNotReady: "The bundled Python runtime service is not initialized.", wechatNotReady: "The WeChat Official Account service is not initialized." },
    root: {
      privateConflict: "The openmind folder and workspace cannot be inside the app's private data folder.", candidateInvalid: "The selected path does not exist, cannot be accessed, or is not a folder.",
      legacyLayout: "A legacy nested layout was found: content is still inside an openmind subfolder. Complete the migration so article, config, .agent, and other content folders are directly inside the selected folder.",
      unreadable: "The openmind root folder cannot be read.", unwritable: "The openmind root folder cannot be written to.", activeTasks: "Tasks are running. The openmind root folder cannot be changed yet.",
      activeWorkspaceTasks: "Tasks are running. The AI/code workspace folder cannot be changed yet.", dedicatedPicker: "Use the dedicated folder picker to change the storage folder.",
      unresolved: "The openmind root folder does not exist or cannot be resolved.", inaccessible: "The openmind root folder cannot be accessed.", notDirectory: "The openmind root path is not a folder.", conflict: (kind: string) => `Path conflict: ${kind}`,
      bindUnavailable: "Cannot connect an openmind root folder that does not exist or cannot be accessed.", unavailable: "The openmind root folder is unavailable.", warningSeparator: "; "
    },
    project: {
      taskRunning: "This project task still has a running AI task and cannot be archived yet.", taskArchived: "An archived project task cannot be continued.", providerSwitch: "The provider for a project task cannot be changed when continuing it.",
      activeRename: "AI tasks are running. The project cannot be renamed yet.", activeArchive: "AI tasks are running. The project cannot be archived yet.", sessionMismatch: "This AI conversation does not belong to the project task.",
      sessionRequired: "This project task already has a conversation. Include the original session ID to continue it.", providerMismatch: "The project task provider does not match.", workerSessionMismatch: "The AI worker returned a project conversation that does not match this task."
    },
    skill: {
      sourceUnreadable: "The selected Skill source cannot be read.", sourceFormat: "The Skill source must be a folder or a .zip file.", brokerNotReady: "ExecutionBroker is not initialized.", workflowNotReady: "WorkflowEngine is not initialized.", staleRoot: "The root snapshot is outdated. The workflow cannot be resumed.",
      workflowMissing: (id: string) => `Workflow Skill is not installed: ${id}`, workflowStepMissing: (id: string) => `Workflow step Skill is not installed: ${id}`,
      bindRootFirst: (id: string) => `Installed Skill ${id} requires ExecutionBroker. Connect an openmind root folder first.`, workspaceOnly: "Skills can only run in a Broker plan for the current workspace.", invalidRoot: "Connect a valid openmind root folder before creating a Skill run.",
      notInstalled: (id: string) => `Skill is not installed: ${id}. Install it first.`, notExecutable: (id: string) => `Installed Skill cannot be run: ${id}. Complete the installation and check the package.`
    },
    provider: { managedClaudeVersion: (minimum: string, distro: string, found: string) => `Managed Claude Code providers in WSL require version ${minimum} or later; ${distro} currently has ${found}.` },
    dialogs: { wechatCover: "Select a WeChat article cover", imageFiles: "JPG / PNG images", openmindRoot: "Select the OpenMind private data folder", workspaceRoot: "Select an AI/code workspace folder", skillSource: "Select a Skill folder or ZIP", skillPackage: "Skill package", projectFiles: "Add project materials", supportedProjectFiles: "Supported project materials", allFiles: "All files", download: "Download file" }
  }
} satisfies TranslationOf<typeof zhCN>;

import type { TranslationOf } from "../types";
import type { electronMessages as zhCN } from "../zh-CN/electron";

export const electronMessages = {
  errors: {
    repo: { selectValidFirst: "Select a valid openmind storage folder in Settings first.", invalidDirectory: "This folder does not exist or cannot be read and written.", pathOutsideProject: "The requested path is outside the project folder." },
    file: { tooLarge: "Files larger than 5 MB cannot be saved directly.", notAFile: "This path is not a file." },
    url: { httpOnly: "Only HTTP and HTTPS links can be opened." },
    source: {
      updateNotFound: "The source to update was not found.", refreshFailed: "The source was saved, but could not be read after refreshing.", invalidRssUrl: "The RSS address must be a valid URL.",
      opmlWriteUnreadable: "The RSS feed was written to OPML, but could not be read back.", systemManagedKind: "This source type is managed by a system Skill and cannot be added manually.",
      opmlEntryMissing: "This RSS source is no longer in the OPML file.", noNewContent: "The most recent run found no new content."
    },
    ai: { workerExited: (code: number | null) => `The AI scheduler exited with code ${code ?? "unknown"}` },
    ipc: { invalidContract: "The request parameters do not match the API contract.", registryMismatch: "The channels in ipcHandlers and IPC_INVOKE_REGISTRY do not match." },
    preferences: { invalidSetting: (key: string) => `The setting ${key} is invalid.`, invalidUserTags: "The userTags setting is invalid." },
    creative: {
      invalidStage: (stage: string) => `Invalid stage: ${stage}`, invalidStageTransition: (from: string, to: string) => `You cannot move directly from ${from} to ${to}.`,
      reviewNotApproved: "The review must be approved before moving to Ready to publish.", publishNotReady: "Configure a platform and export the draft before marking it as published.",
      duplicateStageProject: "A project with this name already exists in the target stage.", invalidCreateDate: "The creation date is invalid.", emptyTopicTitle: "The topic title cannot be empty.",
      invalidProjectDir: "The creative project folder is invalid.",
      truncatedSaveBlocked: (file: string) => `${file} exceeds 512 KB on disk, so the editor loaded only part of it. Saving it directly would lose data. Edit and save it in an external editor.`,
      invalidVersionPath: "The version path is invalid.", markdownOnly: "Only Markdown files in the project root folder can be saved."
    },
    skill: {
      alreadyRunning: (skillId: string) => `Skill is already running: ${skillId}`, stopped: (name: string) => `Skill stopped: ${name}`,
      failed: (code: number | null, name: string, detail: string) => `Skill failed (exit code ${code ?? "?"}): ${name}\n${detail}`
    },
    provider: {
      codexWslNoAppServer: (distro: string) => `Codex in WSL ${distro} does not support the app-server protocol. Upgrade the Codex CLI.`,
      codexNoAppServer: "Codex does not support the app-server protocol. Please upgrade.", codexNativeMissing: "Codex is not on the Windows PATH, or app-server is not enabled.",
      claudeWslNotLoggedIn: (distro: string) => `Claude Code is not signed in within WSL ${distro}. Run claude /login in a WSL terminal.`,
      claudeNotLoggedIn: "Claude Code is not signed in. Run claude /login in a terminal.", claudeNativeMissing: "Claude Code is not on the Windows PATH.",
      wslStartFailed: (label: string, distro: string) => `${label} could not start in WSL ${distro}. Check the installation and sign-in status.`,
      notInPath: (label: string) => `${label} is not on the local PATH.`
    }
  },
  dialogs: { importOpml: "Import OPML", selectProjectFile: "Select a project file", selectOpenmindFile: "Select an openmind file", exportMarkdown: "Export Markdown" },
  pipeline: { collect: "Content collection", summary: "Daily summary", topic: "Topic generation", writing: "Writing materials" },
  source: { localFile: "Local file", webPage: "Web page", customFrequencyDaily: "Daily", frequencyPipeline: "Daily pipeline", collectorInterrupted: "Collection was interrupted. Please retry." },
  brief: { recommendation: (title: string) => `Gather materials about “${title}” and start drafting.` },
  provider: { nativeLabel: (label: string) => `${label} · Local`, wslLabel: (label: string, distro: string) => `${label} · WSL ${distro}` },
  settings: { defaultPlatform: "WeChat Official Account" },
  model: { contextWindowUnknown: "Unknown" },
  skillInput: { optionalDate: "Optional date in YYYYMMDD format" }
} satisfies TranslationOf<typeof zhCN>;

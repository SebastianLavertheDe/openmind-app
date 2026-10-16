import type { browserPreviewMessages as zhCN } from "../zh-CN/browser-preview";
import type { TranslationOf } from "../types";

export const browserPreviewMessages = {
  browserPreview: {
    projectMissing: "Project not found",
    localImageUnavailable: "Local images cannot be read in the browser preview. Open them in the desktop app.",
    chatImageUnavailable: "Use the desktop app to preview conversation images.",
    imageModelUnavailable: "Use the desktop app to select an image model.",
    wechatSaveUnavailable: "Configure your WeChat Official Account in OpenMind Desktop. The browser preview does not save AppSecret.",
    wechatManageUnavailable: "Use OpenMind Desktop to manage your WeChat Official Account configuration.",
    wechatCoverUnavailable: "Use OpenMind Desktop to choose a WeChat article cover.",
    wechatDraftUnavailable: "Use OpenMind Desktop to send articles to your WeChat draft box.",
    richClipboardUnavailable: "This browser cannot copy rich text. Use OpenMind Desktop to copy WeChat article formatting.",
    sourceMissing: "Source not found",
    projectNameExists: "A project with this name already exists",
    materialMissing: "Material not found",
    originalPdfUnavailable: "The browser preview has no original PDF files. View them in the desktop app.",
    taskMissing: "Task not found",
    outputMissing: "Output not found",
    browserDisconnected: "The browser preview does not connect to your browser.",
    browserSkillInstallUnavailable: "BrowserSkill cannot be installed in the browser preview.",
    cliInstallUnavailable: "CLI tools cannot be installed in the browser preview.",
    cliUpgradeUnavailable: "CLI tools cannot be updated in the browser preview.",
    cliLoginUnavailable: "The browser preview cannot open a terminal for sign-in.",
    skillMissing: "Skill not found",
    skillRunUnavailable: "The browser preview does not execute Skill runs.",
    workflowUnavailable: "The browser preview does not execute workflows.",
    automationRuleUnavailable: "The browser preview does not manage automation rules.",
    automationRunUnavailable: "The browser preview does not execute automations.",
    aiRunUnavailable: "The browser preview does not execute AI tasks.",
    sessionUnavailable: "No session is available in preview mode."
  }
} as const satisfies TranslationOf<typeof zhCN>;

/** 浏览器预览中的操作错误和连接诊断；不包含演示内容。 */
export const browserPreviewMessages = {
  browserPreview: {
    projectMissing: "项目不存在",
    localImageUnavailable: "浏览器预览模式无法读取本地图片，请在桌面应用中打开。",
    chatImageUnavailable: "请在桌面应用中预览会话图片。",
    imageModelUnavailable: "请在桌面应用中选择图片模型。",
    wechatSaveUnavailable: "请在 OpenMind 桌面版中配置微信公众号，浏览器预览不会保存 AppSecret。",
    wechatManageUnavailable: "请在 OpenMind 桌面版中管理微信公众号配置。",
    wechatCoverUnavailable: "请在 OpenMind 桌面版中选择公众号封面。",
    wechatDraftUnavailable: "请在 OpenMind 桌面版中发送到微信公众号草稿箱。",
    richClipboardUnavailable: "当前浏览器不支持复制富文本，请在 OpenMind 桌面版中复制公众号排版。",
    sourceMissing: "数据源不存在",
    projectNameExists: "项目名已存在",
    materialMissing: "资料不存在",
    originalPdfUnavailable: "预览环境没有保留的 PDF 原件，请使用桌面版查看。",
    taskMissing: "任务不存在",
    outputMissing: "成品不存在",
    browserDisconnected: "预览模式不连接浏览器。",
    browserSkillInstallUnavailable: "浏览器预览不支持安装 BrowserSkill。 ",
    cliInstallUnavailable: "浏览器预览不支持一键安装 CLI。 ",
    cliUpgradeUnavailable: "浏览器预览不支持升级 CLI。 ",
    cliLoginUnavailable: "浏览器预览不支持打开终端登录。 ",
    skillMissing: "Skill 不存在",
    skillRunUnavailable: "浏览器预览不执行真实 Skill Run。 ",
    workflowUnavailable: "浏览器预览不执行真实 Workflow。 ",
    automationRuleUnavailable: "浏览器预览不管理 Automation Rule。 ",
    automationRunUnavailable: "浏览器预览不执行真实 Automation。 ",
    aiRunUnavailable: "浏览器预览不执行真实 AI 任务。",
    sessionUnavailable: "预览模式没有会话。"
  }
} as const;

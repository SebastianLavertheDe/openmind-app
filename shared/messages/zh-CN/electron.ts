/** Electron 主进程 / product 层用户可见错误、对话框、诊断文案。 */
export const electronMessages = {
  errors: {
    unregisteredSkill: (skillId: string) => `未注册的 cctools skill：${skillId}`,
    repo: {
      selectValidFirst: "请先在设置中选择有效的 mymind 保存目录。",
      invalidDirectory: "该目录不存在，或不是可读写的目录。",
      pathOutsideProject: "请求路径超出项目目录。"
    },
    file: {
      tooLarge: "文件内容超过 5MB，暂不支持直接保存。",
      notAFile: "该路径不是文件。"
    },
    url: {
      httpOnly: "只允许打开 HTTP 或 HTTPS 链接。"
    },
    source: {
      notFound: "找不到数据源。",
      disabled: "该数据源已停用，请先启用。",
      noSkill: "该数据源没有可执行的 Skill。",
      updateNotFound: "找不到要更新的数据源。",
      refreshFailed: "数据源已保存，但刷新后无法读取。",
      invalidRssUrl: "RSS 地址必须是有效 URL。",
      opmlWriteUnreadable: "RSS 已写入 OPML，但无法重新读取。",
      systemManagedKind: "该来源类型由系统技能管理，不能手动新增。",
      opmlEntryMissing: "OPML 中已找不到该 RSS 数据源。",
      noNewContent: "最近一次运行未发现新增内容。"
    },
    ai: {
      workerExited: (code: number | null) => `AI 调度服务已退出，代码 ${code ?? "unknown"}`
    },
    ipc: {
      invalidContract: "请求参数不符合接口契约。",
      registryMismatch: "ipcHandlers 与 IPC_INVOKE_REGISTRY 通道不一致。"
    },
    preferences: {
      invalidSetting: (key: string) => `设置项 ${key} 无效。`,
      invalidAccentColor: "设置项 accentColor 无效。",
      invalidUserTags: "设置项 userTags 无效。"
    },
    creative: {
      invalidStage: (stage: string) => `无效的阶段：${stage}`,
      invalidStageTransition: (from: string, to: string) => `不允许从 ${from} 直接进入 ${to}。`,
      reviewNotApproved: "审核尚未批准，不能进入待发布阶段。",
      publishNotReady: "请先配置平台并导出稿件，再记录为已发布。",
      duplicateStageProject: "目标阶段已存在同名项目。",
      invalidCreateDate: "创作日期无效。",
      emptyTopicTitle: "选题标题不能为空。",
      invalidProjectDir: "创作项目目录无效。",
      truncatedSaveBlocked: (file: string) => `${file} 在磁盘上超过 512KB，编辑器加载的是截断内容。直接保存会丢失数据；请在外部编辑器修改后再保存。`,
      noDraftForReview: "项目还没有可审核的草稿文件。",
      invalidReviewStatus: "审核状态无效。",
      reviewReportRequired: "请先生成审核报告。",
      invalidVersionPath: "版本路径无效。",
      onlyArchivedRestorable: "只有归档项目才能恢复。",
      deleteScopeOnly: "只允许删除文稿库中的项目目录。",
      invalidTopicDate: "选题日期无效。",
      duplicateTopic: "该选题已存在，无需重复添加。",
      markdownOnly: "只允许保存项目根目录下的 Markdown 文件。"
    },
    skill: {
      sourceDisabled: (name: string) => `数据源已停用：${name}`,
      alreadyRunning: (skillId: string) => `Skill 正在运行：${skillId}`,
      cwdMissing: (cwd: string) => `Skill 工作目录不存在：${cwd}`,
      stopped: (name: string) => `Skill 已停止：${name}`,
      failed: (code: number | null, name: string, detail: string) => `Skill 执行失败（退出码 ${code ?? "?"}）：${name}\n${detail}`
    },
    provider: {
      codexWslNoAppServer: (distro: string) => `WSL ${distro} 中的 Codex 不支持 app-server 协议，请升级 Codex CLI。`,
      codexNoAppServer: "Codex 不支持 app-server 协议，请升级。",
      codexNativeMissing: "Codex 未安装在 Windows PATH 中，或未启用 app-server。",
      claudeWslNotLoggedIn: (distro: string) => `WSL ${distro} 中的 Claude Code 未登录，请在 WSL 终端运行 claude /login。`,
      claudeNotLoggedIn: "Claude Code 未登录，请在终端运行 claude /login。",
      claudeNativeMissing: "Claude Code 未安装在 Windows PATH 中。",
      wslStartFailed: (label: string, distro: string) => `${label} 无法在 WSL ${distro} 中启动，请检查安装与登录状态。`,
      notInPath: (label: string) => `${label} 未安装在本机 PATH。`
    }
  },

  dialogs: {
    importOpml: "导入 OPML",
    selectProjectFile: "选择项目内文件",
    selectMymindFile: "选择 mymind 内文件",
    exportMarkdown: "导出 Markdown"
  },

  pipeline: {
    collect: "内容采集",
    summary: "每日总结",
    topic: "选题生成",
    writing: "写作素材包"
  },

  source: {
    localFile: "本地文件",
    webPage: "网页",
    customFrequencyDaily: "每天",
    frequencyPipeline: "每日流水线"
  },

  brief: {
    unnamedTopic: (index: number) => `选题 ${index + 1}`,
    recommendation: (title: string) => `围绕"${title}"整理资料并进入创作阶段。`
  },

  provider: {
    nativeLabel: (label: string) => `${label} · 本机`,
    wslLabel: (label: string, distro: string) => `${label} · WSL ${distro}`
  },

  settings: {
    defaultPlatform: "公众号"
  },

  model: {
    contextWindowUnknown: "未知"
  },

  skillInput: {
    optionalDate: "可选日期，格式 YYYYMMDD"
  }
} as const;

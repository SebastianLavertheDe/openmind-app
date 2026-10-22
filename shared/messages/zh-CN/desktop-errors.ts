export const desktopErrorMessages = {
  desktopErrors: {
    bilibili: {
      invalidUrl: "请使用 Bilibili 的 BV、AV 视频链接或 b23.tv 短链接。",
      shortUrlFailed: "无法解析 Bilibili 短链接，请重试或使用完整的 BV、AV 视频链接。",
      toolsMissing: "视频可内嵌播放；获取字幕需要 yt-dlp，请在设置 → 内置运行时 → 视频导入中安装。",
      loginRequired: "Bilibili 要求登录后才能获取此字幕，当前仅支持匿名获取。已保留内嵌播放器。",
      timeout: "Bilibili 字幕获取超时，请稍后重试。视频仍可内嵌播放。",
      captionsFailed: "Bilibili 字幕获取失败，请重试。视频仍可内嵌播放。",
      noCaptions: "未找到可匿名获取的 Bilibili 字幕。视频可能没有字幕，或字幕不允许匿名访问。"
    },
    youtube: {
      selectBrowser: "请先在设置 → 内置运行时 → 视频导入中选择用于导入 YouTube 的浏览器。",
      browserMissing: "所选浏览器已不可用，请在设置 → 内置运行时 → 视频导入中重新检测并选择。",
      toolsMissing: "缺少 YouTube 下载工具，请在设置 → 内置运行时 → 视频导入中检查 yt-dlp、FFmpeg 和 JavaScript 运行时。",
      downloadFailed: "YouTube 视频下载失败，请检查网络、更新 yt-dlp 后重试。",
      cookiesFailed: "无法读取浏览器登录状态，请在所选浏览器中登录 YouTube，关闭浏览器后重试；如系统不允许解密 cookies，可改选 Firefox。",
      loginRequired: "YouTube 要求登录或验证。请在所选浏览器中打开该视频并完成验证后重试。",
      timeout: "YouTube 下载超时，请稍后重试。",
      invalidOutput: "下载结果缺少可播放的视频或有效的视频信息，请更新下载工具后重试。",
      noCaptions: "视频已下载，但 YouTube 未提供可用字幕。",
      captionsFailed: "视频已下载，但字幕提取失败，可稍后重新获取。"
    },
    cli: { invalidId: "CLI 必须是 claude 或 codex。 ", installUnsupported: "当前环境不支持一键安装 CLI。 ", upgradeUnsupported: "当前环境不支持升级 CLI。 ", versionUnsupported: "当前环境不支持检查 CLI 版本。 " },
    services: { pythonNotReady: "内置 Python 运行时服务尚未初始化。 ", wechatNotReady: "微信公众号服务尚未初始化。 " },
    root: {
      privateConflict: "openmind 或工作区不能位于应用私有数据目录内。", candidateInvalid: "候选路径不存在、不可访问或不是目录。",
      legacyLayout: "检测到旧版嵌套布局：内容仍在 openmind 子目录中。请先完成扁平化迁移，使 article、config、.agent 等目录直接位于所选目录下。",
      unreadable: "openmind 根目录不可读。", unwritable: "openmind 根目录不可写。", activeTasks: "有运行中的任务，暂时不能切换 openmind 根目录。",
      activeWorkspaceTasks: "有运行中的任务，暂时不能切换 AI/代码工作区目录。", dedicatedPicker: "保存目录只能通过专用的目录选择操作修改。",
      unresolved: "openmind 根目录不存在或无法解析。", inaccessible: "openmind 根目录不可访问。", notDirectory: "openmind 根路径不是目录。", conflict: (kind: string) => `路径冲突：${kind}`,
      bindUnavailable: "无法绑定不存在或不可访问的 openmind 根目录。", unavailable: "openmind 根目录不可用。", warningSeparator: "；"
    },
    project: {
      taskRunning: "这个 Project Task 仍有运行中的 AI 任务，暂时不能归档。", taskArchived: "已归档的 Project Task 不能继续创作。", providerSwitch: "Project Task Provider 不允许在续写时切换。",
      activeRename: "有运行中的 AI 任务，暂时不能重命名 Project。", activeArchive: "有运行中的 AI 任务，暂时不能归档 Project。", sessionMismatch: "AI Session 不属于该 Project Task。",
      sessionRequired: "Project Task 已有 Session，续写必须携带原 Session ID。", providerMismatch: "Project Task Provider 不一致。", workerSessionMismatch: "AI Worker 返回了不匹配的 Project Session。"
    },
    skill: {
      sourceUnreadable: "所选 Skill 来源不可读取。 ", sourceFormat: "Skill 来源必须是目录或 .zip 文件。 ", brokerNotReady: "ExecutionBroker 未初始化。 ", workflowNotReady: "WorkflowEngine 未初始化。 ", staleRoot: "当前 root snapshot 已过期，拒绝恢复 Workflow。 ",
      workflowMissing: (id: string) => `没有已安装的 Workflow Skill：${id}`, workflowStepMissing: (id: string) => `没有已安装的 Workflow Step Skill：${id}`,
      bindRootFirst: (id: string) => `Installed Skill ${id} 需要 ExecutionBroker 执行;请先绑定 openmind 根目录。`, workspaceOnly: "Skill 只能在当前工作区的 Broker 计划中运行。", invalidRoot: "尚未绑定有效的 openmind 根目录，无法创建 Skill Run。",
      notInstalled: (id: string) => `没有已安装的 Skill：${id}。请先完成安装。`, notExecutable: (id: string) => `没有可执行的 Installed Skill：${id}。请先完成安装并检查包体。`
    },
    provider: { managedClaudeVersion: (minimum: string, distro: string, found: string) => `WSL Claude Code 托管 Provider 需要 ${minimum} 或更高版本；${distro} 当前为 ${found}。` },
    dialogs: { wechatCover: "选择公众号文章封面", imageFiles: "JPG / PNG 图片", openmindRoot: "选择 OpenMind 私人数据仓库目录", workspaceRoot: "选择 AI/代码工作区目录", skillSource: "选择 Skill 目录或 ZIP", skillPackage: "Skill 包", projectFiles: "添加项目资料", supportedProjectFiles: "支持的项目资料", allFiles: "所有文件", download: "下载文件" }
  }
} as const;

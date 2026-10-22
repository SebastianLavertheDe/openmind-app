/** AI 工作台 / 侧栏 / composer / tool / approval 等 UI 文案。 */
export const aiMessages = {
  session: {
    new: "新会话",
    recent: "最近会话",
    list: "AI 会话",
    empty: "还没有会话",
    unpin: "取消置顶",
    pin: "置顶",
    archiveTask: "归档任务",
    archiveNamed: (title: string) => `归档会话：${title}`,
    archived: "会话已归档",
    archiveFailed: "会话归档失败",
    updateFailed: "会话更新失败",
    unarchived: "已取消归档",
    pinned: "会话已置顶",
    unpinned: "已取消置顶",
    /* P1-SES-3: actions overflow 菜单 */
    moreActions: "更多操作"
  },

  workbench: {
    draftStatus: "尚未创建",
    unsavedTitle: "放弃未保存修改",
    unsavedConfirm: "当前文件有未保存修改，确定要放弃吗？",
    unsavedConfirmText: "放弃修改",
    filePreviewWidth: "文件预览宽度",
    filePreview: "文件预览",
    viewMode: "文件查看模式",
    preview: "预览",
    edit: "编辑",
    fileTooLargePreviewOnly: "文件过大，只能预览截断内容",
    editFile: "编辑文件",
    fileTooLargeCannotSave: "文件过大，不能直接保存截断内容",
    saveFile: "保存文件",
    noUnsavedChanges: "没有未保存修改",
    saving: "保存中",
    save: "保存",
    closeFilePreview: "关闭文件预览",
    loadingFile: "正在加载文件…",
    fileMissing: "文件不存在或者已经删除",
    fileTruncatedWarning: "文件超过预览上限，当前只读展示前 5 MB，避免保存时覆盖剩余内容。",
    editFileContent: "编辑文件内容",
    saved: "已保存",
    /* P2-PRV-2: edit 模式 dirty 切回 preview 时确认 */
    discardDirtyTitle: "切换到预览",
    discardDirtyConfirm: "当前文件有未保存修改，切换到预览将丢弃改动，确定吗？",
    discardDirtyConfirmText: "放弃并预览"
  },

  chat: {
    loadingHistory: "正在加载…",
    loadMoreEvents: (n: number) => `加载更早的 ${n} 个事件`,
    loadOlderTurns: "加载更早的回合",
    transcriptLabel: "对话消息",
    jumpToBottom: "回到底部",
    currentProject: "当前工作区",
    emptyTitle: "从资料到创作，让 AI 帮你推进",
    emptyBody: "直接描述目标。AI 会读取当前工作区，在你的权限范围内整理资料、生成内容并运行流程。",
    emptyHint: "Ctrl/⌘ + K 搜索任务 · Ctrl/⌘ + Enter 发送",
    processing: "正在处理",
    processed: "已处理",
    finalMissing: "最终回复缺失",
    finalMissingDetail: "Provider 已结束运行，但没有返回最终回复。该运行未被视为成功。",
    /* P1-CHAT-1: 与 OpenMind 核心内容工作流对应的快捷任务 */
    emptyPrompts: [
      { title: "整理资料库", body: "归类新增资料，提炼要点并保留来源", prompt: "请查看资料库中今天新增的内容，按主题归类，提炼关键信息，并为每项保留来源链接。" },
      { title: "生成每日简报", body: "汇总今日重点、趋势与后续行动", prompt: "请基于今天新增的资料生成每日简报，按主题整理重点、趋势和下一步行动建议。" },
      { title: "开始内容创作", body: "筛选选题，生成大纲和首版草稿", prompt: "请从资料库中筛选一个值得创作的主题，说明选题依据，并生成内容大纲和首版草稿。" },
      { title: "检查自动化", body: "汇总最近运行结果与待处理问题", prompt: "请检查 RSS 采集、每日摘要等自动化的最近运行状态，汇总成功项、失败项和建议的处理方式。" }
    ],
    newEventsBadge: (n: number) => `${n}`
  },

  permission: {
    label: "权限",
    readOnly: "只读",
    edit: "编辑",
    auto: "自动执行",
    autoShort: "自动"
  },

  mode: {
    label: "模式",
    default: "执行",
    plan: "Plan",
    planActive: "Plan 模式"
  },

  composer: {
    closeError: "关闭错误提示",
    queuedSummary: (n: number) => `${n} 条消息正在排队`,
    cancelQueued: "取消排队消息",
    messageInput: "AI 消息",
    placeholderContinue: (title: string) => `继续 ${title}`,
    placeholderNew: "描述要整理、创作或自动化的内容任务…",
    addAttachment: "添加附件",
    stop: "停止",
    stopping: "正在停止",
    enqueue: "加入队列",
    send: "发送",
    /* P2-CMP-1: token / 字符计数 */
    charCount: (n: number) => `${n} 字符`,
    sendShortcut: "⌘↵ 发送",
    /* P2-CMP-2: 空状态 prompt 提示 chip */
    /* P0-CMP-3: 自定义 select */
    provider: "Provider",
    openWorkspace: "打开当前项目",
    projectTargetHint: (name: string) => `新对话将自动创建为项目「${name}」的任务`,
    moreActions: "更多操作",
    imageTooLarge: (size: string) => `图片过大（${size}MB），上限 2MB。`,
    imageReadFailed: "图片读取失败。",
    imagePreview: "图片预览",
    closePreview: "关闭预览",
    previousImage: "上一张",
    nextImage: "下一张"
  },

  context: {
    count: (n: number) => `${n} 项上下文`,
    clear: "清空",
    inline: "内联上下文",
    chars: (n: number) => ` · ${n} 字符`,
    moveUp: "前移",
    moveDown: "后移",
    remove: "移除",
    detail: (label: string) => `${label} 详情`,
    selection: "引用内容",
    removeNamed: (label: string) => `删除引用：${label}`,
    removeImage: (label: string) => `移除图片：${label}`,
    removeThis: "删除此引用"
  },

  suggestions: {
    mentionAria: "引用文件",
    mentionTitle: "引用 openmind 文件",
    searchQuery: (q: string) => `搜索"${q}"`,
    enterFilename: "输入文件名或路径",
    filterSkill: (q: string) => `筛选"/${q}"`,
    pickWorkflow: "选择要运行的真实工作流",
    searchingFiles: "正在搜索文件",
    startTyping: "输入文件名开始搜索",
    mentionHelp: "支持文件名、目录和模糊匹配；仅搜索 openmind/，敏感凭据不会进入自动补全。",
    noOpenmindMatch: "openmind 中没有匹配文件",
    tryAnotherKeyword: "换一个关键词，或使用「浏览文件」手动选择。",
    noSkillMatch: "没有匹配的 Skill",
    skillRetryHint: "删除部分字符重试；输入 / 可以查看全部已注册 Skill。",
    kbdSelect: "选择",
    kbdConfirm: "或 Enter 确认",
    kbdClose: "关闭",
    browseOpenmind: "浏览 openmind",
    indexTruncatedTitle: "openmind 文件数量超过索引上限，结果可能不完整",
    indexedCount: (n: number, truncated: boolean) => `已索引 ${n} 个文件${truncated ? " · 已达上限" : ""}`
  },

  message: {
    showMore: "显示更多",
    showLess: "收起",
    you: "你",
    quote: "引用",
    quoteMessage: "引用消息",
    editResend: "编辑并重新发送",
    branchFromMessage: "从此消息创建新会话",
    rerun: "按原上下文重新运行",
    quoteReply: "引用回复",
    branchFromReply: "从此回复创建新会话",
    copied: "已复制",
    copy: "复制",
    artifactLabel: "产物 · Markdown",
    artifactDocument: "文档",
    artifactStreaming: "生成中",
    artifactComplete: "已完成",
    artifactIncomplete: "未完整",
    artifactIncompleteDetail: "产物格式未完整结束，已保留当前正文。",
    copyArtifact: "复制正文",
    contextsUsed: (n: number) => `本次使用了 ${n} 项上下文`,
    imageAttachment: "图片附件",
    previewFile: (path: string) => `预览 ${path}`,
    viewImage: (alt: string, src: string) => `查看图片：${alt || src}`,
    userLabel: "用户消息",
    assistantLabel: "AI 回复"
  },

  tool: {
    fallbackName: "工具",
    call: "工具调用",
    runFailed: "运行失败",
    ran: "已运行",
    running: "正在运行",
    commandGroupRan: (n: number) => `运行了 ${n} 条命令`,
    commandGroupRunning: (n: number) => `正在运行 ${n} 条命令`,
    commandGroupCancelled: (n: number) => `命令执行已取消 · 共 ${n} 条`,
    commandGroupFailedTitle: (n: number) => `命令执行失败 · 共 ${n} 条`,
    commandGroupConflicted: (n: number) => `命令执行存在冲突 · 共 ${n} 条`,
    commandGroupIncomplete: (n: number) => `命令结果不完整 · 共 ${n} 条`,
    commandGroupFailed: (n: number) => `${n} 条失败`,
    commandGroupCancelledCount: (n: number) => `${n} 条取消`,
    commandGroupIncompleteCount: (n: number) => `${n} 条结果不完整`,
    toolGroupRan: (n: number) => `运行了 ${n} 个工具`,
    toolGroupRunning: (n: number) => `正在运行 ${n} 个工具`,
    toolGroupCancelled: (n: number) => `工具运行已取消 · 共 ${n} 个`,
    toolGroupFailedTitle: (n: number) => `工具运行失败 · 共 ${n} 个`,
    toolGroupConflicted: (n: number) => `工具运行存在冲突 · 共 ${n} 个`,
    toolGroupIncomplete: (n: number) => `工具结果不完整 · 共 ${n} 个`,
    toolGroupFailed: (n: number) => `${n} 个失败`,
    toolGroupCancelledCount: (n: number) => `${n} 个取消`,
    toolGroupIncompleteCount: (n: number) => `${n} 个结果不完整`,
    commandRunning: (elapsed: string) => `正在运行命令，已持续 ${elapsed}`,
    commandRan: (elapsed: string) => `已运行命令，已持续 ${elapsed}`,
    commandFailed: "命令失败",
    commandCancelled: "命令已取消",
    commandIncomplete: "命令结果不完整",
    incomplete: "结果不完整",
    detail: "调用详情",
    outputCount: (n: number) => `${n} 条输出`,
    noOutput: "暂无输出",
    searchIO: "搜索工具输入和输出",
    searchPlaceholder: "搜索输入和输出",
    saveOutput: "保存输出",
    request: "请求",
    errorResult: "错误结果",
    result: "结果",
    output: "输出",
    query: "查询",
    scope: "范围",
    currentProject: "当前项目",
    matches: "匹配",
    matchCount: (n: number) => `${n} 项`,
    path: "路径",
    fullRange: "全文或默认范围",
    encoding: "编码",
    auto: "自动",
    preview: "预览",
    command: "命令",
    viewRequestDetail: "查看请求详情",
    cwd: "目录",
    exitCode: "退出码",
    file: "文件",
    readFile: (name: string) => `已读文件 ${name}`,
    viewedImages: (n: number) => `已查看 ${n} 张图像`,
    operation: "操作",
    writeEdit: "写入/编辑",
    outcome: "结果",
    recorded: "已记录",
    context: "上下文",
    eventCount: (n: number) => `${n} 个事件`,
    input: "输入",
    structuredParams: "结构化参数",
    rawParams: "原始参数",
    loadMoreOutput: "加载更多输出",
    loadMoreOutputProgress: (shown: number, total: number) => `加载更多（已 ${shown} / 共 ${total} 字符）`,
    expandAllOutput: "全部展开",
    viewCommandDetail: "查看命令详情",
    viewSearchDetail: "查看搜索详情",
    viewFileDetail: "查看文件详情",
    viewNetworkDetail: "查看网络请求详情",
    viewCallDetail: "查看调用详情",
    category: {
      command: "命令",
      search: "搜索",
      read: "读取",
      write: "写入",
      network: "网络",
      skill: "技能",
      tool: "工具"
    }
  },

  file: {
    open: "打开文件",
    revealFolder: "所在目录"
  },

  status: {
    failed: "失败",
    cancelled: "已取消",
    running: "运行中",
    completed: "完成",
    success: "成功",
    run: {
      queued: "排队中",
      running: "运行中",
      waitingApproval: "等待审批",
      completed: "已完成",
      failed: "失败",
      cancelled: "已取消",
      applying: "正在应用",
      conflicted: "存在冲突"
    },
    session: {
      idle: "空闲",
      running: "运行中",
      waitingApproval: "等待批准",
      failed: "失败"
    }
  },

  approval: {
    banner: "待审批操作",
    alreadyHandled: "审批已经被其他操作处理。",
    required: "需要你的授权",
    pending: "等待处理",
    requestDetail: "请求详情",
    affectedPaths: "影响路径",
    sessionHint: "「本会话允许」仅记住相同类别与命令，不会放开删除、提权或项目外访问。",
    decline: "拒绝",
    acceptSession: "本会话允许",
    allow: "允许",
    executeAsk: "是否执行",
    details: "详情",
    category: {
      command: "命令",
      fileChange: "文件修改",
      delete: "删除",
      outsideWorkspace: "项目外访问",
      network: "网络",
      elevation: "提权",
      tool: "工具"
    },
    decisionLine: {
      declined: (subject: string) => `已拒绝 ${subject}`,
      ran: (subject: string) => `已运行了 ${subject}`
    },
    decision: { declined: "已拒绝", processed: "已处理" },
    /* P1-APR-3: 决策后 toast + undo */
    declinedToast: (subject: string) => `已拒绝：${subject}`,
    undo: "撤销",
    undoExpired: "撤销窗口已过",
    /* P1-APR-4: 批量审批 */
    batchSummary: (n: number) => `${n} 项待审批`,
    allowAll: "全部允许",
    declineAll: "全部拒绝"
  },

  diff: {
    editedFiles: (n: number) => `已编辑 ${n} 个文件`,
    editedFile: "已编辑文件",
    showMoreFiles: (n: number) => `再显示 ${n} 个文件`,
    showFewerFiles: "收起",
    changesUpdated: "变更已更新",
    providerReported: "Provider 已报告文件变更，详细 Diff 可在右侧会话详情中查看。",
    status: { created: "新增", modified: "修改", deleted: "删除", renamed: "重命名" }
  },

  events: {
    riskTitle: "风险提示",
    systemTitle: "系统事件",
    runFailed: "运行失败",
    runDetail: "运行详情",
    runDetailSubtitle: "初始化、状态与生命周期事件",
    system: "系统",
    status: "状态",
    systemEvent: "系统事件",
    statusUpdate: "状态更新",
    completed: "运行完成",
    cancelled: "运行已取消",
    contextCompacted: "上下文已自动压缩",
    systemWarning: "系统警告",
    subtaskFallback: "子任务",
    subtaskStarted: "已开始",
    subtaskUpdated: "运行中",
    subtaskCompleted: "已完成",
    subtaskFailed: "失败",
    subtaskCancelled: "已取消",
    subtaskAgents: (n: number) => `${n} 个 agent`
  },

  activity: {
    waitingApproval: "等待你的批准",
    waitingApprovalDetail: "AI 已暂停，处理审批后会从当前位置继续。",
    applyingChanges: "正在应用文件变更",
    applyingChangesDetail: "正在更新当前项目目录，请稍候。",
    executingTool: (tool: string) => `正在执行 ${tool}`,
    continuing: "正在继续下一步",
    continuingDetail: "工具调用已完成，AI 正在决定是否继续操作或给出最终回复。",
    decidingNext: "正在确定下一步",
    decidingNextDetail: "思考阶段已完成，正在准备回复或下一项操作。",
    ready: "本地 AI 已就绪",
    readyDetail: "正在读取项目上下文并分析你的请求。",
    stillWaiting: "仍在等待响应",
    stillWaitingDetail: "已有一段时间没有新事件。可查看诊断信息或停止运行。",
    longRunning: "本地 AI 仍在运行。你可以继续输入，后续消息会进入队列。",
    firstBoot: "首次启动可能需要加载本地配置、技能和项目上下文。",
    starting: "正在启动本地进程并建立会话。",
    startingProvider: (provider: string) => `正在启动 ${provider}`
  },

  trace: {
    reasoningCount: (n: number) => `${n} 次思考`,
    toolCount: (n: number) => `${n} 个工具`,
    filesChanged: (n: number) => `修改 ${n} 个文件`,
    fileOps: (n: number) => `${n} 次文件操作`,
    approvals: (n: number) => `${n} 次审批`,
    failures: (n: number) => `${n} 个失败`,
    noTools: "无工具调用"
  },

  thought: {
    thinking: "正在思考",
    codexSummary: "推理摘要",
    process: "思考过程",
    streaming: "思考中",
    /* P1-RSN-1: 折叠态路标 */
    /* P2-THT-2: pending elapsed timer */
    thinkingFor: (elapsed: string) => `思考中 · ${elapsed}`
  },

  /* P1-RSN-2: 推理过程独立面板（方案 C 侧抽屉） */
  reasoningPanel: {
    virtualHint: "内容过长，已启用虚拟滚动"
  },

  /* P0-OFL: 动态内容溢出统一容器 */
  overflow: {
    expandAll: "展开全文",
    collapse: "收起",
    expandLines: (n: number) => `展开全部 ${n} 行`,
    searchPlaceholder: "搜索…",
    searchCount: (active: number, total: number) => `${active + 1} / ${total}`,
    searchNoMatch: "无匹配",
    searchPrev: "上一个",
    searchNext: "下一个",
    searchClose: "关闭搜索",
    longOutputHint: "输出过长，建议 ⌘F 搜索或下载完整日志"
  },

  plan: {
    aria: "执行计划",
    liveAria: "当前任务实时进度",
    stepProgress: (current: number, total: number) => `第 ${current} / ${total} 步`,
    historyTitle: "计划与任务",
    expand: "展开",
    collapse: "收起",
    title: "计划",
    todoTitle: "任务进度",
    sourceCodex: "Codex CLI",
    sourceClaude: "Claude Code SDK",
    completed: "已完成",
    inProgress: "进行中",
    pending: "待处理"
  },

  risk: { detected: "检测到风险内容" },

  sidebar: {
    dialogLabel: "AI 助手",
    close: "关闭 AI 助手",
    expand: "展开 AI 侧栏",
    providerSelect: "AI 提供方",
    width: "AI 侧栏宽度",
    viewInWorkbench: "在工作台查看会话",
    pendingContexts: (n: number) => `${n} 项待发送上下文`,
    switchSession: "切换 AI 会话",
    newDraft: "新会话草稿",
    toggleWide: "切换宽屏",
    fullscreen: "全屏",
    exitFullscreen: "退出全屏",
    collapse: "收起",
    openWorkbench: "在 AI 工作台打开"
  },

  providerChange: {
    title: "AI Provider 有变更",
    body: (id: string) => `该会话绑定的 Provider「${id}」配置在创建后发生过变更。确认继续后，后续消息将按当前配置发送到对应服务，并更新会话记录的绑定指纹。`,
    confirm: "确认继续",
    cancel: "取消"
  },

  error: {
    workerExit: (code?: number | null) => `AI 调度服务异常退出${code != null ? `，代码 ${code}。` : "。"}`,
    loadOlderFailed: (err: string) => `加载更早会话失败：${err}`,
    loadSessionFailed: (err: string) => `加载会话失败：${err}`,
    sessionNotFound: "找不到要更新的会话。",
    sendingInProgress: "消息正在发送，请稍候。",
    noProvider: "没有检测到可用的 Claude Code 或 Codex。",
    rerunNotFound: "找不到要重新运行的任务。"
  },

  recovery: {
    skill: "可在自动化或数据源运行日志中查看详情，并使用重试/重新运行。",
    provider: "可打开 AI 工作台检查运行日志、权限配置和审批记录后重试。",
    index: "可刷新当前页面；若问题持续，可在设置中重建内容索引。",
    file: "可检查项目目录边界和文件读写权限，然后重新执行当前操作。",
    default: "可重试当前操作；若仍失败，请打开相关页面日志或系统日志查看详情。"
  },

  time: {
    unknown: "耗时未知",
    milliseconds: (n: number) => `${n} ms`,
    seconds: (n: number) => `${n} 秒`,
    secondsDecimal: (s: string) => `${s} 秒`,
    minutesSeconds: (m: number, s: number) => `${m} 分 ${s} 秒`
  },

  common: {
    notRecorded: "未记录",
    chars: (n: number) => `${n} 字符`
  }
} as const;

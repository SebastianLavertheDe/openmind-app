/** 页面级 UI 文案：inbox / sources / brief / projects / settings / automation / design-system。 */
export const featureMessages = {
  inbox: {
    sort: { aria: "内容排序", newest: "最新收录", oldest: "最早收录", source: "来源", title: "标题" },
    splitter: { filter: "筛选栏宽度", list: "内容栏宽度" },
    empty: { title: "没有匹配的资料", description: "切换日期或筛选条件后重试。" },
    context: { open: "打开", addContext: "加入 AI 上下文", copyPath: "复制路径", reveal: "文件夹中显示" },
    batch: {
      apply: "应用"
    },
    notify: {
      tagRequired: "请输入至少一个标签"
    },
    reader: {
      noTags: "暂无标签"
    }
  },

  sources: {
    tabs: { rss: "RSS", web: "文件夹", x: "X", reddit: "Reddit", manual: "手动导入", api: "API" },
    page: { title: "资料来源", description: "管理 RSS、文件夹和 API 源。抓取的内容进入资料收集箱，按主题和标签归类。" },
    actions: { runAll: "立即全部抓取", add: "添加源", disable: "停用", enable: "启用", stop: "停止", fetch: "抓取", more: "更多" },
    metrics: {
      noAnomaly: "无异常"
    },
    toolbar: { tabsAria: "数据源分类", searchPlaceholder: "筛选源..." },
    table: { name: "名称", type: "类型", status: "状态", lastRun: "最近抓取", items: "条目", actions: "操作", notRun: "尚未运行" },
    pagination: { prev: "上一页", next: "下一页", summary: (page: number, totalPages: number, count: number) => `${page} / ${totalPages} · 共 ${count} 个`, loadMore: (remaining: number) => `加载更多(剩 ${remaining} 个)`, allLoaded: "已全部加载" },
    empty: { title: "还没有添加数据源", description: "添加 RSS 订阅、本地文件夹或 API 端点来开始收集资料。", action: "添加第一个源" },
    add: {
      frequencyOptions: { m15: "每 15 分钟", hourly: "每小时", daily: "每天", pipeline: "每日流水线" },
      importOpml: "导入 OPML"
    },
    kind: { rss: "RSS", web: "文件夹", x: "X", reddit: "Reddit", manual: "手动导入", api: "API" },
    status: { pending: "待运行", running: "运行中", ok: "正常", attention: "需关注", failed: "失败", disabled: "已停用" },
    notify: {
      opmlImported: (count: number) => (count ? `已导入 ${count} 个 RSS 数据源` : "没有新增数据源")
    }
  },

  skillCenter: {
    eyebrow: "SKILL CENTER",
    title: "Skills",
    description: "安装、检查和管理本地 Skill 包；包代码必须通过静态检查并完成 Runtime 就绪后才能运行。",
    sourcePicker: {
      open: "添加其他来源",
      close: "收起来源选择",
      title: "添加 Skill 来源",
      description: "本地目录、ZIP 和公开 HTTPS Git 仓库都会先静态检查；Git 不接受 URL 凭据，也不会执行包代码。",
      local: "选择本地目录或 ZIP",
      git: "Git HTTPS 地址",
      gitPlaceholder: "https://github.com/org/skill.git",
      refPlaceholder: "分支或 tag（可选）",
      inspect: "检查 Git 来源",
      inspecting: "检查中…",
      cancel: "取消检查",
      import: "安装",
      importing: "安装中…",
      valid: "静态检查通过",
      invalid: "静态检查未通过",
      noApi: "当前预览环境不支持导入来源。",
      noCandidate: "先选择本地来源或检查 Git 地址。",
      notInspected: "请先完成静态检查，并确认检查通过后再安装。",
      name: "名称",
      publisher: "发布者",
      version: "版本",
      filesLabel: "文件",
      digest: "内容摘要",
      files: (count: number) => `${count} 个文件`,
      issues: "静态检查问题",
      sourceErrors: {
        "git-unavailable": "本机没有可用的 Git，无法检查 Git 来源。",
        "git-command-failed": "Git 克隆或检查失败，请确认仓库地址可公开访问。",
        "git-auth-required": "Git 仓库需要登录或当前账号无权访问。",
        "git-timeout": "Git 来源检查超时，请稍后重试。",
        "git-cancelled": "已取消 Git 来源检查。",
        "git-package-missing": "仓库中没有找到 Skill 包（需要 cctools.skill.yaml，兼容 openmind.skill.yaml 或 SKILL.md）。",
        "git-package-selection-invalid": "请选择仓库中存在且通过静态检查的 Skill 包。",
        invalid: "来源输入不合法：Git 地址必须是有效的 HTTPS URL。",
        unknown: "来源检查失败。"
      } as Record<string, string>
    },
    searchPlaceholder: "搜索 Skills…",
    searchAria: "搜索 Skills",
    clearSearch: "清空搜索",
    skillCount: (count: number) => `${count} 个 Skill`,
    resultCount: (count: number, total: number) => `${count} / ${total}`,
    listAria: "Skill Center 列表",
    loading: "正在读取 Skill 包…",
    emptyTitle: "还没有可管理的 Skill",
    emptyDescription: "在技能中心「添加其他来源」安装，或在设置中绑定一个 AI/代码工作区。",
    noMatch: "没有匹配的 Skill",
    noMatchDescription: "试试名称、ID 或发布者中的其他关键词。",
    detailEmpty: "选择一个 Skill 查看包状态、来源和宿主机执行边界。",
    source: "来源",
    sourcePath: "来源路径",
    sourceUpdate: {
      check: "检查更新",
      checking: "检查中…",
      apply: "更新",
      updating: "更新中…",
      current: "已是最新版本。",
      available: "有可用更新。",
      updated: "更新完成。",
      invalid: "Git 来源中有未通过静态检查的 Skill，已停止更新。",
      failed: (detail: string) => `更新失败${detail ? `：${detail}` : "。"}`
    },
    overviewAria: "Skill 基本信息",
    publisher: "发布者",
    version: "版本",
    kind: "类型",
    installed: "已安装",
    available: "包体已验证",
    unusable: "包体异常",
    availability: {
      title: "后续可用性",
      description: "控制这个 Skill 是否可用于之后新建的会话或新提交的运行。",
      newSessionsOnly: "更改不会修改已有会话，也不会取消已排队或正在运行的任务。",
      enabled: "已启用",
      disabled: "已停用",
      updating: "正在更新…",
      toggleAria: (title: string) => `启用 ${title} 的后续使用`,
      enabledConfirmation: "已为后续会话和运行启用。",
      disabledConfirmation: "已为后续会话和运行停用。",
      updateFailed: (detail: string) => `更新 Skill 可用性失败${detail ? `：${detail}` : "。"}`
    },
    actions: {
      uninstall: "卸载"
    },
    disabledByBoundary: "这个 Skill 安装失败或文件已变化，请重新安装。"
  },

  onboarding: {
    eyebrow: "FIRST START",
    title: "先准备本地工作台",
    description: "按顺序完成 4 项首次设置即可开始。App 只保存路径绑定与设置状态，不会移动、重命名或清理现有内容。",
    progress: (current: number, total: number) => `步骤 ${current} / ${total}`,
    progressLabel: "首次启动设置进度",
    previousStep: "上一步",
    nextStep: "下一步",
    rootTitle: "选择 OpenMind 私人数据仓库",
    rootBody: "选择保存全部 OpenMind 数据的私人仓库。config、article、daily-summary、.agent 等目录都将直接位于这个目录下。",
    rootPathLabel: "OpenMind 私人数据仓库路径",
    rootSafety: "内容始终保留在本机",
    rootSelected: "OpenMind 私人数据仓库已可用",
    rootMissing: "尚未选择文件夹",
    chooseRoot: "选择文件夹",
    chooseAgain: "重新选择私人数据仓库",
    skillTitle: "安装 RSS 源",
    skillBody: "安装 RSS 采集所需的官方组件，让工作台可以订阅、抓取并整理内容。",
    skillSourceLabel: "RSS 采集组件来源",
    skillSafety: "仅从公开 HTTPS 官方仓库安装",
    installSkillsRepo: "安装 RSS 源",
    installingSkillsRepo: "正在安装 RSS 源…",
    skillReady: "RSS 采集能力已安装",
    providerTitle: "连接 AI Provider",
    providerBody: "连接已安装的 Claude Code 或 Codex CLI，让 OpenMind 可以开始 AI 会话。",
    providerStatusLabel: "AI Provider 状态",
    providerSafety: "这一步可以跳过，稍后在设置中完成",
    installProvider: "打开 Provider 设置",
    skipProvider: "稍后配置",
    providerSkipped: "已跳过 Provider 配置",
    finishTitle: "准备完成",
    finishBody: "本地工作台已经可以使用。进入主界面后，仍可随时调整所有可选设置。",
    finishSummaryLabel: "首次设置摘要",
    finishSafety: "配置只保存在应用私有设置中",
    finish: "进入工作台",
    providerReady: "AI Provider 已就绪",
    providerPending: "AI Provider 未就绪",
    selecting: "选择中…"
  },

  brief: {
    metrics: {
      topicCandidates: (n: number) => `${n} 个候选`
    },
    source: {
      export: "导出"
    },
    empty: { title: "没有每日摘要文件", description: "该日期没有可展示的 Markdown 原文。" },
    notify: { exported: (file: string) => `已导出到 ${file}`, copied: "简报原文已复制" }
  },

  projects: {
    filters: {
      projectViewAria: "项目视图"
    },
    actions: { newEmpty: "新建空项目", fromTemplate: "从模板创建", backToCreative: "返回创作", openDir: "打开目录" },
    dateMode: { label: "日期口径", date: "项目日期", updatedAt: "更新时间" },
    view: { cards: "卡片视图", table: "表格视图" },
    empty: { title: "没有匹配的项目", description: "切换筛选或搜索条件后重试。" },
    detail: {
      unconfiguredPlatform: "未配置平台"
    },
    sections: {
      manage: "项目管理"
    },
    manifest: {
      emptyRaw: "没有额外字段"
    },
    fields: {
      updatedAt: "更新时间"
    },
    values: {
      none: "无"
    },
    materials: { empty: "该项目暂未挂载资料文件。" },
    draft: { noBody: "草稿还没有正文内容。", noFile: "该项目还没有草稿文件。" },
    review: {
      status: { pending: "待处理", changesRequested: "需修改", approved: "已通过" }
    },
    publish: {
      status: { draft: "草稿", scheduled: "已排期", exported: "已导出", cancelled: "已取消" },
      fields: { scheduledAt: "计划时间", exportedPath: "导出文件", publishedUrl: "发布链接" }
    },
    ai: {
      bindCurrent: "绑定当前会话"
    },
    manage: {
      delete: "删除项目"
    },
    notify: {
      deleted: "项目已删除"
    },
    delete: {
      body: (dir: string, fileLines: string) =>
        `将永久删除项目目录「${dir}」及其下全部本地内容：\n${fileLines}\n\n包括正文、历史版本、审核报告与发布记录，操作不可撤销。确定继续吗？`
    },
    create: {
      copySuffix: "（副本）"
    }
  },

  settings: {
    loading: "正在加载偏好设置",
    loadError: "偏好设置加载失败，请重试。",
    retry: "重新加载",
    page: { title: "设置", description: "管理 OpenMind 的外观、AI、权限、工作流和本地数据。" },
    navigation: {
      label: "设置分类",
      back: "返回应用",
      searchPlaceholder: "搜索设置…",
      noResults: "没有匹配的设置",
      groups: {
        personal: "个人",
        ai: "AI",
        creation: "创作",
        data: "数据与会话"
      },
      sections: {
        general: { title: "常规", description: "调整外观、阅读密度和当前项目路径。" },
        providers: { title: "AI 与模型", description: "查看 Provider 与本地 CLI 配置中的模型，并设置新会话默认连接。" },
        skills: { title: "Skills", description: "管理 AI 可调用的能力、关联资料来源与运行状态。" },
        mcp: { title: "MCP 服务", description: "管理 AI 可调用的外部服务、连接状态和工具。" },
        browser: { title: "浏览器", description: "让 AI 写作时自主从已登录的 Chrome 获取原文证据截图。" },
        permissions: { title: "权限与安全", description: "配置新会话权限、审批边界和风险提醒。" },
        workflow: { title: "内容工作流", description: "配置创作阶段、自动保存、审核和归档规则。" },
        sources: { title: "资料来源", description: "管理可供 Skills 复用的 RSS、文件夹、API 和其他输入来源。" },
        storage: { title: "数据与存储", description: "记录缓存、日志和通知历史的本地保留策略。" },
        sessions: { title: "会话归档", description: "查看、打开或恢复已经归档的 AI 会话。" }
      }
    },
    saveStatus: { saving: "正在保存…", saved: "改动会即时保存在本地" },
    appearance: { title: "外观", theme: "主题", density: "密度", fontSize: "正文字号" },
    theme: { light: "浅色", dark: "深色", description: "浅色适合白天，深色适合长时间阅读。" },
    density: {
      compact: "紧凑",
      default: "默认",
      comfortable: "宽松",
      description: "紧凑模式缩小栏内间距，更多内容可见。"
    },
    fontSize: {
      small: "小",
      default: "默认",
      large: "大",
      description: "阅读区与列表的基准字号。"
    },
    provider: {
      configuredModel: "配置模型",
      configuredModelAria: (label: string) => `${label} 配置模型`,
      modelNotConfigured: "配置未指定，运行时由 Provider 决定",
      claudeProtocol: "Claude Agent SDK",
      codexProtocol: "app-server 协议",
      available: "可用",
      unavailable: "不可用",
      setDefault: (label: string) => `将 ${label} 设为默认`,
      empty: "当前没有检测到可用 Provider。请确认 Claude Code 或 Codex CLI 已安装并可在本机执行。",
      loggedIn: "已登录",
      notLoggedIn: "未登录或协议不可用",
      install: "一键安装",
      installing: "安装中…",
      installFailed: "一键安装失败：",
      installProgress: "安装进度",
      retryInstall: "重试安装",
      openLogin: "打开终端登录",
      recheck: "我已完成登录，重新检测",
      loginHint: "在终端完成 CLI 登录后回到这里重新检测。",
      wslStepsTitle: "查看 WSL 手动安装步骤",
      copyCommand: "复制命令",
      wslStepsRecheck: "在 WSL 内完成安装与登录后，回到这里重新检测。"
    },
    skills: {
      title: "已支持的能力",
      scope: (skillCount: number, mcpCount: number) => `${skillCount} Skills · ${mcpCount} MCP 服务`,
      catalogAria: "能力类型",
      skillsTab: "Skills",
      mcpTab: "MCP",
      searchPlaceholder: "搜索名称、调用命令或描述",
      searchAria: "搜索 Skills",
      groupAria: "Skill 分组",
      allGroups: "全部分组",
      fallbackGroup: "其他",
      refresh: "刷新能力",
      refreshing: "刷新中…",
      emptyTitle: "当前工作区未发现 Skill",
      emptyDescription: "应用会从 .claude/skills/*/SKILL.md 扫描可用能力。",
      noMatchTitle: "没有匹配的 Skill",
      noMatchDescription: "尝试更换关键词或选择其他分组。",
      detailAria: (title: string) => `查看 Skill 详情：${title}`,
      cwd: "工作目录",
      command: "执行命令",
      envFile: "环境文件",
      timeout: "超时时间",
      outputs: "输出文件",
      notConfigured: "未配置",
      notDeclared: "未声明",
      copyInvocation: "复制调用命令",
      copyNamed: (id: string) => `复制 Skill 调用命令：/${id}`,
      openDirectory: "打开 Skill 目录",
      openNamed: (title: string) => `打开 Skill 目录：${title}`,
      scanComplete: (skillCount: number, mcpCount: number) => `已发现 ${skillCount} 个 Skill、${mcpCount} 个 MCP 服务`,
      scanFailed: "能力刷新失败",
      copySuccess: (id: string) => `已复制 /${id}`,
      copyFailed: "复制调用命令失败",
      openFailed: "无法打开 Skill 目录",
      mcpSearchPlaceholder: "搜索服务、工具、后端或输入输出",
      mcpSearchAria: "搜索 MCP 服务和工具",
      mcpListAria: "MCP 服务",
      mcpStatus: { enabled: "已启用", disabled: "未启用", unavailable: "不可用" },
      mcpBackend: "实现后端",
      mcpTransport: "传输方式",
      mcpConnection: "浏览器连接",
      mcpProviders: "可用 Provider",
      mcpTools: (count: number) => `对 AI 暴露的工具 · ${count}`,
      mcpInputs: "输入",
      mcpOutputs: "输出",
      mcpOpenSettings: "前往浏览器设置",
      mcpEmptyTitle: "当前没有已注册的 MCP 服务",
      mcpEmptyDescription: "应用管理的 MCP 服务会在这里按服务和工具展示。",
      mcpNoMatchTitle: "没有匹配的 MCP 能力",
      mcpNoMatchDescription: "尝试搜索服务名、工具名或后端。"
    },
    browser: {
      scope: "Playwright MCP · Chrome",
      enabled: "允许 AI 自主获取原文截图",
      enabledDescription: "仅在关键事实、引用或数据需要原文佐证时触发，并在同一轮继续写作。",
      reuseTabs: "复用已打开的目标标签页",
      reuseTabsDescription: "URL 完全匹配时直接使用扩展已授权的标签页；截图后恢复原滚动位置和活动标签。",
      evidenceDir: "证据素材目录",
      evidenceDirDescription: "PNG 与来源 JSON 会保存在工作区内，供稿件长期引用。",
      backend: "浏览器后端",
      extension: "Playwright Chrome 扩展",
      ready: "已就绪",
      needsSetup: "需配置",
      token: "扩展令牌",
      tokenDescription: "令牌由 Playwright 扩展生成，使用系统安全存储加密；模型和稿件不会看到令牌。",
      tokenPlaceholder: "粘贴 PLAYWRIGHT_MCP_EXTENSION_TOKEN",
      saveToken: "保存令牌",
      replaceToken: "更新令牌",
      clearToken: "清除",
      configured: "已安全保存",
      notConfigured: "未保存；首次连接需要在扩展中确认标签页",
      installExtension: "安装 / 打开扩展说明",
      boundary: "AI 只能调用“截取原文证据”：可读取、导航和截图；不能输入密码、提交表单、购买、发送、发布或修改账号设置。扩展授权的标签页是访问边界。",
      loadFailed: "浏览器状态读取失败",
      tokenSaved: "浏览器扩展令牌已安全保存",
      tokenCleared: "浏览器扩展令牌已清除",
      tokenFailed: "浏览器扩展令牌保存失败"
    },
    credentials: {
      profileTestFailed: "连接失败"
    },
    permissions: {
      title: "权限与审批",
      readOnly: "只读",
      edit: "编辑",
      auto: "自动执行",
      defaultLabel: "新会话默认权限",
      defaultDescription: "只读最安全；编辑允许写文件；自动执行免审批。",
      destructiveLabel: "破坏性操作需审批",
      destructiveDescription: "删除、覆盖、提权与项目外访问始终需要确认。",
      riskScanLabel: "风险扫描",
      riskScanDescription: "只提醒，不脱敏、不修改、不阻止保存。"
    },
    paths: {
      title: "项目路径",
      openmindRoot: "OpenMind 私人数据仓库",
      workspace: "工作目录",
      notes: "笔记目录",
      browse: "浏览",
      selectRoot: "选择",
      unset: "未设置",
      note: "私人数据仓库本身就是内容根，config、article、.agent 等目录彼此平级；工作目录仅用于 AI/代码工作。"
    },
    archivedSessions: {
      title: "已归档会话",
      scope: (count: number) => `${count} 条`,
      description: "归档会话不会出现在侧边栏的最近会话中，记录与运行历史仍保存在本地。",
      listAria: "已归档会话列表",
      empty: "暂无已归档会话",
      open: "打开",
      restore: "恢复",
      restoring: "恢复中",
      openNamed: (title: string) => `打开归档会话：${title}`,
      restoreNamed: (title: string) => `恢复归档会话：${title}`
    },
    notify: {
      saveFailed: "设置保存失败",
      workspaceUpdated: "工作目录已更新",
      workspaceSelectFailed: "选择工作目录失败",
      notesOpenFailed: "无法打开笔记目录",
      sessionOpenFailed: "无法打开归档会话",
      sessionRestoreFailed: "恢复归档会话失败",
      workflowReset: "工作流规则已恢复默认值"
    },
    workflow: {
      stagesTitle: "阶段定义与进入条件",
      stagesDescription: "创作项目从选题到发布的阶段流转规则（只读）。",
      stageToday: "今日推荐",
      stageDrafting: "创作中",
      stageReview: "待审核",
      stageReady: "待发布",
      stagePublished: "已发布",
      entryNone: "无前置门禁",
      entryReview: "审核通过后可进入待发布",
      entryPublish: "导出或发布完成后进入已发布",
      autoSaveTitle: "自动保存草稿",
      autoSaveDesc: "编辑时按间隔自动保存草稿内容。",
      autoVersionTitle: "阶段切换创建版本",
      autoVersionDesc: "推进到下一阶段时自动创建版本快照。",
      reviewGateTitle: "进入待发布需审核通过",
      reviewGateDesc: "开启后，待审核项目必须审核通过才能进入待发布。",
      publishCheckTitle: "发布前检查清单",
      publishCheckDesc: "待发布阶段检查平台、标题、摘要、标签和封面是否填写。",
      autoArchiveTitle: "自动归档已发布项目",
      autoArchiveDesc: "已发布超过指定天数后自动归档到归档目录。",
      resetToDefaults: "恢复默认值",
      resetConfirm: "确定要将所有工作流规则恢复为默认值吗？"
    }
  },

  automation: {
    title: "自动化",
    ruleCount: (n: number) => `${n} 条规则`,
    enableRule: (title: string) => `启用 ${title}`,
    rules: {
      dailyBrief: {
        steps: [
          { title: "拉取资料", detail: "过去 24h 新增，按关注主题过滤" },
          { title: "主题聚类", detail: "按标签与内容相似度分组" },
          { title: "生成简报", detail: "调用 AI，遵守 Kill the AI Tone" },
          { title: "写入资料库", detail: "openmind/daily-summary/${date}_daily_summary.md" }
        ]
      },
      classify: {
        steps: [
          { title: "读取新增资料", detail: "只处理本次采集产生的条目" },
          { title: "补齐标签", detail: "映射到现有主题和来源类型" },
          { title: "生成候选选题", detail: "输出到 daily-topic 目录" }
        ]
      },
      rss: {
        steps: [
          { title: "读取订阅", detail: "解析 subscriptions.opml" },
          { title: "抓取正文", detail: "trafilatura 优先，必要时降级" },
          { title: "去重与保存", detail: "写入 openmind/article/${date}/" }
        ]
      }
    },
    schedule: { daily0800: "每天 08:00", afterCapture: "抓取后触发", every15min: "每 15 分钟" },
    trigger: { scheduled: "定时", event: "事件", afterCaptureDetail: "RSS / X / Reddit 抓取成功后", every15minDetail: "每 15 分钟检查订阅源" },
    actions: { stop: "停止运行", run: "立即运行" },
    status: {
      running: "运行中",
      ready: "就绪",
      lastFailed: "最近失败",
      lastSucceeded: "最近一次成功"
    },
    enabled: "已启用",
    neverRun: "尚未运行",
    manifestMissing: "Skill manifest 未找到，仍可尝试触发",
    sections: { trigger: "触发条件", steps: "动作步骤" },
    stepState: { ready: "就绪", running: "运行中", approval: "需审批" },
    console: { title: "运行日志", copied: "已复制" },
    log: {
      ended: (time: string, status: string) => `[${time}] 结束：${status}`
    },
    runHistory: {
      columns: { status: "状态", startedAt: "开始时间", duration: "耗时", exitCode: "退出码", items: "条目", actions: "操作" },
      status: { running: "运行中", success: "成功", failed: "失败", stopped: "已停止", timedOut: "超时" }
    }
  },

  designSystem: {
    loadingDefault: "正在加载",
    loadFailed: "加载失败",
    skeletonLabel: "正在加载内容",
    search: "搜索",
    searching: "检索中",
    clearSearch: "清空搜索",
    noData: "没有数据",
    loadingTable: "正在加载",
    paginationPrev: "上一页",
    paginationNext: "下一页",
    expand: (label: string) => `展开${label}`,
    closeMenu: "关闭菜单",
    dismissToast: "关闭提示",
    confirm: "确认",
    selectLabel: "选择",
    selectButton: "下拉菜单",
    logViewer: "运行日志",
    logViewerEmpty: "暂无日志输出"
  },

  feedback: {
    cancel: "取消"
  }
} as const;

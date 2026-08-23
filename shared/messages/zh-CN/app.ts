/** App 壳层、全局搜索、工作台问候等。 */
export const appMessages = {
  app: {
    fatalTitle: "OpenMind 无法启动",
    preloadMissing: "Electron preload 未加载，正式桌面版不能回退到浏览器预览数据。请从打包应用重新启动，或检查 preload.js 是否存在。",
    splashStarting: "正在启动工程工作台...",
    routeLoading: "正在打开页面..."
  },

  shell: {
    navExpand: "展开导航",
    navCollapse: "收起导航",
    navMenu: "打开导航菜单",
    navMain: "主导航",
    moreActions: "更多全局操作",
    searchPlaceholder: "搜索资料、创作和会话",
    searchShort: "搜索",
    openProject: (name: string) => `打开项目目录：${name}`,
    statusPreview: "Preview 数据",
    statusConnected: "本地数据已连接",
    notifications: "查看通知",
    notificationsShort: "通知",
    help: "打开帮助",
    helpShort: "帮助",
    recentTasksAria: "最近任务列表",
    recentOpen: "打开任务"
  },

  search: {
    dialogLabel: "命令面板",
    inputAria: "说一句话或搜索资料、创作、会话和自动化",
    placeholder: "说一句话，或搜索资料、创作、会话…",
    loading: "检索中",
    resultsAria: "搜索与动作",
    hintShort: "说一句话让 AI 去做（如「总结今天 3 篇资料」），或输入关键词检索资料、创作、会话与自动化。",
    hintEmpty: "没有匹配的本地资料、创作、会话或 Skill。按 Enter 让 AI 处理这句话。",
    actionSection: "AI 动作",
    runningSuffix: "· 运行中",
    groups: {
      content: "资料",
      project: "创作",
      session: "AI 会话",
      skill: "自动化"
    },
    actions: {
      summarize: { badge: "只读 · 总结", title: "总结今天的资料", why: (date: string) => `匹配「总结」意图 · 读取今天（${date}）的 inbox 与 article，输出中文要点` },
      createDraft: { badge: "创作 · 编辑", title: "写一段内容草稿", why: "匹配「创作」意图 · 以编辑权限运行，结果作为草稿" },
      compare: { badge: "只读 · 分析", title: "对比相关资料", why: "匹配「对比」意图 · 只读分析两份或多份内容的异同" }
    },
    userPrefix: (text: string) => `用户原话：「${text}」`
  }
} as const;

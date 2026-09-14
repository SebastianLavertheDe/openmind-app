/** 创作中心 UI 扩展文案（panels / history / inline AI / review heuristics）。 */
export const creativeUiMessages = {
  workspace: {
    eyebrow: "Creative Studio",
    title: "创作中心",
    description: "全部选题、创作中、待发布和已发布内容。",
    analyticsDescription: (topics: number, projects: number, completion: number) => `${topics} 个选题 · ${projects} 篇稿件 · 平均完成度 ${completion}%`,
    refresh: "刷新",
    tabsAria: "创作视图",
    tabs: { workflow: "工作台", history: "版本历史", release: "发布记录", analytics: "数据分析" },
    search: "搜索选题或稿件",
    completion: (value: number) => `完成度 ${value}%`,
    emptyProjects: { title: "暂无创作稿件", description: "从左侧选题创建草稿后会出现在这里。" },
    streamWidth: "内容流宽度",
    expandList: "展开内容列表",
    autoSaveFailed: (detail: string) => `自动保存失败：${detail}`,
    switchFile: {
      title: "切换文件",
      body: "当前文件有未保存的修改，切换会先保留草稿内容。确定切换吗？",
      confirm: "切换文件"
    },
    editorVersionNote: "编辑器保存前版本",
    savedWithVersion: "草稿已保存并创建版本",
    untitledProject: "未命名项目",
    draftTitle: "草稿",
    reusedDraft: "该选题已有草稿，已打开现有稿件",
    createdDraft: (platform: string) => `已创建草稿（${platform}）`,
    createdProject: "已创建创作稿件",
    stageEntered: (stage: string) => `稿件已进入${stage}`,
    platformRequired: "请先选择目标平台",
    exportedTo: (file: string) => `已导出到 ${file}`,
    exportCancelled: "导出已取消",
    copied: "已复制稿件",
    archive: {
      title: "归档稿件",
      body: "归档后稿件移入归档区，不会删除正文。确认归档吗？",
      confirm: "归档",
      success: "稿件已归档"
    },
    contextProject: "创作稿件",
    contextTopic: "推荐选题"
  },

  topic: {
    score: (score: number) => `推荐指数 ${score}`,
    askAi: "询问 AI",
    createDraft: "创建草稿",
    creatingDraft: "正在创建…",
    hasDraft: "该选题已有草稿，可在「创作中」阶段继续。",
    pickPlatform: "选择平台与模板",
    genericDraft: "通用草稿",
    loadingProject: (title: string) => `正在读取“${title}”…`,
    noBody: "该选题没有更多说明。",
    reasonHeading: "推荐理由与创作角度",
    outline: {
      title: "建议结构",
      hook: "用最新事实或争议点切入主题",
      explain: "解释变化背后的原因和影响",
      evidence: "结合关联资料给出判断",
      close: "用可执行建议或问题收束"
    }
  },

  review: {
    checks: {
      closingDetail: "结尾应形成观点或行动建议"
    },
    notify: {
      reset: "审核状态已重置"
    },
    status: { approved: "已批准", changesRequested: "需修改", pending: "待处理" },
    heuristics: {
      bodyTooShort: { title: "正文偏短", detail: (n: number) => `当前正文 ${n} 字符，建议补充论据或案例。` },
      missingStructure: { title: "缺少章节结构", detail: "至少添加一个二级标题，帮助读者快速扫读。" },
      missingSource: { title: "缺少可追溯来源", detail: "添加原文链接或资料引用，便于读者核实。" },
      longParagraph: { title: "段落过长", detail: "该段落较长，建议拆成 2–3 段以提升可读性。" },
      missingTitle: { title: "缺少主标题", detail: "正文应以一级标题开头。" },
      titleTooLong: { title: "标题偏长", detail: (n: number) => `标题长度为 ${n}，部分平台可能截断。` },
      weakEnding: { title: "结尾缺少收束", detail: "建议用结论、行动建议或开放问题收束全文。" }
    }
  },

  publish: {
    title: "发布准备",
    exported: "已导出",
    pendingExport: "待导出",
    note: "没有接入平台发布 API，因此「立即发布」改为导出 Markdown 文件到本地，再由你手动上传。",
    platformLabel: "目标平台（仅显示本地已实现的导出模板）",
    platformPlaceholder: "选择平台",
    summary: "摘要 / 导语",
    summaryPlaceholder: "一句话说明这篇文章",
    tags: "标签（逗号分隔）",
    tagsPlaceholder: "AI, 本地优先",
    cover: "封面路径（本地，可选）",
    coverPlaceholder: "assets/cover.png",
    checks: { content: "正文已完成（≥300 字符）", platform: "平台已配置", title: "标题", summary: "摘要", tags: "标签", cover: "封面" },
    exporting: "导出中",
    reexport: "重新导出",
    exportNow: "立即导出",
    blocked: "缺少必填项，暂不能导出。",
    statusPrefix: "状态："
  },

  stats: {
    chars: "字符",
    headings: "标题",
    paragraphs: "段落",
    images: "图片",
    links: "链接",
    longBlocks: "长段落",
    longBlocksTitle: "超长段落可能降低可读性"
  },

  materials: {
    empty: "稿件尚未记录素材。"
  },

  files: { title: "稿件文件" },

  ai: {
    addContext: "加入 AI 上下文"
  },

  notes: {
    saved: "创作备注已保存"
  },

  versions: {
    empty: "保存文件后会在这里生成历史版本。"
  },

  releaseDetail: {
    stageEntered: (stage: string) => `项目进入${stage}`,
    createdFromTopic: "从推荐选题创建项目",
    fileSaved: (file: string) => `保存 ${file}`,
    publishStatus: (status: string) => `发布状态更新为 ${status}`,
    versionRestored: "历史版本已恢复为新版本",
    copiedFrom: (p: string) => `复制自 ${p}`,
    archived: "项目已归档",
    restoredFromArchive: "项目从归档恢复"
  },

  inlineAi: {
    rewrite: "改写",
    extend: "续写",
    shorten: "精简",
    tone: "换语气",
    translate: "翻译",
    rewriteInstruction: "换一种表达重写下面这段，保持原意与 Markdown 结构",
    extendInstruction: "顺延下面这段继续写下去，保持语气与 Markdown 结构",
    shortenInstruction: "把下面这段精简为要点，保留关键信息与 Markdown 结构",
    toneInstruction: "把下面这段改得更口语、像在跟朋友解释，遵守 Kill the AI Tone",
    translateInstruction: "把下面这段翻译成中文（若已是中文则译成英文），保留 Markdown 结构",
    generateFailed: "生成失败",
    promptSuffix: "。直接输出结果正文，不要解释、不要包裹代码块。遵守 Kill the AI Tone：直接陈述、用具体场景与例子，避免「不是…而是…」式转折。",
    originalPrefix: "原文：\n\n",
    toolbar: "选中文字 AI 操作",
    selectedChars: (n: number) => `已选中 ${n} 字`,
    generating: "生成中",
    result: "AI 结果",
    cancel: "取消",
    retry: "重试",
    close: "关闭",
    busyEllipsis: "…",
    replaceSelection: "替换选中",
    replaceSelectionTitle: "替换选中文字",
    discard: "放弃",
    replaceFootnote: (start: number, end: number) => `替换后将覆盖第 ${start}–${end} 字的选中内容；草稿自动保存。`,
    noOutput: "（无输出）"
  },

  history: {
    restoreTitle: "恢复历史版本",
    restoreBody: (note: string) => `将 ${note} 恢复为当前内容，原内容会另存为新版本。`,
    restoreConfirm: "恢复",
    restored: "历史版本已恢复为新版本",
    pickProject: "选择一篇稿件",
    pickProjectDesc: "查看其文件的版本历史，并比较或恢复任意两个版本。",
    noFile: "没有可比较的文件",
    pickMarkdown: "选择一个 Markdown 文件查看版本。",
    versionA: "版本 A",
    versionB: "版本 B",
    currentContent: "当前内容",
    diffAria: "统一 Diff",
    pickTwoVersions: "选择两个版本查看差异。",
    diffTruncated: "差异较长，仅显示前 600 行；可在文件目录中查看完整版本。",
    versions: "历史版本",
    restoreAsNew: "恢复为新版本",
    empty: "保存文件或切换阶段后会在这里生成历史版本。"
  },

  release: {
    pickProjectDesc: "查看该稿件导出、发布、审核与阶段切换的完整记录。",
    searchPlaceholder: "按动作、平台、状态或详情搜索",
    target: (t: string) => `目标：${t}`,
    empty: "该稿件还没有发布或阶段记录。"
  },

  analytics: {
    loading: "正在汇总创作数据",
    noData: "暂无可分析数据",
    noDataDesc: "创建稿件后会在这里汇总本地可计算的指标。",
    title: "本地创作分析",
    subtitle: "仅展示本地可计算指标；外部阅读和互动数据未接入，故不展示。",
    totalProjects: "稿件总数",
    published: "已完成发布",
    avgCycle: "平均完成周期",
    avgCycleHint: "从创建到发布的时长",
    avgCompletion: "平均完成度",
    stageDistribution: "阶段分布",
    stageDistributionHint: "各阶段稿件数量",
    platformDistribution: "平台分布",
    platformDistributionHint: "稿件使用的目标平台",
    noPlatform: "尚无平台记录。",
    stageDuration: "阶段停留时间",
    stageDurationHint: "每个阶段的平均小时数"
  },

  stream: {
    recommendScore: (score: number) => ` · 推荐 ${score}`,
    hasDraft: " · 已有草稿",
    emptyAllTitle: "暂无创作内容",
    emptyFilterTitle: "该阶段暂无内容",
    emptyAllDesc: "推荐选题和创作稿件会出现在这里。",
    emptyFilterDesc: "切换其他阶段看看。",
    funnelAria: "创作流水线",
    undated: "未标日期",
    noPlatform: "未设置平台",
    completion: (n: number) => `完成度 ${n}%`,
    topicManagementFile: "选题管理文件"
  },

  writingStats: {
    aria: "写作统计"
  },

  editor: {
    modeBar: "编辑模式",
    edit: "编辑",
    preview: "预览",
    toolbar: "Markdown 格式",
    textareaAria: "Markdown 草稿编辑器",
    placeholder: "输入正文，或键入 / 插入标题、列表、引用、代码块和图片…",
    heading: "标题",
    headingPlaceholder: "小标题",
    bold: "加粗",
    boldPlaceholder: "加粗",
    italic: "斜体",
    italicPlaceholder: "斜体",
    list: "无序列表",
    listPlaceholder: "列表项",
    orderedList: "有序列表",
    quote: "引用",
    quotePlaceholder: "引用",
    code: "代码块",
    codePlaceholder: "代码",
    inlineCode: "行内代码",
    inlineCodePlaceholder: "代码",
    link: "链接",
    linkPlaceholder: "链接文字",
    image: "图片",
    imagePlaceholder: "图片描述",
    localFile: "本地文件",
    localFileNotify: "已插入本地文件链接",
    addedContextNotify: "已加入 AI 上下文",
    previewEmptyTitle: "暂无内容预览",
    previewEmptyDesc: "切回编辑模式写入内容后会在这里预览。",
    selectLeftTitle: "选择左侧内容",
    selectLeftDesc: "选题、草稿、待发布内容和已发布稿件都会在左侧阶段流里。",
    shortcutBold: "加粗 (Ctrl+B)",
    shortcutItalic: "斜体 (Ctrl+I)",
    shortcutLink: "链接 (Ctrl+K)",
    shortcutCode: "行内代码 (Ctrl+E)",
    loadingTopics: "正在读取创作数据",
    fileTruncatedWarn: "该文件超过 512KB，编辑器仅加载了截断内容；自动保存已禁用，请在外部编辑器修改以防数据丢失。",
    openDir: "打开目录",
    reexport: "重新导出",
    openExportedFile: "打开导出文件",
    exportNotRecorded: "未记录",
    publishedSummary: "已发布",
    publishMetricsNote: "平台阅读、点赞与互动数据未接入，因此不展示。",
    exportFileLabel: "导出文件",
    status: { editing: "编辑中…", autoSaving: "自动保存中…", autoSaveFailed: "自动保存失败，可重试保存", autoSaved: "已自动保存", saved: "已保存" },
    savingVersion: "保存中",
    saveVersion: "保存版本",
    copy: "复制",
    archive: "归档",
    enterStage: (stage: string) => `进入${stage}`,
    slash: {
      menu: "Markdown 插入命令",
      heading: "二级标题",
      bullet: "无序列表",
      ordered: "有序列表",
      todo: "任务清单",
      todoPlaceholder: "待办项",
      quote: "引用块",
      code: "代码块",
      image: "图片",
      divider: "分割线",
      keywords: {
        heading: ["h2", "title", "标题"],
        bullet: ["list", "ul", "列表"],
        ordered: ["ol", "number", "有序"],
        todo: ["task", "check", "todo"],
        quote: ["quote", "引用"],
        code: ["code", "代码"],
        image: ["image", "img", "图片"],
        divider: ["hr", "line", "分割"]
      }
    }
  },

  topicFile: {
    switch: { title: "切换选题文件", body: "当前选题文件有未保存的修改，确定放弃并切换吗？", confirm: "放弃并切换" },
    savedNotice: "选题管理文件已保存",
    badge: "选题文件",
    dirty: "编辑中 · 未保存",
    saved: "已保存",
    viewMode: "查看模式",
    preview: "预览",
    edit: "编辑",
    saving: "保存中",
    save: "保存",
    open: "打开文件",
    truncated: "文件过大，仅展示前 1 MB 内容，无法在应用内保存。",
    editAria: "编辑选题管理文件"
  }
} as const;

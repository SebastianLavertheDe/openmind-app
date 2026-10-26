export const skillLibraryMessages = { skillLibrary: {
  title: "技能", explore: "探索", mine: "我的", views: "技能视图", categories: "技能分类",
  scenes: { all: "全部", research: "研究", writing: "写作", image: "图片", slides: "幻灯片", video: "视频", web: "网页", "github-installed": "GitHub 安装", "local-imported": "本地导入" },
  origin: { all: "全部来源", preset: "应用预设", authored: "我创建的", imported: "导入的", git: "GitHub / Git", local: "本地导入" },
  search: "搜索技能", create: "创建技能", import: "导入技能", manage: "管理技能", use: "使用技能", installUse: "安装并使用", enableUse: "启用并使用",
  edit: "编辑", copy: "复制为我的技能", remove: "删除技能", settings: "安装与来源管理", back: "返回技能", save: "保存并应用", cancel: "取消", saving: "正在保存…", loading: "正在加载技能…",
  empty: "没有匹配的技能", emptyHint: "试试其他分类或搜索词，也可以创建自己的技能。", count: (count: number) => `${count} 个技能`,
  installed: "已安装", disabled: "已停用", draft: "草稿", continueEdit: "继续编辑", unavailable: "需配置", ready: "可使用", busy: "正在处理…",
  basicInformation: "基本信息", usageAndPresentation: "使用与展示", autoIcon: "跟随分类", icon: "技能图标", name: "技能名称", subtitle: "副标题", category: "所属分类", instructions: "指令", instructionHint: "说明目标、风格、背景、执行步骤及输出要求…", addBlock: "添加指令", removeBlock: "删除指令", up: "上移", down: "下移", references: "参考资料", attach: "添加资料", referenceSkill: "引用技能", noReferences: "没有其他可引用的技能",
  executionModel: "执行模型", autoModel: "自动（沿用当前模型）", inputHint: "输入提示", inputHintHelp: "引导用户运行此技能时输入什么，不超过 200 字", images: "展示图片", addImage: "添加展示图片", description: "描述", descriptionHint: "介绍技能的用途、适用场景和预期结果…", modelHelp: "固定模型仅用于该技能，不修改默认配置。",
  selected: "当前技能", change: "更换技能", clearSelection: "移除已选技能", unsavedTitle: "离开技能编辑？", unsavedBody: "未应用的内容会保留为草稿，下次可以继续编辑。", leave: "保留草稿并离开", deleteTitle: "删除这个技能？", deleteBody: "将移除技能及编辑源，已生成的产物会保留。", suggestion: "AI 辅助填写", adopt: "采用建议", undoSuggestion: "撤销建议", suggestionTitle: "AI 字段建议", retry: "重试", sort: "排序", defaultSort: "默认", nameSort: "名称", updatedSort: "最近更新", preview: "预览展示图片", removeImage: "移除图片", removeReference: "移除引用",
  errors: { tooLong: (max: number) => `最多 ${max} 字`, invalid: "技能内容不合法。", nameRequired: "请输入技能名称。", instructionRequired: "至少填写一段指令。", duplicateName: "已有同名的个人技能，请更换名称。", conflict: "技能已被修改，请重新打开或另存副本。", missing: "技能不存在或已被移除。", stale: "所选技能已更新、停用或被移除，请重新选择。", dependency: "引用的技能不可用或存在循环引用。", root: "请先选择 OpenMind 数据目录。", asset: "资料不存在、格式不支持或超过大小限制。", imageLimit: "最多添加四张展示图片。", pythonSetup: "请先在运行环境设置中准备可用的 Python 3。", imageSetup: "请先配置图片服务和模型。", videoSetup: "请先安装可用的 ffmpeg 视频运行工具。", bundle: "此技能的安装资源尚未准备好，请重新构建或更新应用。", model: "此技能的固定模型与当前会话不兼容，请新建会话使用。", skillConflict: "消息中的斜杠命令与已选技能不同，请保留其中一个。", source: "原包不可直接编辑，请复制为个人技能。", suggestion: "未获得有效建议，请重试。" },
  presets: {
    "om-research-brief": { title: "资料研究报告", subtitle: "从问题和资料出发，形成可追溯的研究结论", hint: "你想研究什么问题？可附上资料并说明范围。" },
    "om-source-compare": { title: "多资料对比", subtitle: "对齐比较维度，整理差异与依据", hint: "请提供需要比较的资料和关注的维度。" },
    "om-article-writer": { title: "长文写作", subtitle: "根据素材、受众和语气撰写完整文章", hint: "文章主题、目标读者和期望风格是什么？" },
    "om-text-rewriter": { title: "改写与润色", subtitle: "保留事实与原意，调整结构和表达", hint: "贴入原文，并说明你希望如何改写。" },
    "om-poster-maker": { title: "主题海报", subtitle: "把主题、文案和视觉方向变成海报", hint: "海报的主题、文案、比例和风格是什么？" },
    "om-image-editor": { title: "图片风格编辑", subtitle: "结合参考图调整风格、构图与细节", hint: "上传图片，说明需要修改及必须保留的内容。" },
    "om-slide-outline": { title: "演示内容策划", subtitle: "组织演示结构、逐页要点与讲稿", hint: "演示主题、受众、时长和页数是多少？" },
    "om-slide-deck": { title: "演示文稿制作", subtitle: "根据主题与资料制作可打开的演示文稿", hint: "提供主题或大纲，以及页数和视觉要求。" },
    "om-storyboard": { title: "短视频脚本与分镜", subtitle: "梳理节奏、画面、旁白和素材需求", hint: "视频主题、时长、比例和目标受众是什么？" },
    "om-short-video": { title: "短视频制作", subtitle: "从分镜和素材制作可播放的视频", hint: "描述视频内容、时长，并提供可使用的素材。" },
    "om-landing-page": { title: "落地页制作", subtitle: "围绕产品内容制作可预览的页面", hint: "介绍产品、页面内容和喜欢的视觉风格。" },
    "om-mini-tool": { title: "交互小工具", subtitle: "把具体需求做成可运行的网页工具", hint: "你希望做什么工具？需要哪些输入和交互？" }
  }
} };

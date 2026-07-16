/** 浏览器预览 mock 数据中的 UI 文案（非 fixture 正文）。 */
export const browserPreviewMessages = {
  runtime: "浏览器预览 · Preview 数据",
  repoLabel: "项目目录",
  aiNotSupported: "浏览器预览不执行真实 AI 任务。",
  noSession: "预览模式没有会话。",
  defaultPlatform: "公众号",
  frequencyPipeline: "每日流水线",
  sourceName: "预览数据源",
  logCaptured: "抓取完成，新增 3 篇文章。",
  exportDetail: "导出 Markdown",
  versionNote: "自动保存版本",
  demoPrompt: "整理今日内容",
  demoPromptAlt: "整理今天的内容并保存为文稿",
  skills: {
    rss: { title: "RSS 文章抓取", description: "拉取订阅、提取正文并保存到文章库。", group: "采集" },
    summarizer: { title: "每日文章总结", description: "总结当天文章并同步每日摘要。", group: "分析" },
    x: { title: "X 动态抓取", description: "拉取关注列表动态并保存为结构化内容。", group: "采集" }
  }
} as const;

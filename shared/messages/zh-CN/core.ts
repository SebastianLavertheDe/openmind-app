import type { ContentKind } from "../../contracts";

/** 导航、通用文案与内容类型。 */
export const coreMessages = {
  nav: {
    sources: "RSS 源",
    skills: "Skills",
    brief: "每日简报",
    automation: "自动化",
    runs: "运行中心",
    ai: "新建任务",
    settings: "设置"
  },

  /** 侧边栏分组标题（create 组靠位置自表达，标题留空）。 */
  navGroup: {
    create: "",
    core: "",
    workspace: "最近任务",
    system: ""
  },

  repoRequired: {
    action: "打开设置"
  },

  contentKind: {
    article: "文章",
    post: "动态",
    summary: "摘要",
    topic: "选题",
    reddit: "Reddit",
    html: "HTML",
    unknown: "文件",
    all: "全部"
  } satisfies Record<ContentKind | "all", string>,

  common: {
    noDescription: "暂无说明",
    unspecified: "未指定",
    unnamedTopic: "(未命名选题)",
    justSaved: "刚刚保存",
    justNow: "刚刚",
    close: "关闭",
    copy: "复制",
    retry: "重试",
    open: "打开",
    minutesAgo: (n: number) => `${n} 分钟前`,
    hoursAgo: (n: number) => `${n} 小时前`,
    daysAgo: (n: number) => `${n} 天前`,
    chars: (n: number) => `${n} 字符`,
    hours: (n: number) => `${n} 小时`
  }
} as const;

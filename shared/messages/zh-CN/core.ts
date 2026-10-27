import type { ContentKind } from "../../contracts";

/** 导航、通用文案、content kind、creative 注册表展示文案。 */
export const coreMessages = {
  nav: {
    sources: "RSS 源",
    skills: "Skills",
    brief: "每日简报",
    creative: "创作",
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

  creative: {
    stage: {
      today: "今日推荐",
      drafting: "创作中",
      review: "待审核",
      ready: "待发布",
      published: "已发布",
      archived: "已归档"
    },
    bucket: {
      topic: "选题",
      drafting: "创作中",
      pending: "待发布",
      published: "已发布"
    },
    platform: {
      wechat: "公众号",
      xiaohongshu: "小红书",
      twitter: "Twitter/X 长文"
    },
    releaseAction: {
      project_created: "创建稿件",
      stage_changed: "阶段切换",
      file_saved: "保存文件",
      review_generated: "生成审核",
      review_status_changed: "审核状态变更",
      content_exported: "导出稿件",
      publish_scheduled: "计划发布",
      schedule_cancelled: "取消计划",
      publish_draft: "发布草稿",
      publish_updated: "更新发布",
      version_restored: "恢复版本",
      project_copied: "复制稿件",
      project_archived: "归档稿件"
    },
    reviewDimension: {
      seo: "本地启发式"
    },
    defaults: {
      topicCreation: "内容创作",
      unnamedTopic: "未命名选题",
      owner: "本地用户",
      topicBriefPlaceholder: "## 选题说明\n\n待补充。",
      copySuffix: "（副本）"
    },
    version: {
      beforeSave: "保存前版本",
      manual: "手动版本",
      history: "历史版本",
      beforeRestore: "恢复前版本",
      restoredFrom: (name: string) => `从 ${name} 恢复`,
      stageChange: (from: string, to: string) => `阶段切换：${from} → ${to}`
    }
  },

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

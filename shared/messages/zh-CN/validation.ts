/** 跨进程输入校验与应用生成的默认展示文案。 */
export const validationMessages = {
  validation: {
    project: {
      nameRequired: "项目名不能为空。",
      nameLength: (characters: number, bytes: number) => `项目名最多 ${characters} 个字符且不能超过 ${bytes} 字节。`,
      nameCharacters: "项目名包含跨平台文件系统不支持的字符。",
      namePath: "项目名不能包含 ..、前导点、尾部点或首尾空白。",
      nameReserved: "项目名不能使用 Windows 保留设备名。",
      updateRequired: "至少需要更新一项项目设置。",
      httpUrl: "只支持 HTTP(S) URL。",
      duplicateSession: "历史 Session 不能重复。",
      providerRequired: "新 Project Task 必须指定 Provider。",
      outputTaskRequired: "Output Session/Message 来源必须绑定 Project Task。",
      outputSessionRequired: "Output Message 来源必须绑定 Session。"
    },
    automation: {
      relativePath: "File-change 路径必须是 openmindRoot 下的相对路径。 ",
      duplicateWeekday: "Weekly 触发器不能重复星期。",
      completionTarget: "Run 完成触发器只能选择 Skill 或 Workflow 之一。",
      secretInput: "Automation 输入不能直接保存 Secret。",
      defaults: {
        rss: { name: "RSS 抓取与每日总结", description: "每小时运行 rss-to-summary-workflow（抓取订阅源 → 生成每日总结），对应 crontab 里的 rss-to-summary-workflow。" },
        x: { name: "X/Twitter 关注动态抓取", description: "每 15 分钟拉取关注账号的最新帖子，对应 crontab 里的 x-following-fetcher。" },
        reddit: { name: "Reddit 热门抓取", description: "每小时第 5 分钟拉取 Reddit 热门帖子，对应 crontab 里的 reddit-fetcher。" },
        topics: { name: "每日选题生成", description: "每天 23:55 在晚间摘要完成后生成次日候选选题，对应 crontab 里的 daily-topic-selector。" }
      }
    },
    skillSource: {
      controlCharacters: "Git 地址不能包含控制字符。",
      invalidUrl: "Git 地址必须是有效的 HTTPS URL。",
      httpsOnly: "Git 来源只允许 HTTPS，不支持 SSH、file 或 HTTP 地址。",
      privateUrl: "Git 地址不能包含凭据、查询参数或片段。"
    },
    artifact: {
      untitled: "未命名产物",
      untitledNumbered: (index: number) => `未命名产物 ${index}`
    }
  }
} as const;

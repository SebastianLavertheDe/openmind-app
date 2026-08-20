/** Slash 命令 picker UI 文案（buildInstruction 为 AI prompt，仍留在 slash-commands.ts）。 */
export const slashMessages = {
  search: {
    title: "搜索项目",
    description: "在当前项目和资料库中搜索相关内容并给出出处",
    usage: "/search <查询内容>"
  },
  read: {
    title: "读取分析",
    description: "读取指定路径或已附加文件并回答问题",
    usage: "/read <文件或分析要求>"
  },
  write: {
    title: "写入或修改",
    description: "按要求创建、重写或修改项目文件",
    usage: "/write <具体修改要求>"
  },
  summarize: {
    title: "生成摘要",
    description: "总结指定主题、文件或已附加上下文",
    usage: "/summarize [范围或格式要求]"
  },
  translate: {
    title: "翻译内容",
    description: "翻译指定内容或已附加文件，并保持原结构",
    usage: "/translate <目标语言及要求>"
  },
  outline: {
    title: "生成大纲",
    description: "根据主题或上下文生成可直接写作的大纲",
    usage: "/outline <主题或内容要求>"
  },
  review: {
    title: "审阅内容",
    description: "检查内容或代码质量，按严重程度给出问题",
    usage: "/review [审阅范围或标准]"
  },
  explain: {
    title: "解释实现",
    description: "解释文件、代码、架构或错误原因",
    usage: "/explain <对象或问题>"
  },
  test: {
    title: "运行测试",
    description: "定位并运行与当前任务相关的测试，分析失败",
    usage: "/test [测试范围]"
  },
  skill: {
    title: "调用 Skill",
    description: "按名称运行项目中已注册的 OpenMind skill",
    usage: "/skill <skill-id> [参数或目标]"
  },
  errors: {
    unknownCommand: (name: string) => `未知命令 /${name}。输入 / 查看可用命令。`,
    missingArgument: (usage: string) => `${usage}：缺少必要参数。`
  },
  expand: {
    contextAttached: (count: number, paths: string) => `\n已附加 ${count} 项上下文：${paths}。`,
    userRawCommand: (raw: string) => `用户原始命令：${raw}`
  }
} as const;

export type SlashCommandName = keyof Omit<typeof slashMessages, "errors" | "expand">;

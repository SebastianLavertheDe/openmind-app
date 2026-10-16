import type { ContextReference, PermissionProfile } from "./contracts";
import { messages } from "./messages";
import type { SlashCommandName } from "./messages/zh-CN/slash";

export type SlashCommandDefinition = {
  name: SlashCommandName;
  title: string;
  description: string;
  usage: string;
  category: "research" | "writing" | "engineering" | "automation";
  permissionProfile: PermissionProfile;
  requiresArgument: boolean;
  acceptsContextFallback: boolean;
  keywords: string[];
  buildInstruction(argument: string): string;
};

function slashUi(name: SlashCommandName) {
  return messages.slash[name];
}

export const SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  {
    name: "search",
    get title() { return slashUi("search").title; },
    get description() { return slashUi("search").description; },
    get usage() { return slashUi("search").usage; },
    category: "research",
    permissionProfile: "read-only",
    requiresArgument: true,
    acceptsContextFallback: false,
    keywords: ["搜索", "查找", "find", "grep", "资料"],
    buildInstruction: (argument) => `在当前项目中搜索“${argument}”。优先使用项目内搜索工具，汇总最相关结果，并为每项标注文件路径。不要修改文件。`
  },
  {
    name: "read",
    get title() { return slashUi("read").title; },
    get description() { return slashUi("read").description; },
    get usage() { return slashUi("read").usage; },
    category: "research",
    permissionProfile: "read-only",
    requiresArgument: true,
    acceptsContextFallback: true,
    keywords: ["读取", "分析", "文件", "read"],
    buildInstruction: (argument) => `读取指定文件或已附加的上下文并进行分析。用户要求：${argument || "说明核心内容、结构、关键结论和需要注意的问题"}。不要修改文件。`
  },
  {
    name: "write",
    get title() { return slashUi("write").title; },
    get description() { return slashUi("write").description; },
    get usage() { return slashUi("write").usage; },
    category: "writing",
    permissionProfile: "edit",
    requiresArgument: true,
    acceptsContextFallback: false,
    keywords: ["写入", "修改", "编辑", "create", "edit"],
    buildInstruction: (argument) => `直接在当前项目中完成以下写入或修改任务：${argument}。先检查相关文件和项目约定，实施完整改动，并运行与改动风险匹配的验证。`
  },
  {
    name: "summarize",
    get title() { return slashUi("summarize").title; },
    get description() { return slashUi("summarize").description; },
    get usage() { return slashUi("summarize").usage; },
    category: "research",
    permissionProfile: "read-only",
    requiresArgument: false,
    acceptsContextFallback: true,
    keywords: ["总结", "摘要", "要点", "summary"],
    buildInstruction: (argument) => `总结指定内容或已附加的上下文。${argument ? `用户要求：${argument}。` : ""}输出清晰的核心结论、关键事实和出处；不要修改文件。`
  },
  {
    name: "translate",
    get title() { return slashUi("translate").title; },
    get description() { return slashUi("translate").description; },
    get usage() { return slashUi("translate").usage; },
    category: "writing",
    permissionProfile: "read-only",
    requiresArgument: true,
    acceptsContextFallback: false,
    keywords: ["翻译", "translate", "中文", "英文"],
    buildInstruction: (argument) => `翻译用户指定的内容或已附加上下文。目标语言及附加要求：${argument}。保持原文结构、术语和链接；遇到歧义时标注说明。不要修改源文件，除非用户明确要求写回。`
  },
  {
    name: "outline",
    get title() { return slashUi("outline").title; },
    get description() { return slashUi("outline").description; },
    get usage() { return slashUi("outline").usage; },
    category: "writing",
    permissionProfile: "read-only",
    requiresArgument: true,
    acceptsContextFallback: true,
    keywords: ["大纲", "结构", "outline", "写作"],
    buildInstruction: (argument) => `根据指定主题或已附加上下文生成完整大纲。${argument ? `主题与要求：${argument}。` : ""}大纲应包含标题层级、每节要点、案例或证据位置，以及推荐的开头和结尾。不要修改文件。`
  },
  {
    name: "review",
    get title() { return slashUi("review").title; },
    get description() { return slashUi("review").description; },
    get usage() { return slashUi("review").usage; },
    category: "engineering",
    permissionProfile: "read-only",
    requiresArgument: false,
    acceptsContextFallback: true,
    keywords: ["审阅", "检查", "review", "质量", "代码"],
    buildInstruction: (argument) => `审阅指定内容、当前改动或已附加上下文。${argument ? `审阅范围与标准：${argument}。` : ""}优先报告可验证的问题，按严重程度排序，并标注文件路径和位置；不要直接修改。`
  },
  {
    name: "explain",
    get title() { return slashUi("explain").title; },
    get description() { return slashUi("explain").description; },
    get usage() { return slashUi("explain").usage; },
    category: "research",
    permissionProfile: "read-only",
    requiresArgument: true,
    acceptsContextFallback: true,
    keywords: ["解释", "原理", "架构", "错误", "explain"],
    buildInstruction: (argument) => `解释指定对象或已附加上下文。${argument ? `用户问题：${argument}。` : ""}说明它如何工作、关键调用链、设计取舍和常见风险，并引用具体文件位置。不要修改文件。`
  },
  {
    name: "test",
    get title() { return slashUi("test").title; },
    get description() { return slashUi("test").description; },
    get usage() { return slashUi("test").usage; },
    category: "engineering",
    permissionProfile: "edit",
    requiresArgument: false,
    acceptsContextFallback: false,
    keywords: ["测试", "验证", "test", "check"],
    buildInstruction: (argument) => `检查项目测试约定并运行${argument ? `以下范围的测试：${argument}` : "与当前改动最相关的测试"}。报告实际命令、结果和失败原因；只在修复测试本身属于用户要求时修改文件。`
  },
  {
    name: "skill",
    get title() { return slashUi("skill").title; },
    get description() { return slashUi("skill").description; },
    get usage() { return slashUi("skill").usage; },
    category: "automation",
    permissionProfile: "edit",
    requiresArgument: true,
    acceptsContextFallback: false,
    keywords: ["技能", "自动化", "workflow", "skill"],
    buildInstruction: (argument) => `调用项目中已注册的 openmind skill：${argument}。先从可用 skill 目录确认准确名称、命令、工作目录和产物，再执行；完成后读取产物并汇报结果。`
  }
] as const;

export type SlashInvocation = {
  command: SlashCommandDefinition;
  argument: string;
  raw: string;
};

export function parseSlashInvocation(prompt: string): SlashInvocation | null {
  const raw = prompt.trim();
  const match = raw.match(/^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const command = SLASH_COMMANDS.find((candidate) => candidate.name === match[1].toLocaleLowerCase());
  if (!command) return null;
  return { command, argument: (match[2] || "").trim(), raw };
}

export function slashCommandValidationError(prompt: string, contexts: ContextReference[] = []): string | null {
  const invocation = parseSlashInvocation(prompt);
  if (!invocation) {
    const candidate = prompt.trim().match(/^\/([a-z][a-z0-9-]*)(?:\s|$)/i);
    if (candidate) return messages.slash.errors.unknownCommand(candidate[1]);
    return null;
  }
  if (
    invocation.command.requiresArgument
    && !invocation.argument
    && !(invocation.command.acceptsContextFallback && contexts.length)
  ) {
    return messages.slash.errors.missingArgument(invocation.command.usage);
  }
  return null;
}

export function expandSlashCommand(prompt: string, contexts: ContextReference[] = []): string {
  const invocation = parseSlashInvocation(prompt);
  if (!invocation) return prompt;
  const validationError = slashCommandValidationError(prompt, contexts);
  if (validationError) throw new Error(validationError);
  const contextHint = contexts.length
    ? messages.slash.expand.contextAttached(contexts.length, contexts.map((context) => context.path || context.label).join("、"))
    : "";
  return [
    `<cc_tools_slash_command name="${invocation.command.name}">`,
    invocation.command.buildInstruction(invocation.argument),
    contextHint,
    messages.slash.expand.userRawCommand(invocation.raw),
    "</cc_tools_slash_command>"
  ].filter(Boolean).join("\n");
}

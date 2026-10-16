import type { TranslationOf } from "../types";
import type { slashMessages as zhCN } from "../zh-CN/slash";

export const slashMessages = {
  search: { title: "Search project", description: "Search the current project and library for relevant content with sources", usage: "/search <query>" },
  read: { title: "Read and analyze", description: "Read a path or attached files and answer questions", usage: "/read <file or analysis request>" },
  write: { title: "Write or edit", description: "Create, rewrite, or edit project files as requested", usage: "/write <specific changes>" },
  summarize: { title: "Summarize", description: "Summarize a topic, file, or attached context", usage: "/summarize [scope or format]" },
  translate: { title: "Translate", description: "Translate content or attached files while preserving their structure", usage: "/translate <target language and requirements>" },
  outline: { title: "Create outline", description: "Create an outline ready for writing from a topic or context", usage: "/outline <topic or content requirements>" },
  review: { title: "Review content", description: "Review content or code quality and list issues by severity", usage: "/review [scope or criteria]" },
  explain: { title: "Explain implementation", description: "Explain a file, code, architecture, or the cause of an error", usage: "/explain <subject or question>" },
  test: { title: "Run tests", description: "Find and run tests relevant to the current task and analyze failures", usage: "/test [scope]" },
  skill: { title: "Run Skill", description: "Run a registered OpenMind Skill in the project by name", usage: "/skill <skill-id> [arguments or goal]" },
  errors: { unknownCommand: (name: string) => `Unknown command /${name}. Type / to see available commands.`, missingArgument: (usage: string) => `${usage}: required argument missing.` },
  expand: { contextAttached: (count: number, paths: string) => `\n${count} context item${count === 1 ? "" : "s"} attached: ${paths}.`, userRawCommand: (raw: string) => `User's original command: ${raw}` }
} satisfies TranslationOf<typeof zhCN>;

export type SlashCommandName = keyof Omit<typeof slashMessages, "errors" | "expand">;

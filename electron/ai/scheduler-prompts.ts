import type { AiRun } from "../../shared/contracts";
import { expandSlashCommand } from "../../shared/slash-commands";
import type { NativeSkillInvocation } from "../../shared/skill-invocations";

export function composePrompt(run: AiRun): string {
  const blocks = [expandSlashCommand(run.prompt, run.contexts)];
  const contextBlock = composeContextBlock(run);
  if (contextBlock) blocks.push(contextBlock);
  return blocks.join("\n");
}

export function composeNativeSkillProviderPrompt(run: AiRun, invocation: NativeSkillInvocation): string {
  return `${invocation.raw}${composeContextBlock(run)}`;
}

export function composeNativeSkillTaskPrompt(run: AiRun, invocation: NativeSkillInvocation): string {
  return `${invocation.argument}${composeContextBlock(run)}`.trim();
}

export function titleFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 48) || "新会话";
}

function composeContextBlock(run: AiRun): string {
  if (!run.contexts.length) return "";
  const blocks = ["\n<context_from_cc_tools>"];
  for (const context of run.contexts) {
    if (context.kind === "image") continue; // image 由 provider 作 image block 传，不嵌文本
    blocks.push(`\n## ${context.label}\n路径: ${context.path || "无"}\n${context.content || ""}`);
  }
  blocks.push("\n</context_from_cc_tools>");
  return blocks.join("\n");
}

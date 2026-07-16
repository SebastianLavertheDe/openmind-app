import type { SkillTool } from "./skill-tool-registry";

/**
 * Renders the skill catalog injected into the system prompt for both providers.
 *
 * Skills are not wrapped as tools — they are command-line workflows the agent
 * runs via native Bash (gated by each provider's approval layer), then reads
 * the produced artifacts. Mirrors Open Design's "skill = context, not tool"
 * approach: only capabilities with no native equivalent get exposed as tools,
 * and a command-line script is not one of them.
 */
export function composeSkillCatalog(skills: SkillTool[]): string {
  if (!skills.length) return "";
  const lines = [
    "## 可用的 cctools skills（通过 Bash 运行）",
    "需要时用 Bash 执行下列命令调用对应 skill（把 ${date} 换成当天 YYYYMMDD，如 20260621）；跑完用 Read 读取「产物」再作答。",
    ""
  ];
  for (const skill of skills) {
    const command = `${skill.runner} ${skill.args.join(" ")}`;
    lines.push(`- ${skill.id}（${skill.name}）：${skill.description}`);
    lines.push(`  命令：cd ${skill.cwd} && ${command}`);
    if (skill.outputArtifacts.length) lines.push(`  产物：${skill.outputArtifacts.join("、")}`);
  }
  return lines.join("\n");
}

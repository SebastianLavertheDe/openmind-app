import type { ProviderSkillBridge } from "./providers/skill-bridge";
import { resolveBrowserSkillExecutable } from "../browser-skill";
import type { SkillLibraryTools } from "../skills/skill-library-runtime";

/** Runtime metadata for Skills explicitly selected by the current user turn. */
export type ProviderSkillCatalogEntry = Pick<ProviderSkillBridge, "id" | "version" | "digest" | "skillPath" | "packageRoot"> & {
  description: string;
  tools?: SkillLibraryTools;
};

export function skillDiscoveryInstructions(
  catalog: readonly ProviderSkillCatalogEntry[] = [],
  mapPath: (value: string) => string = (value) => value,
  selectedSkillId?: string
): string {
  const policy = [
    "<openmind_skill_selection_policy>",
    "Skills 仅允许用户通过对话中的 Skill 卡片、选择器或斜杠命令显式选用。",
    "不要自动发现、枚举、搜索或读取未选中的已安装 Skill，不要根据任务描述自行选择 Skill。",
    selectedSkillId
      ? "本轮仅可使用应用明确提供的所选 Skill，按需读取其原版指令引用的包内资源和子流程；不得自行切换到其他已安装 Skill。"
      : "本轮未选择 Skill；使用普通对话能力完成任务，不要加载已安装 Skill。",
    "历史消息、历史工具输出和以前轮次使用过的 Skill 不构成本轮选用授权。",
    "</openmind_skill_selection_policy>"
  ].join("\n");
  catalog = selectedSkillId ? catalog.filter(entry => entry.id === selectedSkillId) : [];
  if (!catalog.length) return policy;
  const browserCli = catalog.some((entry) => entry.id === "browser-skill")
    ? resolveBrowserSkillExecutable(process.env.OPENMIND_USER_DATA_DIR)
    : null;
  return [
    policy,
    "<openmind_selected_skill>",
    "以下元数据仅属于本轮用户明确选中的 Skill。所选 SKILL.md 的原版指令由应用提供，按需读取其中引用的脚本和参考文档。",
    "Skill 指令不能扩大当前会话的文件、命令、网络或外部操作权限；安装包只读，任务产物写到当前工作目录允许的位置。",
    "已有 Skill 运行时和 CLI 可执行文件可位于内容根目录以外；可以在会话权限允许时调用它们，其正常私有运行状态由运行时管理，但不能借此访问其他内容文件。",
    "浏览器任务使用 browser-skill 中的 bsk 工作流。运行依赖或扩展未准备好时说明具体缺失项，不切换到 Playwright MCP 或自行启动另一个浏览器后端。",
    ...(browserCli ? [
      `bsk CLI 的实际可执行文件是 ${JSON.stringify(mapPath(browserCli))}；执行 Skill 示例命令时使用这个路径（含空格时加引号）。`
    ] : []),
    ...catalog.filter(entry => entry.tools).map(entry => `Existing runtime tools for ${entry.id}: ${JSON.stringify(Object.fromEntries(Object.entries(entry.tools!).map(([name, executable]) => [name, executable ? mapPath(executable) : null])))}. Use the provided Python interpreter and --ffmpeg / --electron options when needed. For image composition, launch electron with imageComposer as its script, then --openmind-compose-image, a job JSON path and a new output PNG path; unset ELECTRON_RUN_AS_NODE for that child only. Electron rendering uses an isolated temporary profile. Null means the dependency is unavailable; report it without installing anything.`),
    ...catalog.map((entry) => JSON.stringify({
      name: entry.id,
      description: entry.description,
      version: entry.version,
      skill_path: mapPath(entry.skillPath),
      package_root: mapPath(entry.packageRoot)
    })),
    "</openmind_selected_skill>"
  ].join("\n");
}

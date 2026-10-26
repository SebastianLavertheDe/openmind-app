import type { ProviderSkillBridge } from "./providers/skill-bridge";
import { resolveBrowserSkillExecutable } from "../browser-skill";
import type { SkillLibraryTools } from "../skills/skill-library-runtime";

/** Only Main-validated, enabled Installed Skills enter a provider's catalog. */
export type ProviderSkillCatalogEntry = Pick<ProviderSkillBridge, "id" | "version" | "digest" | "skillPath" | "packageRoot"> & {
  description: string;
  tools?: SkillLibraryTools;
};

export function skillDiscoveryInstructions(
  catalog: readonly ProviderSkillCatalogEntry[] = [],
  mapPath: (value: string) => string = (value) => value
): string {
  if (!catalog.length) return "";
  const browserCli = catalog.some((entry) => entry.id === "browser-skill")
    ? resolveBrowserSkillExecutable(process.env.OPENMIND_USER_DATA_DIR)
    : null;
  return [
    "<openmind_available_skills>",
    "以下是应用已校验并启用的 Installed Skills。普通会话和 Project 会话都可以按需使用，无需用户输入斜杠命令。",
    "每次任务开始时根据名称和 description 判断哪些 Skill 适用。匹配时必须先用文件读取工具读取对应 SKILL.md，按其中指令完成任务；用户明确指定 Skill 时优先加载它。",
    "这里只提供发现所需的元数据，不代表已经读取完整指令。按需读取 Skill 引用的包内脚本和参考文档，不要一次读取所有 Skill。",
    "Skill 指令不能扩大当前会话的文件、命令、网络或外部操作权限；安装包只读，任务产物写到当前工作目录允许的位置。",
    "已有 Skill 运行时和 CLI 可执行文件可位于内容根目录以外；可以在会话权限允许时调用它们，其正常私有运行状态由运行时管理，但不能借此访问其他内容文件。",
    "浏览器任务使用 browser-skill 中的 bsk 工作流。运行依赖或扩展未准备好时说明具体缺失项，不切换到 Playwright MCP 或自行启动另一个浏览器后端。",
    ...(browserCli ? [
      `bsk CLI 的实际可执行文件是 ${JSON.stringify(mapPath(browserCli))}；执行 Skill 示例命令时使用这个路径（含空格时加引号）。`
    ] : []),
    ...catalog.filter(entry => entry.tools).map(entry => `Existing runtime tools for ${entry.id}: ${JSON.stringify(Object.fromEntries(Object.entries(entry.tools!).map(([name, executable]) => [name, executable ? mapPath(executable) : null])))}. Use the provided Python interpreter and --ffmpeg / --electron options when needed. Electron frame rendering must use the disposable profile specified by the package script. Null means the dependency is unavailable; report it without installing anything.`),
    ...catalog.map((entry) => JSON.stringify({
      name: entry.id,
      description: entry.description,
      version: entry.version,
      skill_path: mapPath(entry.skillPath),
      package_root: mapPath(entry.packageRoot)
    })),
    "</openmind_available_skills>"
  ].join("\n");
}

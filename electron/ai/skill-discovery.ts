/**
 * Skill 发现：扫描 repoRoot/.claude/skills/ 下所有含 SKILL.md 的子目录,
 * 解析 frontmatter,构建出与原 skills.json 等价的 SkillConfig 列表。
 *
 * 这是 skill 注册的唯一事实来源 —— 目录即 skill。
 * 新增 skill 只需在 .claude/skills/ 下建目录 + 填 SKILL.md frontmatter。
 */
import fs from "node:fs";
import path from "node:path";
import { parseSkillFrontmatter, type SkillPermission, type SkillSourceSurface } from "../../shared/skill-frontmatter";

/** Skill 运行配置 —— 从 SKILL.md frontmatter 派生，字段含义与原 skills.json 一致。 */
export interface SkillConfig {
  id: string;
  name: string;
  description: string;
  group?: string;
  cwd: string;
  runner: string;
  args: string[];
  envFile?: string | null;
  permission?: SkillPermission;
  outputArtifacts?: string[];
  timeoutMs?: number;
  surfacesAsSource?: SkillSourceSurface;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const SKILLS_RELATIVE_DIR = path.join(".claude", "skills");

/**
 * 扫描 repoRoot/.claude/skills/ 下所有含 SKILL.md 的子目录，
 * 解析 frontmatter 并补默认值后返回 SkillConfig[]。
 *
 * 跳过以下情况：
 * - 目录名以 _ 开头(如 _shared,是共享库而非 skill)
 * - 目录下没有 SKILL.md
 *
 * 缺少 runner/args 的 skill(纯 prompt 型)仍会被列出,
 * 但运行时会因 args 缺失报清晰错误。
 */
export function discoverSkills(repoRoot: string): SkillConfig[] {
  const skillsDir = path.join(repoRoot, SKILLS_RELATIVE_DIR);
  if (!fs.existsSync(skillsDir)) return [];
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const configs: SkillConfig[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_")) continue;
    const mdPath = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(mdPath)) continue;
    const raw = fs.readFileSync(mdPath, "utf8");
    const fm = parseSkillFrontmatter(raw);
    configs.push(toSkillConfig(entry.name, fm));
  }
  return configs;
}

function toSkillConfig(dirName: string, fm: ReturnType<typeof parseSkillFrontmatter>): SkillConfig {
  const id = fm.id ?? fm.name ?? dirName;
  const name = fm.title ?? fm.name ?? dirName;
  const description = fm.description ?? "";
  const cwd = fm.cwd ?? path.join(SKILLS_RELATIVE_DIR, dirName);
  const runner = fm.runner ?? "uv";
  const args = fm.args ?? [];
  const permission = fm.permission ?? "edit";
  const timeoutMs = fm.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const outputArtifacts = fm.outputArtifacts ?? [];
  const envFile = fm.envFile ?? null;
  const config: SkillConfig = {
    id, name, description, cwd, runner, args, permission, timeoutMs, outputArtifacts, envFile
  };
  if (fm.group !== undefined) config.group = fm.group;
  if (fm.surfacesAsSource) config.surfacesAsSource = fm.surfacesAsSource;
  return config;
}

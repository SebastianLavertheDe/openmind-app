/**
 * SKILL.md frontmatter 解析器 —— 轻量、零依赖。
 *
 * 解析规则只覆盖 cctools skill 约定使用的字段子集：
 * - 标量：name / description / title / id / cwd / runner / envFile / group / permission / allowed-tools
 * - 数字：timeoutMs
 * - 列表：args / outputArtifacts
 * - 嵌套对象：surfacesAsSource（固定 4 个字符串字段）
 *
 * 非约定字段被忽略；description 等字段允许行内包含冒号、反引号等字符。
 */

export type SkillPermission = "read-only" | "edit" | "auto";

export type SkillSourceSurface = {
  sourceId: string;
  sourceName: string;
  kind: string;
  artifactRoot: string;
};

export type ParsedSkillFrontmatter = {
  name?: string;
  description?: string;
  title?: string;
  id?: string;
  allowedTools?: string;
  group?: string;
  cwd?: string;
  runner?: string;
  args?: string[];
  envFile?: string | null;
  permission?: SkillPermission;
  outputArtifacts?: string[];
  timeoutMs?: number;
  surfacesAsSource?: SkillSourceSurface;
};

const SURFACE_KEYS = ["sourceId", "sourceName", "kind", "artifactRoot"] as const;

/**
 * 从 SKILL.md 文本里提取首尾 --- 之间的 YAML frontmatter 并解析为 ParsedSkillFrontmatter。
 * 没有 frontmatter 或 frontmatter 为空时返回空对象。
 */
export function parseSkillFrontmatter(source: string): ParsedSkillFrontmatter {
  const yaml = extractFrontmatter(source);
  if (!yaml) return {};
  return parseFrontmatterLines(yaml);
}

function extractFrontmatter(source: string): string | null {
  const trimmed = source.replace(/^\uFEFF/, "");
  // frontmatter 必须在文件开头
  if (!trimmed.startsWith("---")) return null;
  const lines = trimmed.split(/\r?\n/);
  // lines[0] === "---"
  const end = findFenceEnd(lines);
  if (end === -1) return null;
  return lines.slice(1, end).join("\n");
}

function findFenceEnd(lines: string[]): number {
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return i;
  }
  return -1;
}

function parseFrontmatterLines(yaml: string): ParsedSkillFrontmatter {
  const result: ParsedSkillFrontmatter = {};
  const lines = yaml.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) { i++; continue; }
    const key = match[1];
    const inlineValue = match[2];
    const value = parseScalarString(inlineValue);

    if (key === "name") { result.name = value; i++; }
    else if (key === "description") { result.description = value; i++; }
    else if (key === "title") { result.title = value; i++; }
    else if (key === "id") { result.id = value; i++; }
    else if (key === "allowed-tools") { result.allowedTools = value; i++; }
    else if (key === "group") { result.group = value; i++; }
    else if (key === "cwd") { result.cwd = value; i++; }
    else if (key === "runner") { result.runner = value; i++; }
    else if (key === "envFile") { result.envFile = value; i++; }
    else if (key === "permission") { result.permission = value as SkillPermission; i++; }
    else if (key === "timeoutMs") {
      const n = Number(inlineValue);
      if (Number.isFinite(n)) result.timeoutMs = n;
      i++;
    } else if (key === "args" || key === "outputArtifacts") {
      const { values, next } = collectList(lines, i, inlineValue);
      result[key] = values;
      i = next;
    } else if (key === "surfacesAsSource") {
      const { surface, next } = collectSurface(lines, i, inlineValue);
      if (surface) result.surfacesAsSource = surface;
      i = next;
    } else {
      // 未识别字段：若同行无值则跳过其下缩进块，否则跳过单行
      i = inlineValue.trim() === "" ? skipIndentedBlock(lines, i + 1) : i + 1;
    }
  }
  return result;
}

function parseScalarString(raw: string): string {
  const v = raw.trim();
  if (v === "") return "";
  // 双引号包裹
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) return v.slice(1, -1);
  // 单引号包裹
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1);
  return v;
}

/** 收集 YAML 块列表(支持 inline `[a, b]` 和多行 `- item`)。返回 { values, nextIndex }。 */
function collectList(
  lines: string[],
  index: number,
  inlineValue: string
): { values: string[]; next: number } {
  const inline = inlineValue.trim();
  if (inline.startsWith("[") && inline.endsWith("]")) {
    const inner = inline.slice(1, -1).trim();
    if (inner === "") return { values: [], next: index + 1 };
    return {
      values: inner.split(",").map((s) => parseScalarString(s)).filter((s) => s !== ""),
      next: index + 1
    };
  }
  if (inline !== "") {
    // 行内单值(非列表语法)——视为单元素
    return { values: [parseScalarString(inline)], next: index + 1 };
  }
  // 多行列表项
  const values: string[] = [];
  let j = index + 1;
  while (j < lines.length) {
    const item = lines[j];
    const indented = /^(\s+)-\s+(.*)$/.exec(item);
    if (!indented) break;
    values.push(parseScalarString(indented[2]));
    j++;
  }
  return { values, next: j };
}

function collectSurface(
  lines: string[],
  index: number,
  inlineValue: string
): { surface: SkillSourceSurface | null; next: number } {
  const surface: Partial<SkillSourceSurface> = {};
  // 行内对象 { ... }
  if (inlineValue.trim().startsWith("{") && inlineValue.trim().endsWith("}")) {
    const inner = inlineValue.trim().slice(1, -1);
    for (const part of inner.split(",")) {
      const [k, v] = part.split(":").map((s) => s.trim());
      if (k && v && (SURFACE_KEYS as readonly string[]).includes(k)) {
        surface[k as keyof SkillSourceSurface] = parseScalarString(v);
      }
    }
    return { surface: completeSurface(surface), next: index + 1 };
  }
  // 多行块
  let j = index + 1;
  while (j < lines.length) {
    const m = /^(\s+)([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(lines[j]);
    if (!m) break;
    const k = m[2];
    if ((SURFACE_KEYS as readonly string[]).includes(k)) {
      surface[k as keyof SkillSourceSurface] = parseScalarString(m[3]);
    }
    j++;
  }
  return { surface: completeSurface(surface), next: j };
}

function completeSurface(surface: Partial<SkillSourceSurface>): SkillSourceSurface | null {
  if (!surface.sourceId || !surface.sourceName || !surface.kind || !surface.artifactRoot) return null;
  return {
    sourceId: surface.sourceId,
    sourceName: surface.sourceName,
    kind: surface.kind,
    artifactRoot: surface.artifactRoot
  };
}

function skipIndentedBlock(lines: string[], start: number): number {
  let j = start;
  while (j < lines.length && /^\s+/.test(lines[j]) && lines[j].trim() !== "") j++;
  return j;
}

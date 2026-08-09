import fs from "node:fs";
import path from "node:path";

const MAX_ENV_FILE_BYTES = 512 * 1024;
const FORBIDDEN_ENV_NAMES = new Set(["PATH", "HOME", "NODE_OPTIONS", "PYTHONPATH", "LD_PRELOAD"]);
const SECRET_ENV_NAME = /(?:API[_-]?KEY|TOKEN|PASSWORD|PASSWD|PWD|SECRET|COOKIE|PRIVATE[_-]?KEY|CREDENTIAL)/i;

export type SkillEnvFile = {
  path: string | null;
  values: Record<string, string>;
  secretValues: string[];
  ignoredNames: string[];
};

/**
 * Loads the local .env beside a Skill source at run time. Values stay in
 * memory and are passed only to that Skill process; they are never copied to
 * the installed package or persisted in Run records.
 */
export function loadSkillEnvFile(skillDirectory: string): SkillEnvFile {
  const directory = path.resolve(skillDirectory);
  const file = path.join(directory, ".env");
  if (!fs.existsSync(file)) return { path: null, values: {}, secretValues: [], ignoredNames: [] };

  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Skill .env 必须是普通文件，拒绝读取符号链接。");
  }
  if (stat.size > MAX_ENV_FILE_BYTES) throw new Error("Skill .env 过大，拒绝加载。");

  const values: Record<string, string> = {};
  const ignoredNames: string[] = [];
  const content = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error(`Skill .env 第 ${index + 1} 行不是有效的 KEY=VALUE。`);
    const name = match[1];
    if (FORBIDDEN_ENV_NAMES.has(name) || name.startsWith("DYLD_")) {
      ignoredNames.push(name);
      continue;
    }
    values[name] = parseEnvValue(match[2]);
  }

  const secretValues = Object.entries(values)
    .filter(([name, value]) => SECRET_ENV_NAME.test(name) && Boolean(value))
    .map(([, value]) => value);
  return { path: file, values, secretValues: [...new Set(secretValues)], ignoredNames };
}

function parseEnvValue(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith("'")) {
    const end = closingQuoteIndex(value, "'");
    if (end < 0) throw new Error("Skill .env 包含未闭合的单引号。");
    assertCommentOnly(value.slice(end + 1));
    return value.slice(1, end);
  }
  if (value.startsWith('"')) {
    const end = closingQuoteIndex(value, '"');
    if (end < 0) throw new Error("Skill .env 包含未闭合的双引号。");
    assertCommentOnly(value.slice(end + 1));
    return value.slice(1, end)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return value.replace(/\s+#.*$/, "").trimEnd();
}

function closingQuoteIndex(value: string, quote: "'" | '"'): number {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] !== quote) continue;
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) slashes += 1;
    if (slashes % 2 === 0) return index;
  }
  return -1;
}

function assertCommentOnly(raw: string): void {
  const tail = raw.trim();
  if (tail && !tail.startsWith("#")) throw new Error("Skill .env 的引号值后包含无效内容。");
}

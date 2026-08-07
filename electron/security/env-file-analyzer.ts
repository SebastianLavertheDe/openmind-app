import fs from "node:fs";
import path from "node:path";
import {
  EnvFileAnalysisSchema,
  type EnvFileAnalysis,
  type EnvVariableKind
} from "../../shared/env-file-analysis";

const MAX_ENV_FILE_BYTES = 512 * 1024;

/** Read-only .env inspection. It never returns values or performs migration. */
export class EnvFileAnalyzer {
  analyze(filePath: string): EnvFileAnalysis {
    const absolute = path.resolve(filePath);
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Credential 文件必须是普通文件，拒绝分析符号链接。");
    if (stat.size > MAX_ENV_FILE_BYTES) throw new Error("Credential 文件过大，拒绝分析。");
    const content = fs.readFileSync(absolute, "utf8");
    const variables = [];
    const warnings: string[] = [];
    let ignoredLines = 0;
    for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) {
        ignoredLines += 1;
        if (warnings.length < 100) warnings.push(`第 ${index + 1} 行不是可迁移的 KEY=VALUE 格式。`);
        continue;
      }
      const [, name, rawValue] = match;
      const value = stripOptionalQuotes(rawValue.trim());
      variables.push({
        name,
        line: index + 1,
        kind: classifyVariable(name),
        hasValue: value.length > 0,
        valueLength: Math.min(value.length, 1024 * 1024)
      });
    }
    const result = {
      path: absolute,
      variables,
      ignoredLines,
      warnings,
      containsPotentialSecrets: variables.some((item) => item.kind !== "unknown" && item.hasValue)
    };
    return EnvFileAnalysisSchema.parse(result);
  }
}

function stripOptionalQuotes(value: string): string {
  if (value.length >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

function classifyVariable(name: string): EnvVariableKind {
  const normalized = name.toLowerCase();
  if (normalized.includes("private") && normalized.includes("key")) return "private-key";
  if (normalized.includes("password") || normalized.endsWith("_pwd")) return "password";
  if (normalized.includes("cookie")) return "cookie";
  if (normalized.includes("token") || normalized.includes("session")) return "token";
  if (normalized.includes("api") && normalized.includes("key")) return "api-key";
  if (normalized.includes("secret") || normalized.includes("credential") || normalized.includes("auth")) return "credential";
  return "unknown";
}

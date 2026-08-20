import fs from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";

/**
 * `.openmind/` 状态目录的单一 owner：各 product store（content-index/content-state/source/brief）
 * 此前各自 `path.join(repoRoot, ".openmind", ...)`，集中后目录名/布局变更只改这里一处。
 */
export const STATE_DIRECTORY = ".openmind";

/** 解析 <repoRoot>/.openmind/<...segments>。 */
export function statePath(repoRoot: string, ...segments: string[]): string {
  return path.join(repoRoot, STATE_DIRECTORY, ...segments);
}

/**
 * 把损坏的状态文件隔离到 <path>.corrupt-<ts>，返回是否成功隔离（便于调用方决定回退）。
 * content-index 的损坏隔离模式（先 rename，跨设备/权限失败则 copy+unlink）提到此处，供其他 store 复用——
 * 统一 .openmind 各 store 的损坏处理，避免每处各写一份。
 */
export function quarantineCorruptState(filePath: string): boolean {
  const corruptPath = `${filePath}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(filePath, corruptPath);
    return true;
  } catch {
    try {
      fs.copyFileSync(filePath, corruptPath);
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;   // retain the original when quarantine is impossible
    }
  }
}

/** 读取 `.openmind` JSON 状态；损坏时隔离并回退（C6 复用 content-index 同款策略）。 */
export function readStateJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    if (fs.existsSync(filePath)) quarantineCorruptState(filePath);
    return fallback;
  }
}

/** 读取 `.openmind` JSON 数组并逐条 schema 校验；损坏时隔离。 */
export function readStateJsonArray<T>(filePath: string, schema: ZodType<T>): T[] {
  const raw = readStateJson<unknown>(filePath, []);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    const result = schema.safeParse(value);
    return result.success ? [result.data] : [];
  });
}

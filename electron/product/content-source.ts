import fs from "node:fs";
import path from "node:path";
import type { ContentApi } from "./common";
import { readTextPrefixSync } from "../lib/read-text-prefix";
import {
  LEGACY_CONTENT_DATE_DIRECTORY_KINDS,
  LEGACY_CONTENT_FILE_ROOT_KINDS,
  LEGACY_GET_CONTENT_ALL_KINDS
} from "../../shared/content-kinds";

export type ContentFileEntry = {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
};

/**
 * 显式 root 的纯 Node 内容源。worker_threads 无法 import lib/content（传递依赖
 * lib/settings → electron app），这里以注入 openmindRoot 的方式复刻 ContentIndexStore
 * 消费的 getContent/readContent 语义（同一批 kind 目录常量、同一套过滤/排序规则、
 * 同样的 app-managed projects 排除行为）。与 lib/content 的一致性由
 * content-source.test.ts 的奇偶校验测试守护；主进程仍使用 lib/content 本体。
 */
export function createExplicitContentSource(openmindRootInput: string): ContentApi {
  const openmindRoot = path.resolve(openmindRootInput);

  /** 逻辑路径（openmind/…）→ 物理路径，含 contained-in-root 校验。 */
  function physicalFromLogical(logical: string): string {
    const normalized = String(logical || "").replaceAll("\\", "/");
    if (normalized !== "openmind" && !normalized.startsWith("openmind/")) {
      throw new Error(`内容源只接受 openmind 逻辑路径：${logical}`);
    }
    const physical = normalized === "openmind" ? openmindRoot : path.resolve(openmindRoot, normalized.slice("openmind/".length));
    const relative = path.relative(openmindRoot, physical);
    if (!relative && normalized !== "openmind" || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`逻辑路径越界：${logical}`);
    }
    return physical;
  }

  /** 物理路径 → 逻辑路径（openmind/…）；app-managed projects 与 lib/content 同样拒绝。 */
  function logicalFromPhysical(absolutePath: string): string {
    const resolved = path.resolve(absolutePath);
    const relative = path.relative(openmindRoot, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`物理路径不在 openmind root 内：${absolutePath}`);
    }
    if (relative === "projects" || relative.startsWith(`projects${path.sep}`)) {
      throw new Error("Project 内容只能通过 Project 专用接口访问。");
    }
    return `openmind/${relative.split(path.sep).join("/")}`;
  }

  function listFiles(directory: string, filter: (name: string) => boolean = () => true): ContentFileEntry[] {
    try {
      return fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && filter(entry.name))
        .map((entry) => {
          const absolutePath = path.join(directory, entry.name);
          const stat = fs.statSync(absolutePath);
          return {
            name: entry.name,
            path: logicalFromPhysical(absolutePath),
            size: stat.size,
            modifiedAt: stat.mtime.toISOString()
          };
        })
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    } catch {
      return [];
    }
  }

  function listDatedFiles(relativeDirectory: string, date: string, suffix?: string): ContentFileEntry[] {
    return listFiles(
      physicalFromLogical(relativeDirectory),
      (name) => (!date || name.startsWith(`${date}_`)) && (!suffix || name.endsWith(suffix))
    );
  }

  function isXPostMarkdown(name: string): boolean {
    return /^x_/i.test(name) && name.endsWith(".md");
  }

  function latestCreativeTopics(date: string): ContentFileEntry[] {
    const formatted = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    const root = physicalFromLogical("openmind/creative");
    const matches: ContentFileEntry[] = [];

    function walk(directory: string, depth = 0): void {
      if (depth > 4 || !fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(target, depth + 1);
        if (entry.isFile() && entry.name.includes(formatted) && entry.name.endsWith(".md")) {
          const stat = fs.statSync(target);
          matches.push({
            name: entry.name,
            path: logicalFromPhysical(target),
            size: stat.size,
            modifiedAt: stat.mtime.toISOString()
          });
        }
      }
    }

    walk(root);
    return matches.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  return {
    getContent(kind: string, date: string): Array<ContentFileEntry & { kind: string }> {
      const kinds = kind === "all" ? [...LEGACY_GET_CONTENT_ALL_KINDS] : [kind];
      let files: Array<ContentFileEntry & { kind: string }> = [];

      for (const item of kinds) {
        if (item === "articles") {
          files = files.concat(
            listFiles(physicalFromLogical(`openmind/article/${date}`), (name) => name.endsWith(".md") && !isXPostMarkdown(name))
              .map((file) => ({ ...file, kind: item }))
          );
          continue;
        }
        if (item === "posts") {
          files = files.concat(
            listFiles(physicalFromLogical(`openmind/article/${date}`), (name) => isXPostMarkdown(name))
              .map((file) => ({ ...file, kind: item }))
          );
        }
        const fileRoot = LEGACY_CONTENT_FILE_ROOT_KINDS[item];
        if (fileRoot) {
          files = files.concat(listDatedFiles(path.join(...fileRoot), date, ".md").map((file) => ({ ...file, kind: item })));
          continue;
        }
        const dateDirectory = LEGACY_CONTENT_DATE_DIRECTORY_KINDS[item];
        if (!dateDirectory) continue;
        files = files.concat(
          listFiles(physicalFromLogical(path.join(...dateDirectory, date)), (name) => name.endsWith(".md") || name.endsWith(".json") || name.endsWith(".html"))
            .map((file) => ({ ...file, kind: item }))
        );
      }
      if (kind === "all" || kind === "topics") {
        files = files.concat(latestCreativeTopics(date).map((file) => ({ ...file, kind: "topics" })));
      }
      return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    },

    readContent(relativePath: string) {
      const physical = physicalFromLogical(relativePath);
      return {
        path: relativePath,
        name: path.basename(physical),
        ...readTextPrefixSync(physical)
      };
    }
  };
}

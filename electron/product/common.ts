import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z, type ZodType } from "zod";
import { writeJsonAtomic as writeJsonAtomicImpl } from "../lib/fs-utils";
import type * as ContentLib from "../lib/content";
import type * as CreativeLib from "../lib/creative";
import { ContentKindSchema, type ContentKind } from "../../shared/contracts";
import { LEGACY_KIND_MATCHERS } from "../../shared/content-kinds";
import { messages } from "../../shared/messages";

export type ContentApi = Pick<typeof ContentLib, "getContent" | "readContent">;
export type ContentServiceApi = Pick<typeof ContentLib, "getContent" | "readContent" | "readContentAsync" | "getOverview" | "writeContent">;
export type CreativeApi = Pick<typeof CreativeLib, "getCreativeTopics" | "listCreativeProjects">;
export type CreativeServiceApi = typeof CreativeLib;

export type LegacyContentEntry = {
  path: string;
  name?: string;
  title?: string;
  kind?: string;
  type?: string;
  size?: number;
  modifiedAt?: string;
};

export type LegacyCreativeProject = { id?: string; dir: string; topic: string; stage: string; completion: number; date?: string };

export const IndexedContentSchema = z.object({
  schemaVersion: z.number().default(1),
  id: z.string(),
  path: z.string(),
  name: z.string(),
  title: z.string(),
  kind: ContentKindSchema,
  source: z.string(),
  author: z.string().nullable().default(null),
  originalUrl: z.string().nullable().default(null),
  publishedAt: z.string().nullable().default(null),
  capturedAt: z.string(),
  modifiedAt: z.string(),
  size: z.number().nonnegative(),
  excerpt: z.string().default(""),
  date: z.string().regex(/^\d{8}$/),
  searchText: z.string()
});

export type IndexedContent = z.infer<typeof IndexedContentSchema>;

export type ContentIndexFile = {
  schemaVersion: number;
  updatedAt: string;
  items: Record<string, IndexedContent>;
};

export type CustomSource = {
  id: string;
  name: string;
  kind: "web" | "api" | "manual";
  url: string | null;
  frequency: string;
  tags: string[];
  enabled: boolean;
};

// 用户在 Sources 页手动新增的 web/api/manual 来源。宽容 schema：缺字段用默认（与历史手写守卫等价），
// id/name 空串或 kind 非法则整条丢弃。供 readSourceSettings 用 parseArray 统一校验。
export const CustomSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["web", "api", "manual"]),
  url: z.string().nullable().default(null),
  frequency: z.string().default(messages.source.customFrequencyDaily),
  tags: z.array(z.string()).default([]),
  enabled: z.boolean().default(true)
});

export type SourceSettings = {
  schemaVersion: number;
  sources: Record<string, { name?: string; enabled?: boolean; frequency?: string; tags?: string[] }>;
  customSources: CustomSource[];
  disabledUrls: string[];
};

export function parseMetadata(raw: string, fallbackName: string): {
  title: string;
  source: string;
  author: string | null;
  url: string | null;
  publishedAt: string | null;
  excerpt: string;
} {
  const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim()
    || fallbackName.replace(/\.[^.]+$/, "").replace(/^\d+[_-]/, "").trim();
  const url = raw.match(/(?:链接|原文|URL|Link)[：:]\s*(https?:\/\/\S+)/i)?.[1]?.replace(/[)>]+$/, "") || null;
  const author = raw.match(/(?:作者|Author)[：:]\s*(.+)$/im)?.[1]?.trim() || null;
  const publishedAt = raw.match(/(?:发布时间|发布日期|Published|Date)[：:]\s*(.+)$/im)?.[1]?.trim() || null;
  const sourceValue = raw.match(/(?:来源|Source)[：:]\s*(.+)$/im)?.[1]?.trim();
  const source = sourceValue ? shortenSource(sourceValue) : inferSource(url, fallbackName);
  return { title, source, author, url, publishedAt, excerpt: firstParagraph(stripMetadata(raw)).slice(0, 280) };
}

export function normalizeContentKind(kind: string | undefined, relativePath: string): ContentKind {
  const normalized = String(kind || "").toLocaleLowerCase();
  for (const { includes, kind: mapped } of LEGACY_KIND_MATCHERS) {
    if (normalized.includes(includes)) return mapped;
  }
  if (relativePath.toLocaleLowerCase().endsWith(".html")) return "html";
  return "unknown";
}

export { contentKindLabel } from "../../shared/display-labels";

export function stableContentId(
  entryPath: string,
  metadata: { title: string; source: string; author: string | null; url: string | null; publishedAt: string | null; excerpt: string },
  raw: string
): string {
  if (metadata.url) return stableId(`url:${normalizeUrl(metadata.url)}`);
  const body = stripMetadata(raw).replace(/\s+/g, " ").trim().slice(0, 4096);
  const signature = [
    metadata.title,
    metadata.source,
    metadata.author || "",
    metadata.publishedAt || "",
    body
  ].join("\n").trim();
  return stableId(signature ? `content:${signature}` : `path:${entryPath}`);
}

export function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

export function stableId(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

export function compactDate(value: string): string {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

export function parseCompactDate(value: string): Date {
  return new Date(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)), 12);
}

export function firstParagraph(markdown: string): string {
  return markdown
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s+/gm, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`>|-]/g, " ").replace(/\s+/g, " ").trim())
    .find(Boolean) || "";
}

export function stripMetadata(markdown: string): string {
  return markdown.replace(/^#\s+.+$/m, "").replace(/^(?:[-*]\s*)?(?:链接|原文|URL|Link|作者|Author|来源|Source|发布时间|发布日期|Published|Date)[：:].*$/gim, "");
}

export function countMarkdownLinks(markdown: string): number {
  return [...markdown.matchAll(/\[[^\]]+\]\([^)]+\)/g)].length;
}

export function extractHeadings(markdown: string): string[] {
  return markdown.split(/\r?\n/)
    .map((line) => line.match(/^#{2,3}\s+(.+?)\s*#*\s*$/)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

export function inferSource(url: string | null, filename: string): string {
  if (/^x_/i.test(filename)) return "X";
  if (!url) return messages.source.localFile;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return messages.source.webPage; }
}

export function shortenSource(value: string): string {
  const url = value.match(/https?:\/\/\S+/)?.[0];
  if (url) return inferSource(url, "");
  return value.slice(0, 80);
}

export function readJson(filePath: string, fallback: unknown): unknown {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

// 读一个 JSON 文件并逐条用 schema 校验，丢弃不合法条目。统一各 store 的「加载 typed 记录数组」容错策略。
export function readJsonArray<T>(filePath: string, schema: ZodType<T>): T[] {
  const raw = readJson(filePath, []);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    const result = schema.safeParse(value);
    return result.success ? [result.data] : [];
  });
}

// 对内存中的数组逐条 schema 校验，丢弃不合法条目。readJsonArray 的不读文件版本，
// 供已读到内存的 JSON（如 SourceSettings.customSources）统一容错校验。
export function parseArray<T>(raw: unknown, schema: ZodType<T>): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    const result = schema.safeParse(value);
    return result.success ? [result.data] : [];
  });
}

export function readText(filePath: string): string {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return ""; }
}

export function safeStat(filePath: string): fs.Stats | null {
  try { return fs.statSync(filePath); } catch { return null; }
}

export function newestMtime(paths: string[]): string | null {
  const dates = paths.flatMap((target) => {
    const stat = safeStat(target);
    return stat ? [stat.mtime.toISOString()] : [];
  });
  return dates.sort().at(-1) || null;
}

export function collectOutlines(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(collectOutlines);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const current = "xmlUrl" in record ? [record] : [];
  return current.concat(Object.values(record).flatMap(collectOutlines));
}

export function collectPrefixedOutlines(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(collectPrefixedOutlines);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const current = "@_xmlUrl" in record ? [record] : [];
  return current.concat(Object.values(record).flatMap(collectPrefixedOutlines));
}

export function visitObjects(value: unknown, visitor: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visitObjects(item, visitor));
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  visitor(record);
  Object.values(record).forEach((item) => visitObjects(item, visitor));
}

export function lastMeaningfulLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1)?.slice(0, 500) || "";
}

export function writeJsonAtomic(filePath: string, value: unknown, options?: { onlyIfMissing?: boolean }): void {
  writeJsonAtomicImpl(filePath, value, options);
}

export function writeTextAtomic(filePath: string, value: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, value, "utf8");
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EPERM", "EACCES", "EXDEV"].includes(String(code))) {
      try { fs.unlinkSync(temporary); } catch { /* best effort */ }
      throw error;
    }
    fs.copyFileSync(temporary, filePath);
    fs.unlinkSync(temporary);
  }
}

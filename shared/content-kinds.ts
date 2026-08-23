import type { ContentKind } from "./contracts";

/**
 * Content kind 的单一事实源（TS 侧，代码常量）。
 * 展示文案见 shared/messages/zh-CN.ts + display-labels.contentKindLabel()。
 */


// normalizeContentKind 的模糊匹配规则：按顺序 includes 命中即归类，
// 处理遗留复数名（"articles"→article）与大小写差异。
export const LEGACY_KIND_MATCHERS: ReadonlyArray<{ includes: string; kind: ContentKind }> = [
  { includes: "article", kind: "article" },
  { includes: "post", kind: "post" },
  { includes: "summar", kind: "summary" },
  { includes: "topic", kind: "topic" },
  { includes: "reddit", kind: "reddit" }
];

// availableContentDates 的内容根目录（相对 repoRoot）：dateRoots 下按日期子目录，fileRoots 下按文件名含日期。
export const CONTENT_DATE_ROOTS = ["openmind/article", "openmind/post", "openmind/reddit"] as const;
export const CONTENT_FILE_ROOTS = ["openmind/daily-summary", "openmind/daily-topic"] as const;

// inbox 过滤栏的展示顺序（不含 html/unknown）。

/** getContent("all") 展开的 legacy 复数 kind 名（IPC 契约，勿改为单数）。 */
export const LEGACY_GET_CONTENT_ALL_KINDS = ["articles", "reddit", "posts", "summaries", "topics"] as const;

/** getContent 走日期子目录的 legacy kind → repo 相对路径前缀（不含 date）。 */
export const LEGACY_CONTENT_DATE_DIRECTORY_KINDS: Record<string, readonly string[]> = {
  reddit: ["openmind", "reddit"],
  posts: ["openmind", "post"]
};

/** getContent 走文件名含日期的 legacy kind → repo 相对目录。 */
export const LEGACY_CONTENT_FILE_ROOT_KINDS: Record<string, readonly string[]> = {
  summaries: ["openmind", "daily-summary"],
  topics: ["openmind", "daily-topic"]
};

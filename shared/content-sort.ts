import type { ContentItem, ContentQuery } from "./contracts";

type SortComparator = (left: ContentItem, right: ContentItem) => number;

/** ContentQuery.sort 的比较器注册表（key 来自 contracts ContentQuerySchema）。 */
export const CONTENT_SORT_COMPARATORS: Record<ContentQuery["sort"], SortComparator> = {
  newest: (left, right) => right.modifiedAt.localeCompare(left.modifiedAt),
  oldest: (left, right) => left.modifiedAt.localeCompare(right.modifiedAt),
  title: (left, right) => left.title.localeCompare(right.title, "zh-CN"),
  score: (left, right) => (right.state.score || 0) - (left.state.score || 0) || right.modifiedAt.localeCompare(left.modifiedAt),
  source: (left, right) => left.source.localeCompare(right.source, "zh-CN") || right.modifiedAt.localeCompare(left.modifiedAt)
};

export function contentSorter(sort: ContentQuery["sort"]): SortComparator {
  return CONTENT_SORT_COMPARATORS[sort];
}

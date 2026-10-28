/** Stable topic IDs; channel names belong in tags, not topic navigation. */
export const RSS_TOPIC_IDS = ["ai", "agents", "prompts", "engineering", "product", "business", "tech", "life"] as const;
export type RssTopic = typeof RSS_TOPIC_IDS[number];
export const isRssTopic = (value: string): value is RssTopic => RSS_TOPIC_IDS.some(id => id === value);

export const rssGroupIdentity = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en-US");

export function normalizeRssGroup(value: string, existing: readonly string[] = []): string {
  const identity = rssGroupIdentity(value);
  if (!identity) return "";
  return [...RSS_TOPIC_IDS, ...existing].find(group => rssGroupIdentity(group) === identity) ?? value.trim();
}

/** Only these shipped channel groups are eligible for the one-time migration. */
export function legacyRssChannel(group: string): "blog" | "WeChat" | null {
  const key = rssGroupIdentity(group);
  return key === "blog" ? "blog" : key === "wechat" ? "WeChat" : null;
}

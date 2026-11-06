/** Retired App-owned packages; user-imported copies keep their own lifecycle. */
export const RETIRED_BUILTIN_SKILL_IDS = new Set([
  "creative-writing", "daily-writing-orchestrator", "ai-media-topic-selector",
  "collect-interest-markers", "asset-collector", "skill-run-reporter", "video-burnin-subtitles",
  "om-image-editor", "om-slide-outline", "om-slide-deck",
  "om-storyboard", "om-short-video", "om-landing-page", "om-mini-tool"
]);

export const RETIRED_SKILL_REASON = "该内置 Skill 已退役，无法再启动新任务。";

export function isRetiredBuiltinCandidate(record: {
  id: string; publisherId: string; sourceType?: string; sourceLocator?: string; sourcePath: string;
}): boolean {
  if (!RETIRED_BUILTIN_SKILL_IDS.has(record.id)) return false;
  return record.sourceType === "builtin" && record.publisherId === "openmind-library" && record.sourceLocator === "openmind:skill-library"
    || record.sourceType === undefined && record.publisherId === "cctools"
      && record.sourcePath.replaceAll("\\", "/").endsWith(`/skill-library/${record.id}`);
}

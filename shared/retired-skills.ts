/** App-owned production packages retired with the legacy writing workspace. */
export const RETIRED_CREATIVE_SKILL_IDS = new Set([
  "creative-writing", "daily-writing-orchestrator", "ai-media-topic-selector",
  "collect-interest-markers", "asset-collector"
]);

export const RETIRED_SKILL_REASON = "该内置 Skill 已随创作工作台退役，请改用项目和普通 AI 任务。";

export function isRetiredBuiltinCandidate(record: {
  id: string; publisherId: string; sourceType?: string; sourceLocator?: string; sourcePath: string;
}): boolean {
  if (!RETIRED_CREATIVE_SKILL_IDS.has(record.id)) return false;
  return record.sourceType === "builtin" && record.publisherId === "openmind-library" && record.sourceLocator === "openmind:skill-library"
    || record.sourceType === undefined && record.publisherId === "cctools"
      && record.sourcePath.replaceAll("\\", "/").endsWith(`/skill-library/${record.id}`);
}

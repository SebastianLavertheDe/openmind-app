import research from "../../assets/skill-covers/om-research-brief.jpg";
import compare from "../../assets/skill-covers/om-source-compare.jpg";
import article from "../../assets/skill-covers/om-article-writer.jpg";
import rewrite from "../../assets/skill-covers/om-text-rewriter.jpg";
import poster from "../../assets/skill-covers/om-poster-maker.jpg";
import type { SkillLibraryEntry } from "@shared/skill-library";

// Compatibility for old library providers; remote publication owns its own media and recommendations.
export const NEW_TASK_COVERS: Record<string, string> = {
  "om-research-brief": research, "om-source-compare": compare,
  "om-article-writer": article, "om-text-rewriter": rewrite,
  "om-poster-maker": poster
};

export function isRecommendedSkill(entry: SkillLibraryEntry): boolean {
  return entry.recommended ?? (entry.distribution !== "remote" && Boolean(NEW_TASK_COVERS[entry.skillId]));
}

export function skillCardCover(entry: SkillLibraryEntry, entries: SkillLibraryEntry[]): string | undefined {
  if (entry.coverUrl) return entry.coverUrl;
  const categoryCover = entries.find(candidate => candidate.category === entry.category && candidate.coverUrl)?.coverUrl;
  if (categoryCover) return categoryCover;
  if (entry.distribution === "remote" || entry.recommended !== undefined) return undefined;
  return NEW_TASK_COVERS[entry.skillId] || entries.map(candidate => candidate.category === entry.category ? NEW_TASK_COVERS[candidate.skillId] : undefined).find(Boolean);
}

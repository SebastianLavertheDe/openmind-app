import poster from "../../assets/skill-covers/om-poster-maker.jpg";
import articleCover from "../../assets/skill-covers/om-article-cover.jpg";
import articleIllustrator from "../../assets/skill-covers/om-article-illustrator.jpg";
import socialCards from "../../assets/skill-covers/om-social-cards.jpg";
import knowledgeInfographic from "../../assets/skill-covers/om-knowledge-infographic.jpg";
import fourPanelComic from "../../assets/skill-covers/om-four-panel-comic.jpg";
import photoDiptych from "../../assets/skill-covers/om-photo-diptych.jpg";
import productHighlights from "../../assets/skill-covers/om-product-highlights.jpg";
import brandCharacter from "../../assets/skill-covers/om-brand-character.jpg";
import styleFusion from "../../assets/skill-covers/om-style-fusion.jpg";
import agentBrowser from "../../assets/skill-covers/agent-browser.jpg";
import type { SkillLibraryEntry } from "@shared/skill-library";
import { RETIRED_BUILTIN_SKILL_IDS } from "@shared/retired-skills";

// Compatibility for old library providers; remote publication owns its own media and recommendations.
export const NEW_TASK_COVERS: Record<string, string> = {
  "om-poster-maker": poster,
  "om-article-cover": articleCover,
  "om-article-illustrator": articleIllustrator,
  "om-social-cards": socialCards,
  "om-knowledge-infographic": knowledgeInfographic,
  "om-four-panel-comic": fourPanelComic,
  "om-photo-diptych": photoDiptych,
  "om-product-highlights": productHighlights,
  "om-brand-character": brandCharacter,
  "om-style-fusion": styleFusion,
  "agent-browser": agentBrowser
};

export function isRecommendedSkill(entry: SkillLibraryEntry): boolean {
  if (entry.origin === "preset" && RETIRED_BUILTIN_SKILL_IDS.has(entry.skillId)) return false;
  return entry.recommended ?? (entry.distribution !== "remote" && entry.skillId === "om-poster-maker");
}

export function skillCardCover(entry: SkillLibraryEntry, entries: SkillLibraryEntry[]): string | undefined {
  if (entry.coverUrl) return entry.coverUrl;
  const categoryCover = entries.find(candidate => candidate.category === entry.category && candidate.coverUrl)?.coverUrl;
  if (categoryCover) return categoryCover;
  if (entry.distribution === "remote" || entry.recommended !== undefined) return undefined;
  return NEW_TASK_COVERS[entry.skillId] || entries.map(candidate => candidate.category === entry.category ? NEW_TASK_COVERS[candidate.skillId] : undefined).find(Boolean);
}

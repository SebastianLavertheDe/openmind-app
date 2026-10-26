import type { SkillScene } from "./skill-library";

/** Rules live in cctools-skills. The build copies only these reviewed packages into an ignored bundle. */
export const SKILL_LIBRARY_PRESETS: readonly { id: string; category: SkillScene; requirement?: "image" | "ffmpeg" | "python" }[] = [
  { id: "om-research-brief", category: "research" }, { id: "om-source-compare", category: "research" },
  { id: "om-article-writer", category: "writing" }, { id: "om-text-rewriter", category: "writing" },
  { id: "om-poster-maker", category: "image", requirement: "image" }, { id: "om-image-editor", category: "image", requirement: "image" },
  { id: "om-slide-outline", category: "slides" }, { id: "om-slide-deck", category: "slides", requirement: "python" },
  { id: "om-storyboard", category: "video" }, { id: "om-short-video", category: "video", requirement: "ffmpeg" },
  { id: "om-landing-page", category: "web" }, { id: "om-mini-tool", category: "web" }
];

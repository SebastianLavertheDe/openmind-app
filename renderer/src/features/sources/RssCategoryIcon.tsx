import { Bot, Brain, Briefcase, Code2, Coffee, Folder, Globe, LayoutGrid, Palette, Wand2 } from "lucide-react";
import { isRssTopic } from "@shared/rss-categories";

const ICONS = { ai: Brain, agents: Bot, prompts: Wand2, engineering: Code2, product: Palette, business: Briefcase, tech: Globe, life: Coffee };

export function RssCategoryIcon({ category, size = 14 }: { category: string; size?: number }) {
  const Icon = category === "scope:all" ? LayoutGrid : isRssTopic(category) ? ICONS[category] : Folder;
  return <Icon size={size} strokeWidth={1.5} aria-hidden="true" />;
}

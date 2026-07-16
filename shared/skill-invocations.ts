import type { SkillDefinition } from "./contracts";

export interface NativeSkillInvocation {
  skill: SkillDefinition;
  argument: string;
  raw: string;
}

export function parseSkillSlashInvocation(
  value: string,
  skills: SkillDefinition[]
): NativeSkillInvocation | null {
  const raw = value.trim();
  const match = raw.match(/^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const skill = skills.find((candidate) => candidate.id.toLocaleLowerCase() === match[1].toLocaleLowerCase());
  if (!skill) return null;
  return {
    skill,
    argument: (match[2] || "").trim(),
    raw
  };
}

export function skillMatchScore(skill: SkillDefinition, query: string): number {
  const normalized = query.toLocaleLowerCase();
  const id = skill.id.toLocaleLowerCase();
  if (!normalized) return 0;
  if (id === normalized) return 100;
  if (id.startsWith(normalized)) return 80;
  if (id.includes(normalized)) return 60;
  const text = `${skill.title} ${skill.description} ${skill.group || ""}`.toLocaleLowerCase();
  return text.includes(normalized) ? 30 : -1;
}

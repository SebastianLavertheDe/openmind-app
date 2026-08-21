/**
 * 「skill 即数据源」映射的派生逻辑。
 * 原始数据在已安装商店各包 SKILL.md frontmatter 的 `surfacesAsSource` 字段，
 * 由 source-registry.ts 扫描 <openmindRoot>/.agent/skills/ 后传入。
 */

export type SkillSourceSurface = {
  sourceId: string;
  sourceName: string;
  kind: "x" | "reddit";
  artifactRoot: string;
};

export type SkillManifestEntry = {
  id: string;
  surfacesAsSource?: SkillSourceSurface;
};

export type SkillSourceBinding = SkillSourceSurface & { skillId: string };

export function parseSkillSources(skills: ReadonlyArray<SkillManifestEntry>): SkillSourceBinding[] {
  return skills.flatMap((skill) =>
    skill.surfacesAsSource
      ? [{ skillId: skill.id, ...skill.surfacesAsSource }]
      : []
  );
}

export function parseSkillToSourceId(sources: ReadonlyArray<SkillSourceBinding>): Readonly<Record<string, string>> {
  return Object.fromEntries(sources.map((source) => [source.skillId, source.sourceId]));
}

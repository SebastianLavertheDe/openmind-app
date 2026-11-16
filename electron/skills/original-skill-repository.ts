import fs from "node:fs";
import path from "node:path";
import { parseSkillFrontmatter } from "../../shared/skill-frontmatter";
import { SkillLibraryMetadataSchema } from "../../shared/skill-library";
import { SKILL_LIBRARY_PUBLISHER, type SkillLibraryPreset } from "../../shared/skill-library-catalog";

/** Adds App metadata beside original source files; never rewrites upstream instructions. */
export function prepareOriginalSkillRepository(
  configRoot: string, destination: string, entries: SkillLibraryPreset[],
  copySource: (source: string, destination: string) => void
): void {
  const first = entries[0];
  if (!first?.packageId || !first.packageDirectory || !first.upstream) throw new Error("Original Skill repository metadata is incomplete");
  if (entries.some(entry => entry.packageId !== first.packageId || entry.packageDirectory !== first.packageDirectory
    || entry.version !== first.version || JSON.stringify(entry.upstream) !== JSON.stringify(first.upstream))) {
    throw new Error("Shared Skill repository definitions disagree");
  }
  const packages = fs.realpathSync(path.join(configRoot, "packages"));
  const source = fs.realpathSync(path.join(packages, first.packageDirectory));
  if (!source.startsWith(packages + path.sep)) throw new Error("Original Skill repository escapes package sources");
  copySource(source, destination);
  const root = parseSkillFrontmatter(fs.readFileSync(path.join(destination, "SKILL.md"), "utf8"));
  if (root.name !== first.packageId) throw new Error("Original root SKILL.md name differs from package identity");
  const entrypoints = entries.map(entry => {
    if (!entry.skillPath) throw new Error(`Missing original Skill entrypoint: ${entry.id}`);
    const file = fs.realpathSync(path.join(destination, entry.skillPath));
    if (!file.startsWith(fs.realpathSync(destination) + path.sep)) throw new Error("Original Skill path escapes its repository");
    const original = parseSkillFrontmatter(fs.readFileSync(file, "utf8"));
    if (original.name !== entry.id || !original.description) throw new Error(`Original Skill identity mismatch: ${entry.id}`);
    return { id: entry.id, path: entry.skillPath, category: entry.category, display: entry.display };
  });
  for (const reserved of ["openmind.skill.yaml", "openmind.library.json"]) {
    if (fs.existsSync(path.join(destination, reserved))) throw new Error(`Original source owns reserved metadata: ${reserved}`);
  }
  fs.writeFileSync(path.join(destination, "openmind.skill.yaml"), JSON.stringify({
    apiVersion: "openmind.dev/skill/v1", id: first.packageId, version: first.version,
    publisher: { id: SKILL_LIBRARY_PUBLISHER, displayName: "OpenMind Skill Library" }, kind: "agent",
    display: { name: root.name, description: root.description, group: "image" },
    capabilities: {}, execution: {}, artifacts: [],
    platforms: ["windows-x64", "windows-arm64", "macos-arm64", "macos-x64", "linux-x64", "linux-arm64", "wsl-linux-x64"],
    compatibility: { minAppVersion: "1.0.0" }
  }, null, 2) + "\n");
  const metadata = SkillLibraryMetadataSchema.parse({ schemaVersion: 1, origin: "preset", presetId: first.packageId,
    category: first.category, capabilityMode: "session", entrypoints, upstream: first.upstream, contributor: first.contributor });
  if (first.contributor?.avatar) {
    const mapped = first.files.find(file => typeof file !== "string" && file.target === first.contributor!.avatar);
    if (!mapped || typeof mapped === "string") throw new Error("Original Skill contributor avatar needs a shared asset mapping");
    const assets = fs.realpathSync(path.join(configRoot, "assets"));
    const avatar = fs.realpathSync(path.join(assets, mapped.source));
    if (!avatar.startsWith(assets + path.sep)) throw new Error("Contributor asset escapes configuration");
    const target = path.join(destination, mapped.target);
    if (fs.existsSync(target)) throw new Error("App presentation asset would overwrite original source");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(avatar, target);
  }
  fs.writeFileSync(path.join(destination, "openmind.library.json"), JSON.stringify(metadata, null, 2) + "\n");
}

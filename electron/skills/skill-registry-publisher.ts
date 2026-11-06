import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { zipSync, type Zippable } from "fflate";
import { RemoteSkillCatalogSchema, SKILL_REGISTRY_CATALOG_MAX_BYTES, SKILL_REGISTRY_COVER_MAX_BYTES, isBuiltinSkillId, type RemoteSkillCatalog } from "../../shared/skill-registry";
import { buildAppPaths } from "../paths/app-paths-service";
import { readSkillAvatar, skillAvatarDataUrl } from "./skill-avatar";
import { prepareSkillLibraryBundle } from "./skill-library-bundle";
import { readSkillLibraryCatalog } from "./skill-library-catalog";
import { SkillPackageService } from "./skill-package-service";

/**
 * Publish independently of the App build. Packages have immutable hash names;
 * replacing catalog.json is the commit point, and earlier packages stay valid.
 */
export function publishSkillRegistry(configRoot: string, outputRoot: string): RemoteSkillCatalog {
  const configuration = readSkillLibraryCatalog(configRoot);
  const remoteIds = configuration.skills.filter(entry => !isBuiltinSkillId(entry.id)).map(entry => entry.id);
  const destination = path.resolve(outputRoot);
  const source = fs.realpathSync(configRoot);
  if (source === destination || source.startsWith(`${destination}${path.sep}`) || destination.startsWith(`${source}${path.sep}`)) {
    throw new Error("Registry output must be separate from Skill sources");
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(destination), ".skill-registry-publish-"));
  try {
    const bundle = path.join(temporary, "bundle");
    prepareSkillLibraryBundle(configRoot, bundle, { includeIds: remoteIds });
    const bundledCatalog = readSkillLibraryCatalog(bundle);
    const inspector = new SkillPackageService(buildAppPaths(path.join(temporary, "state"), path.join(temporary, "installed")));
    const packageFiles = new Map<string, string>();
    const catalog: RemoteSkillCatalog = { schemaVersion: 1, generatedAt: new Date().toISOString(), skills: [] };
    for (const entry of bundledCatalog.skills) {
      const skillRoot = path.join(bundle, entry.id);
      const inspection = inspector.inspect(skillRoot);
      if (!inspection.valid || !inspection.manifest) throw new Error(`Cannot publish invalid Skill: ${entry.id}`);
      const files: Zippable = {};
      for (const file of [...inspection.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
        files[file.path] = fs.readFileSync(path.join(skillRoot, file.path));
      }
      // A fixed local DOS timestamp makes identical sources produce identical ZIPs.
      const bytes = Buffer.from(zipSync(files, { level: 6, mtime: new Date(2000, 0, 1, 0, 0, 0) }));
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      const filename = `${entry.id}-${sha256}.zip`;
      const archivePath = path.join(temporary, filename);
      fs.writeFileSync(archivePath, bytes);
      const archived = inspector.inspect(archivePath);
      if (!archived.valid || archived.digest !== inspection.digest) throw new Error(`Skill ZIP verification failed: ${entry.id}`);
      packageFiles.set(filename, archivePath);
      // Preview comes from the catalog without downloading the archive. Native
      // packages keep their authored SKILL.md; generated presets keep the same
      // shared execution rules that the builder appended to their package.
      const instructions = entry.instructions.length ? entry.instructions
        : [fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8")
          .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim()];
      catalog.skills.push({
        preset: { ...entry, version: inspection.manifest.version, instructions: [...instructions, ...bundledCatalog.executionRules] },
        package: { path: `packages/${filename}`, sha256, size: bytes.length, digest: inspection.digest },
        avatarDataUrl: entry.contributor?.avatar ? skillAvatarDataUrl(readSkillAvatar(skillRoot, entry.contributor.avatar)) : undefined,
        coverDataUrl: entry.cardCover ? readCoverDataUrl(configRoot, entry.cardCover) : undefined
      });
    }
    const validated = RemoteSkillCatalogSchema.parse(catalog);
    const encoded = JSON.stringify(validated, null, 2) + "\n";
    if (Buffer.byteLength(encoded) > SKILL_REGISTRY_CATALOG_MAX_BYTES) throw new Error("Skill registry catalog is too large");
    const stagedCatalog = path.join(temporary, "catalog.json");
    fs.writeFileSync(stagedCatalog, encoded);
    ensureDirectory(destination);
    const packages = path.join(destination, "packages");
    ensureDirectory(packages);
    for (const [filename, archivePath] of packageFiles) {
      const target = path.join(packages, filename);
      if (fs.existsSync(target)) {
        const stat = fs.lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Invalid published package path: ${filename}`);
        if (stat.size === fs.statSync(archivePath).size && fs.readFileSync(target).equals(fs.readFileSync(archivePath))) continue;
      }
      fs.renameSync(archivePath, target);
    }
    fs.renameSync(stagedCatalog, path.join(destination, "catalog.json"));
    return validated;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

function ensureDirectory(directory: string): void {
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Invalid registry output directory: ${directory}`);
  } else fs.mkdirSync(directory);
}

function readCoverDataUrl(configRoot: string, relative: string): string {
  const assetRoot = fs.realpathSync(path.join(configRoot, "assets"));
  const file = fs.realpathSync(path.join(assetRoot, relative));
  if (!file.startsWith(`${assetRoot}${path.sep}`)) throw new Error("Skill cover must stay inside configuration assets");
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > SKILL_REGISTRY_COVER_MAX_BYTES) throw new Error("Skill cover is too large or invalid");
  const bytes = fs.readFileSync(file);
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
      : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : undefined;
  if (!mime) throw new Error("Skill cover must be a PNG, JPEG or WebP image");
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

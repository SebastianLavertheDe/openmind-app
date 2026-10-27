import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { SKILL_LIBRARY_CATALOG_FILE, SKILL_LIBRARY_PUBLISHER, SKILL_LIBRARY_SOURCE, resolveSkillLibraryCopy } from "../../shared/skill-library-catalog";
import { buildAppPaths } from "../paths/app-paths-service";
import { readSkillLibraryCatalog } from "./skill-library-catalog";
import { SkillPackageService } from "./skill-package-service";
import { readSkillAvatar } from "./skill-avatar";

/** Compile App-owned definitions into verified installable packages. No external repository is read. */
export function prepareSkillLibraryBundle(configRoot: string, outputRoot: string): number {
  const catalog = readSkillLibraryCatalog(configRoot);
  fs.mkdirSync(path.dirname(outputRoot), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(outputRoot), ".skill-library-build-"));
  const bundle = path.join(temporary, "bundle");
  fs.mkdirSync(bundle);
  try {
    const inspector = new SkillPackageService(buildAppPaths(path.join(temporary, "state"), path.join(temporary, "installed")));
    const packages: Record<string, string> = {};
    for (const entry of catalog.skills) {
      const destination = path.join(bundle, entry.id);
      fs.mkdirSync(destination);
      const copy = resolveSkillLibraryCopy(entry, "en");
      const description = copy.subtitle || copy.title;
      const instructions = [...entry.instructions, ...catalog.executionRules].join("\n\n");
      if (entry.packageDirectory) {
        const packagesRoot = path.resolve(configRoot, "packages");
        const source = fs.realpathSync(path.join(packagesRoot, entry.packageDirectory));
        if (!source.startsWith(`${packagesRoot}${path.sep}`)) throw new Error(`Invalid package directory: ${entry.id}`);
        copyPackageSource(source, destination);
        const shared = path.join(packagesRoot, "_shared");
        if (fs.existsSync(shared)) copyPackageSource(shared, path.join(destination, "_shared"));
        if (entry.id === "rss-article-saver") fs.copyFileSync(path.join(configRoot, "../rss-sources/catalog.json"), path.join(destination, "rss-catalog.json"));
        const manifestFile = ["cctools.skill.yaml", "openmind.skill.yaml"].find(file => fs.existsSync(path.join(destination, file)));
        if (!manifestFile) throw new Error(`Missing manifest: ${entry.id}`);
        const manifest = loadYaml(fs.readFileSync(path.join(destination, manifestFile), "utf8")) as Record<string, unknown>;
        if (manifest.id !== entry.id || manifest.kind !== entry.executionKind) throw new Error(`Package identity/kind mismatch: ${entry.id}`);
        manifest.apiVersion = "openmind.dev/skill/v1";
        manifest.publisher = { id: SKILL_LIBRARY_PUBLISHER, displayName: "OpenMind Skill Library" };
        fs.rmSync(path.join(destination, manifestFile));
        fs.writeFileSync(path.join(destination, "openmind.skill.yaml"), JSON.stringify(manifest, null, 2) + "\n");
      } else {
      fs.writeFileSync(path.join(destination, "SKILL.md"), `---\nname: ${entry.id}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${copy.title}\n\n${instructions}\n`);
      fs.writeFileSync(path.join(destination, "openmind.skill.yaml"), JSON.stringify({
        apiVersion: "openmind.dev/skill/v1", id: entry.id, version: entry.version,
        publisher: { id: SKILL_LIBRARY_PUBLISHER, displayName: "OpenMind Skill Library" }, kind: "agent",
        display: { name: copy.title, description, group: entry.category },
        capabilities: { openmind: { read: [], write: [] }, network: { required: false, hosts: [] }, subprocess: { allowed: ["image", "python", "ffmpeg"].includes(entry.requirement || "") }, browser: false },
        execution: { timeoutSeconds: 3600, gracefulStopSeconds: 10, retry: { maxAttempts: 0 }, concurrency: { maxInstances: 1, mutexes: [] } },
        platforms: ["windows-x64", "windows-arm64", "macos-arm64", "macos-x64", "linux-x64", "linux-arm64", "wsl-linux-x64"], compatibility: { minAppVersion: "1.0.0" }
      }, null, 2) + "\n");
      }
      fs.writeFileSync(path.join(destination, "openmind.library.json"), JSON.stringify({
        schemaVersion: 1, origin: "preset", presetId: entry.id, category: entry.category,
        requirement: entry.requirement, inputHint: copy.inputHint, capabilityMode: entry.packageDirectory ? undefined : "session", contributor: entry.contributor
      }, null, 2) + "\n");
      const targets = new Set<string>();
      for (const file of entry.files) {
        const relativeTarget = typeof file === "string" ? file : file.target;
        const targetKey = relativeTarget.toLowerCase();
        if (["skill.md", "openmind.skill.yaml", "cctools.skill.yaml", "openmind.library.json"].includes(targetKey)) throw new Error(`Reserved library asset: ${entry.id}/${relativeTarget}`);
        if (targets.has(targetKey)) throw new Error(`Duplicate library asset: ${entry.id}/${relativeTarget}`);
        targets.add(targetKey);
        const assetRoot = path.resolve(configRoot, "assets");
        const skillRoot = path.resolve(assetRoot, entry.id);
        const sourceRoot = typeof file === "string" ? skillRoot : assetRoot;
        const source = typeof file === "string" ? path.join(skillRoot, file) : path.join(assetRoot, file.source);
        const realSource = fs.realpathSync(source);
        if (!realSource.startsWith(`${sourceRoot}${path.sep}`) || !fs.statSync(realSource).isFile()) throw new Error(`Invalid library asset: ${entry.id}/${relativeTarget}`);
        const target = path.join(destination, relativeTarget);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(realSource, target);
      }
      if (entry.contributor?.avatar) {
        // A shared avatar may already be copied by an explicit files mapping.
        // Validate it with the same size/type limits as a per-Skill avatar.
        const declared = entry.files.some(file => (typeof file === "string" ? file : file.target) === entry.contributor!.avatar);
        const skillRoot = declared ? destination : path.join(configRoot, "assets", entry.id);
        if (!declared && !fs.realpathSync(skillRoot).startsWith(`${path.resolve(configRoot, "assets")}${path.sep}`)) throw new Error(`Invalid library avatar: ${entry.id}`);
        const bytes = readSkillAvatar(skillRoot, entry.contributor.avatar);
        const target = path.join(destination, entry.contributor.avatar);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes);
      }
      const inspection = inspector.inspect(destination);
      if (!inspection.valid) throw new Error(`${entry.id}: ${JSON.stringify(inspection.issues)}`);
      packages[entry.id] = inspection.digest;
    }
    const configuration = JSON.stringify(catalog, null, 2) + "\n";
    fs.writeFileSync(path.join(bundle, SKILL_LIBRARY_CATALOG_FILE), configuration);
    fs.writeFileSync(path.join(bundle, "bundle.json"), JSON.stringify({ schemaVersion: 1, source: SKILL_LIBRARY_SOURCE, catalogDigest: crypto.createHash("sha256").update(configuration).digest("hex"), packages }, null, 2) + "\n");
    // Validate every definition before replacing the previous build output.
    fs.rmSync(outputRoot, { recursive: true, force: true });
    fs.renameSync(bundle, outputRoot);
    return catalog.skills.length;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

function copyPackageSource(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if ([".git", ".venv", "__pycache__", ".pytest_cache", ".env", "node_modules"].includes(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Package source must not contain symlinks: ${entry.name}`);
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyPackageSource(from, to);
    else if (entry.isFile() && !entry.name.endsWith(".pyc")) fs.copyFileSync(from, to);
  }
}

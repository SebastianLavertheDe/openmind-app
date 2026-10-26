import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SKILL_LIBRARY_CATALOG_FILE, SKILL_LIBRARY_PUBLISHER, SKILL_LIBRARY_SOURCE, resolveSkillLibraryCopy } from "../../shared/skill-library-catalog";
import { buildAppPaths } from "../paths/app-paths-service";
import { readSkillLibraryCatalog } from "./skill-library-catalog";
import { SkillPackageService } from "./skill-package-service";

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
      fs.writeFileSync(path.join(destination, "SKILL.md"), `---\nname: ${entry.id}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${copy.title}\n\n${instructions}\n`);
      fs.writeFileSync(path.join(destination, "openmind.skill.yaml"), JSON.stringify({
        apiVersion: "openmind.dev/skill/v1", id: entry.id, version: entry.version,
        publisher: { id: SKILL_LIBRARY_PUBLISHER, displayName: "OpenMind Skill Library" }, kind: "agent",
        display: { name: copy.title, description, group: entry.category },
        capabilities: { openmind: { read: [], write: [] }, network: { required: false, hosts: [] }, subprocess: { allowed: ["python", "ffmpeg"].includes(entry.requirement || "") }, browser: false },
        execution: { timeoutSeconds: 3600, gracefulStopSeconds: 10, retry: { maxAttempts: 0 }, concurrency: { maxInstances: 1, mutexes: [] } },
        platforms: ["windows-x64", "windows-arm64", "macos-arm64", "macos-x64", "linux-x64", "linux-arm64", "wsl-linux-x64"], compatibility: { minAppVersion: "1.0.0" }
      }, null, 2) + "\n");
      fs.writeFileSync(path.join(destination, "openmind.library.json"), JSON.stringify({
        schemaVersion: 1, origin: "preset", presetId: entry.id, category: entry.category,
        requirement: entry.requirement, inputHint: copy.inputHint, capabilityMode: "session"
      }, null, 2) + "\n");
      for (const file of entry.files) {
        if (["SKILL.md", "openmind.skill.yaml", "cctools.skill.yaml", "openmind.library.json"].includes(file)) throw new Error(`Reserved library asset: ${entry.id}/${file}`);
        const assetRoot = path.resolve(configRoot, "assets");
        const skillRoot = path.resolve(assetRoot, entry.id);
        const source = path.join(skillRoot, file);
        const realSource = fs.realpathSync(source);
        if (!realSource.startsWith(`${skillRoot}${path.sep}`) || !fs.statSync(realSource).isFile()) throw new Error(`Invalid library asset: ${entry.id}/${file}`);
        const target = path.join(destination, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(realSource, target);
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

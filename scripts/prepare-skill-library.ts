import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SKILL_LIBRARY_PRESETS } from "../shared/skill-library-catalog";
import { SkillPackageService } from "../electron/skills/skill-package-service";
import { buildAppPaths } from "../electron/paths/app-paths-service";

const root = path.resolve(__dirname, "..");
const source = process.env.OPENMIND_SKILLS_REPO_ROOT || path.resolve(root, "../cctools-skills");
const output = path.join(root, ".build", "skill-library");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-library-build-"));
try {
  const service = new SkillPackageService(buildAppPaths(temporary, path.join(temporary, "skills")));
  fs.mkdirSync(output, { recursive: true });
  const packages: Record<string, string> = {};
  for (const entry of SKILL_LIBRARY_PRESETS) {
    const folder = path.join(source, entry.id);
    if (!fs.existsSync(path.join(folder, "SKILL.md"))) throw new Error(`Missing ${entry.id}. Set OPENMIND_SKILLS_REPO_ROOT to the independent cctools-skills checkout containing the scenario packages.`);
    const inspection = service.inspect(folder);
    if (!inspection.valid) throw new Error(`${entry.id}: ${JSON.stringify(inspection.issues)}`);
    const destination = path.join(output, entry.id);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.cpSync(folder, destination, { recursive: true, filter: file => !["__pycache__", ".DS_Store"].includes(path.basename(file)) });
    if (service.inspect(destination).digest !== inspection.digest) throw new Error(`Bundle copy differs: ${entry.id}`);
    packages[entry.id] = inspection.digest;
  }
  const sourceRevision = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  fs.writeFileSync(path.join(output, "bundle.json"), JSON.stringify({ schemaVersion: 1, sourceRevision, sourceDirty: Boolean(execFileSync("git", ["-C", source, "status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" }).trim()), packages }, null, 2) + "\n");
  process.stdout.write(`Prepared ${Object.keys(packages).length} verified Skill packages.\n`);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }

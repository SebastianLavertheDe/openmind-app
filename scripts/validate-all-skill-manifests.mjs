// Validate every top-level openmind.skill.yaml in the independent Skills
// repository against the frozen SkillManifestSchema. Override the sibling
// checkout with OPENMIND_SKILLS_REPO_ROOT. A desktop-app-only checkout has no
// Skills source tree, so linting is skipped there.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(moduleDir, "..", "..");
const skillsDir = path.resolve(process.env.OPENMIND_SKILLS_REPO_ROOT || path.join(root, "..", "cctools-skills"));

// Minimal YAML→JS: the manifests are a flat-enough subset, but to be correct
// we use the same parser the app uses. Load the compiled schema via tsx-style
// dynamic import of the TS source through a tiny require shim.
// Fallback: use js-yaml if available, else a very small hand parser.
let parseYaml;
try {
  const mod = await import("yaml");
  parseYaml = mod.default.parse;
} catch {
  try {
    const mod = await import("js-yaml");
    parseYaml = mod.load;
  } catch {
    // Use node -e 'require("yaml")' fallback path through the app's node_modules.
    const yamlPath = path.join(moduleDir, "..", "node_modules", "yaml");
    parseYaml = (await import(pathToFileURL(yamlPath).href)).default.parse;
  }
}

// Load the schema module (TS source) via the desktop-app's own tsx loader.
const schemaUrl = pathToFileURL(path.join(moduleDir, "..", "shared", "skill-manifest-schema.ts")).href;
const { validateManifest } = await import(schemaUrl);

if (!fs.existsSync(skillsDir)) {
  console.log(`⊘ Skill manifest lint skipped: independent repository not found at ${skillsDir}`);
  process.exit(0);
}

const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "_shared")
  .map((d) => d.name)
  .sort();

let formal = 0;
let legacy = 0;
const failures = [];

for (const name of entries) {
  const manifestPath = path.join(skillsDir, name, "openmind.skill.yaml");
  if (!fs.existsSync(manifestPath)) {
    legacy += 1;
    console.log(`  • ${name}: LEGACY (no openmind.skill.yaml)`);
    continue;
  }
  const raw = fs.readFileSync(manifestPath, "utf8");
  let doc;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    failures.push({ name, error: `YAML parse error: ${e.message}` });
    continue;
  }
  const result = validateManifest(doc);
  if (result.ok) {
    formal += 1;
    console.log(`  ✓ ${name}: valid ${result.manifest.kind} v${result.manifest.version}`);
  } else {
    const issuePaths = result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    failures.push({ name, error: issuePaths });
  }
}

console.log(`\n${formal} formal / ${legacy} legacy / ${entries.length} total`);

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} invalid manifest(s):`);
  for (const f of failures) {
    console.error(`  ${f.name}:`);
    console.error(`    ${f.error}`);
  }
  process.exit(1);
}
console.log("✓ all formal manifests validate against SkillManifestSchema");

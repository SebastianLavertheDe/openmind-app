// Validate every cctools.skill.yaml under .claude/skills against the frozen
// SkillManifestSchema. Run with: node --experimental-strip-types scripts/validate-all-skill-manifests.mjs
// (or via tsx). Exits non-zero on any invalid manifest.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..", "..");
const skillsDir = path.join(root, ".claude", "skills");

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
    const yamlPath = path.join(import.meta.dirname, "..", "node_modules", "yaml");
    parseYaml = (await import(pathToFileURL(yamlPath).href)).default.parse;
  }
}

// Load the schema module (TS source) via the desktop-app's own tsx loader.
const schemaUrl = pathToFileURL(path.join(import.meta.dirname, "..", "shared", "skill-manifest-schema.ts")).href;
const { validateManifest } = await import(schemaUrl);

const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "_shared")
  .map((d) => d.name)
  .sort();

let formal = 0;
let legacy = 0;
const failures = [];

for (const name of entries) {
  const manifestPath = path.join(skillsDir, name, "cctools.skill.yaml");
  if (!fs.existsSync(manifestPath)) {
    legacy += 1;
    console.log(`  • ${name}: LEGACY (no cctools.skill.yaml)`);
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

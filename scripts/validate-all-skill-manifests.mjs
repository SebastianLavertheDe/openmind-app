// Validate every top-level formal manifest in the independent Skills
// repository against the frozen internal SkillManifestSchema. The public
// cctools.skill.yaml contract is preferred; openmind.skill.yaml remains a
// compatibility fallback. Override the sibling checkout with
// OPENMIND_SKILLS_REPO_ROOT. A standalone app checkout without its sibling
// Skills repository skips this lint.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(moduleDir, "..");
const skillsDir = path.resolve(process.env.OPENMIND_SKILLS_REPO_ROOT || path.join(appRoot, "..", "cctools-skills"));
const primaryManifestFile = "cctools.skill.yaml";
const compatManifestFile = "openmind.skill.yaml";

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
  const packageRoot = path.join(skillsDir, name);
  const primaryManifestPath = path.join(packageRoot, primaryManifestFile);
  const compatManifestPath = path.join(packageRoot, compatManifestFile);
  const hasPrimaryManifest = fs.existsSync(primaryManifestPath);
  const hasCompatManifest = fs.existsSync(compatManifestPath);
  const manifestFile = hasPrimaryManifest ? primaryManifestFile : hasCompatManifest ? compatManifestFile : null;
  if (!manifestFile) {
    legacy += 1;
    console.log(`  • ${name}: LEGACY (no ${primaryManifestFile} or ${compatManifestFile})`);
    continue;
  }
  if (hasPrimaryManifest && hasCompatManifest) {
    console.warn(`  ⚠ ${name}: both manifests found; using ${primaryManifestFile}`);
  }
  const manifestPath = path.join(packageRoot, manifestFile);
  const raw = fs.readFileSync(manifestPath, "utf8");
  let doc;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    failures.push({ name, error: `YAML parse error: ${e.message}` });
    continue;
  }
  const result = validateManifest(normalizeManifestDocument(doc, manifestFile));
  if (result.ok) {
    formal += 1;
    console.log(`  ✓ ${name}: valid ${result.manifest.kind} v${result.manifest.version} (${manifestFile})`);
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

// Mirrors skill-package-service.ts: `cctools.skill.yaml` shares the internal
// vocabulary; only its apiVersion differs, so translate that at the read
// boundary and leave legacy `openmind.skill.yaml` untouched. The old-brand
// `mymind` vocabulary is rejected outright.
function normalizeManifestDocument(value, manifestFile) {
  if (manifestFile !== primaryManifestFile || !isRecord(value)) return value;
  const capabilities = value.capabilities;
  if (value.apiVersion !== "cctools.dev/skill/v1"
    || !isRecord(capabilities)
    || Object.prototype.hasOwnProperty.call(capabilities, "mymind")) {
    return { ...value, apiVersion: "invalid-cctools-manifest-dialect" };
  }
  return { ...value, apiVersion: "openmind.dev/skill/v1" };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

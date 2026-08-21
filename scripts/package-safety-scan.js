const fs = require("fs");
const path = require("path");

let asar;

const root = path.resolve(__dirname, "..");
const cliArgs = parseArgs(process.argv.slice(2));
const reportOutput = path.resolve(cliArgs.output || path.join(root, ".build", "package-safety-report.json"));
const requestedTargets = asPathList(cliArgs.target);
const onlyTargets = asPathList(cliArgs["only-target"]);
const fixedTargets = [
  path.join(root, ".build"),
  path.join(root, "dist", "win-unpacked", "resources", "app.asar"),
  path.join(root, "dist", "win-unpacked", "resources", "app.asar.unpacked")
];
const distRoot = path.join(root, "dist");
const unpackedTargets = fs.existsSync(distRoot)
  ? fs.readdirSync(distRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("-unpacked"))
    .flatMap((entry) => [
      path.join(distRoot, entry.name, "resources", "app.asar"),
      path.join(distRoot, entry.name, "resources", "app.asar.unpacked")
    ])
  : [];
const appBundleTargets = findAppBundleTargets(distRoot);
const targets = [...new Set(onlyTargets.length
  ? onlyTargets
  : [...fixedTargets, ...unpackedTargets, ...appBundleTargets, ...requestedTargets])];
const workspacePathFragments = [
  root,
  path.resolve(root, "renderer"),
  path.resolve(root, "electron")
].flatMap((value) => {
  const normalized = value.toLowerCase();
  return [normalized, normalized.replace(/\\/g, "/"), normalized.replace(/\//g, "\\")];
});

const forbiddenPathFragments = [
  `${path.sep}.env`,
  `${path.sep}.openmind${path.sep}ai${path.sep}sessions`,
  `${path.sep}.openmind${path.sep}ai${path.sep}.runtime`,
  `${path.sep}provider-state`,
  `${path.sep}openmind${path.sep}article`,
  `${path.sep}openmind${path.sep}post`,
  `${path.sep}openmind${path.sep}reddit`,
  `${path.sep}openmind${path.sep}daily-summary`
].map((fragment) => fragment.toLowerCase());

// Flat content-root layout (audited 2026-08-21): content dirs sit directly
// under the selected root, so leaked content no longer carries an `openmind/`
// prefix. Single-segment names are too generic for bundled dependency trees
// (node_modules / python-runtime legitimately contain config/ or scripts/
// subtrees), so these fragments only apply outside those trees. Directory
// fragments carry a trailing separator to avoid prefix collisions.
const flatContentPathFragments = [
  `${path.sep}article${path.sep}`,
  `${path.sep}post${path.sep}`,
  `${path.sep}reddit${path.sep}`,
  `${path.sep}daily-summary${path.sep}`,
  `${path.sep}daily-topic${path.sep}`,
  `${path.sep}creative${path.sep}`,
  `${path.sep}wiki${path.sep}`,
  `${path.sep}assets${path.sep}`,
  `${path.sep}config${path.sep}providers.yaml`,
  `${path.sep}.agent${path.sep}`,
  `${path.sep}.openmind${path.sep}`
].map((fragment) => fragment.toLowerCase());

/**
 * Trees where flat single-segment names are the app's own output or vendored
 * dependencies (`.build/renderer/assets/` is Vite output; node_modules and the
 * bundled python-runtime legitimately contain config/ or scripts/ subtrees).
 * Flat content fragments only apply outside these trees — a real content leak
 * lands under `dist/<plat>-unpacked/resources/` via extraResources/files.
 */
function insideBundledOrBuildTree(filePath) {
  const segments = filePath.toLowerCase().split(path.sep);
  return segments.includes(".build") || segments.includes("node_modules") || segments.includes("python-runtime");
}

const secretPatterns = [
  // Match an actual PEM payload, not a dependency's format validator or
  // redaction regex that merely contains the BEGIN header as source text.
  { label: "private key block", pattern: /-----BEGIN [A-Z0-9 _-]*PRIVATE KEY-----\r?\n(?:[A-Za-z0-9+/=]{40,}\r?\n)+-----END [A-Z0-9 _-]*PRIVATE KEY-----/ },
  { label: "OpenAI-style API key", pattern: /\bsk-[A-Za-z0-9_-]{24,}\b/ },
  { label: "NVIDIA API key", pattern: /\bnvapi-[A-Za-z0-9_-]{20,}\b/ },
  { label: "Notion secret", pattern: /\bsecret_[A-Za-z0-9]{20,}\b/ },
  { label: "cookie header", pattern: /\b(cookie|set-cookie)\s*[:=]\s*[^;\n]{20,}/i, textOnly: true }
];

const prohibitedDiagnosticPatterns = [
  { label: "Electron crash reporter", pattern: /\bcrashReporter\b/i },
  { label: "Node diagnostic report", pattern: /\bprocess\.(?:report|crash)\b/i },
  { label: "heap/core dump", pattern: /\b(?:heapdump|heap[_ -]?dump|core[_ -]?dump|full[_ -]?memory[_ -]?dump)\b/i },
  { label: "Node diagnostic flag", pattern: /--(?:report-on-fatalerror|report-uncaught-exception|report-on-signal|diagnostic-dir|heapsnapshot-signal|heapsnapshot-near-heap-limit|abort-on-uncaught-exception)\b/i },
  { label: "crash upload flag", pattern: /\b(?:uploadToServer\s*:\s*true|CRASH[_-]?REPORTER|DIAGNOSTIC[_-]?REPORT|HEAPDUMP|CORE[_-]?DUMP|FULL[_-]?MEMORY[_-]?DUMP)\b/i },
  { label: "third-party crash credential", pattern: /\b(?:SENTRY|BUGSNAG|ROLLBAR)[A-Z_]*(?:DSN|TOKEN|KEY|URL)\b/i }
];
const diagnosticCodeExtensions = new Set([
  ".cjs", ".cmd", ".js", ".jsx", ".json", ".mjs", ".ps1", ".sh", ".ts", ".tsx", ".yml", ".yaml"
]);

const findings = [];
let scannedFiles = 0;

for (const target of targets) {
  if (!fs.existsSync(target)) continue;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) walk(target);
  else scanFile(target);
}

if (findings.length) {
  writeReport("failed");
  throw new Error(`Package safety scan failed:\n${findings.map((item) => `- ${item}`).join("\n")}`);
}

writeReport("passed");
console.log(`Package safety scan passed: ${scannedFiles} built/package files checked.`);

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile()) scanFile(file);
  }
}

function findAppBundleTargets(directory, depth = 0) {
  if (!fs.existsSync(directory) || depth > 2) return [];
  const targets = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(directory, entry.name);
    if (entry.name.endsWith(".app")) {
      targets.push(
        path.join(child, "Contents", "Resources", "app.asar"),
        path.join(child, "Contents", "Resources", "app.asar.unpacked")
      );
      continue;
    }
    targets.push(...findAppBundleTargets(child, depth + 1));
  }
  return targets;
}

function scanFile(file) {
  if (isGeneratedEvidenceFile(file)) return;
  scannedFiles += 1;
  if (path.basename(file).toLowerCase() === "app.asar") {
    scanAsar(file);
    return;
  }
  const normalized = file.toLowerCase();
  for (const fragment of forbiddenPathFragments) {
    if (normalized.includes(fragment)) findings.push(`forbidden package path: ${path.relative(root, file)}`);
  }
  if (!insideBundledOrBuildTree(file)) {
    for (const fragment of flatContentPathFragments) {
      if (normalized.includes(fragment)) findings.push(`forbidden package path: ${path.relative(root, file)}`);
    }
  }

  const relative = path.relative(root, file);
  if (/(^|[\\/])[^\\/]+\.(?:test|spec)\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(relative) || relative.split(/[\\/]/).includes("__tests__")) {
    findings.push(`development test artifact: ${relative}`);
  }

  const ext = path.extname(file).toLowerCase();
  if ([".exe", ".dll", ".pak", ".bin", ".dat", ".png", ".jpg", ".jpeg", ".ico", ".zip", ".7z", ".blockmap"].includes(ext)) return;
  const stat = fs.statSync(file);
  if (stat.size > 30 * 1024 * 1024 && path.basename(file) !== "app.asar") return;
  const text = fs.readFileSync(file, "utf8");
  for (const fragment of workspacePathFragments) {
    if (text.toLowerCase().includes(fragment)) {
      findings.push(`absolute workspace path in package: ${relative}`);
      break;
    }
  }
  for (const secret of secretPatterns) {
    if (secret.textOnly && !isTextConfigFile(file)) continue;
    if (secret.pattern.test(text)) findings.push(`${secret.label} pattern in ${path.relative(root, file)}`);
  }
  scanDiagnosticText(file, text);
}

function isGeneratedEvidenceFile(file) {
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  return /^\.build\/(?:[^/]+\.json|release-evidence\/[^/]+\.json)$/i.test(relative);
}

function scanAsar(file) {
  asar ||= loadAsar();
  const entries = asar.listPackage(file);
  for (const entry of entries) {
    const archivePath = entry.replace(/^\/+/, "");
    if (!archivePath || (!archivePath.startsWith(".build/") && archivePath !== "package.json")) continue;

    const stat = asar.statFile(file, archivePath);
    if (!stat || stat.files || stat.link) continue;

    const sourceName = `${path.relative(root, file)}:${archivePath}`;
    scannedFiles += 1;
    scanArchivePath(sourceName, archivePath);

    const extension = path.posix.extname(archivePath).toLowerCase();
    if ([".exe", ".dll", ".pak", ".bin", ".dat", ".png", ".jpg", ".jpeg", ".ico", ".zip", ".7z", ".blockmap"].includes(extension)) continue;
    if (stat.size > 30 * 1024 * 1024) continue;

    const text = asar.extractFile(file, archivePath).toString("utf8");
    scanText(sourceName, text, isTextConfigExtension(extension));
  }
}

function scanArchivePath(sourceName, archivePath) {
  const normalized = archivePath.toLowerCase().replace(/\\/g, "/");
  // Flat content fragments are enforced on the real unpacked paths only: the
  // asar contains just `.build/` + package.json, where `assets/` is Vite output.
  for (const fragment of forbiddenPathFragments.map((item) => item.replace(/\\/g, "/"))) {
    if (normalized.includes(fragment)) findings.push(`forbidden package path: ${sourceName}`);
  }
  if (/(^|[\\/])[^\\/]+\.(?:test|spec)\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(archivePath) || archivePath.split(/[\\/]/).includes("__tests__")) {
    findings.push(`development test artifact: ${sourceName}`);
  }
}

function scanText(sourceName, text, textOnly) {
  for (const fragment of workspacePathFragments) {
    if (text.toLowerCase().includes(fragment)) {
      findings.push(`absolute workspace path in package: ${sourceName}`);
      break;
    }
  }
  for (const secret of secretPatterns) {
    if (secret.textOnly && !textOnly) continue;
    if (secret.pattern.test(text)) findings.push(`${secret.label} pattern in ${sourceName}`);
  }
  scanDiagnosticText(sourceName, text);
}

function scanDiagnosticText(sourceName, text) {
  if (!diagnosticCodeExtensions.has(path.extname(sourceName.split(":").at(-1) || sourceName).toLowerCase())) return;
  for (const diagnostic of prohibitedDiagnosticPatterns) {
    if (diagnostic.pattern.test(text)) findings.push(`${diagnostic.label} pattern in ${sourceName}`);
  }
}

function loadAsar() {
  try {
    return require("@electron/asar");
  } catch (error) {
    throw new Error(`ASAR package scanner is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isTextConfigExtension(extension) {
  return [".env", ".json", ".log", ".txt", ".md", ".yaml", ".yml"].includes(extension);
}

function isTextConfigFile(file) {
  return [".env", ".json", ".log", ".txt", ".md", ".yaml", ".yml"].includes(path.extname(file).toLowerCase());
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=", 2);
    const nextValue = inline ?? values[++index];
    if (parsed[key] === undefined) parsed[key] = nextValue;
    else parsed[key] = [...asValueList(parsed[key]), nextValue];
  }
  return parsed;
}

function asValueList(value) {
  return Array.isArray(value) ? value : [value];
}

function asPathList(value) {
  return asValueList(value || [])
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => path.resolve(item));
}

function writeReport(status) {
  fs.mkdirSync(path.dirname(reportOutput), { recursive: true });
  fs.writeFileSync(reportOutput, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    kind: "openmind-package-safety-evidence",
    status,
    scannedFiles,
    targets: targets.filter((target) => fs.existsSync(target)).map((target) => path.relative(root, target).replaceAll(path.sep, "/")),
    findings
  }, null, 2)}\n`, "utf8");
}

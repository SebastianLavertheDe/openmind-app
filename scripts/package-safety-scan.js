const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const targets = [
  path.join(root, ".build"),
  path.join(root, "dist", "win-unpacked", "resources", "app.asar"),
  path.join(root, "dist", "win-unpacked", "resources", "app.asar.unpacked")
];

const forbiddenPathFragments = [
  `${path.sep}.env`,
  `${path.sep}.cctools${path.sep}ai${path.sep}sessions`,
  `${path.sep}.cctools${path.sep}ai${path.sep}.runtime`,
  `${path.sep}provider-state`,
  `${path.sep}mymind${path.sep}article`,
  `${path.sep}mymind${path.sep}post`,
  `${path.sep}mymind${path.sep}reddit`,
  `${path.sep}mymind${path.sep}daily-summary`
].map((fragment) => fragment.toLowerCase());

const secretPatterns = [
  { label: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "OpenAI-style API key", pattern: /\bsk-[A-Za-z0-9_-]{24,}\b/ },
  { label: "NVIDIA API key", pattern: /\bnvapi-[A-Za-z0-9_-]{20,}\b/ },
  { label: "Notion secret", pattern: /\bsecret_[A-Za-z0-9]{20,}\b/ },
  { label: "cookie header", pattern: /\b(cookie|set-cookie)\s*[:=]\s*[^;\n]{20,}/i, textOnly: true }
];

const findings = [];
let scannedFiles = 0;

for (const target of targets) {
  if (!fs.existsSync(target)) continue;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) walk(target);
  else scanFile(target);
}

if (findings.length) {
  throw new Error(`Package safety scan failed:\n${findings.map((item) => `- ${item}`).join("\n")}`);
}

console.log(`Package safety scan passed: ${scannedFiles} built/package files checked.`);

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile()) scanFile(file);
  }
}

function scanFile(file) {
  scannedFiles += 1;
  const normalized = file.toLowerCase();
  for (const fragment of forbiddenPathFragments) {
    if (normalized.includes(fragment)) findings.push(`forbidden package path: ${path.relative(root, file)}`);
  }

  const ext = path.extname(file).toLowerCase();
  if ([".exe", ".dll", ".pak", ".bin", ".dat", ".png", ".jpg", ".jpeg", ".ico", ".zip", ".blockmap"].includes(ext)) return;
  const stat = fs.statSync(file);
  if (stat.size > 30 * 1024 * 1024 && path.basename(file) !== "app.asar") return;
  const text = fs.readFileSync(file, "utf8");
  for (const secret of secretPatterns) {
    if (secret.textOnly && !isTextConfigFile(file)) continue;
    if (secret.pattern.test(text)) findings.push(`${secret.label} pattern in ${path.relative(root, file)}`);
  }
}

function isTextConfigFile(file) {
  return [".env", ".json", ".log", ".txt", ".md", ".yaml", ".yml"].includes(path.extname(file).toLowerCase());
}

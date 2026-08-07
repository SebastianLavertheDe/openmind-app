const fs = require("fs");
const os = require("os");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(appRoot, ".build");
const matrixModulePath = path.resolve(process.env.CCTOOLS_CLEAN_MACHINE_MATRIX_FILE || path.join(buildRoot, "electron", "electron", "paths", "clean-machine-smoke.js"));
const evidencePath = path.resolve(process.env.CCTOOLS_CLEAN_MACHINE_EVIDENCE_FILE || path.join(appRoot, "docs", "CLEAN_MACHINE_EVIDENCE.md"));
const reportOutput = path.resolve(process.env.CCTOOLS_CLEAN_MACHINE_OUTPUT || path.join(buildRoot, "clean-machine-report.json"));
const strict = process.env.CCTOOLS_CLEAN_MACHINE_STRICT === "1";
const REQUIRED_EVIDENCE_FIELDS = ["date", "os", "build", "package", "sha256", "preconditions", "outcome", "evidence"];
const VALID_STATUS = new Set(["pending", "blocked", "passed"]);

if (!fs.existsSync(matrixModulePath)) throw new Error("Compiled clean-machine matrix is missing. Run npm run build first.");
const { CLEAN_MACHINE_MATRIX: matrix } = require(matrixModulePath);
const evidence = fs.readFileSync(evidencePath, "utf8");
const declaredStatus = readMarker() || "pending";
const parsedRows = parseRows();
const rows = parsedRows.rows;
if (parsedRows.duplicateScenarioIds.length) {
  throw new Error(`Clean-machine evidence contains duplicate scenario ID(s): ${parsedRows.duplicateScenarioIds.join(", ")}.`);
}
const matrixIds = new Set(matrix.map((scenario) => scenario.id));
const unknownScenarioIds = [...rows.keys()].filter((id) => !matrixIds.has(id));
if (unknownScenarioIds.length) throw new Error(`Clean-machine evidence contains unknown scenario ID(s): ${unknownScenarioIds.join(", ")}.`);
const scenarios = matrix.map((scenario) => {
  const row = rows.get(scenario.id);
  const status = row?.status || "pending";
  const hasEvidence = Boolean(row?.evidence && row.evidence.trim());
  const evidenceFields = parseEvidenceFields(row?.evidence || "");
  const missingEvidenceFields = [
    ...requiredEvidenceFields(scenario, evidenceFields),
    ...duplicateEvidenceFieldKeys(row?.evidence || "").map((key) => `duplicate(${key})`)
  ];
  const hasConcreteEvidence = hasEvidence && missingEvidenceFields.length === 0;
  return {
    ...scenario,
    status,
    validStatus: VALID_STATUS.has(status),
    hasEvidence,
    hasConcreteEvidence,
    evidence: row?.evidence || null,
    evidenceFields,
    missingEvidenceFields: [...new Set(missingEvidenceFields)]
  };
});
const missing = scenarios.filter((scenario) => scenario.status !== "passed" || !scenario.hasConcreteEvidence);
const passedCount = scenarios.length - missing.length;
const complete = declaredStatus === "complete" && missing.length === 0;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  kind: "cctools-clean-machine-evidence",
  strict,
  status: complete ? "complete" : "manual-required",
  declaredStatus,
  host: { platform: process.platform, arch: process.arch, node: process.version, os: os.release() },
  matrixScenarioCount: scenarios.length,
  passedCount,
  pendingCount: missing.filter((scenario) => scenario.status === "pending").length,
  blockedCount: missing.filter((scenario) => scenario.status === "blocked").length,
  scenarios,
  excludedPlatforms: ["linux", "wsl"]
};

fs.mkdirSync(buildRoot, { recursive: true });
fs.writeFileSync(reportOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (strict && !complete) {
  throw new Error(`Clean-machine Matrix is not complete: ${missing.length} scenario(s) lack passed evidence.`);
}

console.log(`Clean-machine report written: ${report.status} (${passedCount}/${scenarios.length} scenarios passed).`);

function readMarker() {
  const match = evidence.match(/<!--\s*cctools-clean-machine-status:\s*([^>]*)-->/i);
  return match ? match[1].trim().toLowerCase() : "";
}

function parseRows() {
  const result = new Map();
  const duplicateScenarioIds = [];
  for (const line of evidence.split(/\r?\n/)) {
    if (!/^\|\s*[a-z0-9-]+\s*\|/i.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (!cells[0] || cells[0].toLowerCase() === "scenario id" || /^-+$/.test(cells[0])) continue;
    if (result.has(cells[0])) duplicateScenarioIds.push(cells[0]);
    result.set(cells[0], { status: (cells[1] || "pending").toLowerCase(), evidence: cells[2] || "" });
  }
  return { rows: result, duplicateScenarioIds: [...new Set(duplicateScenarioIds)] };
}

function parseEvidenceFields(value) {
  const fields = {};
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim().toLowerCase();
    const fieldValue = part.slice(separator + 1).trim();
    if (key && fieldValue) fields[key] = fieldValue;
  }
  return fields;
}

function requiredEvidenceFields(scenario, fields) {
  const missing = REQUIRED_EVIDENCE_FIELDS.filter((field) => !fields[field]);
  if (fields.date && !isValidIsoDate(fields.date)) missing.push("date(YYYY-MM-DD)");
  if (fields.sha256 && !/^[a-f0-9]{64}$/i.test(fields.sha256)) missing.push("sha256(64 hex)");
  if (fields.outcome && fields.outcome.toLowerCase() !== "passed") missing.push("outcome=passed");
  if (fields.os && !matchesScenarioPlatform(scenario, fields.os)) missing.push("os(platform)");
  if (fields.package && !matchesScenarioPackage(scenario, fields.package)) missing.push("package(target artifact)");
  if (fields.evidence && !isConcreteEvidenceReference(fields.evidence)) missing.push("evidence(concrete path or URL)");
  if (scenario.environment === "no-python-uv-node-git-ffmpeg"
    && fields.preconditions
    && !fields.preconditions.toLowerCase().includes("no-python-uv-node-git-ffmpeg")) {
    missing.push("preconditions(no-python-uv-node-git-ffmpeg)");
  }
  return [...new Set(missing)];
}

function matchesScenarioPlatform(scenario, osValue) {
  const value = osValue.toLowerCase();
  if (scenario.platform.startsWith("windows")) {
    return /windows|win(?:dows)?\s*\d|win11/i.test(value) && /x64|amd64/i.test(value);
  }
  if (scenario.platform.startsWith("macos-applesilicon")) {
    return /macos|mac\s*os|darwin/i.test(value) && /arm64|aarch64|apple[ -]?silicon/i.test(value);
  }
  if (scenario.platform.startsWith("macos-intel")) {
    return /macos|mac\s*os|darwin/i.test(value) && /x86_?64|x64|intel/i.test(value);
  }
  return false;
}

function matchesScenarioPackage(scenario, packageValue) {
  const value = packageValue.toLowerCase();
  if (scenario.platform.startsWith("windows")) {
    return /\.(?:exe|zip)$/i.test(value)
      && /win|windows|portable|setup|nsis/i.test(value)
      && /x64|amd64/i.test(value);
  }
  if (scenario.platform.startsWith("macos-applesilicon")) {
    return /\.(?:dmg|zip)$/i.test(value)
      && (value.endsWith(".dmg") || /mac|macos|darwin/i.test(value))
      && /arm64|aarch64|apple[ -]?silicon/i.test(value);
  }
  if (scenario.platform.startsWith("macos-intel")) {
    return /\.(?:dmg|zip)$/i.test(value)
      && (value.endsWith(".dmg") || /mac|macos|darwin/i.test(value))
      && /x86_?64|x64|intel/i.test(value);
  }
  return false;
}

function duplicateEvidenceFieldKeys(value) {
  const seen = new Set();
  const duplicates = new Set();
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}

function isValidIsoDate(value) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function isConcreteEvidenceReference(value) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || /^(?:pending|todo|tbd|n\/a|none|placeholder)$/.test(normalized)) return false;
  if (/^(?:https?|s3|artifact):\/\//.test(normalized)) return true;
  if (!normalized.includes("/") && !normalized.includes("\\")) return false;
  const candidate = path.isAbsolute(value) ? value : path.resolve(appRoot, value);
  return fs.existsSync(candidate);
}

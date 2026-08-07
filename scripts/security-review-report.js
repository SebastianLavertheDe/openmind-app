const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(appRoot, ".build");
const reviewPath = path.resolve(process.env.CCTOOLS_SECURITY_REVIEW_FILE || path.join(appRoot, "docs", "SECURITY_REVIEW.md"));
const reportOutput = path.resolve(process.env.CCTOOLS_SECURITY_REVIEW_OUTPUT || path.join(buildRoot, "security-review-report.json"));
const review = fs.readFileSync(reviewPath, "utf8");
const strict = process.env.CCTOOLS_SECURITY_REVIEW_STRICT === "1";
const REQUIRED_FINDING_PRIORITIES = new Map([
  ["SEC-001", "P1"],
  ["SEC-002", "P1"],
  ["SEC-003", "P1"],
  ["SEC-004", "P1"],
  ["SEC-005", "P1"]
]);
const REQUIRED_EXTERNAL_EVIDENCE_KEYS = new Map([
  ["SEC-001", ["deployment-audit", "diagnostic-audit"]],
  ["SEC-004", ["packaged-evidence", "clean-machine-evidence", "recovery-evidence"]],
  ["SEC-005", ["deployment-audit", "diagnostic-audit"]]
]);
const EVIDENCE_REFERENCE_PATTERN = /(?:https?:\/\/\S+|(?:\.build|dist|artifacts?|evidence|logs?|screenshots?|docs)[/\\][^\s|,;]+|\b(?:artifact|evidence|report|log|screenshot|build|sha256|deployment-audit|diagnostic-audit|packaged-evidence|clean-machine-evidence|recovery-evidence)\s*[:=]\s*[^\s|,;]+)/i;
const status = readMarker("status") || "pending";
const reviewer = readMarker("reviewer");
const reviewedAt = readMarker("reviewed-at");
const independence = readMarker("independence");
const findings = parseFindings();
const openP0P1 = findings.filter((finding) => ["P0", "P1"].includes(finding.priority) && (
  finding.status !== "closed"
  || !finding.notes.trim()
  || !finding.evidenceReference
));
const missingEvidenceReference = findings
  .filter((finding) => ["P0", "P1"].includes(finding.priority) && finding.status === "closed" && !finding.evidenceReference)
  .map((finding) => finding.id);
const findingIds = findings.map((finding) => finding.id);
const missingRequiredFindings = [...REQUIRED_FINDING_PRIORITIES.keys()].filter((id) => !findingIds.includes(id));
const duplicateFindingIds = [...new Set(findingIds.filter((id, index) => findingIds.indexOf(id) !== index))];
const unexpectedFindingIds = [...new Set(findingIds.filter((id) => !REQUIRED_FINDING_PRIORITIES.has(id)))];
const invalidRequiredPriorities = findings
  .filter((finding) => REQUIRED_FINDING_PRIORITIES.has(finding.id) && finding.priority !== REQUIRED_FINDING_PRIORITIES.get(finding.id))
  .map((finding) => `${finding.id}:${finding.priority || "missing"}`);
const missingRequiredExternalEvidence = findings
  .filter((finding) => finding.status === "closed" && REQUIRED_EXTERNAL_EVIDENCE_KEYS.has(finding.id))
  .filter((finding) => !finding.externalEvidenceReference)
  .map((finding) => finding.id);
const reviewerComplete = Boolean(
  reviewer
  && reviewedAt
  && !isPlaceholder(reviewer)
  && !isPlaceholder(reviewedAt)
  && isValidReviewDate(reviewedAt)
  && /^(?:independent|external)$/i.test(independence)
);
const complete = status === "complete"
  && reviewerComplete
  && openP0P1.length === 0
  && missingRequiredFindings.length === 0
  && duplicateFindingIds.length === 0
  && unexpectedFindingIds.length === 0
  && missingRequiredExternalEvidence.length === 0
  && invalidRequiredPriorities.length === 0;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  review: path.relative(appRoot, reviewPath),
  strict,
  status: complete ? "complete" : "manual-required",
  declaredStatus: status,
  reviewer: reviewer || null,
  reviewedAt: reviewedAt || null,
  independence: independence || null,
  reviewerComplete,
  findingCount: findings.length,
  openP0P1,
  missingEvidenceReference,
  missingRequiredFindings,
  duplicateFindingIds,
  unexpectedFindingIds,
  missingRequiredExternalEvidence,
  invalidRequiredPriorities,
  supportingLocalEvidence: {
    auditEvidence: fs.existsSync(path.join(buildRoot, "audit-evidence.json")),
    packageSafetyCommand: "npm run package:safety",
    recoveryDrillCommand: "npm run recovery:drill"
  }
};

fs.mkdirSync(buildRoot, { recursive: true });
fs.writeFileSync(reportOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (strict && !complete) {
  throw new Error(`Security Review is not complete: ${openP0P1.length} open P0/P1 findings (${missingEvidenceReference.length} closed finding(s) without a concrete evidence reference), ${missingRequiredExternalEvidence.length} closed finding(s) without required external-audit evidence, ${missingRequiredFindings.length} missing required findings, ${duplicateFindingIds.length} duplicate finding IDs, ${unexpectedFindingIds.length} unexpected finding IDs, reviewerComplete=${reviewerComplete}, declaredStatus=${status}, invalidPriorities=${invalidRequiredPriorities.length}.`);
}

console.log(`Security Review report written: ${report.status}${openP0P1.length ? ` (${openP0P1.length} open P0/P1 findings)` : ""}.`);

function readMarker(name) {
  const markerNames = {
    status: "cctools-security-review-status",
    reviewer: "cctools-security-reviewer",
    "reviewed-at": "cctools-security-reviewed-at",
    independence: "cctools-security-review-independence"
  };
  const markerName = markerNames[name] || `cctools-security-review-${name}`;
  const match = review.match(new RegExp(`<!--\\s*${markerName}:\\s*([^>]*)-->`, "i"));
  return match ? match[1].trim() : "";
}

function parseFindings() {
  return review.split(/\r?\n/)
    .filter((line) => /^\|\s*SEC-\d+\s*\|/i.test(line))
    .map((line) => {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      return {
        id: cells[0] || "unknown",
        priority: (cells[1] || "").toUpperCase(),
        status: (cells[3] || "pending").toLowerCase(),
        notes: cells[4] || "",
        evidenceReference: evidenceReference(cells[4] || ""),
        externalEvidenceReference: externalEvidenceReference(cells[4] || "")
      };
    });
}

function evidenceReference(notes) {
  const match = notes.match(EVIDENCE_REFERENCE_PATTERN);
  return match && isConcreteEvidenceReference(match[0]) ? match[0] : null;
}

function externalEvidenceReference(notes) {
  const keys = [...REQUIRED_EXTERNAL_EVIDENCE_KEYS.values()].flat();
  const keyPattern = new RegExp(`\\b(${keys.join("|")})\\s*[:=]\\s*([^\\s|,;]+)`, "i");
  const match = notes.match(keyPattern);
  if (!match || !isConcreteEvidenceValue(match[2])) return null;
  return `${match[1]}=${match[2]}`;
}

function isConcreteEvidenceReference(reference) {
  const tokenMatch = reference.match(/(?:artifact|evidence|report|log|screenshot|build|sha256|deployment-audit|diagnostic-audit|packaged-evidence|clean-machine-evidence|recovery-evidence)\s*[:=]\s*([^\s|,;]+)/i);
  return isConcreteEvidenceValue(tokenMatch ? tokenMatch[1] : reference);
}

function isConcreteEvidenceValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || /^(?:pending|todo|tbd|n\/a|none|placeholder|unknown|<.*>)$/.test(normalized)) return false;
  if (/^(?:https?|s3|artifact):\/\//.test(normalized)) return true;
  if (normalized.includes("/") || normalized.includes("\\")) {
    const candidate = path.isAbsolute(value) ? value : path.resolve(appRoot, value);
    return fs.existsSync(candidate);
  }
  return /^[a-z0-9._-]{8,}$/i.test(normalized);
}

function isPlaceholder(value) {
  return !value || /^\s*(todo|tbd|pending|yyyy-mm-dd|<.*>)\s*$/i.test(value);
}

function isValidReviewDate(value) {
  const datePart = String(value).slice(0, 10);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(datePart)) return false;
  const [year, month, day] = datePart.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

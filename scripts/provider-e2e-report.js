const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(appRoot, ".build");
const checklistPath = path.resolve(process.env.CCTOOLS_PROVIDER_E2E_CHECKLIST_FILE || path.join(appRoot, "docs", "PROVIDER_E2E_CHECKLIST.md"));
const reportOutput = path.resolve(process.env.CCTOOLS_PROVIDER_E2E_OUTPUT || path.join(buildRoot, "provider-e2e-report.json"));
const checklist = fs.readFileSync(checklistPath, "utf8");
const strict = process.env.CCTOOLS_PROVIDER_E2E_STRICT === "1";
const parsed = parseChecklist(checklist);
const incompleteCount = parsed.cells.filter((cell) => cell.status !== "passed" || !cell.evidenceComplete).length;
const pendingCount = parsed.cells.filter((cell) => cell.status === "pending").length;
const report = {
  generatedAt: new Date().toISOString(),
  checklist: path.relative(appRoot, checklistPath),
  rowCount: parsed.rows.length,
  cellCount: parsed.cells.length,
  pendingCount,
  incompleteCount,
  invalidRows: parsed.invalidRows,
  duplicateCases: parsed.duplicateCases,
  invalidEvidenceRows: parsed.invalidEvidenceRows,
  strict,
  status: incompleteCount || parsed.invalidRows.length || parsed.duplicateCases.length || parsed.invalidEvidenceRows.length
    ? "manual-required"
    : "complete"
};

fs.mkdirSync(buildRoot, { recursive: true });
fs.writeFileSync(reportOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (strict && report.status !== "complete") {
  throw new Error(`Provider E2E checklist is incomplete: ${incompleteCount} cell(s), ${parsed.invalidRows.length} invalid row(s), ${parsed.duplicateCases.length} duplicate case(s), ${parsed.invalidEvidenceRows.length} row(s) with incomplete evidence. Fill every passed row with date, package filename, project path and a concrete evidence reference first.`);
}

console.log(`Provider E2E report written: ${report.status}${incompleteCount ? ` (${incompleteCount} incomplete cells)` : ""}.`);

function parseChecklist(source) {
  const rows = [];
  const cells = [];
  const invalidRows = [];
  const invalidEvidenceRows = [];
  const duplicateCases = [];
  const seenCases = new Set();
  const validStatuses = new Set(["pending", "blocked", "passed"]);
  let section = "unsectioned";
  for (const line of source.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    if (!/^\|/.test(line)) continue;
    const columns = line.split("|").slice(1, -1).map((column) => column.trim());
    if (columns.length < 4 || columns[0].toLowerCase() === "case" || columns.every((column) => /^:?-{3,}:?$/.test(column))) continue;
    const [caseName, windowsStatus, wslStatus, evidence] = columns;
    if (!caseName || !windowsStatus || !wslStatus) continue;
    const caseKey = `${section}::${caseName}`;
    if (seenCases.has(caseKey)) duplicateCases.push(caseKey);
    seenCases.add(caseKey);
    const evidenceFields = parseEvidenceFields(evidence);
    const duplicateEvidenceFields = duplicateEvidenceFieldKeys(evidence);
    const missingEvidenceFields = [...new Set([
      ...requiredEvidenceFields(evidenceFields),
      ...duplicateEvidenceFields.map((key) => `duplicate(${key})`)
    ])];
    const evidenceComplete = missingEvidenceFields.length === 0;
    const row = { section, caseName, evidence, evidenceFields, duplicateEvidenceFields, missingEvidenceFields, evidenceComplete };
    rows.push(row);
    for (const [platform, status] of [["windows-native", windowsStatus], ["wsl", wslStatus]]) {
      cells.push({
        section,
        caseName,
        platform,
        status: status.toLowerCase(),
        evidence: evidence.trim(),
        evidenceComplete
      });
    }
    if (columns.length !== 4) invalidRows.push(`${caseName}: expected 4 columns`);
    for (const [platform, status] of [["windows-native", windowsStatus], ["wsl", wslStatus]]) {
      if (!validStatuses.has(status.toLowerCase())) invalidRows.push(`${caseName}/${platform}: invalid status ${status}`);
    }
    if ((windowsStatus.toLowerCase() === "passed" || wslStatus.toLowerCase() === "passed") && !evidenceComplete) {
      invalidEvidenceRows.push({ caseName, section, missingEvidenceFields });
    }
  }
  if (!rows.length) invalidRows.push("no Provider E2E table rows found");
  return { rows, cells, invalidRows, invalidEvidenceRows, duplicateCases: [...new Set(duplicateCases)] };
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

function requiredEvidenceFields(fields) {
  const missing = [];
  for (const field of ["date", "package", "project", "evidence"]) {
    if (!fields[field]) missing.push(field);
  }
  if (fields.date && !isValidIsoDate(fields.date)) missing.push("date(YYYY-MM-DD)");
  if (fields.package && !isConcretePackage(fields.package)) missing.push("package(filename)");
  if (fields.project && !isConcreteProject(fields.project)) missing.push("project(path)");
  if (fields.evidence && !isConcreteEvidenceReference(fields.evidence)) missing.push("evidence(concrete path or URL)");
  return [...new Set(missing)];
}

function isConcretePackage(value) {
  const normalized = value.trim().toLowerCase();
  return !isPlaceholder(normalized) && /\.(?:exe|zip|dmg|app|msi|pkg)$/i.test(normalized);
}

function isConcreteProject(value) {
  const normalized = value.trim().toLowerCase();
  return !isPlaceholder(normalized) && (normalized.includes("/") || normalized.includes("\\"));
}

function isConcreteEvidenceReference(value) {
  const normalized = value.trim().toLowerCase();
  if (isPlaceholder(normalized)) return false;
  if (/^(?:https?|s3|artifact):\/\//.test(normalized)) return true;
  if (normalized.includes("/") || normalized.includes("\\")) return true;
  return /^[a-z0-9._-]{8,}$/i.test(normalized);
}

function isPlaceholder(value) {
  return !value || /^(?:pending|todo|tbd|n\/a|none|placeholder|unknown|done|ok|pass|passed|<.*>)$/i.test(value.trim());
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

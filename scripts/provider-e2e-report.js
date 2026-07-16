const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(appRoot, ".build");
const checklistPath = path.join(appRoot, "docs", "PROVIDER_E2E_CHECKLIST.md");
const checklist = fs.readFileSync(checklistPath, "utf8");
const pendingCount = (checklist.match(/\bpending\b/g) || []).length;
const strict = process.env.CCTOOLS_PROVIDER_E2E_STRICT === "1";
const report = {
  generatedAt: new Date().toISOString(),
  checklist: path.relative(appRoot, checklistPath),
  pendingCount,
  strict,
  status: pendingCount ? "manual-required" : "complete"
};

fs.mkdirSync(buildRoot, { recursive: true });
fs.writeFileSync(path.join(buildRoot, "provider-e2e-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (strict && pendingCount) {
  throw new Error(`Provider E2E checklist still has ${pendingCount} pending cells. Fill docs/PROVIDER_E2E_CHECKLIST.md with dated evidence first.`);
}

console.log(`Provider E2E report written: ${report.status}${pendingCount ? ` (${pendingCount} pending cells)` : ""}.`);

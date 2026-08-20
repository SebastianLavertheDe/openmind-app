const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const platform = args.platform;
const distRoot = path.resolve(args.dist || path.join(appRoot, "dist"));
const output = path.resolve(args.output || path.join(distRoot, `package-evidence-${platform || "unknown"}.json`));
const safetyReportPath = path.resolve(args["safety-report"] || path.join(appRoot, ".build", "package-safety-report.json"));
const artifactSafetyReportPath = path.resolve(args["artifact-safety-report"] || path.join(appRoot, ".build", "package-artifact-safety-report.json"));
const packagedRecoveryReportPath = path.resolve(args["packaged-recovery-report"] || path.join(appRoot, ".build", "packaged-recovery-report.json"));
const requireSafety = args["require-safety"] === "true" || args["require-safety"] === "1";
const requireArtifactSafety = args["require-artifact-safety"] === "true" || args["require-artifact-safety"] === "1";
const requirePackagedRecovery = args["require-packaged-recovery"] === "true" || args["require-packaged-recovery"] === "1";
const allowMissingTargets = args["allow-missing-targets"] === "true" || args["allow-missing-targets"] === "1";
const packagedSmoke = args["packaged-smoke"] || "not-recorded";
const recoveryDrill = args["recovery-drill"] || "not-recorded";
const packagedRecovery = args["packaged-recovery"] || "not-recorded";

if (!platform || !["win", "mac"].includes(platform)) throw new Error("Use --platform win or --platform mac.");
if (!fs.existsSync(distRoot) || !fs.statSync(distRoot).isDirectory()) throw new Error(`Artifact directory is missing: ${distRoot}`);

writeReport().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function writeReport() {
  const extensions = platform === "win" ? new Set([".exe", ".zip", ".blockmap"]) : new Set([".dmg", ".zip", ".blockmap"]);
  const artifacts = (await Promise.all(fs.readdirSync(distRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()) && isPlatformArtifact(entry.name, platform))
    .map(async (entry) => {
      const filePath = path.join(distRoot, entry.name);
      const stat = fs.statSync(filePath);
      return {
        file: path.relative(appRoot, filePath).replaceAll(path.sep, "/"),
        name: entry.name,
        bytes: stat.size,
        sha256: await sha256File(filePath),
        kind: artifactKind(entry.name, platform)
      };
    }))).sort((left, right) => left.name.localeCompare(right.name));

  if (!artifacts.length) throw new Error(`No ${platform} package artifacts found in ${distRoot}.`);
  const requiredKinds = platform === "win" ? ["portable", "nsis", "zip"] : ["dmg", "zip"];
  const foundKinds = new Set(artifacts.map((artifact) => artifact.kind));
  const missingKinds = requiredKinds.filter((kind) => !foundKinds.has(kind));
  if (missingKinds.length && !allowMissingTargets) {
    throw new Error(`Expected ${platform} package target(s) are missing: ${missingKinds.join(", ")}.`);
  }

  const safetyReport = readJsonIfExists(safetyReportPath);
  const artifactSafetyReport = readJsonIfExists(artifactSafetyReportPath);
  const packagedRecoveryReport = readJsonIfExists(packagedRecoveryReportPath);
  const artifactSafetyValidation = validateArtifactSafety(artifactSafetyReport, platform, artifacts, allowMissingTargets);
  const packagedRecoveryValidation = validatePackagedRecovery(packagedRecoveryReport, platform);
  if (requireSafety && safetyReport?.status !== "passed") {
    throw new Error(`Required package safety evidence is missing or not passed: ${safetyReportPath}`);
  }
  if (requireSafety && packagedSmoke !== "passed") {
    throw new Error("Required packaged smoke evidence is missing or not passed.");
  }
  if (requireSafety && recoveryDrill !== "passed") {
    throw new Error("Required built recovery drill evidence is missing or not passed.");
  }
  if (requirePackagedRecovery && packagedRecovery !== "passed") {
    throw new Error("Required packaged recovery smoke evidence is missing or not passed.");
  }
  if (requirePackagedRecovery && packagedRecoveryValidation.errors.length) {
    throw new Error(`Required packaged recovery report is missing, failed or incomplete: ${packagedRecoveryValidation.errors.join("; ")}`);
  }
  if (requireArtifactSafety && artifactSafetyValidation.errors.length) {
    throw new Error(`Required artifact-container safety evidence is missing, stale or mismatched: ${artifactSafetyValidation.errors.join("; ")}`);
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    kind: "openmind-package-artifact-evidence",
    platform,
    host: { platform: process.platform, arch: process.arch, node: process.version, os: os.release() },
    artifacts,
    targetValidation: missingKinds.length === 0 ? "passed" : "manual-required",
    requiredKinds,
    foundKinds: [...foundKinds].sort(),
    missingKinds,
    packageSafety: safetyReport
      ? {
        status: safetyReport.status,
        scannedFiles: safetyReport.scannedFiles,
        targets: safetyReport.targets,
        findings: safetyReport.findings,
        sourceReport: path.relative(appRoot, safetyReportPath).replaceAll(path.sep, "/")
      }
      : "not-recorded",
    artifactSafety: artifactSafetyReport
      ? {
        status: artifactSafetyReport.status,
        passedArtifacts: artifactSafetyReport.passedArtifacts,
        failedArtifacts: artifactSafetyReport.failedArtifacts,
        validated: artifactSafetyValidation.errors.length === 0,
        targetComplete: artifactSafetyReport.status === "passed" && !(artifactSafetyReport.missingKinds || []).length,
        mismatches: artifactSafetyValidation.errors,
        sourceReport: path.relative(appRoot, artifactSafetyReportPath).replaceAll(path.sep, "/")
      }
      : "not-recorded",
    packagedSmoke,
    recoveryDrill,
    packagedRecovery: packagedRecoveryValidation.errors.length === 0 ? "passed" : "not-recorded",
    packagedRecoveryEvidence: packagedRecoveryReport
      ? {
        status: packagedRecoveryReport.status,
        kind: packagedRecoveryReport.kind,
        validated: packagedRecoveryValidation.errors.length === 0,
        scenarioCount: Array.isArray(packagedRecoveryReport.scenarios) ? packagedRecoveryReport.scenarios.length : 0,
        forcedTerminationCount: packagedRecoveryValidation.forcedTerminationCount,
        restoredPreviousState: packagedRecoveryValidation.restoredPreviousState,
        transactionRemoved: packagedRecoveryValidation.transactionRemoved,
        mismatches: packagedRecoveryValidation.errors,
        sourceReport: path.relative(appRoot, packagedRecoveryReportPath).replaceAll(path.sep, "/")
      }
      : "not-recorded",
    cleanMachine: "pending",
    signed: false,
    notes: "Artifact hashes and container-content safety do not prove GUI, installation, clean-machine, Provider, signing or packaged force-quit recovery acceptance."
  };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Package artifact evidence written: ${artifacts.length} ${platform} artifact(s), target validation ${missingKinds.length === 0 ? "passed" : "manual-required"}, ${path.relative(appRoot, output)}.`);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const [key, inline] = value.slice(2).split("=", 2);
    parsed[key] = inline ?? values[++index];
  }
  return parsed;
}

function artifactKind(name, targetPlatform) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".blockmap")) return "blockmap";
  if (targetPlatform === "win" && lower.includes("portable")) return "portable";
  if (targetPlatform === "win" && (lower.includes("setup") || lower.includes("nsis"))) return "nsis";
  if (lower.endsWith(".dmg")) return "dmg";
  return "zip";
}

function isPlatformArtifact(name, targetPlatform) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".blockmap")) {
    return targetPlatform === "win"
      ? !lower.includes("-mac") && (lower.includes("setup") || lower.includes("win") || lower.includes("portable"))
      : lower.includes("-mac") || lower.includes("macos");
  }
  if (targetPlatform === "win") {
    return lower.endsWith(".exe") || (lower.endsWith(".zip") && /(?:^|[-_.])win(?:[-_.]|$)/.test(lower));
  }
  return lower.endsWith(".dmg") || (lower.endsWith(".zip") && /(?:^|[-_.])mac(?:[-_.]|$)/.test(lower));
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function readJsonIfExists(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function validateArtifactSafety(report, targetPlatform, artifacts, allowMissingTargets) {
  const errors = [];
  if (!report) return { errors: ["report missing"] };
  if (report.platform !== targetPlatform) errors.push(`platform=${report.platform || "missing"}, expected ${targetPlatform}`);
  const requiredKinds = targetPlatform === "win" ? ["portable", "nsis", "zip"] : ["dmg", "zip"];
  const expectedMissingKinds = requiredKinds.filter((kind) => !artifacts.some((artifact) => artifact.kind === kind));
  const reportMissingKinds = Array.isArray(report.missingKinds) ? report.missingKinds : [];
  const partialTargetEvidence = allowMissingTargets
    && report.status === "manual-required"
    && expectedMissingKinds.length > 0
    && reportMissingKinds.length > 0
    && reportMissingKinds.every((kind) => expectedMissingKinds.includes(kind));
  if (report.status !== "passed" && !partialTargetEvidence) errors.push(`status=${report.status || "missing"}`);
  if (reportMissingKinds.some((kind) => !expectedMissingKinds.includes(kind))) {
    errors.push(`unexpected missing target kind(s): ${reportMissingKinds.join(", ")}`);
  }
  const expectedArtifacts = artifacts.filter((artifact) => artifact.kind !== "blockmap");
  const checkedArtifacts = Array.isArray(report.artifacts) ? report.artifacts : [];
  const checkedByName = new Map(checkedArtifacts.map((artifact) => [artifact.name, artifact]));
  for (const expected of expectedArtifacts) {
    const checked = checkedByName.get(expected.name);
    if (!checked) {
      errors.push(`${expected.name}: missing from safety report`);
      continue;
    }
    if (checked.kind !== expected.kind) errors.push(`${expected.name}: kind mismatch`);
    if (checked.status !== "passed") errors.push(`${expected.name}: status=${checked.status || "missing"}`);
    if (checked.containsAsar !== true) errors.push(`${expected.name}: app.asar missing`);
    if (checked.bytes !== expected.bytes) errors.push(`${expected.name}: byte size mismatch`);
    if (checked.sha256 !== expected.sha256) errors.push(`${expected.name}: sha256 mismatch`);
  }
  const expectedNames = new Set(expectedArtifacts.map((artifact) => artifact.name));
  for (const checked of checkedArtifacts) {
    if (!expectedNames.has(checked.name)) errors.push(`${checked.name || "unknown artifact"}: unexpected safety entry`);
  }
  return { errors };
}

function validatePackagedRecovery(report, targetPlatform) {
  const errors = [];
  const expectedHostPlatform = targetPlatform === "win" ? "win32" : "darwin";
  if (!report) return { errors: ["report missing"], forcedTerminationCount: 0, restoredPreviousState: false, transactionRemoved: false };
  if (report.kind !== "openmind-packaged-recovery-smoke") errors.push(`kind=${report.kind || "missing"}`);
  if (report.status !== "passed") errors.push(`status=${report.status || "missing"}`);
  if (report.host?.platform !== expectedHostPlatform) errors.push(`host.platform=${report.host?.platform || "missing"}, expected ${expectedHostPlatform}`);
  if (!Array.isArray(report.scenarios) || report.scenarios.length < 2) {
    errors.push("at least initial-startup and startup-recovery scenarios are required");
    return { errors, forcedTerminationCount: 0, restoredPreviousState: false, transactionRemoved: false };
  }
  const initial = report.scenarios.find((scenario) => scenario?.id === "initial-startup");
  const recovery = report.scenarios.find((scenario) => scenario?.id === "startup-recovery");
  if (!initial) errors.push("initial-startup scenario missing");
  if (!recovery) errors.push("startup-recovery scenario missing");
  const forcedTerminationCount = [initial, recovery].filter((scenario) => scenario?.forcedTermination === true).length;
  if (forcedTerminationCount !== 2) errors.push(`forcedTermination scenarios=${forcedTerminationCount}, expected 2`);
  const restoredPreviousState = recovery?.restoredPreviousState === true;
  const transactionRemoved = recovery?.transactionRemoved === true;
  if (!restoredPreviousState) errors.push("startup-recovery did not record restoredPreviousState=true");
  if (!transactionRemoved) errors.push("startup-recovery did not record transactionRemoved=true");
  return { errors, forcedTerminationCount, restoredPreviousState, transactionRemoved };
}

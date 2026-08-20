"use strict";

/**
 * Built-artifact migration/recovery drill.
 *
 * This intentionally loads the compiled Main-process services from `.build`
 * instead of importing TypeScript source or Vitest fixtures. It exercises the
 * state boundaries that can be verified on the current host while leaving
 * Windows/macOS packaged-install and force-quit evidence to the external
 * clean-machine matrix.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const buildRoot = path.resolve(__dirname, "..", ".build");
const appPathsModule = require(path.join(buildRoot, "electron/electron/paths/app-paths-service.js"));
const relocationModule = require(path.join(buildRoot, "electron/electron/paths/openmind-relocation-service.js"));
const backupModule = require(path.join(buildRoot, "electron/electron/backup/app-state-backup.js"));
const runStoreModule = require(path.join(buildRoot, "electron/electron/execution/run-store.js"));
const runtimeModule = require(path.join(buildRoot, "electron/electron/runtime/runtime-pack-service.js"));
const verifierModule = require(path.join(buildRoot, "electron/electron/runtime/runtime-pack-verifier.js"));
const reportOutput = path.resolve(process.env.OPENMIND_RECOVERY_DRILL_OUTPUT || path.join(buildRoot, "recovery-drill-report.json"));

const {
  buildAppPaths,
  ensureAppPaths
} = appPathsModule;
const {
  previewOpenmindRelocation,
  relocateOpenmind
} = relocationModule;
const { AppStateBackupService } = backupModule;
const { RunStore } = runStoreModule;
const { RuntimePackService } = runtimeModule;
const { canonicalRuntimePackPayload } = verifierModule;

const drillRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-built-recovery-drill-"));

try {
  assertBuildServices();
  runOpenmindRelocationDrill();
  runInterruptedRunDrill();
  runAppStateBackupDrill();
  runRuntimeRollbackDrill();
  writeReport("passed");
  console.log("Built recovery drill passed: relocation, interrupted Run/orphan recovery, app-state restore, runtime rollback.");
} catch (error) {
  writeReport("failed", error);
  throw error;
} finally {
  fs.rmSync(drillRoot, { recursive: true, force: true });
}

function writeReport(status, error = null) {
  fs.mkdirSync(path.dirname(reportOutput), { recursive: true });
  fs.writeFileSync(reportOutput, `${JSON.stringify({
    schemaVersion: 1,
    kind: "openmind-built-recovery-drill",
    generatedAt: new Date().toISOString(),
    status,
    scope: "compiled Main-process services on the current host",
    externalGates: ["packaged Windows/macOS force-quit", "target-OS disaster recovery"],
    error: error ? String(error?.message || error) : null
  }, null, 2)}\n`, "utf8");
}

function assertBuildServices() {
  for (const relative of [
    "electron/electron/paths/app-paths-service.js",
    "electron/electron/paths/openmind-relocation-service.js",
    "electron/electron/backup/app-state-backup.js",
    "electron/electron/execution/run-store.js",
    "electron/electron/runtime/runtime-pack-service.js"
  ]) {
    const target = path.join(buildRoot, relative);
    if (!fs.existsSync(target)) throw new Error(`Missing compiled recovery service: ${relative}`);
  }
}

function runInterruptedRunDrill() {
  const root = path.join(drillRoot, "run-recovery");
  const runsRoot = path.join(root, "runs");
  const secret = "do-not-persist-this-secret";
  const request = {
    skillId: "recovery-fixture",
    version: "1.0.0",
    digest: "a".repeat(64),
    inputs: { secretInput: secret },
    providerBindings: { provider: "credential-1" },
    trigger: { type: "manual" },
    externalExportBindingIds: [],
    rootGeneration: 1
  };
  const firstProcess = new RunStore(runsRoot);
  firstProcess.create(request, "run-recovery-1");
  firstProcess.transition("run-recovery-1", "inspecting");
  firstProcess.transition("run-recovery-1", "preparing_runtime");
  firstProcess.transition("run-recovery-1", "running");
  firstProcess.bindProcessPid("run-recovery-1", process.pid);

  // A new RunStore instance represents the next Main process after a crash.
  // The current PID is intentionally used so the recovery record must surface
  // a human-diagnostic orphan warning instead of silently killing a reused PID.
  const afterRestart = new RunStore(runsRoot);
  const recovered = afterRestart.recoverInterrupted("built-recovery-drill");
  assert(recovered.length === 1, "interrupted Run was not recovered");
  assert(recovered[0].state === "failed" && recovered[0].terminalState === "failed", "interrupted Run is not terminal failed");
  assert(recovered[0].orphanPid === process.pid && recovered[0].processPid === null, "live orphan PID was not surfaced safely");
  assert(String(recovered[0].error).includes("人工诊断"), "orphan warning did not require manual diagnosis");
  assert(!readTree(root).includes(secret), "Run recovery persisted an input Secret");
  assert(afterRestart.recoverInterrupted("second-restart").length === 0, "terminal recovered Run was recovered twice");
}

function runOpenmindRelocationDrill() {
  const root = path.join(drillRoot, "openmind-relocation");
  const source = path.join(root, "source-openmind");
  const target = path.join(root, "target-openmind");
  const paths = buildAppPaths(path.join(root, "user-data"));
  ensureAppPaths(paths);
  write(path.join(source, "article", "one.md"), "user-content");
  fs.mkdirSync(target, { recursive: true });

  const input = { sourceDirectory: source, targetDirectory: target, paths };
  assert(previewOpenmindRelocation(input).canCommit, "openmind relocation preflight failed");
  const report = relocateOpenmind(input);
  assert(report.status === "committed" && report.verified && report.sourcePreserved, "openmind relocation was not verified");
  assert(fs.readFileSync(path.join(source, "article", "one.md"), "utf8") === "user-content", "openmind source was modified");
  assert(fs.readFileSync(path.join(target, "article", "one.md"), "utf8") === "user-content", "openmind target is incomplete");
}

function runAppStateBackupDrill() {
  const root = path.join(drillRoot, "app-state-backup");
  const paths = buildAppPaths(path.join(root, "user-data"));
  ensureAppPaths(paths);
  write(paths.settingsFile, JSON.stringify({ schemaVersion: 2, openmindRoot: "/external/openmind" }));
  write(path.join(paths.state, "root-1", "session.json"), "session-v1");
  const backup = path.join(root, "state-backup.zip");
  const service = new AppStateBackupService(paths);
  const exported = service.exportToFile(backup);
  assert(exported.fileCount === 2, "app-state backup did not capture expected state");
  write(paths.settingsFile, "partially-applied");
  write(path.join(paths.state, "root-1", "session.json"), "partially-applied");
  const imported = service.importFromFile(backup);
  assert(imported.operation === "import", "app-state backup restore did not complete");
  assert(fs.readFileSync(paths.settingsFile, "utf8").includes("/external/openmind"), "settings restore failed");
  assert(fs.readFileSync(path.join(paths.state, "root-1", "session.json"), "utf8") === "session-v1", "state restore failed");

  // Simulate a process dying during commit. Constructor startup recovery must
  // restore the previous snapshot and remove the transaction marker.
  const transaction = path.join(paths.staging, "state-backup-restore-recovery");
  write(path.join(transaction, "previous", "settings", "settings.json"), "before-crash");
  write(path.join(transaction, "marker.json"), JSON.stringify({ kind: "openmind-app-state-backup", schemaVersion: 1, phase: "committing" }));
  write(paths.settingsFile, "partially-applied-again");
  new AppStateBackupService(paths);
  assert(fs.readFileSync(paths.settingsFile, "utf8") === "before-crash", "app-state crash recovery did not restore the previous snapshot");
  assert(!fs.existsSync(transaction), "app-state recovery transaction was not cleaned up");
}

function runRuntimeRollbackDrill() {
  const root = path.join(drillRoot, "runtime");
  const paths = buildAppPaths(path.join(root, "user-data"));
  ensureAppPaths(paths);
  const keys = crypto.generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const service = new RuntimePackService(paths, { runtimeRoot: publicKey });

  const firstBytes = Buffer.from("runtime-v1");
  const first = signedPack("1.0.0", firstBytes, keys.privateKey);
  const firstRecord = service.install(first.metadata, firstBytes);
  service.activate(firstRecord.packId, firstRecord.target, firstRecord.digest);

  const secondBytes = Buffer.from("runtime-v2");
  const second = signedPack("2.0.0", secondBytes, keys.privateKey);
  const secondRecord = service.install(second.metadata, secondBytes);
  service.activate(secondRecord.packId, secondRecord.target, secondRecord.digest);
  const rollback = service.rollback("python-core", "windows-x64");
  assert(rollback.active.version === "1.0.0" && rollback.previous.version === "2.0.0", "runtime rollback did not restore the previous verified version");
  assert(service.getReadiness("python-core", "windows-x64").ready === true, "rolled-back runtime is not ready");
}

function signedPack(version, bytes, privateKey) {
  const metadata = {
    schemaVersion: 1,
    packId: "python-core",
    version,
    target: "windows-x64",
    filename: "python-core.pack",
    size: bytes.byteLength,
    sha256: sha256(bytes),
    publisherKeyId: "runtimeRoot",
    signatureAlgorithm: "ed25519",
    signature: "placeholder",
    expiresAt: "2027-01-01T00:00:00.000Z",
    license: "PSF-2.0",
    sbom: { format: "spdx", digest: "b".repeat(64) }
  };
  return {
    metadata: {
      ...metadata,
      signature: crypto.sign(null, Buffer.from(canonicalRuntimePackPayload(metadata)), privateKey).toString("base64")
    }
  };
}

function write(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function readTree(root) {
  const values = [];
  walk(root);
  return values.join("\n");

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) values.push(fs.readFileSync(target, "utf8"));
    }
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

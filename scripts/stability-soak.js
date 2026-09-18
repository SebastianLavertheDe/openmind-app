#!/usr/bin/env node
"use strict";

/**
 * Local stability evidence for Phase 12.
 *
 * This is intentionally split from the packaged Windows/macOS matrix:
 * - it executes the compiled SessionStore and RunStore against temporary
 *   state, including concurrent append and restart/reload checks;
 * - it validates a large synthetic Manifest set and repeatedly generates the
 *   Installed Skill discovery contract;
 * - it does not claim live Provider, Chrome extension, clean-machine or
 *   packaged force-quit evidence.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const appRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(appRoot, ".build");
const reportPath = path.join(buildRoot, "stability-soak-report.json");
const sessionStorePath = path.join(buildRoot, "electron", "electron", "ai", "session-store.js");
const runStorePath = path.join(buildRoot, "electron", "electron", "execution", "run-store.js");
const manifestSchemaPath = path.join(buildRoot, "electron", "shared", "skill-manifest-schema.js");
const skillDiscoveryPath = path.join(buildRoot, "electron", "electron", "ai", "skill-discovery.js");

const config = {
  cycles: positiveInteger("OPENMIND_SOAK_CYCLES", 3),
  manifestCount: positiveInteger("OPENMIND_SOAK_MANIFESTS", 1000),
  sessionCount: positiveInteger("OPENMIND_SOAK_SESSIONS", 100),
  eventCount: positiveInteger("OPENMIND_SOAK_EVENTS", 1000),
  brokerRunCount: positiveInteger("OPENMIND_SOAK_BROKER_RUNS", 100),
  skillDiscoveryCycles: positiveInteger("OPENMIND_SOAK_SKILL_CYCLES", 1000)
};

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-stability-soak-"));
const startedAt = new Date().toISOString();
const started = performance.now();
let report;

void main();

async function main() {
  try {
    requireBuildArtifacts();
    const { SessionStore } = require(sessionStorePath);
    const { RunStore } = require(runStorePath);
    const { SkillManifestSchema } = require(manifestSchemaPath);
    const { skillDiscoveryInstructions } = require(skillDiscoveryPath);

    const tracks = {
      manifestValidation: [],
      sessionSchedulerPersistence: [],
      brokerRunRecovery: [],
      installedSkillDiscoveryContract: []
    };
    for (let cycle = 0; cycle < config.cycles; cycle += 1) {
      const cycleRoot = path.join(temporaryRoot, `cycle-${cycle}`);
      fs.mkdirSync(cycleRoot, { recursive: true });
      tracks.manifestValidation.push(runManifestValidationSoak(SkillManifestSchema));
      tracks.sessionSchedulerPersistence.push(await runSessionSchedulerSoak(SessionStore, cycleRoot));
      tracks.brokerRunRecovery.push(runBrokerRunSoak(RunStore, cycleRoot));
      tracks.installedSkillDiscoveryContract.push(runInstalledSkillDiscoveryContractSoak(skillDiscoveryInstructions, cycle));
    }

    report = {
      schemaVersion: 1,
      kind: "openmind-local-stability-soak",
      generatedAt: new Date().toISOString(),
      startedAt,
      status: "passed",
      host: { platform: process.platform, arch: process.arch, node: process.version, os: os.release() },
      configuration: config,
      tracks,
      totals: {
        cycles: config.cycles,
        manifests: config.manifestCount * config.cycles,
        sessions: config.sessionCount * config.cycles,
        brokerRuns: config.brokerRunCount * config.cycles,
        skillDiscoveryCycles: config.skillDiscoveryCycles * config.cycles
      },
      externalGates: [
        "live Windows/macOS Provider E2E",
        "Chrome extension and user-authorized Browser E2E",
        "packaged clean-machine and force-quit/disaster-recovery matrix",
        "independent Security Review and deployment/diagnostic-platform audit"
      ],
      durationMs: round(performance.now() - started)
    };
    writeReport(report);
    console.log(`Local stability soak passed: ${config.manifestCount} manifests, ${config.sessionCount} sessions, ${config.brokerRunCount} Broker Runs, ${config.skillDiscoveryCycles} Skill discovery cycles.`);
  } catch (error) {
    report = {
      schemaVersion: 1,
      kind: "openmind-local-stability-soak",
      generatedAt: new Date().toISOString(),
      startedAt,
      status: "failed",
      host: { platform: process.platform, arch: process.arch, node: process.version, os: os.release() },
      configuration: config,
      error: error instanceof Error ? error.stack || error.message : String(error),
      durationMs: round(performance.now() - started)
    };
    writeReport(report);
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function requireBuildArtifacts() {
  for (const target of [sessionStorePath, runStorePath, manifestSchemaPath, skillDiscoveryPath]) {
    if (!fs.existsSync(target)) throw new Error(`Missing compiled soak dependency: ${path.relative(appRoot, target)}. Run npm run build first.`);
  }
}

function runManifestValidationSoak(SkillManifestSchema) {
  const started = performance.now();
  let lastId = "";
  for (let index = 0; index < config.manifestCount; index += 1) {
    lastId = `stability-soak-${index}`;
    const parsed = SkillManifestSchema.parse({
      apiVersion: "openmind.dev/skill/v1",
      id: lastId,
      version: "1.0.0",
      publisher: { id: "openmind", displayName: "OpenMind" },
      kind: "process",
      display: { name: `Stability Soak ${index}`, description: "Synthetic local validation fixture." },
      entrypoint: { runtime: "python", script: "main.py", args: [] },
      runtime: { version: ">=3.11,<3.13", dependencyFile: "pyproject.toml", packs: ["python-core"] },
      capabilities: { openmind: { read: [], write: [] }, network: { required: false, hosts: [] } },
      artifacts: [],
      execution: {
        concurrency: { maxInstances: 1, mutexes: [] },
        timeoutSeconds: 60,
        gracefulStopSeconds: 1,
        retry: { maxAttempts: 0 }
      },
      platforms: ["linux-x64"],
      compatibility: { minAppVersion: "1.0.0" }
    });
    assert(parsed.id === lastId, `Manifest parser changed the ID at index ${index}.`);
  }
  return {
    status: "passed",
    count: config.manifestCount,
    lastId,
    mode: "synthetic-schema-validation",
    durationMs: round(performance.now() - started)
  };
}

async function runSessionSchedulerSoak(SessionStore, cycleRoot) {
  const started = performance.now();
  const projectRoot = path.join(cycleRoot, "project");
  const stateRoot = path.join(cycleRoot, "session-state");
  fs.mkdirSync(projectRoot, { recursive: true });
  const store = new SessionStore(projectRoot, stateRoot);
  store.initialize();
  const sessions = [];
  for (let index = 0; index < config.sessionCount; index += 1) {
    sessions.push(store.createSession({
      provider: index % 2 ? "claude" : "codex",
      providerId: `${index % 2 ? "claude" : "codex"}:soak:${index}`,
      cwd: ".",
      title: `Stability Soak Session ${String(index).padStart(4, "0")}`,
      scope: { type: "workspace" },
      permissionProfile: index % 3 === 0 ? "read-only" : index % 3 === 1 ? "edit" : "auto"
    }));
  }

  const longSession = sessions[0];
  const longRun = store.createRun(longSession, "stability soak long run", []);
  await store.beginTurn(longRun);
  for (let index = 0; index < config.eventCount; index += 1) {
    await store.appendEvent(longRun, "assistant-message", {
      text: `soak-event-${index} searchable-soak-${index % 31}`
    });
  }
  store.updateRun(longRun.id, { status: "completed", completedAt: new Date().toISOString() });
  await store.completeTurn(store.getRun(longRun.id));

  const concurrent = sessions.slice(1, 4).map((session, index) => store.createRun(session, `concurrent soak ${index}`, []));
  await Promise.all(concurrent.map(async (run, index) => {
    await store.beginTurn(run);
    for (let event = 0; event < Math.max(1, Math.floor(config.eventCount / 20)); event += 1) {
      await store.appendEvent(run, "tool-output", { text: `concurrent-${index}-${event}` });
    }
    store.updateRun(run.id, { status: "completed", completedAt: new Date().toISOString() });
    await store.completeTurn(store.getRun(run.id));
  }));

  const listed = store.listSessions();
  const searched = store.search("Stability Soak Session 0099");
  const events = store.readEvents(longSession.id);
  // appendEvent uses the Journal's bounded delayed flush path. Read every
  // concurrent session before returning so no timer can outlive the temp
  // state tree and turn a successful soak into a late asynchronous error.
  for (const session of concurrent.map((run) => store.getSession(run.sessionId))) {
    store.readEvents(session.id);
  }
  assert(listed.length === config.sessionCount, `Session listing mismatch: ${listed.length}/${config.sessionCount}.`);
  assert(searched.length >= 1, "Concurrent session search did not find the expected session.");
  assert(events.length >= config.eventCount, `Long session event count too small: ${events.length}.`);
  assert(store.listRuns(longSession.id)[0]?.status === "completed", "Long scheduler soak Run did not reach completed.");

  return {
    status: "passed",
    sessions: listed.length,
    longRunEvents: events.length,
    concurrentRuns: concurrent.length,
    mode: "compiled-session-store-with-concurrent-appends",
    durationMs: round(performance.now() - started)
  };
}

function runBrokerRunSoak(RunStore, cycleRoot) {
  const started = performance.now();
  const runsRoot = path.join(cycleRoot, "broker-runs");
  const store = new RunStore(runsRoot);
  const secret = "stability-soak-secret-must-not-persist";
  const digest = crypto.createHash("sha256").update("stability-soak-skill").digest("hex");

  for (let index = 0; index < config.brokerRunCount; index += 1) {
    const record = store.create({
      skillId: "stability-soak",
      version: "1.0.0",
      digest,
      inputs: { task: `run-${index}`, secretInput: secret },
      providerBindings: { provider: "profile-soak" },
      trigger: { type: "manual" },
      externalExportBindingIds: [],
      rootGeneration: 1
    }, `stability-soak-run-${index}`);
    store.transition(record.id, "inspecting");
    if (index % 10 === 0) {
      store.transition(record.id, "cancelled", { reason: "soak-cancel" });
      continue;
    }
    if (index % 10 === 1) {
      store.transition(record.id, "failed", { reason: "soak-failure", error: "synthetic failure" });
      continue;
    }
    store.transition(record.id, "preparing_runtime");
    store.transition(record.id, "running");
    store.appendOutput(record.id, "stdout", `soak-output-${index}`);
    store.attachUsage(record.id, {
      model: "stability-soak-model",
      totalTokens: 12,
      costUsd: 0,
      costSource: "provider-reported",
      durationMs: 1
    });
    store.transition(record.id, "succeeded");
  }

  const reopened = new RunStore(runsRoot);
  const records = reopened.list();
  assert(records.length === config.brokerRunCount, `Broker Run reload mismatch: ${records.length}/${config.brokerRunCount}.`);
  assert(records.every((record) => ["succeeded", "failed", "cancelled"].includes(record.state)), "A Broker Run remained non-terminal after soak.");
  for (const record of records) assert(reopened.events(record.id).length >= 2, `Run ${record.id} has incomplete event history.`);
  assert(!readTree(runsRoot).includes(secret), "Broker Run durable state leaked a Secret value.");

  return {
    status: "passed",
    runs: records.length,
    terminalStates: countValues(records.map((record) => record.state)),
    mode: "compiled-run-store-reload-and-secret-boundary",
    durationMs: round(performance.now() - started)
  };
}

function runInstalledSkillDiscoveryContractSoak(skillDiscoveryInstructions, cycle) {
  const started = performance.now();
  let codeBytes = 0;
  for (let index = 0; index < config.skillDiscoveryCycles; index += 1) {
    const code = skillDiscoveryInstructions([{
      id: `fixture-${cycle}-${index}`,
      version: "1.0.0",
      digest: "a".repeat(64),
      description: "Read a page and capture evidence through an installed Skill",
      packageRoot: `/fixture/skills/fixture-${index}`,
      skillPath: `/fixture/skills/fixture-${index}/SKILL.md`
    }]);
    assert(code.includes("SKILL.md"), "Skill discovery lost its instruction entrypoint.");
    assert(code.includes("必须先用文件读取工具"), "Skill discovery lost progressive instruction loading.");
    assert(code.includes("普通会话和 Project 会话"), "Skill discovery lost a conversation scope.");
    codeBytes += Buffer.byteLength(code);
  }
  return {
    status: "passed",
    cycles: config.skillDiscoveryCycles,
    generatedBytes: codeBytes,
    mode: "installed-skill-discovery-contract-only",
    liveProviderAndChromeE2E: "manual-required",
    durationMs: round(performance.now() - started)
  };
}

function readTree(root) {
  const values = [];
  if (!fs.existsSync(root)) return values.join("\n");
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) values.push(readTree(target));
    else if (entry.isFile()) values.push(fs.readFileSync(target, "utf8"));
  }
  return values.join("\n");
}

function countValues(values) {
  return values.reduce((result, value) => {
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeReport(value) {
  fs.mkdirSync(buildRoot, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

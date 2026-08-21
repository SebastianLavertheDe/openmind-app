import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillRunRequest } from "../../shared/execution-contracts";
import { buildAppPaths, ensureAppPaths, type AppPaths } from "../paths/app-paths-service";
import { ArtifactCollector } from "./artifact-collector";
import { ExecutionBroker, type ExecutionPlan } from "./execution-broker";

describe("ExecutionBroker", () => {
  let root = "";
  let paths: AppPaths;
  let packageRoot = "";
  let openmindRoot = "";
  let broker: ExecutionBroker;
  const digest = "a".repeat(64);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-execution-broker-"));
    paths = buildAppPaths(path.join(root, "user-data"));
    ensureAppPaths(paths);
    packageRoot = path.join(root, "installed-skill");
    openmindRoot = path.join(root, "openmind");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(openmindRoot, { recursive: true });
    broker = new ExecutionBroker(paths, (_request, runId) => Promise.resolve(plan(packageRoot, openmindRoot, digest, runId)), undefined, { maxConcurrentRuns: 1 });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("starts immediately, uses a minimal process environment, and collects declared Artifacts", async () => {
    const run = broker.submit({
      skillId: "example-skill",
      version: "1.0.0",
      digest,
      inputs: { date: "20260805" },
      trigger: { type: "manual" },
      rootGeneration: 1
    });
    await waitFor(() => broker.get(run.id).state !== "queued" && broker.get(run.id).state !== "inspecting");
    expect(broker.get(run.id).state).not.toBe("waiting_execution_consent");
    await waitFor(() => broker.get(run.id).state === "succeeded");

    const completed = broker.get(run.id);
    expect(completed.terminalState).toBe("succeeded");
    expect(completed.artifacts).toHaveLength(1);
    expect(completed.artifacts[0].logicalPath).toBe("openmind/daily-summary/out.md");
    expect(broker.events(run.id).map((event) => event.state)).not.toContain("waiting_execution_consent");
    expect(broker.events(run.id).find((event) => event.text?.includes("sk-secret"))).toBeUndefined();
    expect(fs.readFileSync(path.join(paths.runs, run.id, "run.json"), "utf8")).not.toContain("20260805");
    const environment = JSON.parse(fs.readFileSync(path.join(packageRoot, "environment.json"), "utf8"));
    expect(environment).toMatchObject({
      CCTOOLS_RUN_ID: run.id,
      CCTOOLS_SKILL_ID: "example-skill",
      CCTOOLS_SKILL_VERSION: "1.0.0",
      CCTOOLS_SKILL_HOME: packageRoot,
      CCTOOLS_SKILL_DATA_DIR: path.join(openmindRoot, ".agent", "skill-data", "example-skill"),
      CCTOOLS_RUN_DIR: path.join(paths.runs, run.id, "work"),
      CCTOOLS_MYMIND_ROOT: openmindRoot,
      CCTOOLS_ROOT_GENERATION: "1",
      CCTOOLS_MANAGED_RUN: "1",
      CCTOOLS_APP_USER_DATA: paths.userData,
      MYMIND_ROOT: openmindRoot,
      OPENMIND_ROOT: openmindRoot,
      OPENMIND_MANAGED_RUN: "1"
    });
    expect(environment.OPENMIND_SKILL_DATA_DIR).toBe(
      path.join(openmindRoot, ".agent", "skill-data", "example-skill")
    );
  });

  it("accepts a compatible semver range returned by an execution plan", async () => {
    const run = broker.submit({ ...request(), version: "^1.0.0" });

    await waitFor(() => broker.get(run.id).state === "succeeded");
  });

  it("does not fail a successful process when optional Artifact registration exceeds its limit", async () => {
    const limitedBroker = new ExecutionBroker(
      paths,
      (_request, runId) => Promise.resolve(plan(packageRoot, openmindRoot, digest, runId)),
      undefined,
      { maxConcurrentRuns: 1, artifactCollector: new ArtifactCollector(1) }
    );

    const run = limitedBroker.submit(request());
    await waitFor(() => limitedBroker.get(run.id).state === "succeeded");

    expect(limitedBroker.get(run.id).artifacts).toEqual([]);
    expect(limitedBroker.events(run.id).some((event) => event.text?.includes("Artifact 登记失败，已忽略"))).toBe(true);
  });

  it("queues on a mutex and cancels an active process through the broker", async () => {
    let invocation = 0;
    broker = new ExecutionBroker(paths, (_request, runId) => {
      invocation += 1;
      return Promise.resolve(plan(packageRoot, openmindRoot, digest, runId, { script: "setTimeout(() => {}, 30_000)", mutexes: ["openmind:write"], timeoutMs: 30_000 }));
    }, undefined, { maxConcurrentRuns: 1 });
    const first = broker.submit(request());
    const second = broker.submit(request());
    await waitFor(() => broker.get(first.id).state === "running");
    expect(broker.get(second.id).state).toBe("preparing_runtime");
    await broker.cancel(first.id);
    await broker.cancel(second.id);
    await waitFor(() => broker.get(first.id).state === "cancelled" && broker.get(second.id).state === "cancelled");
    expect(invocation).toBe(2);
  });

  it("makes timeout a terminal state and rejects secret-like direct inputs", async () => {
    const timeoutBroker = new ExecutionBroker(paths, (_request, runId) => Promise.resolve(plan(packageRoot, openmindRoot, digest, runId, { script: "setTimeout(() => {}, 30_000)", timeoutMs: 30 })), undefined, { maxConcurrentRuns: 1 });
    const run = timeoutBroker.submit(request());
    await waitFor(() => timeoutBroker.get(run.id).state === "timed_out");
    expect(timeoutBroker.get(run.id).terminalState).toBe("timed_out");
    expect(() => broker.submit({ ...request(), inputs: { apiKey: "secret" } })).toThrow(/不能直接携带 Secret/);
  });

  it("retries a failed process within the same durable Run", async () => {
    const marker = path.join(packageRoot, "retry-marker");
    const script = `const fs=require('fs');const marker=${JSON.stringify(marker)};if(!fs.existsSync(marker)){fs.writeFileSync(marker,'failed-once');process.exit(1)};process.exit(0)`;
    const retryBroker = new ExecutionBroker(
      paths,
      (_request, runId) => Promise.resolve(plan(packageRoot, openmindRoot, digest, runId, { script, retry: { maxAttempts: 1 } })),
      undefined,
      { maxConcurrentRuns: 1 }
    );
    const run = retryBroker.submit(request());
    await waitFor(() => retryBroker.get(run.id).state === "succeeded");

    const completed = retryBroker.get(run.id);
    expect(completed.attempt).toBe(2);
    expect(completed.terminalState).toBe("succeeded");
    expect(retryBroker.events(run.id).some((event) => event.reason === "retry-after-failed")).toBe(true);
  });

  it("lets the admission boundary pin a public retry before the replacement Run is stored", async () => {
    const failingBroker = new ExecutionBroker(
      paths,
      async () => { throw new Error("expected failure"); },
      undefined,
      { maxConcurrentRuns: 1 }
    );
    const original = failingBroker.submit({ ...request(), version: undefined, digest: undefined });
    await waitFor(() => failingBroker.get(original.id).state === "failed");
    const admittedDigest = "d".repeat(64);
    const admit = vi.fn((candidate: SkillRunRequest): SkillRunRequest => ({
      ...candidate,
      version: "2.3.4",
      digest: admittedDigest
    }));

    const retried = failingBroker.retry(original.id, admit);

    expect(admit).toHaveBeenCalledOnce();
    expect(retried.request).toMatchObject({ version: "2.3.4", digest: admittedDigest });
    await waitFor(() => failingBroker.get(retried.id).state === "failed");
  });

  it("cancels active Runs and blocks later starts when a Credential is revoked", async () => {
    const credentialBroker = new ExecutionBroker(
      paths,
      (_request, runId) => Promise.resolve(plan(packageRoot, openmindRoot, digest, runId, {
        script: "setTimeout(() => {}, 30_000)",
        credentialIds: ["credential-token"]
      })),
      undefined,
      { maxConcurrentRuns: 1 }
    );
    const run = credentialBroker.submit(request());
    await waitFor(() => credentialBroker.get(run.id).state === "running");

    await expect(credentialBroker.revokeCredentials(["credential-token"])).resolves.toBe(1);
    await waitFor(() => credentialBroker.get(run.id).state === "cancelled");
    expect(credentialBroker.events(run.id).some((event) => event.reason === "credential-revoked")).toBe(true);

    const later = credentialBroker.submit(request());
    await waitFor(() => credentialBroker.get(later.id).state === "failed");
    expect(credentialBroker.get(later.id).error).toMatch(/Credential 已撤销/);
  });

  it("holds the Runtime Pack lease from preparation through process cleanup", async () => {
    let acquired = 0;
    let released = 0;
    const leaseBroker = new ExecutionBroker(
      paths,
      (_request, runId) => Promise.resolve(plan(packageRoot, openmindRoot, digest, runId, {
        acquireRuntime: () => { acquired += 1; },
        releaseRuntime: () => { released += 1; }
      })),
      undefined,
      { maxConcurrentRuns: 1 }
    );
    const run = leaseBroker.submit(request());
    await waitFor(() => leaseBroker.get(run.id).state === "succeeded");
    expect(acquired).toBe(1);
    expect(released).toBe(1);
  });
});

function request() {
  return {
    skillId: "example-skill",
    version: "1.0.0",
    digest: "a".repeat(64),
    inputs: { date: "20260805" },
    trigger: { type: "manual" } as const,
    rootGeneration: 1
  };
}

function plan(
  packageRoot: string,
  openmindRoot: string,
  digest: string,
  runId: string,
  overrides: (Partial<ExecutionPlan["process"]> & Pick<Partial<ExecutionPlan>, "mutexes" | "retry" | "credentialIds" | "acquireRuntime" | "releaseRuntime"> & { script?: string }) = {}
): ExecutionPlan {
  const output = path.join(openmindRoot, "daily-summary", "out.md");
  const environmentOutput = path.join(packageRoot, "environment.json");
  const { script: overrideScript, acquireRuntime, releaseRuntime, ...processOverrides } = overrides;
  const script = overrideScript || (processOverrides.args
    ? String(processOverrides.args[1])
    : `const fs=require('fs');fs.mkdirSync(${JSON.stringify(path.dirname(output))},{recursive:true});fs.writeFileSync(${JSON.stringify(output)},'done');fs.writeFileSync(${JSON.stringify(environmentOutput)},JSON.stringify(process.env));console.log('api-key=sk-secret')`);
  return {
    skillId: "example-skill",
    version: "1.0.0",
    digest,
    rootGeneration: 1,
    skillHome: packageRoot,
    openmindRoot,
    capabilities: { openmind: { write: ["daily-summary/**"] } },
    ...(acquireRuntime ? { acquireRuntime } : {}),
    ...(releaseRuntime ? { releaseRuntime } : {}),
    process: {
      executable: process.execPath,
      args: ["-e", script],
      cwd: packageRoot,
      env: {},
      timeoutMs: 5_000,
      gracefulStopMs: 0,
      ...processOverrides
    },
    mutexes: overrides.mutexes || ["openmind:write"],
    retry: overrides.retry,
    credentialIds: overrides.credentialIds,
    artifacts: [{ id: "summary", type: "markdown", logicalPath: "daily-summary/out.md" }]
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("test wait timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillManifestSchema, type WorkflowManifest } from "../../shared/skill-manifest-schema";
import { BrokerRunRecordSchema, EXECUTION_SCHEMA_VERSION, type BrokerRunRecord, type RunArtifact } from "../../shared/execution-contracts";
import { workflowManifestFingerprint, WorkflowDefinitionError, WorkflowEngine } from "./workflow-engine";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("WorkflowEngine", () => {
  it("topologically orders steps and rejects cycles or missing dependencies", () => {
    const root = makeRoot();
    const engine = new WorkflowEngine(root, () => child("unused"), () => child("unused"));
    expect(engine.validate(workflow())).toEqual(["collect", "summarize"]);
    expect(() => engine.validate(workflow({ needs: ["missing"] }))).toThrow(WorkflowDefinitionError);
    expect(() => engine.validate(workflow({ cycle: true }))).toThrow(/循环依赖/);
  });

  it("submits each ready step through Broker and persists a terminal workflow record", async () => {
    const root = makeRoot();
    const submitted: Array<{ skillId: string; version?: string; inputs: Record<string, unknown> }> = [];
    const engine = new WorkflowEngine(
      root,
      (request) => {
        submitted.push({ skillId: request.skillId, version: request.version, inputs: request.inputs });
        return child(`run-${submitted.length}`, "succeeded");
      },
      (runId) => child(runId, "succeeded")
    );
    const run = engine.start(workflow(), { date: "20260805" }, 4);
    await waitFor(() => engine.get(run.id).state === "succeeded");

    expect(submitted).toEqual([
      { skillId: "collector", version: "^1.0.0", inputs: { date: "20260805" } },
      { skillId: "summarizer", version: "^1.0.0", inputs: { date: "20260805" } }
    ]);
    expect(engine.get(run.id).stepRuns.every((step) => step.state === "succeeded")).toBe(true);
    expect(fs.existsSync(path.join(root, `${run.id}.json`))).toBe(true);
  });

  it("persists child Artifacts and maps dependency metadata into the next Step", async () => {
    const root = makeRoot();
    const submitted: Array<{ skillId: string; version?: string; inputs: Record<string, unknown> }> = [];
    const children = new Map<string, BrokerRunRecord>();
    const output = artifact("run-1", "summary", "mymind/daily-summary/20260805.md");
    const manifest = workflowWithArtifactHandoff();
    const engine = new WorkflowEngine(
      root,
      (request) => {
        const id = `run-${submitted.length + 1}`;
        submitted.push({ skillId: request.skillId, version: request.version, inputs: request.inputs });
        const record = child(id, "succeeded", request.skillId === "collector" ? [output] : []);
        children.set(id, record);
        return record;
      },
      (runId) => children.get(runId) || child(runId, "failed")
    );

    const run = engine.start(manifest, { date: "20260805" }, 1);
    await waitFor(() => engine.get(run.id).state === "succeeded");

    expect(submitted).toEqual([
      { skillId: "collector", version: "^1.0.0", inputs: { date: "20260805" } },
      { skillId: "summarizer", version: "^1.0.0", inputs: { artifactPath: "mymind/daily-summary/20260805.md", checksum: output.sha256 } }
    ]);
    expect(engine.get(run.id).stepRuns[0].artifacts).toEqual([output]);
    expect(JSON.parse(fs.readFileSync(path.join(root, `${run.id}.json`), "utf8")).stepRuns[0].artifacts).toEqual([output]);
  });

  it("rejects Artifact references outside the declared dependency set", async () => {
    const root = makeRoot();
    const manifest = workflow();
    manifest.workflow.steps[0].with = { artifactPath: "{{ steps.summarize.artifacts.output.logicalPath }}" };
    const engine = new WorkflowEngine(root, () => child("unused"), () => child("unused"));
    const run = engine.start(manifest, {}, 1);

    await waitFor(() => engine.get(run.id).state === "failed");
    expect(engine.get(run.id).stepRuns[0].error).toContain("只能引用 needs");
  });

  it("cancels a queued or running workflow and stops polling", async () => {
    const root = makeRoot();
    const engine = new WorkflowEngine(root, () => child("run-running", "queued"), () => child("run-running", "queued"));
    const run = engine.start(workflow(), {}, 1);
    expect(await engine.cancel(run.id)).toBe(true);
    expect(engine.get(run.id).state).toBe("cancelled");
  });

  it("converges a child submission error to a terminal failed record", async () => {
    const root = makeRoot();
    const engine = new WorkflowEngine(
      root,
      () => { throw new Error("child broker unavailable"); },
      () => child("unused")
    );
    const run = engine.start(workflow(), {}, 1);
    await waitFor(() => engine.get(run.id).state === "failed");

    const failed = engine.get(run.id);
    expect(failed.error).toContain("collect");
    expect(failed.stepRuns[0]).toMatchObject({ state: "failed", error: "child broker unavailable" });
  });

  it("marks an in-flight persisted workflow as interrupted after restart", () => {
    const root = makeRoot();
    const record = WorkflowRunRecordSchemaForTest("workflow-restart");
    fs.writeFileSync(path.join(root, `${record.id}.json`), JSON.stringify(record));

    const engine = new WorkflowEngine(root, () => child("unused"), () => child("unused"));
    expect(engine.get(record.id)).toMatchObject({
      state: "failed",
      error: "Workflow 在应用重启时中断，未恢复执行。"
    });
  });

  it("resumes an interrupted workflow only with the current root and re-entered inputs", async () => {
    const root = makeRoot();
    const record = {
      ...WorkflowRunRecordSchemaForTest("workflow-resume"),
      workflowFingerprint: workflowManifestFingerprint(workflow()),
      stepRuns: [
        { stepId: "collect", skillId: "collector", state: "running", attempt: 1, retryAt: null, runId: "child-1", error: null },
        { stepId: "summarize", skillId: "summarizer", state: "pending", attempt: 0, retryAt: null, runId: null, error: null }
      ]
    };
    fs.writeFileSync(path.join(root, `${record.id}.json`), JSON.stringify(record));
    const submitted: string[] = [];
    const engine = new WorkflowEngine(
      root,
      (request) => {
        submitted.push(request.skillId);
        return child(`resumed-${submitted.length}`, "succeeded");
      },
      () => child("resumed", "succeeded")
    );
    const validationEngine = new WorkflowEngine(root, () => child("unused"), () => child("unused"));
    expect(() => validationEngine.resume(record.id, workflow(), { apiKey: "blocked" }, 1)).toThrow("Secret");

    const resumed = engine.resume(record.id, workflow(), { date: "20260805" }, 1);
    expect(resumed.state).toBe("running");
    await waitFor(() => engine.get(record.id).state === "succeeded");
    expect(submitted).toEqual(["collector", "summarizer"]);
  });

  it("retries only the failed step and preserves completed predecessors", async () => {
    const root = makeRoot();
    const submitted: string[] = [];
    const childStates = new Map<string, BrokerRunRecord["state"]>();
    const engine = new WorkflowEngine(
      root,
      (request) => {
        const id = `${request.skillId}-${submitted.filter((skill) => skill === request.skillId).length + 1}`;
        submitted.push(request.skillId);
        childStates.set(id, request.skillId === "collector" ? "succeeded" : submitted.filter((skill) => skill === "summarizer").length === 1 ? "failed" : "succeeded");
        return child(id, childStates.get(id)!);
      },
      (runId) => child(runId, childStates.get(runId) || "succeeded")
    );
    const manifest = workflowWithRetry();
    const run = engine.start(manifest, {}, 1);
    await waitFor(() => engine.get(run.id).state === "succeeded");

    expect(submitted).toEqual(["collector", "summarizer", "summarizer"]);
    expect(engine.get(run.id).stepRuns.map((step) => step.attempt)).toEqual([1, 2]);
  });

  it("allows an explicit retry of a failed step without rerunning predecessors", async () => {
    const root = makeRoot();
    let shouldFail = true;
    const submitted: string[] = [];
    const childStates = new Map<string, BrokerRunRecord["state"]>();
    const engine = new WorkflowEngine(
      root,
      (request) => {
        submitted.push(request.skillId);
        const id = `run-${submitted.length}`;
        const state = request.skillId === "summarizer" && shouldFail ? "failed" : "succeeded";
        childStates.set(id, state);
        return child(id, state);
      },
      (runId) => child(runId, childStates.get(runId) || "succeeded")
    );
    const run = engine.start(workflow(), {}, 1);
    await waitFor(() => engine.get(run.id).state === "failed");
    shouldFail = false;

    const retried = engine.retryStep(run.id, "summarize");
    expect(retried.state).toBe("running");
    await waitFor(() => engine.get(run.id).state === "succeeded");
    expect(submitted).toEqual(["collector", "summarizer", "summarizer"]);
  });

  it("deletes only terminal Workflow history", async () => {
    const root = makeRoot();
    const engine = new WorkflowEngine(root, () => child("run", "succeeded"), () => child("run", "succeeded"));
    const run = engine.start(workflow(), {}, 1);
    await waitFor(() => engine.get(run.id).state === "succeeded");
    expect(engine.deleteHistory(run.id)).toBe(true);
    expect(fs.existsSync(path.join(root, `${run.id}.json`))).toBe(false);
    expect(() => engine.get(run.id)).toThrow(/不存在/);
  });
});

function workflow(options: { needs?: string[]; cycle?: boolean } = {}) {
  return SkillManifestSchema.parse({
    apiVersion: "cctools.dev/skill/v1",
    id: "daily-workflow",
    version: "1.0.0",
    publisher: { id: "cctools", displayName: "cctools" },
    kind: "workflow",
    display: { name: "Daily Workflow", description: "" },
    capabilities: { mymind: { read: [], write: [] }, network: { required: false, hosts: [] } },
    artifacts: [],
    execution: { concurrency: { maxInstances: 1, mutexes: [] }, timeoutSeconds: 60, gracefulStopSeconds: 1, retry: { maxAttempts: 0 } },
    platforms: ["linux-x64"],
    compatibility: { minAppVersion: "1.0.0" },
    workflow: {
      steps: options.cycle
        ? [
          { id: "collect", skill: "collector", version: "^1.0.0", needs: ["summarize"], with: {} },
          { id: "summarize", skill: "summarizer", version: "^1.0.0", needs: ["collect"], with: {} }
        ]
        : [
          { id: "collect", skill: "collector", version: "^1.0.0", needs: [], with: { date: "{{ inputs.date }}" } },
          { id: "summarize", skill: "summarizer", version: "^1.0.0", needs: options.needs || ["collect"], with: { date: "{{ inputs.date }}" } }
        ]
    }
  }) as WorkflowManifest;
}

function workflowWithRetry(): WorkflowManifest {
  const manifest = workflow() as WorkflowManifest;
  manifest.workflow.steps[1].retry = { maxAttempts: 1, backoffMs: 0 };
  return manifest;
}

function child(id: string, state: BrokerRunRecord["state"] = "succeeded", artifacts: RunArtifact[] = []): BrokerRunRecord {
  return BrokerRunRecordSchema.parse({
    schemaVersion: EXECUTION_SCHEMA_VERSION,
    id,
    request: { skillId: "child", trigger: { type: "manual" }, providerBindingIds: [], externalExportBindingIds: [], inputKeys: [] },
    state,
    sequence: 0,
    rootGeneration: 1,
    skillDigest: null,
    runtime: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    terminalState: null,
    error: null,
    processPid: null,
    orphanPid: null,
    artifacts
  });
}

function artifact(runId: string, id: string, logicalPath: string): RunArtifact {
  return {
    id,
    runId,
    skillId: "collector",
    logicalPath,
    type: "markdown",
    size: 128,
    sha256: "a".repeat(64),
    declared: true,
    createdAt: new Date().toISOString()
  };
}

function workflowWithArtifactHandoff(): WorkflowManifest {
  const manifest = workflow() as WorkflowManifest;
  manifest.workflow.steps[1].with = {
    artifactPath: "{{ steps.collect.artifacts.summary.logicalPath }}",
    checksum: "{{ steps.collect.artifacts.summary.sha256 }}"
  };
  return manifest;
}

function WorkflowRunRecordSchemaForTest(id: string) {
  return {
    schemaVersion: EXECUTION_SCHEMA_VERSION,
    id,
    workflowSkillId: "daily-workflow",
    workflowVersion: "1.0.0",
    workflowFingerprint: workflowManifestFingerprint(workflow()),
    state: "running",
    rootGeneration: 1,
    createdAt: new Date().toISOString(),
    completedAt: null,
    stepRuns: [{ stepId: "collect", skillId: "collector", state: "running", attempt: 1, retryAt: null, runId: "child-1", error: null }]
  };
}

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-workflow-engine-"));
  roots.push(root);
  return root;
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("workflow wait timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

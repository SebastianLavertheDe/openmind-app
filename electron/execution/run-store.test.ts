import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunStore } from "./run-store";
import { SkillRunRequestSchema } from "../../shared/execution-contracts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("RunStore", () => {
  it("persists only request metadata and enforces a single terminal transition", () => {
    const root = makeRoot();
    const store = new RunStore(root);
    const run = store.create(request({ apiKey: "plain-secret" }), "run-1");

    store.transition(run.id, "inspecting");
    store.transition(run.id, "preparing_runtime");
    store.transition(run.id, "running");
    store.appendOutput(run.id, "stdout", "done");
    const completed = store.transition(run.id, "succeeded");
    expect(completed.terminalState).toBe("succeeded");
    expect(store.transition(run.id, "succeeded")).toEqual(completed);
    expect(() => store.transition(run.id, "failed")).toThrow(/已经结束/);
    expect(JSON.stringify(fs.readFileSync(path.join(root, "run-1", "run.json"), "utf8"))).not.toContain("plain-secret");
    expect(store.events(run.id).map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("recovers in-flight runs after reopening without changing terminal history", () => {
    const root = makeRoot();
    const first = new RunStore(root);
    first.create(request(), "run-recover");
    first.transition("run-recover", "inspecting");
    first.transition("run-recover", "waiting_execution_consent");

    const file = path.join(root, first.list()[0].id, "run.json");
    const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
    persisted.ownerPid = 2147483647; // Simulate a terminated owner, not another live broker.
    fs.writeFileSync(file, JSON.stringify(persisted));
    const reopened = new RunStore(root);
    const recovered = reopened.recoverInterrupted();

    expect(recovered).toHaveLength(1);
    expect(reopened.get("run-recover").terminalState).toBe("failed");
    expect(reopened.events("run-recover").at(-1)?.reason).toBe("application-restarted");
    expect(reopened.recoverInterrupted()).toEqual([]);
  });

  it("records a possible orphan PID during restart recovery", () => {
    const root = makeRoot();
    const first = new RunStore(root);
    first.create(request(), "run-orphan");
    first.transition("run-orphan", "inspecting");
    first.transition("run-orphan", "preparing_runtime");
    first.transition("run-orphan", "running");
    first.bindProcessPid("run-orphan", process.pid);

    const file = path.join(root, first.list()[0].id, "run.json");
    const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
    persisted.ownerPid = 2147483647; // Simulate a terminated owner, not another live broker.
    fs.writeFileSync(file, JSON.stringify(persisted));
    const reopened = new RunStore(root);
    const recovered = reopened.recoverInterrupted();

    expect(recovered[0]?.orphanPid).toBe(process.pid);
    expect(reopened.get("run-orphan").processPid).toBeNull();
    expect(reopened.get("run-orphan").error).toContain(`PID ${process.pid}`);
  });

  it("preserves live owner runs when another broker opens the same history", () => {
    const root = makeRoot(); const first = new RunStore(root);
    first.create(request(), "live-owner");
    const second = new RunStore(root);
    expect(second.recoverInterrupted()).toEqual([]);
    expect(second.get("live-owner").state).toBe("queued");
  });

  it("lists artifacts and deletes only terminal Run metadata", () => {
    const root = makeRoot();
    const store = new RunStore(root);
    store.create(request(), "run-artifacts");
    store.transition("run-artifacts", "inspecting");
    store.transition("run-artifacts", "preparing_runtime");
    store.transition("run-artifacts", "running");
    store.attachArtifacts("run-artifacts", [{ id: "artifact-1", runId: "run-artifacts", skillId: "example-skill", logicalPath: "daily-summary/out.md", type: "markdown", size: 4, declared: true, createdAt: new Date().toISOString() }]);
    store.transition("run-artifacts", "succeeded");

    expect(store.listArtifacts()).toHaveLength(1);
    expect(store.listArtifacts("run-artifacts")[0]?.logicalPath).toBe("daily-summary/out.md");
    expect(store.deleteHistory("run-artifacts")).toBe(true);
    expect(fs.existsSync(path.join(root, "run-artifacts"))).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it("refuses to delete an active Run", () => {
    const root = makeRoot();
    const store = new RunStore(root);
    store.create(request(), "run-active");
    expect(() => store.deleteHistory("run-active")).toThrow(/已经结束/);
    expect(store.get("run-active").state).toBe("queued");
  });
});

function request(inputs: Record<string, unknown> = {}) {
  return SkillRunRequestSchema.parse({
    skillId: "example-skill",
    digest: "a".repeat(64),
    inputs,
    providerBindings: { default: "provider-main" },
    trigger: { type: "manual" },
    rootGeneration: 1
  });
}

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-run-store-"));
  roots.push(root);
  return root;
}

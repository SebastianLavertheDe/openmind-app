import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectMaterialConverter } from "./material-service";
import { ProjectService } from "./project-service";

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fs.rmSync(fixture, { recursive: true, force: true });
});

function fixture(options: Partial<ConstructorParameters<typeof ProjectService>[1]> = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-project-integrity-"));
  const root = path.join(base, "content");
  fs.mkdirSync(root);
  const imports = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-project-integrity-import-"));
  fixtures.push(base, imports);
  return { root, imports, service: new ProjectService(root, { stateRoot: path.join(root, "..", "state"), ...options }) };
}

describe("Project persisted identity validation", () => {
  it("keeps the project and remaining files readable after files are deleted outside the app", async () => {
    const { root, imports, service } = fixture();
    service.createProject({ name: "Missing" });
    const sourceA = path.join(imports, "A.md");
    const sourceB = path.join(imports, "B.md");
    fs.writeFileSync(sourceA, "# A");
    fs.writeFileSync(sourceB, "# B");
    const [a, b] = await service.addProjectFiles("Missing", [sourceA, sourceB]);
    const outputA = service.createProjectOutput({ projectName: "Missing", title: "A", content: "A" }).output;
    const outputB = service.createProjectOutput({ projectName: "Missing", title: "B", content: "B" }).output;
    const projectRoot = service.resolveProjectRoot("Missing");
    const indexPath = path.join(projectRoot, "materials", ".openmind-materials.json");
    const before = fs.readFileSync(indexPath, "utf8");
    fs.unlinkSync(path.join(projectRoot, a.relativePath));
    fs.unlinkSync(path.join(projectRoot, outputA.relativePath));
    const restarted = new ProjectService(root, { stateRoot: path.join(root, "..", "state") });
    expect(restarted.listProjects()[0]).toMatchObject({ materialCount: 1, outputCount: 1 });
    expect(restarted.getProject("Missing").project).toMatchObject({ materialCount: 1, outputCount: 1 });
    expect(restarted.listProjectMaterials("Missing").map(item => item.relativePath)).toEqual([b.relativePath]);
    expect(restarted.listProjectOutputs("Missing").map(item => item.relativePath)).toEqual([outputB.relativePath]);
    expect(restarted.readProjectMaterial("Missing", b.relativePath).content).toContain("B");
    expect(restarted.readProjectOutput("Missing", outputB.relativePath).content).toBe("B");
    expect(() => restarted.readProjectMaterial("Missing", a.relativePath)).toThrow(/不存在/);
    expect(fs.readFileSync(indexPath, "utf8")).toBe(before);
  });

  it("rejects Task metadata whose projectName or taskId disagrees with its directory", () => {
    const { root, service } = fixture();
    service.createProject({ name: "Identity" });
    const task = service.createProjectTask("Identity", "Draft", "provider-a");
    const taskFile = service.tasks.taskFile("Identity", task.taskId);
    const baseline = readJson(taskFile);
    const message = {
      id: "identity-message",
      role: "user" as const,
      content: "identity-bound",
      sourceMessageId: null,
      createdAt: "2026-08-31T00:00:00.000Z"
    };

    writeJson(taskFile, { ...baseline, projectName: "Other" });
    expect(() => service.getProjectTask("Identity", task.taskId)).toThrow(/projectName/);
    expect(() => service.listProjectTaskMessages("Identity", task.taskId)).toThrow(/projectName/);
    expect(() => service.appendProjectTaskMessage("Identity", task.taskId, message)).toThrow(/projectName/);

    writeJson(taskFile, { ...baseline, taskId: "7f43fc74-10a1-4e71-97cd-ec90d2660c1c" });
    expect(() => service.listProjectTasks("Identity")).toThrow(/taskId/);
    expect(() => service.appendProjectTaskMessage("Identity", task.taskId, message)).toThrow(/taskId/);
  });

  it("rejects forged, misplaced, traversing or duplicate Material index records", async () => {
    const { root, imports, service } = fixture();
    service.createProject({ name: "Materials" });
    const source = path.join(imports, "source.md");
    fs.writeFileSync(source, "# source\n", "utf8");
    await service.addProjectFiles("Materials", [source]);
    const indexFile = path.join(root, "projects", "Materials", "materials", ".openmind-materials.json");
    const baseline = readJson(indexFile) as Array<Record<string, unknown>>;

    for (const records of [
      [{ ...baseline[0], projectName: "Other" }],
      [{ ...baseline[0], relativePath: "../outside.md" }],
      [{ ...baseline[0], relativePath: "materials/web/source.md" }],
      [baseline[0], { ...baseline[0], title: "duplicate" }]
    ]) {
      writeJson(indexFile, records);
      expect(() => service.listProjectMaterials("Materials")).toThrow();
    }
  });

  it("rejects forged, traversing or duplicate Output index records", () => {
    const { root, service } = fixture();
    service.createProject({ name: "Outputs" });
    service.createProjectOutput({ projectName: "Outputs", title: "Draft", content: "body" });
    const indexFile = path.join(root, "projects", "Outputs", "outputs", ".openmind-outputs.json");
    const baseline = readJson(indexFile) as Array<Record<string, unknown>>;

    for (const records of [
      [{ ...baseline[0], projectName: "Other" }],
      [{ ...baseline[0], relativePath: "../Draft.md" }],
      [{ ...baseline[0], relativePath: "materials/Draft.md" }],
      [baseline[0], { ...baseline[0], title: "duplicate" }]
    ]) {
      writeJson(indexFile, records);
      expect(() => service.listProjectOutputs("Outputs")).toThrow();
    }
  });

  it("binds Output provenance to the same Task, current or historical Session, and transcript Message", () => {
    const { root, service } = fixture();
    service.createProject({ name: "Provenance" });
    const first = service.createProjectTask("Provenance", "First", "provider-a");
    const second = service.createProjectTask("Provenance", "Second", "provider-a");
    service.bindProjectTaskSession("Provenance", first.taskId, "session-first");
    service.bindProjectTaskSession("Provenance", second.taskId, "session-second");
    service.appendProjectTaskMessage("Provenance", first.taskId, {
      id: "11111111-1111-4111-8111-111111111111",
      runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      role: "assistant",
      content: "first",
      sourceMessageId: "message-first",
      createdAt: "2026-08-31T00:00:00.000Z"
    });
    service.appendProjectTaskMessage("Provenance", second.taskId, {
      id: "22222222-2222-4222-8222-222222222222",
      runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      role: "assistant",
      content: "second",
      sourceMessageId: "message-second",
      createdAt: "2026-08-31T00:00:01.000Z"
    });

    expect(() => service.createProjectOutput({
      projectName: "Provenance",
      title: "No task",
      sourceSessionId: "session-first",
      content: "invalid"
    })).toThrow();
    expect(() => service.createProjectOutput({
      projectName: "Provenance",
      title: "Cross session",
      sourceTaskId: first.taskId,
      sourceSessionId: "session-second",
      content: "invalid"
    })).toThrow(/Session/);
    expect(() => service.createProjectOutput({
      projectName: "Provenance",
      title: "Cross message",
      sourceTaskId: first.taskId,
      sourceSessionId: "session-first",
      sourceMessageId: "message-second",
      content: "invalid"
    })).toThrow(/Message/);

    const created = service.createProjectOutput({
      projectName: "Provenance",
      title: "Valid",
      sourceTaskId: first.taskId,
      sourceSessionId: "session-first",
      sourceMessageId: "message-first",
      content: "valid"
    });
    service.renameProject("Provenance", "Provenance Renamed");
    service.bindProjectTaskSession("Provenance Renamed", first.taskId, "session-next");
    expect(service.listProjectOutputs("Provenance Renamed")).toEqual([
      expect.objectContaining({ relativePath: created.output.relativePath, sourceSessionId: "session-first" })
    ]);
    expect(service.getProjectTask("Provenance Renamed", first.taskId).previousSessionIds).toContain("session-first");
    expect(() => service.createProjectOutput({
      projectName: "Provenance Renamed",
      title: "Cross historical message",
      sourceTaskId: first.taskId,
      sourceSessionId: "session-next",
      sourceMessageId: "message-first",
      content: "invalid"
    })).toThrow(/Session/);
    service.appendProjectTaskMessage("Provenance Renamed", first.taskId, {
      id: "33333333-3333-4333-8333-333333333333",
      runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      role: "user",
      content: "prompt",
      sourceMessageId: "user-message-next",
      createdAt: "2026-08-31T00:00:02.000Z"
    });
    expect(() => service.createProjectOutput({
      projectName: "Provenance Renamed",
      title: "User message",
      sourceTaskId: first.taskId,
      sourceSessionId: "session-next",
      sourceMessageId: "user-message-next",
      content: "invalid"
    })).toThrow(/最终回答/);

    const indexFile = path.join(root, "projects", "Provenance Renamed", "outputs", ".openmind-outputs.json");
    const records = readJson(indexFile) as Array<Record<string, unknown>>;
    writeJson(indexFile, records.map((record) => ({ ...record, sourceSessionId: "forged-session" })));
    expect(() => service.listProjectOutputs("Provenance Renamed")).toThrow(/Session/);
  });

  it("sanitizes extended Windows device names for Material and Output files", async () => {
    const { imports, service } = fixture();
    service.createProject({ name: "Reserved Files" });
    const source = path.join(imports, "COM¹.txt");
    fs.writeFileSync(source, "reserved", "utf8");
    const [material] = await service.addProjectFiles("Reserved Files", [source]);
    const output = service.createProjectOutput({
      projectName: "Reserved Files",
      title: "CONOUT$",
      content: "reserved"
    });
    expect(material.relativePath).toBe("materials/documents/资料-COM¹.txt");
    expect(output.output.relativePath).toBe("outputs/未命名产物.md");
  });
});

describe("Project material restart reconciliation", () => {
  it("marks persisted importing/converting records failed after restart", async () => {
    const { root, imports, service } = fixture();
    service.createProject({ name: "Restart" });
    const first = path.join(imports, "first.md");
    const second = path.join(imports, "second.txt");
    fs.writeFileSync(first, "first", "utf8");
    fs.writeFileSync(second, "second", "utf8");
    await service.addProjectFiles("Restart", [first, second]);
    const indexFile = path.join(root, "projects", "Restart", "materials", ".openmind-materials.json");
    const records = readJson(indexFile) as Array<Record<string, unknown>>;
    writeJson(indexFile, records.map((record, index) => ({
      ...record,
      status: index === 0 ? "importing" : "converting",
      errorCode: null,
      errorMessage: null
    })));

    const restarted = new ProjectService(root, { stateRoot: path.join(root, "..", "state") });
    const reconciled = restarted.listProjectMaterials("Restart");
    expect(reconciled).toHaveLength(2);
    expect(reconciled.every((record) => record.status === "failed")).toBe(true);
    expect(reconciled.every((record) => record.errorCode === "material-conversion-interrupted")).toBe(true);
    expect(readJson(indexFile)).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "failed", errorCode: "material-conversion-interrupted" })
    ]));
  });

  it("does not reconcile a conversion that is active in this process", async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const conversionStarted = new Promise<void>((resolve) => { entered = resolve; });
    const converter: ProjectMaterialConverter = {
      id: "slow-test-v1",
      supportedExtensions: [".slow"],
      supports: (source) => source.type === "file" && source.extension === ".slow",
      target: () => ({ kind: "document", directory: "documents", fileName: "slow.md", title: "Slow" }),
      convert: async () => {
        entered();
        await gate;
        return { content: "done", mimeType: "text/markdown" };
      }
    };
    const { imports, service } = fixture({ materialConverters: [converter] });
    service.createProject({ name: "Active" });
    const source = path.join(imports, "source.slow");
    fs.writeFileSync(source, "source", "utf8");

    const conversion = service.addProjectFiles("Active", [source]);
    await conversionStarted;
    const active = service.listProjectMaterials("Active")[0];
    expect(active.status).toBe("converting");
    expect(() => service.removeProjectMaterial("Active", active.relativePath)).toThrow(/正在转换/);
    expect(() => service.renameProject("Active", "Renamed")).toThrow(/正在转换/);
    expect(fs.existsSync(service.resolveProjectRoot("Active"))).toBe(true);
    release();
    await expect(conversion).resolves.toEqual([expect.objectContaining({ status: "ready" })]);
  });

  it("recognizes a live conversion marker created by another service instance", async () => {
    const { root, imports, service } = fixture();
    service.createProject({ name: "CrossProcess" });
    const source = path.join(imports, "source.md");
    fs.writeFileSync(source, "source", "utf8");
    const [material] = await service.addProjectFiles("CrossProcess", [source]);
    const projectRoot = service.resolveProjectRoot("CrossProcess");
    const indexFile = path.join(projectRoot, "materials", ".openmind-materials.json");
    const records = readJson(indexFile) as Array<Record<string, unknown>>;
    writeJson(indexFile, records.map((record) => ({ ...record, status: "converting" })));
    const markerDirectory = path.join(projectRoot, "materials", ".openmind-active-conversions");
    fs.mkdirSync(markerDirectory);
    const markerPath = path.join(markerDirectory, "external.json");
    writeJson(markerPath, {
      token: "external",
      pid: process.pid,
      projectName: "CrossProcess",
      relativePath: material.relativePath,
      createdAt: new Date().toISOString()
    });
    const old = new Date("2000-01-01T00:00:00.000Z");
    fs.utimesSync(markerPath, old, old);

    const otherService = new ProjectService(root, { stateRoot: path.join(root, "..", "state") });
    expect(otherService.listProjectMaterials("CrossProcess")[0].status).toBe("converting");
    expect(() => otherService.renameProject("CrossProcess", "Blocked")).toThrow(/正在转换/);
    fs.rmSync(markerDirectory, { recursive: true });
    expect(new ProjectService(root, { stateRoot: path.join(root, "..", "state") }).listProjectMaterials("CrossProcess")[0]).toMatchObject({
      status: "failed",
      errorCode: "material-conversion-interrupted"
    });
  });
});

describe("Project cross-process read-modify-write persistence", () => {
  it("preserves overlapping Material conversions from independent service instances", async () => {
    let release!: () => void;
    let bothStarted!: () => void;
    let started = 0;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const conversionsStarted = new Promise<void>((resolve) => { bothStarted = resolve; });
    const converter: ProjectMaterialConverter = {
      id: "concurrent-material-v1",
      supportedExtensions: [".parallel"],
      supports: (source) => source.type === "file" && source.extension === ".parallel",
      target: () => ({ kind: "document", directory: "documents", fileName: "same.md", title: "Same" }),
      convert: async ({ source }) => {
        started += 1;
        if (started === 2) bothStarted();
        await gate;
        if (source.type !== "file") throw new Error("expected file source");
        return { content: source.originalName, mimeType: "text/markdown" };
      }
    };
    const { root, imports, service } = fixture({ materialConverters: [converter] });
    service.createProject({ name: "Concurrent Materials" });
    const otherService = new ProjectService(root, { stateRoot: path.join(root, "..", "state"), materialConverters: [converter] });
    const first = path.join(imports, "first.parallel");
    const second = path.join(imports, "second.parallel");
    fs.writeFileSync(first, "first", "utf8");
    fs.writeFileSync(second, "second", "utf8");

    const firstConversion = service.addProjectFiles("Concurrent Materials", [first]);
    const secondConversion = otherService.addProjectFiles("Concurrent Materials", [second]);
    await conversionsStarted;
    expect(service.listProjectMaterials("Concurrent Materials")).toHaveLength(2);
    release();
    await expect(Promise.all([firstConversion, secondConversion])).resolves.toEqual([
      [expect.objectContaining({ status: "ready" })],
      [expect.objectContaining({ status: "ready" })]
    ]);

    const materials = new ProjectService(root, { stateRoot: path.join(root, "..", "state") }).listProjectMaterials("Concurrent Materials");
    expect(materials).toHaveLength(2);
    expect(materials.every((material) => material.status === "ready")).toBe(true);
    expect(new Set(materials.map((material) => material.relativePath)).size).toBe(2);
  });

  it("preserves concurrent Task messages and Output records from separate processes", async () => {
    const { root, service } = fixture();
    service.createProject({ name: "Concurrent" });
    const task = service.createProjectTask("Concurrent", "Concurrent writes", "provider-a");
    const gate = path.join(root, "start-workers");
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "electron/project/project-service.ts")).href;
    const script = `
      import fs from "node:fs";
      import { ProjectService } from ${JSON.stringify(moduleUrl)};
      const worker = Number(process.env.PROJECT_TEST_WORKER);
      const service = new ProjectService(process.env.PROJECT_TEST_ROOT, { stateRoot: process.env.PROJECT_TEST_ROOT + "/../state" });
      fs.writeFileSync(process.env.PROJECT_TEST_READY, "ready");
      while (!fs.existsSync(process.env.PROJECT_TEST_GATE)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
      for (let index = 0; index < 5; index += 1) {
        const id = \`00000000-0000-4000-800\${worker}-\${String(index).padStart(12, "0")}\`;
        service.appendProjectTaskMessage("Concurrent", process.env.PROJECT_TEST_TASK, {
          id,
          runId: \`00000000-0000-4000-900\${worker}-\${String(index).padStart(12, "0")}\`,
          role: "user",
          content: id,
          sourceMessageId: null,
          createdAt: new Date(Date.UTC(2026, 7, 31, 0, 0, worker * 10 + index)).toISOString()
        });
        service.createProjectOutput({ projectName: "Concurrent", title: "Same", content: id });
      }
    `;
    const children = [1, 2].map((worker) => {
      const ready = path.join(root, `worker-${worker}-ready`);
      const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "-e", script], {
        env: {
          ...process.env,
          PROJECT_TEST_ROOT: root,
          PROJECT_TEST_READY: ready,
          PROJECT_TEST_GATE: gate,
          PROJECT_TEST_TASK: task.taskId,
          PROJECT_TEST_WORKER: String(worker)
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      return { child, ready };
    });
    await Promise.all(children.map(({ child, ready }) => waitForFile(ready, child)));
    fs.writeFileSync(gate, "go", "utf8");
    await Promise.all(children.map(({ child }) => waitForExit(child)));

    const restarted = new ProjectService(root, { stateRoot: path.join(root, "..", "state") });
    expect(restarted.listProjectTaskMessages("Concurrent", task.taskId)).toHaveLength(10);
    const outputs = restarted.listProjectOutputs("Concurrent");
    expect(outputs).toHaveLength(10);
    expect(new Set(outputs.map((output) => output.relativePath)).size).toBe(10);
  });
});

describe("Project rename transaction recovery", () => {
  it("restores the exact Task sessions and indexes after an in-process migration failure", async () => {
    const { root, imports, service } = fixture();
    service.createProject({ name: "Rollback", description: "before" });
    const task = service.createProjectTask("Rollback", "Write", "provider-a");
    service.bindProjectTaskSession("Rollback", task.taskId, "session-before");
    const source = path.join(imports, "source.md");
    fs.writeFileSync(source, "source", "utf8");
    await service.addProjectFiles("Rollback", [source]);
    service.createProjectOutput({ projectName: "Rollback", title: "Draft", content: "draft", sourceTaskId: task.taskId });
    const projectRoot = service.resolveProjectRoot("Rollback");
    const snapshots = {
      manifest: readJson(path.join(projectRoot, ".openmind-project.json")),
      materials: readJson(path.join(projectRoot, "materials", ".openmind-materials.json")),
      outputs: readJson(path.join(projectRoot, "outputs", ".openmind-outputs.json")),
      task: readJson(service.tasks.taskFile("Rollback", task.taskId))
    };
    vi.spyOn(service.outputs, "renameProject").mockImplementationOnce(() => {
      throw new Error("injected output migration failure");
    });

    expect(() => service.renameProject("Rollback", "Rollback Next")).toThrow("injected output migration failure");
    const restoredRoot = service.resolveProjectRoot("Rollback");
    expect(() => service.resolveProjectRoot("Rollback Next")).toThrow();
    expect(readJson(path.join(restoredRoot, ".openmind-project.json"))).toEqual(snapshots.manifest);
    expect(readJson(path.join(restoredRoot, "materials", ".openmind-materials.json"))).toEqual(snapshots.materials);
    expect(readJson(path.join(restoredRoot, "outputs", ".openmind-outputs.json"))).toEqual(snapshots.outputs);
    expect(readJson(service.tasks.taskFile("Rollback", task.taskId))).toEqual(snapshots.task);
    expect(service.getProjectTask("Rollback", task.taskId).sessionId).toBe("session-before");
    expect(fs.existsSync(path.join(root, "projects", ".openmind-project-rename.json"))).toBe(false);
  });

  it("recovers an interrupted rename journal on the next process startup", async () => {
    const { root, imports, service } = fixture();
    service.createProject({ name: "Crash", description: "before" });
    const task = service.createProjectTask("Crash", "Write", "provider-a");
    service.bindProjectTaskSession("Crash", task.taskId, "session-crash");
    const source = path.join(imports, "crash.md");
    fs.writeFileSync(source, "crash", "utf8");
    await service.addProjectFiles("Crash", [source]);
    service.createProjectOutput({ projectName: "Crash", title: "Draft", content: "draft", sourceTaskId: task.taskId });
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "electron/project/project-service.ts")).href;
    const script = `
      import { ProjectService } from ${JSON.stringify(moduleUrl)};
      const service = new ProjectService(process.env.PROJECT_TEST_ROOT, { stateRoot: process.env.PROJECT_TEST_ROOT + "/../state" });
      service.outputs.renameProject = () => process.exit(73);
      service.renameProject("Crash", "Crash Next");
    `;
    const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "-e", script], {
      env: { ...process.env, PROJECT_TEST_ROOT: root },
      stdio: ["ignore", "pipe", "pipe"]
    });
    await waitForExitCode(child, 73);
    const journalPath = path.join(root, "projects", ".openmind-project-rename.json");
    expect(fs.existsSync(journalPath)).toBe(true);
    expect(fs.existsSync(path.join(root, "projects", "Crash Next"))).toBe(true);
    const lockPath = path.join(root, "projects", ".openmind-projects.lock");
    const old = new Date("2000-01-01T00:00:00.000Z");
    fs.utimesSync(lockPath, old, old);

    const restarted = new ProjectService(root, { stateRoot: path.join(root, "..", "state") });
    expect(restarted.getProjectTask("Crash", task.taskId).sessionId).toBe("session-crash");
    expect(restarted.listProjectMaterials("Crash")).toEqual([
      expect.objectContaining({ projectName: "Crash", status: "ready" })
    ]);
    expect(restarted.listProjectOutputs("Crash")).toEqual([
      expect.objectContaining({ projectName: "Crash", sourceTaskId: task.taskId })
    ]);
    expect(() => restarted.resolveProjectRoot("Crash Next")).toThrow();
    expect(fs.existsSync(journalPath)).toBe(false);
  });

  it("keeps a fully committed rename when the process exits before journal cleanup", async () => {
    const { root, service } = fixture();
    service.createProject({ name: "Committed Crash" });
    const task = service.createProjectTask("Committed Crash", "Write", "provider-a");
    service.bindProjectTaskSession("Committed Crash", task.taskId, "session-committed");
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "electron/project/project-service.ts")).href;
    const script = `
      import { ProjectService } from ${JSON.stringify(moduleUrl)};
      const service = new ProjectService(process.env.PROJECT_TEST_ROOT, { stateRoot: process.env.PROJECT_TEST_ROOT + "/../state" });
      service.removeRenameJournal = () => process.exit(74);
      service.renameProject("Committed Crash", "Committed Crash Next");
    `;
    const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "-e", script], {
      env: { ...process.env, PROJECT_TEST_ROOT: root },
      stdio: ["ignore", "pipe", "pipe"]
    });
    await waitForExitCode(child, 74);
    const journalPath = path.join(root, "projects", ".openmind-project-rename.json");
    expect((readJson(journalPath) as { phase: string }).phase).toBe("committed");
    const lockPath = path.join(root, "projects", ".openmind-projects.lock");
    const old = new Date("2000-01-01T00:00:00.000Z");
    fs.utimesSync(lockPath, old, old);

    const restarted = new ProjectService(root, { stateRoot: path.join(root, "..", "state") });
    expect(restarted.getProject("Committed Crash Next").project.name).toBe("Committed Crash Next");
    expect(restarted.getProjectTask("Committed Crash Next", task.taskId)).toMatchObject({
      sessionId: null,
      previousSessionIds: ["session-committed"]
    });
    expect(() => restarted.resolveProjectRoot("Committed Crash")).toThrow();
    expect(fs.existsSync(journalPath)).toBe(false);
  });
});

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function waitForFile(filePath: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(filePath)) {
    if (child.exitCode !== null) throw new Error(`Project persistence worker exited early with ${child.exitCode}`);
    if (Date.now() > deadline) throw new Error("Timed out waiting for Project persistence worker");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForExit(child: ChildProcess): Promise<void> {
  const stderr: Buffer[] = [];
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
  const exitCode = child.exitCode ?? await new Promise<number | null>((resolve) => child.once("exit", resolve));
  if (exitCode !== 0) throw new Error(`Project persistence worker failed (${exitCode}): ${Buffer.concat(stderr).toString("utf8")}`);
}

async function waitForExitCode(child: ChildProcess, expected: number): Promise<void> {
  const stderr: Buffer[] = [];
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
  const exitCode = child.exitCode ?? await new Promise<number | null>((resolve) => child.once("exit", resolve));
  if (exitCode !== expected) {
    throw new Error(`Project fault-injection worker exited with ${exitCode}: ${Buffer.concat(stderr).toString("utf8")}`);
  }
}

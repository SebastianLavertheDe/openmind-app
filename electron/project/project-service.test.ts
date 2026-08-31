import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ProjectMaterialConversionSource,
  ProjectMaterialConverter
} from "./material-service";
import { ProjectService } from "./project-service";

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fs.rmSync(fixture, { recursive: true, force: true });
});

function fixture(options: ConstructorParameters<typeof ProjectService>[1] = {}): {
  root: string;
  imports: string;
  service: ProjectService;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-project-service-"));
  const imports = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-project-import-"));
  fixtures.push(root, imports);
  return { root, imports, service: new ProjectService(root, options) };
}

describe("ProjectService", () => {
  it("persists independent Project, Task and Output records across restart, rename and archive", () => {
    const { root, service } = fixture();
    expect(service.createProject({ name: "研究", description: "独立项目" }).project.name).toBe("研究");
    const task = service.createProjectTask("研究", "写文章", "provider-a");
    const output = service.createProjectOutput({
      projectName: "研究",
      title: "初稿",
      content: "# 初稿\n",
      sourceTaskId: task.taskId
    });

    const restarted = new ProjectService(root);
    expect(restarted.listProjectTasks("研究")).toEqual([task]);
    expect(restarted.readProjectOutput("研究", output.output.relativePath).content).toBe("# 初稿\n");

    const renamed = restarted.renameProject("研究", "研究 2026");
    expect(renamed.project.name).toBe("研究 2026");
    expect(restarted.listProjectTasks("研究 2026")[0]).toMatchObject({ projectName: "研究 2026", taskId: task.taskId });
    expect(restarted.listProjectOutputs("研究 2026")[0]).toMatchObject({ projectName: "研究 2026" });
    expect(() => restarted.getProject("研究")).toThrow();

    const projectRoot = restarted.resolveProjectRoot("研究 2026");
    restarted.archiveProject("研究 2026", true);
    expect(restarted.getProject("研究 2026").project.status).toBe("archived");
    expect(restarted.resolveProjectRoot("研究 2026")).toBe(projectRoot);
  });

  it("imports ordinary UTF-8 MD/TXT files, deduplicates content and protects control filenames", async () => {
    const { imports, service } = fixture();
    service.createProject({ name: "Materials" });
    const markdown = path.join(imports, "AGENTS.md");
    const duplicate = path.join(imports, "same.txt");
    fs.writeFileSync(markdown, "# Project facts\n", "utf8");
    fs.writeFileSync(duplicate, "# Project facts\n", "utf8");

    const [first] = await service.addProjectFiles("Materials", [markdown]);
    const [same] = await service.addProjectFiles("Materials", [duplicate]);
    expect(first.status).toBe("ready");
    expect(first.relativePath).toBe("materials/documents/资料-AGENTS.md");
    expect(same.relativePath).toBe(first.relativePath);
    expect(service.readProjectMaterial("Materials", first.relativePath).content).toBe("# Project facts\n");
    expect(service.getProject("Materials").project.materialCount).toBe(1);
  });

  it("keeps converter failures retryable using only the project-owned original", async () => {
    let attempts = 0;
    const converter: ProjectMaterialConverter = {
      id: "test-foo-v1",
      supportedExtensions: [".foo"],
      supports: (source: ProjectMaterialConversionSource) => source.type === "file" && source.extension === ".foo",
      target: () => ({
        kind: "document",
        directory: "documents",
        fileName: "converted.md",
        title: "Converted",
        preserveOriginal: true
      }),
      convert: async ({ source, originalAbsolutePath }) => {
        attempts += 1;
        expect(originalAbsolutePath).toContain(`${path.sep}materials${path.sep}originals${path.sep}`);
        if (attempts === 1) throw Object.assign(new Error("temporary failure"), { code: "temporary" });
        if (source.type !== "file") throw new Error("expected file");
        return { content: `# ${fs.readFileSync(source.absolutePath, "utf8")}`, mimeType: "text/markdown" };
      }
    };
    const { imports, service } = fixture({ materialConverters: [converter] });
    service.createProject({ name: "Retry" });
    const source = path.join(imports, "source.foo");
    fs.writeFileSync(source, "kept", "utf8");

    await expect(service.addProjectFiles("Retry", [source])).rejects.toThrow("temporary failure");
    const [failed] = service.listProjectMaterials("Retry");
    expect(failed).toMatchObject({ status: "failed", converterId: "test-foo-v1", errorCode: "temporary" });
    expect(failed.originalRelativePath).toBe("materials/originals/source.foo");
    fs.rmSync(source);

    const ready = await service.retryMaterialExtraction("Retry", failed.relativePath);
    expect(ready.status).toBe("ready");
    expect(service.readProjectMaterial("Retry", ready.relativePath).content).toBe("# kept");
  });

  it("uses atomic files without leaving temporary siblings", () => {
    const { root, service } = fixture();
    service.createProject({ name: "Atomic" });
    const task = service.createProjectTask("Atomic", "Task", "provider-a");
    const created = service.createProjectOutput({ projectName: "Atomic", title: "Draft", content: "one", sourceTaskId: task.taskId });
    service.saveProjectOutput({ projectName: "Atomic", relativePath: created.output.relativePath, content: "two" });
    const all = walk(root);
    expect(all.some((entry) => entry.includes(".tmp-"))).toBe(false);
  });

  it("persists a deduplicated Project-readable task transcript and clears the frozen session after rename", () => {
    const { root, service } = fixture();
    service.createProject({ name: "Transcript" });
    const task = service.createProjectTask("Transcript", "Write", "provider-a");
    const sessionId = "session-project-1";
    service.bindProjectTaskSession("Transcript", task.taskId, sessionId);
    const message = {
      id: "message-1",
      role: "user" as const,
      content: "Use the project materials",
      sourceMessageId: "message-1",
      createdAt: "2026-08-31T00:00:00.000Z"
    };
    service.appendProjectTaskMessage("Transcript", task.taskId, message);
    service.appendProjectTaskMessage("Transcript", task.taskId, { ...message, id: "fallback-message-1" });

    const restarted = new ProjectService(root);
    expect(restarted.findProjectTaskBySessionId(sessionId)?.taskId).toBe(task.taskId);
    expect(restarted.tasks.listMessages("Transcript", task.taskId)).toEqual([{ ...message, sessionId }]);

    restarted.renameProject("Transcript", "Renamed Transcript");
    expect(restarted.listProjectTasks("Renamed Transcript")[0]).toMatchObject({
      projectName: "Renamed Transcript",
      sessionId: null,
      status: "active"
    });
    expect(restarted.tasks.listMessages("Renamed Transcript", task.taskId)).toEqual([{ ...message, sessionId }]);
  });
});

function walk(root: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    result.push(absolute);
    if (entry.isDirectory() && !entry.isSymbolicLink()) result.push(...walk(absolute));
  }
  return result;
}

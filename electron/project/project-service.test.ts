import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectMaterialConversionSource,
  ProjectMaterialConverter
} from "./material-service";
import { ProjectService } from "./project-service";

const fixtures: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) fs.rmSync(fixture, { recursive: true, force: true });
});

function fixture(options: Partial<ConstructorParameters<typeof ProjectService>[1]> = {}): {
  root: string;
  imports: string;
  service: ProjectService;
} {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-project-service-"));
  const root = path.join(base, "content");
  fs.mkdirSync(root);
  const imports = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-project-import-"));
  fixtures.push(base, imports);
  return { root, imports, service: new ProjectService(root, { stateRoot: path.join(root, "..", "state"), ...options }) };
}

describe("ProjectService", () => {
  it("lists summaries without task detail scans, and reuses only unchanged validated metadata", () => {
    const { service } = fixture();
    service.createProject({ name: "Summary" });
    const tasks = Array.from({ length: 20 }, (_, index) => service.createProjectTask("Summary", `Task ${index}`, "provider-a"));
    expect(service.listProjects()[0].taskCount).toBe(20);
    const details = vi.spyOn(service, "getProject");
    const taskList = vi.spyOn(service.tasks, "list");
    const reads = vi.spyOn(fs, "readFileSync");
    const stats = vi.spyOn(fs, "lstatSync");
    expect(service.listProjects()[0].taskCount).toBe(20);
    expect(details).not.toHaveBeenCalled();
    expect(taskList).not.toHaveBeenCalled();
    expect(reads.mock.calls.filter(([file]) => String(file).endsWith(`${path.sep}task.json`))).toHaveLength(0);
    // Two leaf checks per task plus a fixed amount of project/index validation.
    expect(stats.mock.calls.length).toBeLessThan(20 * 2 + 150);

    service.archiveProjectTask("Summary", tasks[0].taskId);
    reads.mockClear();
    expect(service.listProjects()[0].taskCount).toBe(19);
    expect(reads.mock.calls.filter(([file]) => String(file).endsWith(`${path.sep}task.json`))).toHaveLength(1);
    service.setProjectTaskStatus("Summary", tasks[0].taskId, "active");
    expect(service.listProjects()[0].taskCount).toBe(20);
  });

  it("invalidates task summaries for external edits/deletes and rejects links even on a warm cache", () => {
    const { service } = fixture();
    service.createProject({ name: "Summary" });
    const task = service.createProjectTask("Summary", "Task", "provider-a");
    const file = service.tasks.taskFile("Summary", task.taskId);
    expect(service.listProjects()[0].taskCount).toBe(1);
    const stat = fs.statSync(file);
    fs.writeFileSync(file, JSON.stringify({ ...task, status: "archived" }));
    fs.utimesSync(file, stat.atime, stat.mtime);
    expect(service.listProjects()[0].taskCount).toBe(0);

    fs.writeFileSync(file, JSON.stringify({ ...task, projectName: "Forged" }));
    expect(service.listProjects()).toEqual([]);
    expect(() => service.listProjectTasks("Summary")).toThrow(/projectName/);
    fs.writeFileSync(file, JSON.stringify(task));
    expect(service.listProjects()[0].taskCount).toBe(1);
    const target = `${file}.real`;
    fs.renameSync(file, target);
    fs.symlinkSync(target, file);
    expect(service.listProjects()).toEqual([]);
    fs.unlinkSync(file);
    fs.renameSync(target, file);
    expect(service.listProjects()[0].taskCount).toBe(1);
    fs.rmSync(path.dirname(file), { recursive: true });
    expect(service.listProjects()[0].taskCount).toBe(0);
  });

  it("discards old project transcripts while preserving materials and outputs across restart", () => {
    const { root, service } = fixture();
    const project = service.createProject({ name: "Legacy" }).project;
    const legacyId = "ccf40fb8-6b12-48ce-8cf5-8dd9c362f883";
    const projectRoot = service.resolveProjectRoot(project.name);
    const legacy = path.join(projectRoot, "tasks", legacyId);
    fs.mkdirSync(path.join(legacy, "messages"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "task.json"), "obsolete metadata");
    fs.writeFileSync(path.join(legacy, "messages", "old.json"), "OLD_CONVERSATION");
    const material = path.join(projectRoot, "materials", "keep.md");
    fs.writeFileSync(material, "MATERIAL");
    const output = service.outputs.create({ projectName: project.name, title: "Keep", content: "OUTPUT", sourceTaskId: legacyId });
    const restarted = new ProjectService(root, { stateRoot: path.join(root, "..", "state") });

    expect(fs.existsSync(path.join(projectRoot, "tasks"))).toBe(false);
    expect(restarted.getProject(project.name).project.taskCount).toBe(0);
    expect(fs.readFileSync(material, "utf8")).toBe("MATERIAL");
    expect(restarted.readProjectOutput(project.name, output.output.relativePath)).toMatchObject({
      content: "OUTPUT", output: { sourceTaskId: null, sourceSessionId: null, sourceMessageId: null }
    });
    const task = restarted.createProjectTask(project.name, "New conversation", "provider-a");
    expect(fs.existsSync(path.join(projectRoot, "tasks"))).toBe(false);
    expect(restarted.tasks.taskFile(project.name, task.taskId)).toBe(path.join(
      root, "..", "state", ".openmind", "ai", "project-tasks", project.id, task.taskId, "task.json"
    ));
    expect(new ProjectService(root, { stateRoot: path.join(root, "..", "state") }).listProjectTasks(project.name)).toEqual([task]);
  });

  it("requires task state outside the content root", () => {
    const { root } = fixture();
    expect(() => new ProjectService(root, { stateRoot: root })).toThrow("内容根目录之外");
  });

  it("does not follow a linked legacy task directory during cleanup", () => {
    const { root, imports, service } = fixture();
    service.createProject({ name: "Linked" });
    const sentinel = path.join(imports, "keep.md");
    fs.writeFileSync(sentinel, "KEEP");
    fs.symlinkSync(imports, path.join(service.resolveProjectRoot("Linked"), "tasks"), process.platform === "win32" ? "junction" : "dir");
    expect(() => new ProjectService(root, { stateRoot: path.join(root, "..", "state") })).toThrow();
    expect(fs.readFileSync(sentinel, "utf8")).toBe("KEEP");
  });

  it("rejects links in the private task directory before writing", () => {
    const { imports, service } = fixture();
    service.createProject({ name: "Private link" });
    const directory = service.tasks.projectDirectory("Private link");
    fs.rmdirSync(directory);
    fs.symlinkSync(imports, directory, process.platform === "win32" ? "junction" : "dir");
    expect(() => service.createProjectTask("Private link", "Reject", "provider-a")).toThrow("符号链接");
    expect(fs.readdirSync(imports)).toEqual([]);
  });

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

    const restarted = new ProjectService(root, { stateRoot: path.join(root, "..", "state") });
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

  it("persists project icon, color and favorite metadata across restart", () => {
    const { root, service } = fixture();
    service.createProject({ name: "Appearance" });

    expect(service.updateProject("Appearance", { icon: "gamepad", color: "pink", favorite: true }).project).toMatchObject({
      icon: "gamepad",
      color: "pink",
      favorite: true
    });
    expect(new ProjectService(root, { stateRoot: path.join(root, "..", "state") }).getProject("Appearance").project).toMatchObject({
      icon: "gamepad",
      color: "pink",
      favorite: true
    });
  });

  it("persists task renames and hides archived tasks from visible counts", () => {
    const { root, service } = fixture();
    service.createProject({ name: "Task actions" });
    const task = service.createProjectTask("Task actions", "旧标题", "provider-a");

    expect(service.renameProjectTask("Task actions", task.taskId, "新标题").title).toBe("新标题");
    expect(new ProjectService(root, { stateRoot: path.join(root, "..", "state") }).listProjectTasks("Task actions")[0]?.title).toBe("新标题");

    service.archiveProjectTask("Task actions", task.taskId);
    expect(service.listProjectTasks("Task actions")).toEqual([]);
    expect(service.getProject("Task actions").project.taskCount).toBe(0);
    expect(service.getProjectTask("Task actions", task.taskId).status).toBe("archived");
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

  it("serves preserved PDF originals for preview and rejects materials without one", async () => {
    const pdfConverter: ProjectMaterialConverter = {
      id: "test-pdf-v1",
      supportedExtensions: [".pdf"],
      supports: (source: ProjectMaterialConversionSource) => source.type === "file" && source.extension === ".pdf",
      target: () => ({
        kind: "document",
        directory: "documents",
        fileName: "converted.md",
        title: "Converted",
        preserveOriginal: true
      }),
      convert: async ({ source }) => {
        if (source.type !== "file") throw new Error("expected file");
        return { content: "# 提取文本", mimeType: "text/markdown" };
      }
    };
    const { imports, service } = fixture({ materialConverters: [pdfConverter] });
    service.createProject({ name: "Pdfs" });
    const pdf = path.join(imports, "paper.pdf");
    fs.writeFileSync(pdf, Buffer.from("%PDF-1.4", "latin1"));

    const [material] = await service.addProjectFiles("Pdfs", [pdf]);
    expect(service.readProjectMaterial("Pdfs", material.relativePath).content).toBe("# 提取文本");
    const original = service.readProjectMaterialOriginal("Pdfs", material.relativePath);
    expect(original).toMatchObject({ fileName: "paper.pdf", mimeType: "application/pdf", byteSize: 8 });
    expect(Buffer.from(original.data).toString("latin1")).toBe("%PDF-1.4");

    const markdown = path.join(imports, "notes.md");
    fs.writeFileSync(markdown, "# Notes\n", "utf8");
    const [textMaterial] = await service.addProjectFiles("Pdfs", [markdown]);
    expect(() => service.readProjectMaterialOriginal("Pdfs", textMaterial.relativePath))
      .toThrow("该资料没有保留原始文件。");
    expect(() => service.readProjectMaterialOriginal("Pdfs", "materials/documents/missing.md"))
      .toThrow("项目资料不存在。");
  });

  it("renames and moves materials across projects on disk and in the index", async () => {
    const { imports, service } = fixture();
    service.createProject({ name: "Source" });
    service.createProject({ name: "Target" });
    const file = path.join(imports, "notes.md");
    fs.writeFileSync(file, "# Notes\n", "utf8");
    const [material] = await service.addProjectFiles("Source", [file]);

    const renamed = service.renameProjectMaterial("Source", material.relativePath, "新笔记");
    expect(renamed.title).toBe("新笔记");
    expect(renamed.relativePath).toBe("materials/documents/新笔记.md");
    expect(service.readProjectMaterial("Source", renamed.relativePath).content).toBe("# Notes\n");
    expect(fs.existsSync(path.join(service.resolveProjectRoot("Source"), ...material.relativePath.split("/")))).toBe(false);

    const moved = service.moveProjectMaterial("Source", renamed.relativePath, "Target");
    expect(moved).toMatchObject({ projectName: "Target", relativePath: renamed.relativePath, title: "新笔记" });
    expect(service.readProjectMaterial("Target", moved.relativePath).content).toBe("# Notes\n");
    expect(service.listProjectMaterials("Source")).toEqual([]);
    expect(service.getProject("Source").project.materialCount).toBe(0);
    expect(service.getProject("Target").project.materialCount).toBe(1);
  });

  it("renames and moves outputs across projects and clears cross-project provenance", () => {
    const { service } = fixture();
    service.createProject({ name: "Origin" });
    service.createProject({ name: "Destination" });
    const task = service.createProjectTask("Origin", "Write", "provider-a");
    const created = service.createProjectOutput({ projectName: "Origin", title: "Draft", content: "v1", sourceTaskId: task.taskId });

    const renamed = service.renameProjectOutput("Origin", created.output.relativePath, "终稿");
    expect(renamed.output.title).toBe("终稿");
    expect(renamed.output.relativePath).toBe("outputs/终稿.md");
    expect(renamed.content).toBe("v1");
    expect(fs.existsSync(path.join(service.resolveProjectRoot("Origin"), "outputs", "Draft.md"))).toBe(false);

    const moved = service.moveProjectOutput("Origin", renamed.output.relativePath, "Destination");
    expect(moved.output).toMatchObject({
      projectName: "Destination",
      relativePath: "outputs/终稿.md",
      sourceTaskId: null,
      sourceSessionId: null,
      sourceMessageId: null
    });
    expect(moved.content).toBe("v1");
    expect(service.listProjectOutputs("Origin")).toEqual([]);
    expect(() => service.readProjectOutput("Origin", renamed.output.relativePath)).toThrow();
    expect(service.readProjectOutput("Destination", moved.output.relativePath).content).toBe("v1");
  });

  it("resolves download sources to ordinary project files", async () => {
    const { imports, service } = fixture();
    service.createProject({ name: "Export" });
    const file = path.join(imports, "doc.md");
    fs.writeFileSync(file, "# Exportable\n", "utf8");
    const [material] = await service.addProjectFiles("Export", [file]);
    const materialRoot = service.resolveProjectRoot("Export");

    const materialSource = service.resolveProjectExportFile("Export", "material", material.relativePath);
    expect(materialSource.startsWith(materialRoot)).toBe(true);
    expect(fs.statSync(materialSource).isFile()).toBe(true);

    const created = service.createProjectOutput({ projectName: "Export", title: "Report", content: "body" });
    const outputSource = service.resolveProjectExportFile("Export", "output", created.output.relativePath);
    expect(outputSource).toBe(path.join(service.resolveProjectRoot("Export"), ...created.output.relativePath.split("/")));
    expect(() => service.resolveProjectExportFile("Export", "output", "outputs/missing.md")).toThrow();
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
      id: "11111111-1111-4111-8111-111111111111",
      runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      role: "user" as const,
      content: "Use the project materials",
      sourceMessageId: "message-1",
      createdAt: "2026-08-31T00:00:00.000Z"
    };
    service.appendProjectTaskMessage("Transcript", task.taskId, message);
    service.appendProjectTaskMessage("Transcript", task.taskId, message);

    const restarted = new ProjectService(root, { stateRoot: path.join(root, "..", "state") });
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

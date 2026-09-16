import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  PROJECT_MANIFEST_FILE,
  PROJECT_SCHEMA_VERSION,
  ProjectCreateInputSchema,
  ProjectCreateOutputInputSchema,
  ProjectManifestSchema,
  ProjectMaterialSchema,
  ProjectOutputSchema,
  ProjectSaveOutputInputSchema,
  ProjectSummarySchema,
  ProjectTaskSchema,
  normalizeProjectName,
  type ProjectCreateOutputInput,
  type ProjectDetail,
  type ProjectManifest,
  type ProjectMaterial,
  type ProjectMaterialOriginalRead,
  type ProjectMaterialRead,
  type ProjectOutput,
  type ProjectOutputRead,
  type ProjectSaveOutputInput,
  type ProjectSummary,
  type ProjectTask,
  type ProjectTaskStatus,
  type ProjectUpdateInput
} from "../../shared/project-contracts";
import { writeJsonAtomic } from "../lib/fs-utils";
import {
  ProjectMaterialService,
  type ProjectMaterialConverter
} from "./material-service";
import { ProjectOutputService } from "./output-service";
import { ProjectPathResolver } from "./project-path-resolver";
import { ProjectTaskService } from "./task-service";

const PROJECT_RENAME_JOURNAL_FILE = ".openmind-project-rename.json";
const MAX_RENAME_JOURNAL_BYTES = 100 * 1024 * 1024;
const RenamePhaseSchema = z.enum([
  "prepared",
  "directory-renamed",
  "materials-renamed",
  "tasks-renamed",
  "outputs-renamed",
  "committed"
]);
const ProjectDirectoryIdentityPartSchema = z.preprocess(
  (value) => typeof value === "number" || typeof value === "bigint" ? value.toString() : value,
  z.string().regex(/^\d+$/)
);
const ProjectDirectoryIdentitySchema = z.object({
  // Windows can expose file IDs larger than Number.MAX_SAFE_INTEGER. Persisting
  // them as strings keeps rename journals valid while accepting older numeric journals.
  device: ProjectDirectoryIdentityPartSchema,
  inode: ProjectDirectoryIdentityPartSchema,
  birthtimeMs: z.number().nonnegative()
});
const ProjectRenameJournalSchema = z.object({
  schemaVersion: z.literal(1),
  transactionId: z.string().uuid(),
  phase: RenamePhaseSchema,
  previousName: ProjectManifestSchema.shape.name,
  nextName: ProjectManifestSchema.shape.name,
  projectDirectoryIdentity: ProjectDirectoryIdentitySchema,
  targetUpdatedAt: z.string().datetime(),
  snapshot: z.object({
    manifest: ProjectManifestSchema,
    materials: z.array(ProjectMaterialSchema),
    tasks: z.array(ProjectTaskSchema),
    outputs: z.array(ProjectOutputSchema)
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
type ProjectRenameJournal = z.infer<typeof ProjectRenameJournalSchema>;
type ProjectDirectoryIdentity = z.infer<typeof ProjectDirectoryIdentitySchema>;
const LegacyProjectManifestSchema = ProjectManifestSchema.omit({ id: true, schemaVersion: true }).extend({
  schemaVersion: z.literal(1).optional()
});

export type ProjectServiceOptions = {
  /** Same per-content-root private state directory used by SessionStore. */
  stateRoot: string;
  materialConverters?: readonly ProjectMaterialConverter[];
};

/** Project is an independent filesystem domain. It never reads or writes CreativeProject records. */
export class ProjectService {
  readonly paths: ProjectPathResolver;
  readonly materials: ProjectMaterialService;
  readonly tasks: ProjectTaskService;
  readonly outputs: ProjectOutputService;
  private readonly sessionTaskIndex = new Map<string, { projectName: string; taskId: string }>();
  private recoveringRename = false;
  private renameTransactionActive = false;

  constructor(openmindRoot: string, options: ProjectServiceOptions) {
    this.paths = new ProjectPathResolver(openmindRoot);
    this.materials = new ProjectMaterialService(this.paths, options.materialConverters);
    this.tasks = new ProjectTaskService(this.paths, path.join(options.stateRoot, ".openmind", "ai"));
    this.outputs = new ProjectOutputService(this.paths);
    this.paths.initialize();
    this.recoverInterruptedRename();
    this.migrateProjectIdentities();
    this.discardLegacyTaskRecords();
    this.rebuildSessionTaskIndex();
  }

  listProjects(): ProjectSummary[] {
    return this.paths.withProjectMutationLock(() => {
      this.recoverInterruptedRenameLocked();
      const projects: ProjectSummary[] = [];
      for (const name of this.paths.listProjectNames()) {
        try { projects.push(this.readProjectSummary(name)); }
        catch { /* Preserve invalid external directories, but do not expose them as Projects. */ }
      }
      return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }

  createProject(rawInput: unknown): ProjectDetail {
    const input = ProjectCreateInputSchema.parse(rawInput);
    return this.paths.withProjectMutationLock(() => {
      this.recoverInterruptedRenameLocked();
      const project = this.paths.createProjectRoot(input.name);
      const timestamp = now();
      const manifest = ProjectManifestSchema.parse({
        id: crypto.randomUUID(),
        name: project.name,
        description: input.description,
        status: "active",
        icon: "database",
        color: "neutral",
        favorite: false,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      try {
        writeJsonAtomic(path.join(project.rootPath, PROJECT_MANIFEST_FILE), manifest);
        this.materials.initializeProject(project.name);
        this.tasks.initializeProject(project.name);
        this.outputs.initializeProject(project.name);
      } catch (error) {
        fs.rmSync(project.rootPath, { recursive: true, force: true });
        throw error;
      }
      return this.getProject(project.name);
    });
  }

  getProject(projectName: string): ProjectDetail {
    return this.paths.withProjectMutationLock(() => {
      const manifest = this.readManifest(projectName);
      const outputs = this.outputs.list(manifest.name);
      for (const output of outputs) this.validateOutputProvenance(manifest.name, output, false);
      return {
        project: ProjectSummarySchema.parse({
          ...manifest,
          materialCount: this.materials.list(manifest.name).length,
          taskCount: this.tasks.countActive(manifest.name),
          outputCount: outputs.length
        })
      };
    });
  }

  private readProjectSummary(projectName: string): ProjectSummary {
    const manifest = this.readManifest(projectName);
    // Listing counts validates index/schema/path identity, but does not load
    // output provenance transcripts. Detail/output reads still validate provenance.
    return ProjectSummarySchema.parse({
      ...manifest,
      materialCount: this.materials.count(manifest.name),
      taskCount: this.tasks.countActive(manifest.name),
      outputCount: this.outputs.count(manifest.name)
    });
  }

  renameProject(projectName: string, newName: string): ProjectDetail {
    return this.paths.withProjectMutationLock(() => {
      const previous = this.readManifest(projectName);
      if (this.materials.hasActiveConversions(previous.name)) {
        throw new Error("项目资料正在转换，暂时不能重命名 Project。");
      }
      const nextName = normalizeProjectName(newName);
      if (previous.name === nextName) return this.getProject(previous.name);
      let journal = ProjectRenameJournalSchema.parse({
        schemaVersion: 1,
        transactionId: crypto.randomUUID(),
        phase: "prepared",
        previousName: previous.name,
        nextName,
        projectDirectoryIdentity: this.captureProjectDirectoryIdentity(previous.name),
        targetUpdatedAt: now(),
        snapshot: {
          manifest: previous,
          materials: this.materials.list(previous.name),
          tasks: this.tasks.list(previous.name),
          outputs: this.outputs.list(previous.name)
        },
        createdAt: now(),
        updatedAt: now()
      });
      this.writeRenameJournal(journal);
      this.renameTransactionActive = true;
      try {
        const renamed = this.paths.renameProjectRoot(previous.name, nextName);
        syncDirectory(this.paths.projectsRoot);
        journal = this.advanceRenameJournal(journal, "directory-renamed");
        this.materials.renameProject(previous.name, renamed.name);
        journal = this.advanceRenameJournal(journal, "materials-renamed");
        this.tasks.renameProject(previous.name, renamed.name);
        this.rebuildSessionTaskIndex();
        journal = this.advanceRenameJournal(journal, "tasks-renamed");
        this.outputs.renameProject(previous.name, renamed.name);
        journal = this.advanceRenameJournal(journal, "outputs-renamed");
        this.writeManifest(renamed.name, {
          ...previous,
          name: renamed.name,
          updatedAt: journal.targetUpdatedAt
        });
        const result = this.getProject(renamed.name);
        this.syncProjectMetadata(renamed.name);
        journal = this.advanceRenameJournal(journal, "committed");
        this.removeRenameJournal();
        return result;
      } catch (error) {
        this.renameTransactionActive = false;
        try {
          this.recoverInterruptedRenameLocked();
        } catch (recoveryError) {
          throw new AggregateError(
            [error, recoveryError],
            "Project 重命名失败，且自动恢复尚未完成；下次启动会继续恢复。"
          );
        }
        throw error;
      } finally {
        this.renameTransactionActive = false;
      }
    });
  }

  archiveProject(projectName: string, archived = true): ProjectDetail {
    return this.paths.withProjectMutationLock(() => {
      const manifest = this.readManifest(projectName);
      this.writeManifest(manifest.name, {
        ...manifest,
        status: archived ? "archived" : "active",
        updatedAt: now()
      });
      return this.getProject(manifest.name);
    });
  }

  updateProject(projectName: string, patch: Omit<ProjectUpdateInput, "projectName">): ProjectDetail {
    return this.paths.withProjectMutationLock(() => {
      const manifest = this.readManifest(projectName);
      this.writeManifest(manifest.name, {
        ...manifest,
        ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
        updatedAt: now()
      });
      return this.getProject(manifest.name);
    });
  }

  resolveProjectRoot(projectName: string): string {
    return this.paths.withProjectMutationLock(() => {
      this.recoverInterruptedRenameLocked();
      return this.paths.resolveProject(projectName).rootPath;
    });
  }

  listProjectMaterials(projectName: string): ProjectMaterial[] {
    return this.materials.list(this.canonicalName(projectName));
  }

  async addProjectFiles(projectName: string, absolutePaths: readonly string[]): Promise<ProjectMaterial[]> {
    const name = this.canonicalName(projectName);
    try { return await this.materials.addFiles(name, absolutePaths); }
    finally { this.touch(name); }
  }

  async addProjectUrl(projectName: string, url: string): Promise<ProjectMaterial> {
    const name = this.canonicalName(projectName);
    try { return await this.materials.addUrl(name, url); }
    finally { this.touch(name); }
  }

  async retryMaterialExtraction(projectName: string, relativePath: string): Promise<ProjectMaterial> {
    const name = this.canonicalName(projectName);
    try { return await this.materials.retry(name, relativePath); }
    finally { this.touch(name); }
  }

  removeProjectMaterial(projectName: string, relativePath: string): boolean {
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(projectName);
      const removed = this.materials.remove(name, relativePath);
      if (removed) this.touch(name);
      return removed;
    });
  }

  readProjectMaterial(projectName: string, relativePath: string): ProjectMaterialRead {
    return this.materials.read(this.canonicalName(projectName), relativePath);
  }

  readProjectMaterialOriginal(projectName: string, relativePath: string): ProjectMaterialOriginalRead {
    return this.materials.readOriginal(this.canonicalName(projectName), relativePath);
  }

  createProjectTask(projectName: string, title: string, providerId: string): ProjectTask {
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(projectName);
      const task = this.tasks.create(name, title, providerId);
      this.touch(name);
      return task;
    });
  }

  listProjectTasks(projectName: string): ProjectTask[] {
    return this.tasks.list(this.canonicalName(projectName)).filter((task) => task.status !== "archived");
  }

  listProjectTaskMessages(projectName: string, taskId: string) {
    return this.tasks.listMessages(this.canonicalName(projectName), taskId);
  }

  findProjectTaskBySessionId(sessionId: string): ProjectTask | null {
    if (!sessionId) return null;
    return this.paths.withProjectMutationLock(() => {
      this.recoverInterruptedRenameLocked();
      const locator = this.sessionTaskIndex.get(sessionId);
      if (!locator) return null;
      try {
        const task = this.tasks.get(locator.projectName, locator.taskId);
        if (task.sessionId === sessionId) return task;
      } catch {
        // Drop stale cache entries caused by externally removed Project files.
      }
      this.sessionTaskIndex.delete(sessionId);
      return null;
    });
  }

  appendProjectTaskMessage(
    projectName: string,
    taskId: string,
    message: Parameters<ProjectTaskService["appendMessage"]>[2]
  ): void {
    this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(projectName);
      const task = this.tasks.get(name, taskId);
      this.tasks.appendMessage(name, taskId, {
        ...message,
        sessionId: task.sessionId
      });
    });
  }

  getProjectTask(projectName: string, taskId: string): ProjectTask {
    return this.tasks.get(this.canonicalName(projectName), taskId);
  }

  renameProjectTask(projectName: string, taskId: string, title: string): ProjectTask {
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(projectName);
      const task = this.tasks.rename(name, taskId, title);
      this.touch(name);
      return task;
    });
  }

  archiveProjectTask(projectName: string, taskId: string): ProjectTask {
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(projectName);
      const task = this.tasks.archive(name, taskId);
      this.touch(name);
      return task;
    });
  }

  bindProjectTaskSession(projectName: string, taskId: string, sessionId: string, providerId?: string): ProjectTask {
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(projectName);
      const previous = this.tasks.get(name, taskId);
      const task = this.tasks.bindSession(name, taskId, sessionId, providerId);
      this.sessionTaskIndex.set(sessionId, { projectName: task.projectName, taskId: task.taskId });
      if (previous.sessionId !== sessionId) this.touch(name);
      return task;
    });
  }

  setProjectTaskStatus(projectName: string, taskId: string, status: ProjectTaskStatus): ProjectTask {
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(projectName);
      const task = this.tasks.setStatus(name, taskId, status);
      this.touch(name);
      return task;
    });
  }

  listProjectOutputs(projectName: string): ProjectOutput[] {
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(projectName);
      const outputs = this.outputs.list(name);
      for (const output of outputs) this.validateOutputProvenance(name, output, false);
      return outputs;
    });
  }

  createProjectOutput(rawInput: ProjectCreateOutputInput): ProjectOutputRead {
    const input = ProjectCreateOutputInputSchema.parse(rawInput);
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(input.projectName);
      this.validateOutputProvenance(name, input, true);
      const result = this.outputs.create({ ...input, projectName: name });
      this.touch(name);
      return result;
    });
  }

  readProjectOutput(projectName: string, relativePath: string): ProjectOutputRead {
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(projectName);
      const result = this.outputs.read(name, relativePath);
      this.validateOutputProvenance(name, result.output, false);
      return result;
    });
  }

  saveProjectOutput(rawInput: ProjectSaveOutputInput): ProjectOutputRead {
    const input = ProjectSaveOutputInputSchema.parse(rawInput);
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(input.projectName);
      this.validateOutputProvenance(name, this.outputs.read(name, input.relativePath).output, false);
      const result = this.outputs.save({ ...input, projectName: name });
      this.touch(name);
      return result;
    });
  }

  removeProjectOutput(projectName: string, relativePath: string): boolean {
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(projectName);
      const removed = this.outputs.remove(name, relativePath);
      if (removed) this.touch(name);
      return removed;
    });
  }

  renameProjectMaterial(projectName: string, relativePath: string, newTitle: string): ProjectMaterial {
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(projectName);
      const updated = this.materials.rename(name, relativePath, newTitle);
      this.touch(name);
      return updated;
    });
  }

  moveProjectMaterial(projectName: string, relativePath: string, targetProjectName: string): ProjectMaterial {
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(projectName);
      const targetName = this.canonicalName(targetProjectName);
      const moved = this.materials.moveToProject(name, relativePath, targetName);
      this.touch(name);
      this.touch(targetName);
      return moved;
    });
  }

  renameProjectOutput(projectName: string, relativePath: string, newTitle: string): ProjectOutputRead {
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(projectName);
      const result = this.outputs.rename(name, relativePath, newTitle);
      this.touch(name);
      return result;
    });
  }

  moveProjectOutput(projectName: string, relativePath: string, targetProjectName: string): ProjectOutputRead {
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(projectName);
      const targetName = this.canonicalName(targetProjectName);
      const result = this.outputs.moveToProject(name, relativePath, targetName);
      this.touch(name);
      this.touch(targetName);
      return result;
    });
  }

  /** Absolute path of the on-disk file a download should export (material original when preserved). */
  resolveProjectExportFile(projectName: string, kind: "material" | "output", relativePath: string): string {
    return this.paths.withProjectMutationLock(() => {
      const name = this.canonicalName(projectName);
      if (kind === "output") {
        this.outputs.read(name, relativePath);
        return this.paths.resolveInsideProject(name, relativePath, { allowedTopLevels: ["outputs"] });
      }
      const material = this.materials.list(name).find((item) => item.relativePath === relativePath);
      if (!material) throw new Error("项目资料不存在。");
      const candidates = [material.originalRelativePath, material.relativePath].filter(Boolean) as readonly string[];
      for (const candidate of candidates) {
        const absolute = this.paths.resolveInsideProject(name, candidate, { allowedTopLevels: ["materials"] });
        const stat = fs.lstatSync(absolute);
        if (stat.isFile() && !stat.isSymbolicLink()) return absolute;
      }
      throw new Error("项目资料文件不存在，暂时不能下载。");
    });
  }

  private recoverInterruptedRename(): void {
    if (this.recoveringRename || this.renameTransactionActive || !fs.existsSync(this.renameJournalPath())) return;
    this.paths.withProjectMutationLock(() => this.recoverInterruptedRenameLocked());
  }

  private validateOutputProvenance(
    projectName: string,
    provenance: {
      sourceTaskId?: string | null;
      sourceSessionId?: string | null;
      sourceMessageId?: string | null;
    },
    requireCurrentSession: boolean
  ): void {
    const taskId = provenance.sourceTaskId ?? null;
    const sessionId = provenance.sourceSessionId ?? null;
    const messageId = provenance.sourceMessageId ?? null;
    if (!taskId) {
      if (sessionId || messageId) throw new Error("项目产物的 Session/Message 来源没有绑定 Project Task。");
      return;
    }
    const task = this.tasks.get(projectName, taskId);
    if (sessionId) {
      const belongsToTask = task.sessionId === sessionId || (task.previousSessionIds ?? []).includes(sessionId);
      if (!belongsToTask || (requireCurrentSession && task.sessionId !== sessionId)) {
        throw new Error("项目产物的来源 Session 不属于该 Project Task。");
      }
    }
    if (messageId) {
      if (!sessionId) throw new Error("项目产物的来源 Message 没有绑定 Session。");
      const sourceMessage = this.tasks.listMessages(projectName, task.taskId).find((message) =>
        message.id === messageId || message.sourceMessageId === messageId
      );
      if (!sourceMessage) throw new Error("项目产物的来源 Message 不属于该 Project Task。");
      if (sourceMessage.sessionId !== sessionId) {
        throw new Error("项目产物的来源 Message 不属于声明的 AI Session。");
      }
      if (sourceMessage.role !== "assistant") {
        throw new Error("只有 AI 最终回答可以作为项目产物的 Message 来源。");
      }
    }
  }

  private recoverInterruptedRenameLocked(): void {
    if (this.recoveringRename || this.renameTransactionActive) return;
    const journal = this.readRenameJournal();
    if (!journal) return;
    this.recoveringRename = true;
    try {
      this.validateRenameJournalIdentity(journal);
      const locations = this.locateRenameDirectories(journal);
      const activeRoot = locations.previousRoot ?? locations.nextRoot;
      if (!activeRoot || (locations.previousRoot && locations.nextRoot)) {
        throw new Error("Project 重命名恢复无法确定唯一的项目目录；已保留恢复日志。");
      }
      if (!sameProjectDirectoryIdentity(directoryIdentity(activeRoot), journal.projectDirectoryIdentity)) {
        throw new Error("Project 重命名恢复日志与当前项目目录身份不一致；已保留恢复日志。");
      }
      if (journal.phase === "committed" && locations.nextRoot) {
        try {
          this.validateCommittedRename(journal);
          this.removeRenameJournal();
          return;
        } catch {
          // A committed marker is trusted only after validating every persisted
          // Project identity. Otherwise the pre-rename snapshot wins.
        }
      }
      this.rollbackRename(journal, locations);
    } finally {
      this.recoveringRename = false;
    }
  }

  private rollbackRename(
    journal: ProjectRenameJournal,
    initialLocations = this.locateRenameDirectories(journal)
  ): void {
    if (initialLocations.previousRoot && initialLocations.nextRoot) {
      throw new Error("Project 重命名恢复检测到新旧目录同时存在，拒绝覆盖任何目录。");
    }
    if (!initialLocations.previousRoot && !initialLocations.nextRoot) {
      throw new Error("Project 重命名恢复找不到原项目目录。");
    }
    if (initialLocations.nextRoot) {
      this.paths.renameProjectRoot(journal.nextName, journal.previousName);
      syncDirectory(this.paths.projectsRoot);
    }
    const restoredRoot = this.exactProjectDirectory(journal.previousName);
    if (!restoredRoot || !sameProjectDirectoryIdentity(directoryIdentity(restoredRoot), journal.projectDirectoryIdentity)) {
      throw new Error("Project 重命名回滚后的目录身份不一致。");
    }
    this.materials.restoreProjectSnapshot(journal.previousName, journal.snapshot.materials);
    this.tasks.restoreProjectSnapshot(journal.previousName, journal.snapshot.tasks);
    this.outputs.restoreProjectSnapshot(journal.previousName, journal.snapshot.outputs);
    this.writeManifest(journal.previousName, journal.snapshot.manifest);
    this.validateRestoredSnapshot(journal);
    this.syncProjectMetadata(journal.previousName);
    this.removeRenameJournal();
  }

  private validateCommittedRename(journal: ProjectRenameJournal): void {
    const manifest = this.readManifest(journal.nextName);
    assertJsonEqual(manifest, {
      ...journal.snapshot.manifest,
      name: journal.nextName,
      updatedAt: journal.targetUpdatedAt
    }, "Project 重命名后的 manifest 不完整。");
    const expectedMaterials = journal.snapshot.materials
      .map((material) => ProjectMaterialSchema.parse({ ...material, projectName: journal.nextName }));
    assertRecordSetEqual(
      this.materials.list(journal.nextName),
      expectedMaterials,
      (material) => material.relativePath,
      "Project 重命名后的 Material 索引不完整。"
    );
    const expectedOutputs = journal.snapshot.outputs
      .map((output) => ProjectOutputSchema.parse({ ...output, projectName: journal.nextName }));
    assertRecordSetEqual(
      this.outputs.list(journal.nextName),
      expectedOutputs,
      (output) => output.relativePath,
      "Project 重命名后的 Output 索引不完整。"
    );
    const expectedTasks = journal.snapshot.tasks.map((task) => ({
      taskId: task.taskId,
      projectName: journal.nextName,
      title: task.title,
      sessionId: null,
      previousSessionIds: task.sessionId
        ? [...new Set([...task.previousSessionIds, task.sessionId])]
        : task.previousSessionIds,
      providerId: task.providerId,
      status: task.status === "archived" ? ("archived" as const) : ("active" as const),
      createdAt: task.createdAt
    }));
    const actualTasks = this.tasks.list(journal.nextName).map((task) => ({
      taskId: task.taskId,
      projectName: task.projectName,
      title: task.title,
      sessionId: task.sessionId,
      previousSessionIds: task.previousSessionIds,
      providerId: task.providerId,
      status: task.status,
      createdAt: task.createdAt
    }));
    assertRecordSetEqual(actualTasks, expectedTasks, (task) => task.taskId, "Project 重命名后的 Task 索引不完整。");
  }

  private validateRestoredSnapshot(journal: ProjectRenameJournal): void {
    assertJsonEqual(this.readManifest(journal.previousName), journal.snapshot.manifest, "Project manifest 回滚不完整。");
    assertRecordSetEqual(
      this.materials.list(journal.previousName),
      journal.snapshot.materials,
      (material) => material.relativePath,
      "Project Material 回滚不完整。"
    );
    assertRecordSetEqual(
      this.tasks.list(journal.previousName),
      journal.snapshot.tasks,
      (task) => task.taskId,
      "Project Task 回滚不完整。"
    );
    assertRecordSetEqual(
      this.outputs.list(journal.previousName),
      journal.snapshot.outputs,
      (output) => output.relativePath,
      "Project Output 回滚不完整。"
    );
  }

  private validateRenameJournalIdentity(journal: ProjectRenameJournal): void {
    if (journal.previousName === journal.nextName || journal.snapshot.manifest.name !== journal.previousName) {
      throw new Error("Project 重命名恢复日志的项目身份无效。");
    }
    for (const record of [
      ...journal.snapshot.materials,
      ...journal.snapshot.tasks,
      ...journal.snapshot.outputs
    ]) {
      if (record.projectName !== journal.previousName) {
        throw new Error("Project 重命名恢复快照包含跨项目记录。");
      }
    }
  }

  private locateRenameDirectories(journal: ProjectRenameJournal): {
    previousRoot: string | null;
    nextRoot: string | null;
  } {
    return {
      previousRoot: this.exactProjectDirectory(journal.previousName),
      nextRoot: this.exactProjectDirectory(journal.nextName)
    };
  }

  private exactProjectDirectory(projectName: string): string | null {
    this.paths.initialize();
    const entry = fs.readdirSync(this.paths.projectsRoot, { withFileTypes: true })
      .find((candidate) => candidate.name === projectName);
    if (!entry) return null;
    const candidate = path.join(this.paths.projectsRoot, projectName);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`Project 重命名恢复目标不是普通目录：${projectName}`);
    }
    return candidate;
  }

  private captureProjectDirectoryIdentity(projectName: string): ProjectDirectoryIdentity {
    return directoryIdentity(this.paths.resolveProject(projectName).rootPath);
  }

  private advanceRenameJournal(
    journal: ProjectRenameJournal,
    phase: z.infer<typeof RenamePhaseSchema>
  ): ProjectRenameJournal {
    const next = ProjectRenameJournalSchema.parse({ ...journal, phase, updatedAt: now() });
    this.writeRenameJournal(next);
    return next;
  }

  private readRenameJournal(): ProjectRenameJournal | null {
    const journalPath = this.renameJournalPath();
    let stat: fs.Stats;
    try { stat = fs.lstatSync(journalPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RENAME_JOURNAL_BYTES) {
      throw new Error("Project 重命名恢复日志不是有效的普通文件。");
    }
    return ProjectRenameJournalSchema.parse(JSON.parse(fs.readFileSync(journalPath, "utf8")));
  }

  private writeRenameJournal(journal: ProjectRenameJournal): void {
    const parsed = ProjectRenameJournalSchema.parse(journal);
    writeJsonAtomic(this.renameJournalPath(), parsed);
    syncFile(this.renameJournalPath());
    syncDirectory(this.paths.projectsRoot);
  }

  private removeRenameJournal(): void {
    const journalPath = this.renameJournalPath();
    const stat = fs.lstatSync(journalPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Project 重命名恢复日志无效，拒绝删除。");
    fs.rmSync(journalPath);
    syncDirectory(this.paths.projectsRoot);
  }

  private renameJournalPath(): string {
    return path.join(this.paths.projectsRoot, PROJECT_RENAME_JOURNAL_FILE);
  }

  private syncProjectMetadata(projectName: string): void {
    const project = this.paths.resolveProject(projectName);
    for (const relativePath of [
      PROJECT_MANIFEST_FILE,
      "materials/.openmind-materials.json",
      "outputs/.openmind-outputs.json"
    ]) {
      syncFile(this.paths.resolveInsideProject(project.name, relativePath));
    }
    for (const task of this.tasks.list(project.name)) {
      const taskFile = this.tasks.taskFile(project.name, task.taskId);
      syncFile(taskFile);
      syncDirectory(path.dirname(taskFile));
    }
    syncDirectory(this.tasks.projectDirectory(project.name));
    for (const relativeDirectory of ["materials", "outputs"]) {
      syncDirectory(this.paths.resolveInsideProject(project.name, relativeDirectory));
    }
    syncDirectory(project.rootPath);
    syncDirectory(this.paths.projectsRoot);
  }

  private canonicalName(projectName: string): string {
    return this.readManifest(projectName).name;
  }

  private readManifest(projectName: string): ProjectManifest {
    return this.paths.withProjectMutationLock(() => {
      if (!this.recoveringRename && !this.renameTransactionActive) this.recoverInterruptedRenameLocked();
      const project = this.paths.resolveProject(projectName);
      const filePath = this.paths.resolveInsideProject(project.name, PROJECT_MANIFEST_FILE);
      const raw: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const current = ProjectManifestSchema.safeParse(raw);
      let manifest: ProjectManifest;
      if (current.success) {
        manifest = current.data;
      } else {
        const legacy = LegacyProjectManifestSchema.parse(raw);
        manifest = ProjectManifestSchema.parse({
          ...legacy,
          schemaVersion: PROJECT_SCHEMA_VERSION,
          id: crypto.randomUUID()
        });
        writeJsonAtomic(filePath, manifest);
      }
      if (manifest.name !== project.name) throw new Error("Project 清单名称与目录身份不一致。");
      return manifest;
    });
  }

  private writeManifest(projectName: string, manifest: ProjectManifest): void {
    const project = this.paths.resolveProject(projectName);
    writeJsonAtomic(path.join(project.rootPath, PROJECT_MANIFEST_FILE), ProjectManifestSchema.parse(manifest));
  }

  private touch(projectName: string): void {
    this.paths.withProjectMutationLock(() => {
      const manifest = this.readManifest(projectName);
      this.writeManifest(manifest.name, { ...manifest, updatedAt: now() });
    });
  }

  private rebuildSessionTaskIndex(): void {
    this.sessionTaskIndex.clear();
    for (const projectName of this.paths.listProjectNames()) {
      try {
        for (const task of this.tasks.list(projectName)) {
          if (task.sessionId) this.sessionTaskIndex.set(task.sessionId, { projectName: task.projectName, taskId: task.taskId });
        }
      } catch {
        // Invalid or obsolete Projects stay on disk but are outside the active index.
      }
    }
  }

  private migrateProjectIdentities(): void {
    for (const projectName of this.paths.listProjectNames()) {
      try {
        this.readManifest(projectName);
      } catch {
        // Preserve malformed external directories without guessing how to repair them.
      }
    }
  }

  private discardLegacyTaskRecords(): void {
    this.paths.withProjectMutationLock(() => {
      for (const projectName of this.paths.listProjectNames()) {
        try { this.readManifest(projectName); }
        catch { continue; }
        // Explicitly retire the old layout without importing conversations.
        // Resolve inside the named Project before recursive removal; links at
        // this boundary are rejected by the resolver.
        const legacy = this.paths.resolveInsideProject(projectName, "tasks", {
          allowedTopLevels: ["tasks"], allowMissingLeaf: true
        });
        if (!fs.existsSync(legacy)) continue;
        const oldIds = new Set(fs.readdirSync(legacy));
        const outputs = this.outputs.list(projectName);
        const cleared = outputs.map((output) => output.sourceTaskId && oldIds.has(output.sourceTaskId)
          ? { ...output, sourceTaskId: null, sourceSessionId: null, sourceMessageId: null }
          : output);
        // Clear obsolete references before deleting tasks so a restart cannot
        // leave preserved outputs pointing at missing canonical transcripts.
        if (cleared.some((output, index) => output !== outputs[index])) {
          this.outputs.restoreProjectSnapshot(projectName, cleared);
        }
        fs.rmSync(legacy, { recursive: true });
      }
    });
  }
}

function now(): string {
  return new Date().toISOString();
}

function directoryIdentity(directory: string): ProjectDirectoryIdentity {
  const stat = fs.statSync(directory);
  if (!stat.isDirectory()) throw new Error("Project 重命名目标不是目录。");
  return ProjectDirectoryIdentitySchema.parse({
    device: stat.dev,
    inode: stat.ino,
    birthtimeMs: stat.birthtimeMs
  });
}

function sameProjectDirectoryIdentity(left: ProjectDirectoryIdentity, right: ProjectDirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.birthtimeMs === right.birthtimeMs;
}

function assertRecordSetEqual<T>(
  actual: readonly T[],
  expected: readonly T[],
  key: (record: T) => string,
  message: string
): void {
  const sortRecords = (records: readonly T[]) => [...records].sort((left, right) => key(left).localeCompare(key(right)));
  assertJsonEqual(sortRecords(actual), sortRecords(expected), message);
}

function assertJsonEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

function syncFile(filePath: string): void {
  // FlushFileBuffers requires a writable file handle on Windows.
  const descriptor = fs.openSync(filePath, "r+");
  try { fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

function syncDirectory(directory: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== "win32" || !["EACCES", "EINVAL", "EPERM"].includes(code ?? "")) throw error;
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  PROJECT_MANIFEST_FILE,
  ProjectManifestSchema,
  ProjectTaskMessageSchema,
  ProjectTaskSchema,
  type ProjectTask,
  type ProjectTaskMessage,
  type ProjectTaskStatus
} from "../../shared/project-contracts";
import { writeJsonAtomic } from "../lib/fs-utils";
import { ProjectPathResolver } from "./project-path-resolver";

export class ProjectTaskService {
  readonly root: string;

  constructor(private readonly paths: ProjectPathResolver, aiStateRoot: string) {
    if (!path.isAbsolute(aiStateRoot)) throw new Error("AI 状态目录必须是绝对路径。");
    this.root = path.resolve(aiStateRoot, "project-tasks");
    const relative = path.relative(paths.openmindRoot, this.root);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error("AI 任务状态必须保存在内容根目录之外。");
    }
  }

  initializeProject(projectName: string): void {
    this.paths.withProjectMutationLock(() => {
      fs.mkdirSync(this.projectDirectory(projectName), { recursive: true });
    });
  }

  create(projectName: string, title: string, providerId: string): ProjectTask {
    return this.paths.withProjectMutationLock(() => {
      const canonicalProjectName = this.paths.resolveProject(projectName).name;
      this.initializeProject(canonicalProjectName);
      const timestamp = now();
      const task = ProjectTaskSchema.parse({
        taskId: crypto.randomUUID(),
        projectId: this.projectId(canonicalProjectName),
        projectName: canonicalProjectName,
        title,
        sessionId: null,
        previousSessionIds: [],
        providerId,
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp
      });
      const directory = this.taskDirectory(canonicalProjectName, task.taskId, true);
      fs.mkdirSync(directory, { recursive: false });
      try {
        writeJsonAtomic(path.join(directory, "task.json"), task);
        fs.mkdirSync(path.join(directory, "messages"), { recursive: false });
      } catch (error) {
        fs.rmSync(directory, { recursive: true, force: true });
        throw error;
      }
      return task;
    });
  }

  list(projectName: string): ProjectTask[] {
    return this.paths.withProjectMutationLock(() => {
      this.initializeProject(projectName);
      const tasksRoot = this.projectDirectory(projectName);
      const result: ProjectTask[] = [];
      const taskIdentities = new Set<string>();
      for (const entry of fs.readdirSync(tasksRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !z.string().uuid().safeParse(entry.name).success) continue;
        const identity = entry.name.toLocaleLowerCase("en-US");
        if (taskIdentities.has(identity)) throw new Error(`Project Task 目录包含重复 taskId：${entry.name}`);
        taskIdentities.add(identity);
        result.push(this.get(projectName, entry.name));
      }
      return result.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  }

  get(projectName: string, taskId: string): ProjectTask {
    return this.paths.withProjectMutationLock(() => {
      const canonicalProjectName = this.paths.resolveProject(projectName).name;
      const filePath = this.taskFile(canonicalProjectName, taskId);
      const raw: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const task = ProjectTaskSchema.parse(raw);
      if (task.projectName !== canonicalProjectName) {
        throw new Error(`Project Task 的 projectName 与所在项目不一致：${task.taskId}`);
      }
      if (task.projectId !== this.projectId(canonicalProjectName)) {
        throw new Error(`Project Task 的 projectId 与所在项目不一致：${task.taskId}`);
      }
      if (task.taskId !== taskId || path.basename(path.dirname(filePath)) !== taskId) {
        throw new Error(`Project Task 的 taskId 与所在目录不一致：${taskId}`);
      }
      return task;
    });
  }

  archive(projectName: string, taskId: string): ProjectTask {
    return this.update(projectName, taskId, { status: "archived" });
  }

  rename(projectName: string, taskId: string, title: string): ProjectTask {
    return this.update(projectName, taskId, { title });
  }

  bindSession(projectName: string, taskId: string, sessionId: string, providerId?: string): ProjectTask {
    return this.paths.withProjectMutationLock(() => {
      const current = this.get(projectName, taskId);
      if (current.sessionId && current.sessionId !== sessionId) throw new Error("Project Task 已绑定其他 AI Session。");
      if (current.sessionId === sessionId) return current;
      if (!current.sessionId && (current.previousSessionIds ?? []).includes(sessionId)) {
        throw new Error("Project Task 不能重新绑定已失效的历史 AI Session。");
      }
      if (providerId && current.providerId !== providerId) throw new Error("Project Task Provider 与 AI Session 不一致。");
      return this.update(projectName, taskId, { sessionId, status: "active" });
    });
  }

  setStatus(projectName: string, taskId: string, status: ProjectTaskStatus): ProjectTask {
    return this.update(projectName, taskId, { status });
  }

  appendMessage(projectName: string, taskId: string, message: ProjectTaskMessage): void {
    this.paths.withProjectMutationLock(() => {
      const task = this.get(projectName, taskId);
      const parsed = ProjectTaskMessageSchema.parse(message);
      if (parsed.sessionId !== task.sessionId) throw new Error("Project Task 消息的 Session 归属不一致。");
      const directory = this.messageDirectory(task.projectName, task.taskId, true);
      fs.mkdirSync(directory, { recursive: true });
      const filePath = path.join(directory, `${parsed.id}.json`);
      if (fs.existsSync(filePath)) {
        const current = ProjectTaskMessageSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
        if (JSON.stringify(current) !== JSON.stringify(parsed)) throw new Error("Project Task 消息 ID 冲突。");
        return;
      }
      writeJsonAtomic(filePath, parsed, { onlyIfMissing: true });
    });
  }

  listMessages(projectName: string, taskId: string): ProjectTaskMessage[] {
    return this.paths.withProjectMutationLock(() => {
      const task = this.get(projectName, taskId);
      const directory = this.messageDirectory(task.projectName, task.taskId, true);
      fs.mkdirSync(directory, { recursive: true });
      const allowedSessions = new Set<string | null>([task.sessionId, ...task.previousSessionIds]);
      return fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && /^[0-9a-f-]{36}\.json$/i.test(entry.name))
        .map((entry) => {
          const message = ProjectTaskMessageSchema.parse(JSON.parse(fs.readFileSync(path.join(directory, entry.name), "utf8")));
          if (`${message.id}.json`.toLocaleLowerCase("en-US") !== entry.name.toLocaleLowerCase("en-US")) {
            throw new Error(`Project Task 消息 ID 与文件名不一致：${entry.name}`);
          }
          if (!allowedSessions.has(message.sessionId)) {
            throw new Error(`Project Task 消息的 Session 归属不一致：${message.id}`);
          }
          return message;
        })
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    });
  }

  renameProject(previousName: string, nextName: string): void {
    this.paths.withProjectMutationLock(() => {
      this.initializeProject(nextName);
      const tasksRoot = this.projectDirectory(nextName);
      const taskIdentities = new Set<string>();
      for (const entry of fs.readdirSync(tasksRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !z.string().uuid().safeParse(entry.name).success) continue;
        const identity = entry.name.toLocaleLowerCase("en-US");
        if (taskIdentities.has(identity)) throw new Error(`Project Task 目录包含重复 taskId：${entry.name}`);
        taskIdentities.add(identity);
        const filePath = this.taskFile(nextName, entry.name);
        const task = ProjectTaskSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
        if (task.taskId !== entry.name) throw new Error(`Project Task 的 taskId 与所在目录不一致：${entry.name}`);
        if (task.projectName !== previousName && task.projectName !== nextName) {
          throw new Error(`Project Task 的 projectName 与重命名项目不一致：${task.taskId}`);
        }
        // Native provider sessions freeze their absolute cwd. A real directory
        // rename invalidates that cwd, so the next turn creates a fresh session
        // under the renamed Project while preserving the Project transcript.
        writeJsonAtomic(filePath, ProjectTaskSchema.parse({
          ...task,
          projectName: nextName,
          sessionId: null,
          previousSessionIds: task.sessionId
            ? [...new Set([...(task.previousSessionIds ?? []), task.sessionId])]
            : task.previousSessionIds ?? [],
          status: task.status === "archived" ? "archived" : "active",
          updatedAt: now()
        }));
      }
    });
  }

  /** Restores the exact pre-rename Task metadata while preserving transcript files. */
  restoreProjectSnapshot(projectName: string, snapshot: readonly ProjectTask[]): void {
    this.paths.withProjectMutationLock(() => {
      const canonicalProjectName = this.paths.resolveProject(projectName).name;
      this.initializeProject(canonicalProjectName);
      const tasksRoot = this.projectDirectory(canonicalProjectName);
      const directoryIds = fs.readdirSync(tasksRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && z.string().uuid().safeParse(entry.name).success)
        .map((entry) => entry.name)
        .sort();
      const parsed = snapshot.map((task) => ProjectTaskSchema.parse(task));
      const snapshotIds = parsed.map((task) => task.taskId).sort();
      if (new Set(snapshotIds).size !== snapshotIds.length || JSON.stringify(directoryIds) !== JSON.stringify(snapshotIds)) {
        throw new Error("Project Task 快照与当前目录集合不一致，无法安全恢复重命名。");
      }
      for (const task of parsed) {
        if (task.projectName !== canonicalProjectName) {
          throw new Error(`Project Task 快照的 projectName 不一致：${task.taskId}`);
        }
        writeJsonAtomic(this.taskFile(canonicalProjectName, task.taskId), task);
      }
    });
  }

  private update(
    projectName: string,
    taskId: string,
    patch: Partial<Pick<ProjectTask, "sessionId" | "status" | "title">>
  ): ProjectTask {
    return this.paths.withProjectMutationLock(() => {
      const current = this.get(projectName, taskId);
      const next = ProjectTaskSchema.parse({ ...current, ...patch, updatedAt: now() });
      writeJsonAtomic(this.taskFile(projectName, taskId), next);
      return next;
    });
  }

  private taskDirectory(projectName: string, taskId: string, allowMissingLeaf = false): string {
    z.string().uuid().parse(taskId);
    return this.statePath(projectName, taskId, allowMissingLeaf);
  }

  taskFile(projectName: string, taskId: string): string {
    z.string().uuid().parse(taskId);
    return this.statePath(projectName, `${taskId}/task.json`);
  }

  private messageDirectory(projectName: string, taskId: string, allowMissingLeaf = false): string {
    z.string().uuid().parse(taskId);
    return this.statePath(projectName, `${taskId}/messages`, allowMissingLeaf);
  }

  projectDirectory(projectName: string): string {
    return this.statePath(projectName, "", true);
  }

  private statePath(projectName: string, relativePath: string, allowMissing = false): string {
    const target = path.join(this.root, this.projectId(projectName), relativePath);
    // Unlike project content, this tree belongs to the application. Still reject
    // links in every existing path component before any read/write/delete.
    const parsed = path.parse(target);
    let current = parsed.root;
    for (const part of target.slice(parsed.root.length).split(path.sep)) {
      current = path.join(current, part);
      try {
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error("AI 任务状态路径不能包含符号链接。");
      } catch (error) {
        if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
    }
    return target;
  }

  private projectId(projectName: string): string {
    const project = this.paths.resolveProject(projectName);
    return ProjectManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(project.rootPath, PROJECT_MANIFEST_FILE), "utf8"))).id;
  }
}

function now(): string {
  return new Date().toISOString();
}

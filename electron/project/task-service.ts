import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ProjectTaskMessageSchema,
  ProjectTaskSchema,
  type ProjectTask,
  type ProjectTaskMessage,
  type ProjectTaskStatus
} from "../../shared/project-contracts";
import { writeJsonAtomic, writeTextAtomic } from "../lib/fs-utils";
import { ProjectPathResolver } from "./project-path-resolver";

const TASKS_TOP_LEVEL = ["tasks"] as const;
const MAX_MESSAGES_BYTES = 20 * 1024 * 1024;

export class ProjectTaskService {
  constructor(private readonly paths: ProjectPathResolver) {}

  initializeProject(projectName: string): void {
    const tasks = this.paths.resolveInsideProject(projectName, "tasks", {
      allowedTopLevels: TASKS_TOP_LEVEL,
      allowMissingLeaf: true
    });
    fs.mkdirSync(tasks, { recursive: true });
  }

  create(projectName: string, title: string, providerId: string): ProjectTask {
    return this.paths.withProjectMutationLock(() => {
      const canonicalProjectName = this.paths.resolveProject(projectName).name;
      this.initializeProject(canonicalProjectName);
      const timestamp = now();
      const task = ProjectTaskSchema.parse({
        taskId: crypto.randomUUID(),
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
        writeTextAtomic(path.join(directory, "messages.jsonl"), "");
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
      const tasksRoot = this.paths.resolveInsideProject(projectName, "tasks", { allowedTopLevels: TASKS_TOP_LEVEL });
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
      const task = ProjectTaskSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
      if (task.projectName !== canonicalProjectName) {
        throw new Error(`Project Task 的 projectName 与所在项目不一致：${task.taskId}`);
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

  bindSession(projectName: string, taskId: string, sessionId: string, providerId?: string): ProjectTask {
    return this.paths.withProjectMutationLock(() => {
      const current = this.get(projectName, taskId);
      if (current.sessionId && current.sessionId !== sessionId) throw new Error("Project Task 已绑定其他 AI Session。");
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
      this.get(projectName, taskId);
      const parsed = ProjectTaskMessageSchema.parse(message);
      const filePath = this.messageFile(projectName, taskId);
      const existing = fs.readFileSync(filePath, "utf8");
      const duplicate = existing.split("\n").filter(Boolean).some((line) => {
        try {
          const current = ProjectTaskMessageSchema.parse(JSON.parse(line));
          return current.id === parsed.id || (
            current.role === parsed.role
            && current.content === parsed.content
            && current.createdAt === parsed.createdAt
          );
        }
        catch { return false; }
      });
      if (duplicate) return;
      const next = `${existing}${JSON.stringify(parsed)}\n`;
      if (Buffer.byteLength(next, "utf8") > MAX_MESSAGES_BYTES) throw new Error("Project Task 消息记录超过 20 MB 限制。");
      writeTextAtomic(filePath, next);
    });
  }

  listMessages(projectName: string, taskId: string): ProjectTaskMessage[] {
    return this.paths.withProjectMutationLock(() => {
      const task = this.get(projectName, taskId);
      const content = fs.readFileSync(this.messageFile(task.projectName, task.taskId), "utf8");
      if (Buffer.byteLength(content, "utf8") > MAX_MESSAGES_BYTES) throw new Error("Project Task 消息记录超过 20 MB 限制。");
      return content.split("\n").filter(Boolean).map((line) => ProjectTaskMessageSchema.parse(JSON.parse(line)));
    });
  }

  renameProject(previousName: string, nextName: string): void {
    this.paths.withProjectMutationLock(() => {
      this.initializeProject(nextName);
      const tasksRoot = this.paths.resolveInsideProject(nextName, "tasks", { allowedTopLevels: TASKS_TOP_LEVEL });
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
      const tasksRoot = this.paths.resolveInsideProject(canonicalProjectName, "tasks", { allowedTopLevels: TASKS_TOP_LEVEL });
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
    return this.paths.resolveInsideProject(projectName, `tasks/${taskId}`, {
      allowedTopLevels: TASKS_TOP_LEVEL,
      allowMissingLeaf
    });
  }

  private taskFile(projectName: string, taskId: string): string {
    return this.paths.resolveInsideProject(projectName, `tasks/${taskId}/task.json`, { allowedTopLevels: TASKS_TOP_LEVEL });
  }

  private messageFile(projectName: string, taskId: string): string {
    return this.paths.resolveInsideProject(projectName, `tasks/${taskId}/messages.jsonl`, { allowedTopLevels: TASKS_TOP_LEVEL });
  }
}

function now(): string {
  return new Date().toISOString();
}

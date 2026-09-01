import type {
  ProjectDetail,
  ProjectMaterial,
  ProjectMaterialKind,
  ProjectMaterialStatus,
  ProjectOutput,
  ProjectStatus,
  ProjectSummary,
  ProjectTask,
  ProjectTaskMessage,
  ProjectTaskRunResult,
  ProjectTranscriptSegment,
  ProjectVideo
} from "./types";

type ProjectMethod =
  | "listProjects"
  | "getProject"
  | "createProject"
  | "renameProject"
  | "archiveProject"
  | "listProjectMaterials"
  | "readProjectMaterial"
  | "addProjectFiles"
  | "addProjectUrl"
  | "retryMaterialExtraction"
  | "removeProjectMaterial"
  | "listProjectTasks"
  | "listProjectTaskMessages"
  | "createProjectTask"
  | "listProjectOutputs"
  | "createProjectOutput"
  | "readProjectOutput"
  | "saveProjectOutput"
  | "projectStartTaskRun";

type UnknownRecord = Record<string, unknown>;

async function invoke(method: ProjectMethod, ...args: unknown[]): Promise<unknown> {
  const bridge = window.openmind as unknown as UnknownRecord;
  const candidate = bridge[method];
  if (typeof candidate !== "function") throw new Error(`当前应用版本尚未提供 ${method}。`);
  return await (candidate as (...values: unknown[]) => Promise<unknown>).apply(window.openmind, args);
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  const result = string(value).trim();
  return result || undefined;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const wrapped = record(value);
  for (const key of ["items", "projects", "materials", "tasks", "outputs", "data"]) {
    if (Array.isArray(wrapped[key])) return wrapped[key] as unknown[];
  }
  return [];
}

function status(value: unknown): ProjectStatus {
  return value === "archived" ? "archived" : "active";
}

function project(value: unknown): ProjectSummary {
  const wrapper = record(value);
  const item = Object.keys(record(wrapper.project)).length ? record(wrapper.project) : wrapper;
  const counts = record(item.counts);
  return {
    name: string(item.name || item.projectName),
    description: string(item.description),
    status: status(item.status),
    materialCount: number(item.materialCount, number(counts.materials)),
    taskCount: number(item.taskCount, number(counts.tasks)),
    outputCount: number(item.outputCount, number(counts.outputs)),
    createdAt: string(item.createdAt),
    updatedAt: string(item.updatedAt)
  };
}

function materialKind(value: unknown, relativePath: string): ProjectMaterialKind {
  if (value === "video" || value === "web" || value === "document") return value;
  if (/\.video\.md$/i.test(relativePath)) return "video";
  if (/\.web\.md$/i.test(relativePath)) return "web";
  return "document";
}

function materialStatus(value: unknown): ProjectMaterialStatus {
  if (value === "importing" || value === "converting" || value === "failed") return value;
  return "ready";
}

function segment(value: unknown, index: number): ProjectTranscriptSegment | null {
  const item = record(value);
  const text = string(item.text || item.content).trim();
  if (!text) return null;
  const startMs = number(item.startMs, number(item.start, 0));
  const endMs = number(item.endMs, number(item.end, startMs));
  return {
    id: string(item.id, `segment-${index}`),
    startMs,
    endMs: Math.max(startMs, endMs),
    text,
    speaker: optionalString(item.speaker)
  };
}

function video(value: unknown): ProjectVideo | undefined {
  const item = record(value);
  if (!Object.keys(item).length) return undefined;
  const rawTranscript = Array.isArray(item.transcript) ? item.transcript : Array.isArray(item.segments) ? item.segments : [];
  const mediaType = item.mediaType === "hls" || item.mediaType === "webm" ? item.mediaType : item.mediaType === "mp4" ? "mp4" : undefined;
  return {
    provider: optionalString(item.provider),
    videoId: optionalString(item.videoId),
    durationMs: number(item.durationMs) || undefined,
    mediaType,
    embedUrl: optionalString(item.embedUrl),
    mediaUrl: directMediaUrl(optionalString(item.mediaUrl || item.playbackUrl || item.sourceUrl), mediaType),
    posterUrl: optionalString(item.posterUrl || item.thumbnailUrl),
    transcript: rawTranscript.map(segment).filter((item): item is ProjectTranscriptSegment => Boolean(item))
  };
}

function directMediaUrl(value: string | undefined, mediaType: ProjectVideo["mediaType"]): string | undefined {
  if (!value || !mediaType) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return undefined;
    const extension = mediaType === "hls" ? ".m3u8" : mediaType === "webm" ? ".webm" : ".mp4";
    return parsed.pathname.toLocaleLowerCase().endsWith(extension) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function material(value: unknown): ProjectMaterial {
  const wrapper = record(value);
  const item = Object.keys(record(wrapper.material)).length ? record(wrapper.material) : wrapper;
  const relativePath = string(item.relativePath || item.path || item.id);
  const source = record(item.source);
  const content = optionalString(wrapper.content || item.content || item.markdown);
  const sourceUrl = optionalString(item.sourceUrl || item.url || source.url);
  return {
    relativePath,
    title: string(item.title || item.name, relativePath.split("/").at(-1) || "未命名资料"),
    kind: materialKind(item.kind, relativePath),
    status: materialStatus(item.status),
    sourceUrl,
    content,
    truncated: wrapper.truncated === true || item.truncated === true,
    error: optionalString(item.error || item.errorMessage),
    createdAt: optionalString(item.createdAt),
    updatedAt: optionalString(item.updatedAt),
    // readProjectMaterial returns parsed video metadata beside `material`.
    // Keep accepting the nested preview shape while preferring the typed envelope.
    video: video(wrapper.video || item.video || item.playback) || videoFromMarkdown(content, sourceUrl)
  };
}

function videoFromMarkdown(content?: string, sourceUrl?: string): ProjectVideo | undefined {
  if (!content && !sourceUrl) return undefined;
  const provider = content?.match(/^-\s*Provider[：:]\s*(.+)$/im)?.[1]?.trim()
    || (sourceUrl && /(?:youtube\.com|youtu\.be)/i.test(sourceUrl) ? "youtube" : undefined);
  const videoId = content?.match(/^-\s*Video ID[：:]\s*(.+)$/im)?.[1]?.trim() || youtubeVideoId(sourceUrl);
  const duration = content?.match(/^-\s*时长[：:]\s*([0-9:.]+)$/im)?.[1];
  const durationMs = duration ? colonTimeToMs(duration) : undefined;
  const mediaUrl = sourceUrl && /\.(?:mp4|webm|m3u8)(?:$|\?)/i.test(sourceUrl) ? sourceUrl : undefined;
  const mediaType = mediaUrl?.match(/\.m3u8(?:$|\?)/i)
    ? "hls"
    : mediaUrl?.match(/\.webm(?:$|\?)/i)
      ? "webm"
      : mediaUrl
        ? "mp4"
        : undefined;
  return { provider, videoId, durationMs, mediaType, mediaUrl };
}

function youtubeVideoId(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") return optionalString(url.pathname.slice(1));
    if (/youtube\.com$/i.test(url.hostname) || /\.youtube\.com$/i.test(url.hostname)) return optionalString(url.searchParams.get("v") || url.pathname.match(/^\/shorts\/([^/]+)/)?.[1]);
  } catch { /* Main validates URLs; malformed historical metadata simply has no embed. */ }
  return undefined;
}

function colonTimeToMs(value: string): number | undefined {
  const parts = value.split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return undefined;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return seconds * 1000;
}

function task(value: unknown): ProjectTask {
  const item = record(value);
  const rawStatus = string(item.status);
  const normalizedStatus: ProjectTask["status"] = rawStatus === "completed" || rawStatus === "failed" || rawStatus === "archived" ? rawStatus : "active";
  return {
    taskId: string(item.taskId || item.id),
    projectName: string(item.projectName),
    title: string(item.title, "未命名任务"),
    sessionId: optionalString(item.sessionId) || null,
    providerId: optionalString(item.providerId),
    status: normalizedStatus,
    createdAt: string(item.createdAt),
    updatedAt: string(item.updatedAt)
  };
}

function taskMessage(value: unknown): ProjectTaskMessage {
  const item = record(value);
  return {
    id: string(item.id),
    role: item.role === "assistant" ? "assistant" : "user",
    content: string(item.content),
    sourceMessageId: optionalString(item.sourceMessageId) || null,
    createdAt: string(item.createdAt)
  };
}

function output(value: unknown): ProjectOutput {
  const wrapper = record(value);
  const item = Object.keys(record(wrapper.output)).length ? record(wrapper.output) : wrapper;
  const relativePath = string(item.relativePath || item.path);
  return {
    relativePath,
    title: string(item.title || item.name, relativePath.split("/").at(-1)?.replace(/\.md$/i, "") || "未命名文档"),
    content: typeof wrapper.content === "string" ? wrapper.content : typeof item.content === "string" ? item.content : undefined,
    sourceTaskId: optionalString(item.sourceTaskId),
    sourceSessionId: optionalString(item.sourceSessionId),
    sourceMessageId: optionalString(item.sourceMessageId),
    createdAt: string(item.createdAt),
    updatedAt: string(item.updatedAt)
  };
}

export const projectsApi = {
  async listProjects(): Promise<ProjectSummary[]> {
    return array(await invoke("listProjects")).map(project).filter((item) => item.name);
  },

  async getProject(projectName: string): Promise<ProjectDetail> {
    return project(await invoke("getProject", projectName));
  },

  async createProject(name: string, description: string): Promise<ProjectDetail> {
    return project(await invoke("createProject", { name, description }));
  },

  async renameProject(projectName: string, newName: string): Promise<ProjectDetail> {
    return project(await invoke("renameProject", { projectName, newName }));
  },

  async archiveProject(projectName: string, archived: boolean): Promise<ProjectDetail> {
    return project(await invoke("archiveProject", { projectName, archived }));
  },

  async listMaterials(projectName: string): Promise<ProjectMaterial[]> {
    return array(await invoke("listProjectMaterials", projectName)).map(material).filter((item) => item.relativePath);
  },

  async readMaterial(projectName: string, relativePath: string): Promise<ProjectMaterial> {
    return material(await invoke("readProjectMaterial", { projectName, relativePath }));
  },

  async addFiles(projectName: string): Promise<ProjectMaterial[]> {
    return array(await invoke("addProjectFiles", { projectName })).map(material);
  },

  async addUrl(projectName: string, url: string): Promise<ProjectMaterial> {
    return material(await invoke("addProjectUrl", { projectName, url }));
  },

  async retryMaterial(projectName: string, relativePath: string): Promise<ProjectMaterial> {
    return material(await invoke("retryMaterialExtraction", { projectName, relativePath }));
  },

  async removeMaterial(projectName: string, relativePath: string): Promise<void> {
    await invoke("removeProjectMaterial", { projectName, relativePath });
  },

  async listTasks(projectName: string): Promise<ProjectTask[]> {
    return array(await invoke("listProjectTasks", projectName)).map(task).filter((item) => item.taskId);
  },

  async listTaskMessages(projectName: string, taskId: string): Promise<ProjectTaskMessage[]> {
    return array(await invoke("listProjectTaskMessages", { projectName, taskId }))
      .map(taskMessage)
      .filter((item) => item.id && item.content);
  },

  async createTask(projectName: string, title: string, providerId?: string): Promise<ProjectTask> {
    return task(await invoke("createProjectTask", { projectName, title, providerId }));
  },

  async startTaskRun(projectName: string, taskId: string, providerId: string, prompt: string): Promise<ProjectTaskRunResult> {
    const result = record(await invoke("projectStartTaskRun", { projectName, taskId, providerId, prompt }));
    const session = record(result.session) as ProjectTaskRunResult["session"];
    const run = record(result.run) as ProjectTaskRunResult["run"];
    return { task: task(result.task), session, run };
  },

  async listOutputs(projectName: string): Promise<ProjectOutput[]> {
    return array(await invoke("listProjectOutputs", projectName)).map(output).filter((item) => item.relativePath);
  },

  async createOutput(projectName: string, title: string, content = "", source?: Partial<ProjectOutput>): Promise<ProjectOutput> {
    return output(await invoke("createProjectOutput", {
      projectName,
      title,
      content,
      sourceTaskId: source?.sourceTaskId,
      sourceSessionId: source?.sourceSessionId,
      sourceMessageId: source?.sourceMessageId
    }));
  },

  async readOutput(projectName: string, relativePath: string): Promise<ProjectOutput> {
    return output(await invoke("readProjectOutput", { projectName, relativePath }));
  },

  async saveOutput(projectName: string, relativePath: string, content: string, title?: string): Promise<ProjectOutput> {
    return output(await invoke("saveProjectOutput", { projectName, relativePath, content, title }));
  }
};

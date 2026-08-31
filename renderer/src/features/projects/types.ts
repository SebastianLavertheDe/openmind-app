export type ProjectStatus = "active" | "archived";
export type ProjectSection = "tasks" | "materials" | "outputs";

export type ProjectSummary = {
  name: string;
  description: string;
  status: ProjectStatus;
  materialCount: number;
  taskCount: number;
  outputCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDetail = ProjectSummary;

export type ProjectMaterialKind = "document" | "web" | "video";
export type ProjectMaterialStatus = "importing" | "converting" | "ready" | "failed";

export type ProjectTranscriptSegment = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
};

export type ProjectVideo = {
  provider?: string;
  videoId?: string;
  durationMs?: number;
  mediaType?: "mp4" | "webm" | "hls";
  embedUrl?: string;
  mediaUrl?: string;
  posterUrl?: string;
  transcript?: ProjectTranscriptSegment[];
};

export type ProjectMaterial = {
  relativePath: string;
  title: string;
  kind: ProjectMaterialKind;
  status: ProjectMaterialStatus;
  sourceUrl?: string;
  content?: string;
  /** The renderer only received a prefix of the material content. */
  truncated?: boolean;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  video?: ProjectVideo;
};

export type ProjectTask = {
  taskId: string;
  projectName: string;
  title: string;
  sessionId: string | null;
  providerId?: string;
  status: "active" | "completed" | "failed" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type ProjectTaskMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sourceMessageId?: string | null;
  createdAt: string;
};

export type ProjectOutput = {
  relativePath: string;
  title: string;
  content?: string;
  sourceTaskId?: string;
  sourceSessionId?: string;
  sourceMessageId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectTaskRunResult = {
  task: ProjectTask;
  session: { id: string } & Record<string, unknown>;
  run: { id: string } & Record<string, unknown>;
};

export type ProjectCreateAction = ProjectSection;

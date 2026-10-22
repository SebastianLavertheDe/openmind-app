export type ProjectStatus = "active" | "archived";
export type ProjectSection = "tasks" | "materials" | "outputs";
export type ProjectColor = "neutral" | "gray" | "blue" | "cyan" | "green" | "indigo" | "purple" | "pink" | "red" | "orange" | "yellow" | "brown";

export type ProjectSummary = {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  icon?: string;
  color?: ProjectColor;
  favorite?: boolean;
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
  localMediaUrl?: string;
  posterUrl?: string;
  transcript?: ProjectTranscriptSegment[];
  warnings?: string[];
};

export type ProjectMaterial = {
  relativePath: string;
  title: string;
  kind: ProjectMaterialKind;
  status: ProjectMaterialStatus;
  sourceUrl?: string;
  /** Path of the preserved original inside materials/originals, when the converter kept one. */
  originalPath?: string | null;
  content?: string;
  /** The renderer only received a prefix of the material content. */
  truncated?: boolean;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  video?: ProjectVideo;
};

/** Binary original preserved beside the extracted Markdown; v1 only serves PDF. */
export type ProjectMaterialOriginal = {
  fileName: string;
  mimeType: "application/pdf";
  byteSize: number;
  data: Uint8Array<ArrayBuffer>;
};

export type ProjectTask = {
  taskId: string;
  projectId: string;
  projectName: string;
  title: string;
  sessionId: string | null;
  previousSessionIds: string[];
  providerId?: string;
  status: "active" | "completed" | "failed" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type ProjectTaskMessage = {
  id: string;
  runId: string;
  sessionId: string | null;
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

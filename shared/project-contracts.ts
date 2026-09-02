import { z } from "zod";
import {
  AiRunSchema,
  AiSessionSchema,
  ContextReferenceSchema,
  type AiRun,
  type AiSession,
  type ContextReference
} from "./contracts";

export const PROJECT_SCHEMA_VERSION = 1 as const;
export const PROJECTS_LOGICAL_ROOT = "projects" as const;
export const PROJECT_MANIFEST_FILE = ".openmind-project.json" as const;

const MAX_PROJECT_NAME_CODE_POINTS = 80;
const MAX_PROJECT_NAME_UTF8_BYTES = 180;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com(?:[1-9]|[¹²³])|lpt(?:[1-9]|[¹²³]))(?:\..*)?$/iu;
const FORBIDDEN_PROJECT_NAME_CHARACTERS = /[\u0000-\u001f\u007f/\\<>:"|?*]/u;
const ENCODED_PATH_TOKEN = /%(?:2e|2f|5c)/i;

/** Stable cross-platform comparison key. The physical directory keeps the NFC display name. */
export function projectNameUniquenessKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export const ProjectNameSchema = z.string().superRefine((raw, context) => {
  const value = raw.normalize("NFC");
  if (!value) {
    context.addIssue({ code: "custom", message: "项目名不能为空。" });
    return;
  }
  if ([...value].length > MAX_PROJECT_NAME_CODE_POINTS || utf8ByteLength(value) > MAX_PROJECT_NAME_UTF8_BYTES) {
    context.addIssue({ code: "custom", message: "项目名最多 80 个字符且不能超过 180 字节。" });
  }
  if (FORBIDDEN_PROJECT_NAME_CHARACTERS.test(value) || ENCODED_PATH_TOKEN.test(value)) {
    context.addIssue({ code: "custom", message: "项目名包含跨平台文件系统不支持的字符。" });
  }
  if (value !== value.trim() || value.includes("..") || value.startsWith(".") || value.endsWith(".")) {
    context.addIssue({ code: "custom", message: "项目名不能包含 ..、前导点、尾部点或首尾空白。" });
  }
  if (WINDOWS_RESERVED_NAME.test(value)) {
    context.addIssue({ code: "custom", message: "项目名不能使用 Windows 保留设备名。" });
  }
}).transform((value) => value.normalize("NFC"));
export type ProjectName = z.infer<typeof ProjectNameSchema>;

export function normalizeProjectName(value: string): ProjectName {
  return ProjectNameSchema.parse(value);
}

export const ProjectStatusSchema = z.enum(["active", "archived"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectManifestSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION).default(PROJECT_SCHEMA_VERSION),
  name: ProjectNameSchema,
  description: z.string().max(20_000).default(""),
  status: ProjectStatusSchema.default("active"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

export const ProjectSummarySchema = ProjectManifestSchema.extend({
  materialCount: z.number().int().nonnegative().default(0),
  taskCount: z.number().int().nonnegative().default(0),
  outputCount: z.number().int().nonnegative().default(0)
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectDetailSchema = z.object({
  project: ProjectSummarySchema
});
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

export const ProjectCreateInputSchema = z.object({
  name: ProjectNameSchema,
  description: z.string().max(20_000).default("")
});
export type ProjectCreateInput = z.input<typeof ProjectCreateInputSchema>;

export const ProjectRenameInputSchema = z.object({
  projectName: ProjectNameSchema,
  newName: ProjectNameSchema
});
export type ProjectRenameInput = z.input<typeof ProjectRenameInputSchema>;

export const ProjectArchiveInputSchema = z.object({
  projectName: ProjectNameSchema,
  archived: z.boolean().default(true)
});
export type ProjectArchiveInput = z.input<typeof ProjectArchiveInputSchema>;

export const ProjectMaterialKindSchema = z.enum(["document", "web", "video"]);
export type ProjectMaterialKind = z.infer<typeof ProjectMaterialKindSchema>;

export const ProjectMaterialStatusSchema = z.enum(["importing", "converting", "ready", "failed"]);
export type ProjectMaterialStatus = z.infer<typeof ProjectMaterialStatusSchema>;

export const ProjectMaterialSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("file"), originalName: z.string().min(1).max(255) }),
  z.object({ type: z.literal("url"), url: z.string().url().refine((value) => /^https?:\/\//i.test(value), "只支持 HTTP(S) URL。") })
]);
export type ProjectMaterialSource = z.infer<typeof ProjectMaterialSourceSchema>;

export const ProjectMaterialSchema = z.object({
  projectName: ProjectNameSchema,
  relativePath: z.string().min(1).max(4096),
  title: z.string().min(1).max(255),
  kind: ProjectMaterialKindSchema,
  status: ProjectMaterialStatusSchema,
  source: ProjectMaterialSourceSchema,
  originalRelativePath: z.string().min(1).max(4096).nullable().default(null),
  mimeType: z.string().min(1).max(255).nullable().default(null),
  byteSize: z.number().int().nonnegative().nullable().default(null),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  converterId: z.string().min(1).max(120).nullable().default(null),
  errorCode: z.string().min(1).max(120).nullable().default(null),
  errorMessage: z.string().max(2_000).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type ProjectMaterial = z.infer<typeof ProjectMaterialSchema>;

export const ProjectVideoTranscriptSegmentSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative().nullable().default(null),
  text: z.string().max(100_000)
});
export type ProjectVideoTranscriptSegment = z.infer<typeof ProjectVideoTranscriptSegmentSchema>;

export const ProjectVideoReadMetadataSchema = z.object({
  provider: z.string().min(1).max(80),
  sourceUrl: z.string().url().refine((value) => /^https?:\/\//i.test(value), "只支持 HTTP(S) URL。"),
  embedUrl: z.string().url().refine((value) => /^https?:\/\//i.test(value), "只支持 HTTP(S) URL。").nullable().default(null),
  videoId: z.string().min(1).max(500).nullable().default(null),
  mediaType: z.string().min(1).max(80).default("video"),
  title: z.string().min(1).max(500),
  durationMs: z.number().int().nonnegative().nullable().default(null),
  thumbnailUrl: z.string().url().refine((value) => /^https?:\/\//i.test(value), "只支持 HTTP(S) URL。").nullable().default(null),
  transcript: z.array(ProjectVideoTranscriptSegmentSchema).max(100_000).default([]),
  transcriptSource: z.string().min(1).max(80).nullable().default(null)
});
export type ProjectVideoReadMetadata = z.infer<typeof ProjectVideoReadMetadataSchema>;

export const ProjectMaterialReadSchema = z.object({
  material: ProjectMaterialSchema,
  content: z.string(),
  truncated: z.boolean().default(false),
  /** Parsed convenience data for `.video.md`; Markdown remains the persisted source of truth. */
  video: ProjectVideoReadMetadataSchema.optional()
});
export type ProjectMaterialRead = z.infer<typeof ProjectMaterialReadSchema>;

export const ProjectNameInputSchema = z.object({ projectName: ProjectNameSchema });
export type ProjectNameInput = z.input<typeof ProjectNameInputSchema>;

/** filePaths comes from renderer drag-and-drop (preload webUtils); omit it to open the native picker in Main. */
export const ProjectAddFilesInputSchema = ProjectNameInputSchema.extend({
  filePaths: z.array(z.string().min(1).max(4096)).max(100).optional()
});
export type ProjectAddFilesInput = z.input<typeof ProjectAddFilesInputSchema>;

export const ProjectAddUrlInputSchema = z.object({
  projectName: ProjectNameSchema,
  url: z.string().url().refine((value) => /^https?:\/\//i.test(value), "只支持 HTTP(S) URL。")
});
export type ProjectAddUrlInput = z.input<typeof ProjectAddUrlInputSchema>;

export const ProjectMaterialLocatorSchema = z.object({
  projectName: ProjectNameSchema,
  relativePath: z.string().min(1).max(4096)
});
export type ProjectMaterialLocator = z.input<typeof ProjectMaterialLocatorSchema>;

export const ProjectTaskStatusSchema = z.enum(["active", "completed", "failed", "archived"]);
export type ProjectTaskStatus = z.infer<typeof ProjectTaskStatusSchema>;

export const ProjectTaskSchema = z.object({
  taskId: z.string().uuid(),
  projectName: ProjectNameSchema,
  title: z.string().min(1).max(160),
  sessionId: z.string().min(1).max(160).nullable().default(null),
  /** Immutable provenance for Outputs after a rename intentionally clears the active cwd-bound Session. */
  previousSessionIds: z.array(z.string().min(1).max(160)).max(10_000)
    .refine((values) => new Set(values).size === values.length, "历史 Session 不能重复。")
    .default([]),
  providerId: z.string().min(1).max(160),
  status: ProjectTaskStatusSchema.default("active"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
type ParsedProjectTask = z.infer<typeof ProjectTaskSchema>;
export type ProjectTask = Omit<ParsedProjectTask, "previousSessionIds"> & {
  /** Optional in callers during the additive schema rollout; persisted parses always materialize an array. */
  previousSessionIds?: string[];
};

export const ProjectCreateTaskInputSchema = z.object({
  projectName: ProjectNameSchema,
  title: z.string().trim().min(1).max(160),
  providerId: z.string().trim().min(1).max(160)
});
export type ProjectCreateTaskInput = z.input<typeof ProjectCreateTaskInputSchema>;

export const ProjectTaskLocatorSchema = z.object({
  projectName: ProjectNameSchema,
  taskId: z.string().uuid()
});
export type ProjectTaskLocator = z.input<typeof ProjectTaskLocatorSchema>;

export const ProjectRenameTaskInputSchema = ProjectTaskLocatorSchema.extend({
  title: z.string().trim().min(1).max(160)
});
export type ProjectRenameTaskInput = z.input<typeof ProjectRenameTaskInputSchema>;

export const ProjectTaskMessageSchema = z.object({
  id: z.string().min(1).max(160),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(10 * 1024 * 1024),
  sourceMessageId: z.string().min(1).max(160).nullable().default(null),
  /** Captured from the bound Task by ProjectService; legacy rows may omit it. */
  sessionId: z.string().min(1).max(160).nullable().optional(),
  createdAt: z.string().datetime()
});
export type ProjectTaskMessage = z.infer<typeof ProjectTaskMessageSchema>;

export const ProjectStartTaskRunInputSchema = z.object({
  projectName: ProjectNameSchema,
  taskId: z.string().uuid(),
  sessionId: z.string().min(1).max(160).optional(),
  providerId: z.string().trim().min(1).max(160).optional(),
  prompt: z.string().trim().min(1).max(2_000_000),
  contexts: z.array(ContextReferenceSchema).max(50).default([])
}).superRefine((input, context) => {
  if (!input.sessionId && !input.providerId) {
    context.addIssue({ code: "custom", path: ["providerId"], message: "新 Project Task 必须指定 Provider。" });
  }
});
export type ProjectStartTaskRunInput = Omit<z.input<typeof ProjectStartTaskRunInputSchema>, "contexts"> & {
  contexts?: ContextReference[];
};

export const ProjectAiRunResultSchema = z.object({
  session: AiSessionSchema,
  run: AiRunSchema
});
export type ProjectAiRunResult = { session: AiSession; run: AiRun };

export const ProjectTaskRunResultSchema = ProjectAiRunResultSchema.extend({ task: ProjectTaskSchema });
export type ProjectTaskRunResult = ProjectAiRunResult & { task: ProjectTask };

export const ProjectOutputSchema = z.object({
  projectName: ProjectNameSchema,
  relativePath: z.string().min(1).max(4096),
  title: z.string().min(1).max(255),
  sourceTaskId: z.string().uuid().nullable().default(null),
  sourceSessionId: z.string().min(1).max(160).nullable().default(null),
  sourceMessageId: z.string().min(1).max(160).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).superRefine((output, context) => {
  if (!output.sourceTaskId && (output.sourceSessionId || output.sourceMessageId)) {
    context.addIssue({ code: "custom", path: ["sourceTaskId"], message: "Output Session/Message 来源必须绑定 Project Task。" });
  }
  if (output.sourceMessageId && !output.sourceSessionId) {
    context.addIssue({ code: "custom", path: ["sourceSessionId"], message: "Output Message 来源必须绑定 Session。" });
  }
});
export type ProjectOutput = z.infer<typeof ProjectOutputSchema>;

export const ProjectOutputReadSchema = z.object({
  output: ProjectOutputSchema,
  content: z.string()
});
export type ProjectOutputRead = z.infer<typeof ProjectOutputReadSchema>;

export const ProjectCreateOutputInputSchema = z.object({
  projectName: ProjectNameSchema,
  title: z.string().trim().min(1).max(255),
  content: z.string().max(10 * 1024 * 1024).default(""),
  sourceTaskId: z.string().uuid().optional(),
  sourceSessionId: z.string().min(1).max(160).optional(),
  sourceMessageId: z.string().min(1).max(160).optional()
}).superRefine((output, context) => {
  if (!output.sourceTaskId && (output.sourceSessionId || output.sourceMessageId)) {
    context.addIssue({ code: "custom", path: ["sourceTaskId"], message: "Output Session/Message 来源必须绑定 Project Task。" });
  }
  if (output.sourceMessageId && !output.sourceSessionId) {
    context.addIssue({ code: "custom", path: ["sourceSessionId"], message: "Output Message 来源必须绑定 Session。" });
  }
});
export type ProjectCreateOutputInput = z.input<typeof ProjectCreateOutputInputSchema>;

export const ProjectOutputLocatorSchema = z.object({
  projectName: ProjectNameSchema,
  relativePath: z.string().min(1).max(4096)
});
export type ProjectOutputLocator = z.input<typeof ProjectOutputLocatorSchema>;

export const ProjectSaveOutputInputSchema = ProjectOutputLocatorSchema.extend({
  title: z.string().trim().min(1).max(255).optional(),
  content: z.string().max(10 * 1024 * 1024)
});
export type ProjectSaveOutputInput = z.input<typeof ProjectSaveOutputInputSchema>;

export interface ProjectDesktopApi {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: ProjectCreateInput): Promise<ProjectDetail>;
  getProject(projectName: string): Promise<ProjectDetail>;
  renameProject(input: ProjectRenameInput): Promise<ProjectDetail>;
  archiveProject(input: ProjectArchiveInput): Promise<ProjectDetail>;

  addProjectFiles(input: ProjectAddFilesInput): Promise<ProjectMaterial[]>;
  addProjectUrl(input: ProjectAddUrlInput): Promise<ProjectMaterial>;
  retryMaterialExtraction(input: ProjectMaterialLocator): Promise<ProjectMaterial>;
  removeProjectMaterial(input: ProjectMaterialLocator): Promise<boolean>;
  readProjectMaterial(input: ProjectMaterialLocator): Promise<ProjectMaterialRead>;
  listProjectMaterials(projectName: string): Promise<ProjectMaterial[]>;

  createProjectTask(input: ProjectCreateTaskInput): Promise<ProjectTask>;
  listProjectTasks(projectName: string): Promise<ProjectTask[]>;
  listProjectTaskMessages(input: ProjectTaskLocator): Promise<ProjectTaskMessage[]>;
  renameProjectTask(input: ProjectRenameTaskInput): Promise<ProjectTask>;
  archiveProjectTask(input: ProjectTaskLocator): Promise<ProjectTask>;
  projectStartTaskRun(input: ProjectStartTaskRunInput): Promise<ProjectTaskRunResult>;

  listProjectOutputs(projectName: string): Promise<ProjectOutput[]>;
  createProjectOutput(input: ProjectCreateOutputInput): Promise<ProjectOutputRead>;
  readProjectOutput(input: ProjectOutputLocator): Promise<ProjectOutputRead>;
  saveProjectOutput(input: ProjectSaveOutputInput): Promise<ProjectOutputRead>;
  removeProjectOutput(input: ProjectOutputLocator): Promise<boolean>;
}

/** Project invoke channels are kept with their independent domain contract. */
export const PROJECT_IPC = {
  LIST: "project:list",
  CREATE: "project:create",
  GET: "project:get",
  RENAME: "project:rename",
  ARCHIVE: "project:archive",
  MATERIAL_ADD_FILES: "project:material-add-files",
  MATERIAL_ADD_URL: "project:material-add-url",
  MATERIAL_RETRY: "project:material-retry",
  MATERIAL_REMOVE: "project:material-remove",
  MATERIAL_READ: "project:material-read",
  MATERIAL_LIST: "project:material-list",
  TASK_CREATE: "project:task-create",
  TASK_LIST: "project:task-list",
  TASK_MESSAGES: "project:task-messages",
  TASK_RENAME: "project:task-rename",
  TASK_ARCHIVE: "project:task-archive",
  TASK_START_RUN: "project:task-start-run",
  OUTPUT_LIST: "project:output-list",
  OUTPUT_CREATE: "project:output-create",
  OUTPUT_READ: "project:output-read",
  OUTPUT_SAVE: "project:output-save",
  OUTPUT_REMOVE: "project:output-remove"
} as const;

declare module "./contracts" {
  interface DesktopApi extends ProjectDesktopApi {}
}

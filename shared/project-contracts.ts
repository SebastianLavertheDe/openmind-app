import { messages } from "./messages";
import { z } from "zod";
import { ImageSelectionSchema } from "./image-generation";
import {
  AiRunSchema,
  AiSessionSchema,
  ContextReferenceSchema,
  PermissionProfileSchema,
  type AiRun,
  type AiSession,
  type ContextReference
} from "./contracts";

export const PROJECT_SCHEMA_VERSION = 2 as const;
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
    context.addIssue({ code: "custom", message: messages.validation.project.nameRequired });
    return;
  }
  if ([...value].length > MAX_PROJECT_NAME_CODE_POINTS || utf8ByteLength(value) > MAX_PROJECT_NAME_UTF8_BYTES) {
    context.addIssue({ code: "custom", message: messages.validation.project.nameLength(MAX_PROJECT_NAME_CODE_POINTS, MAX_PROJECT_NAME_UTF8_BYTES) });
  }
  if (FORBIDDEN_PROJECT_NAME_CHARACTERS.test(value) || ENCODED_PATH_TOKEN.test(value)) {
    context.addIssue({ code: "custom", message: messages.validation.project.nameCharacters });
  }
  if (value !== value.trim() || value.includes("..") || value.startsWith(".") || value.endsWith(".")) {
    context.addIssue({ code: "custom", message: messages.validation.project.namePath });
  }
  if (WINDOWS_RESERVED_NAME.test(value)) {
    context.addIssue({ code: "custom", message: messages.validation.project.nameReserved });
  }
}).transform((value) => value.normalize("NFC"));
export type ProjectName = z.infer<typeof ProjectNameSchema>;

export function normalizeProjectName(value: string): ProjectName {
  return ProjectNameSchema.parse(value);
}

export const ProjectStatusSchema = z.enum(["active", "archived"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectColorSchema = z.enum([
  "neutral",
  "gray",
  "blue",
  "cyan",
  "green",
  "indigo",
  "purple",
  "pink",
  "red",
  "orange",
  "yellow",
  "brown"
]);
export type ProjectColor = z.infer<typeof ProjectColorSchema>;

export const ProjectIconSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/).default("database");
export type ProjectIcon = z.infer<typeof ProjectIconSchema>;

export const ProjectManifestSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION).default(PROJECT_SCHEMA_VERSION),
  /** Immutable identity; the directory/name may change without changing ownership. */
  id: z.string().uuid(),
  name: ProjectNameSchema,
  description: z.string().max(20_000).default(""),
  status: ProjectStatusSchema.default("active"),
  icon: ProjectIconSchema,
  color: ProjectColorSchema.default("neutral"),
  favorite: z.boolean().default(false),
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

export const ProjectUpdateInputSchema = z.object({
  projectName: ProjectNameSchema,
  icon: ProjectIconSchema.optional(),
  color: ProjectColorSchema.optional(),
  favorite: z.boolean().optional()
}).refine((input) => input.icon !== undefined || input.color !== undefined || input.favorite !== undefined, {
  error: () => messages.validation.project.updateRequired
});
export type ProjectUpdateInput = z.input<typeof ProjectUpdateInputSchema>;

export const ProjectMaterialKindSchema = z.enum(["document", "web", "video"]);
export type ProjectMaterialKind = z.infer<typeof ProjectMaterialKindSchema>;

export const ProjectMaterialStatusSchema = z.enum(["importing", "converting", "ready", "failed"]);
export type ProjectMaterialStatus = z.infer<typeof ProjectMaterialStatusSchema>;

export const ProjectMaterialSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("file"), originalName: z.string().min(1).max(255) }),
  z.object({ type: z.literal("url"), url: z.string().url().refine((value) => /^https?:\/\//i.test(value), { error: () => messages.validation.project.httpUrl }) })
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
  sourceUrl: z.string().url().refine((value) => /^https?:\/\//i.test(value), { error: () => messages.validation.project.httpUrl }),
  embedUrl: z.string().url().refine((value) => /^https?:\/\//i.test(value), { error: () => messages.validation.project.httpUrl }).nullable().default(null),
  videoId: z.string().min(1).max(500).nullable().default(null),
  mediaType: z.string().min(1).max(80).default("video"),
  title: z.string().min(1).max(500),
  durationMs: z.number().int().nonnegative().nullable().default(null),
  thumbnailUrl: z.string().url().refine((value) => /^https?:\/\//i.test(value), { error: () => messages.validation.project.httpUrl }).nullable().default(null),
  transcript: z.array(ProjectVideoTranscriptSegmentSchema).max(100_000).default([]),
  transcriptSource: z.string().min(1).max(80).nullable().default(null),
  warnings: z.array(z.string().max(4_000)).max(100).default([])
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

/** Binary original of a preserved material (PDF v1); bytes ride the IPC structured clone. */
export const ProjectMaterialOriginalReadSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.literal("application/pdf"),
  byteSize: z.number().int().nonnegative(),
  data: z.custom<Uint8Array<ArrayBuffer>>((value) => value instanceof Uint8Array)
});
export type ProjectMaterialOriginalRead = z.infer<typeof ProjectMaterialOriginalReadSchema>;

export const ProjectNameInputSchema = z.object({ projectName: ProjectNameSchema });
export type ProjectNameInput = z.input<typeof ProjectNameInputSchema>;

/** filePaths comes from renderer drag-and-drop (preload webUtils); omit it to open the native picker in Main. */
export const ProjectAddFilesInputSchema = ProjectNameInputSchema.extend({
  filePaths: z.array(z.string().min(1).max(4096)).max(100).optional()
});
export type ProjectAddFilesInput = z.input<typeof ProjectAddFilesInputSchema>;

export const ProjectAddUrlInputSchema = z.object({
  projectName: ProjectNameSchema,
  url: z.string().url().refine((value) => /^https?:\/\//i.test(value), { error: () => messages.validation.project.httpUrl })
});
export type ProjectAddUrlInput = z.input<typeof ProjectAddUrlInputSchema>;

export const ProjectMaterialLocatorSchema = z.object({
  projectName: ProjectNameSchema,
  relativePath: z.string().min(1).max(4096)
});
export type ProjectMaterialLocator = z.input<typeof ProjectMaterialLocatorSchema>;

export const ProjectRenameMaterialInputSchema = ProjectMaterialLocatorSchema.extend({
  newTitle: z.string().trim().min(1).max(255)
});
export type ProjectRenameMaterialInput = z.input<typeof ProjectRenameMaterialInputSchema>;

export const ProjectMoveMaterialInputSchema = ProjectMaterialLocatorSchema.extend({
  targetProjectName: ProjectNameSchema
});
export type ProjectMoveMaterialInput = z.input<typeof ProjectMoveMaterialInputSchema>;

export const ProjectTaskStatusSchema = z.enum(["active", "completed", "failed", "archived"]);
export type ProjectTaskStatus = z.infer<typeof ProjectTaskStatusSchema>;

export const ProjectTaskSchema = z.object({
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectName: ProjectNameSchema,
  title: z.string().min(1).max(160),
  sessionId: z.string().min(1).max(160).nullable().default(null),
  /** Immutable provenance for Outputs after a rename intentionally clears the active cwd-bound Session. */
  previousSessionIds: z.array(z.string().min(1).max(160)).max(10_000)
    .refine((values) => new Set(values).size === values.length, { error: () => messages.validation.project.duplicateSession })
    .default([]),
  providerId: z.string().min(1).max(160),
  status: ProjectTaskStatusSchema.default("active"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type ProjectTask = z.infer<typeof ProjectTaskSchema>;

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
  id: z.string().uuid(),
  runId: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(10 * 1024 * 1024),
  sourceMessageId: z.string().min(1).max(160).nullable().default(null),
  /** Captured from the bound Task so the canonical message cannot drift across Sessions. */
  sessionId: z.string().min(1).max(160).nullable(),
  createdAt: z.string().datetime()
});
export type ProjectTaskMessage = z.infer<typeof ProjectTaskMessageSchema>;

export const ProjectStartTaskRunInputSchema = z.object({
  projectName: ProjectNameSchema,
  taskId: z.string().uuid(),
  sessionId: z.string().min(1).max(160).optional(),
  providerId: z.string().trim().min(1).max(160).optional(),
  permissionProfile: PermissionProfileSchema.default("auto"),
  prompt: z.string().trim().min(1).max(2_000_000),
  imageGeneration: ImageSelectionSchema.nullable().optional(),
  contexts: z.array(ContextReferenceSchema).max(50).default([])
}).superRefine((input, context) => {
  if (!input.sessionId && !input.providerId) {
    context.addIssue({ code: "custom", path: ["providerId"], message: messages.validation.project.providerRequired });
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
  sourceArtifactIndex: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).superRefine((output, context) => {
  if (!output.sourceTaskId && (output.sourceSessionId || output.sourceMessageId)) {
    context.addIssue({ code: "custom", path: ["sourceTaskId"], message: messages.validation.project.outputTaskRequired });
  }
  if (output.sourceMessageId && !output.sourceSessionId) {
    context.addIssue({ code: "custom", path: ["sourceSessionId"], message: messages.validation.project.outputSessionRequired });
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
  sourceMessageId: z.string().min(1).max(160).optional(),
  sourceArtifactIndex: z.number().int().nonnegative().optional()
}).superRefine((output, context) => {
  if (!output.sourceTaskId && (output.sourceSessionId || output.sourceMessageId)) {
    context.addIssue({ code: "custom", path: ["sourceTaskId"], message: messages.validation.project.outputTaskRequired });
  }
  if (output.sourceMessageId && !output.sourceSessionId) {
    context.addIssue({ code: "custom", path: ["sourceSessionId"], message: messages.validation.project.outputSessionRequired });
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

export const ProjectRenameOutputInputSchema = ProjectOutputLocatorSchema.extend({
  newTitle: z.string().trim().min(1).max(255)
});
export type ProjectRenameOutputInput = z.input<typeof ProjectRenameOutputInputSchema>;

export const ProjectMoveOutputInputSchema = ProjectOutputLocatorSchema.extend({
  targetProjectName: ProjectNameSchema
});
export type ProjectMoveOutputInput = z.input<typeof ProjectMoveOutputInputSchema>;

export const ProjectDownloadFileInputSchema = z.object({
  projectName: ProjectNameSchema,
  kind: z.enum(["material", "output"]),
  relativePath: z.string().min(1).max(4096)
});
export type ProjectDownloadFileInput = z.input<typeof ProjectDownloadFileInputSchema>;

export const ProjectDownloadFileResultSchema = z.object({
  canceled: z.boolean(),
  savedPath: z.string().min(1).nullable().default(null)
});
export type ProjectDownloadFileResult = z.infer<typeof ProjectDownloadFileResultSchema>;

export interface ProjectDesktopApi {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: ProjectCreateInput): Promise<ProjectDetail>;
  getProject(projectName: string): Promise<ProjectDetail>;
  renameProject(input: ProjectRenameInput): Promise<ProjectDetail>;
  updateProject(input: ProjectUpdateInput): Promise<ProjectDetail>;
  archiveProject(input: ProjectArchiveInput): Promise<ProjectDetail>;

  addProjectFiles(input: ProjectAddFilesInput): Promise<ProjectMaterial[]>;
  addProjectUrl(input: ProjectAddUrlInput): Promise<ProjectMaterial>;
  retryMaterialExtraction(input: ProjectMaterialLocator): Promise<ProjectMaterial>;
  removeProjectMaterial(input: ProjectMaterialLocator): Promise<boolean>;
  renameProjectMaterial(input: ProjectRenameMaterialInput): Promise<ProjectMaterial>;
  moveProjectMaterial(input: ProjectMoveMaterialInput): Promise<ProjectMaterial>;
  readProjectMaterial(input: ProjectMaterialLocator): Promise<ProjectMaterialRead>;
  readProjectMaterialOriginal(input: ProjectMaterialLocator): Promise<ProjectMaterialOriginalRead>;
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
  renameProjectOutput(input: ProjectRenameOutputInput): Promise<ProjectOutputRead>;
  moveProjectOutput(input: ProjectMoveOutputInput): Promise<ProjectOutputRead>;
  removeProjectOutput(input: ProjectOutputLocator): Promise<boolean>;
  downloadProjectFile(input: ProjectDownloadFileInput): Promise<ProjectDownloadFileResult>;
}

// Project invoke channels live with the schema-free channel constants
// (ipc-channels.ts) so the preload bridge never pulls this Zod schema module;
// re-exported here for the domain single-import convenience.
export { PROJECT_IPC } from "./ipc-channels";

declare module "./contracts" {
  interface DesktopApi extends ProjectDesktopApi {}
}

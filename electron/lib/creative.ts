import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { appPrivateStatePath, findRepoRoot, ensureInsideRepo, relativeToOpenmind, resolveOpenmindRoot } from "./settings";
import { readJson } from "./content";
import { copyDirectoryRecursively, moveDirectoryWithFallback, writeJsonAtomic, writeTextAtomic } from "./fs-utils";
import {
  ALLOWED_STAGE_TRANSITIONS,
  CREATIVE_STAGE_DISK_FOLDERS,
  CREATIVE_STAGE_SCAN_FOLDERS,
  CREATIVE_WORKSPACE_SEGMENTS,
  TOPIC_SECTION_HEADERS,
  TOPIC_SECTION_PLATFORM,
  stageFromProjectPath,
  type CreativeStageId
} from "../../shared/creative-registry";
import { messages } from "../../shared/messages";
import type {
  CreativeAnalytics,
  CreativeProjectDetail,
  CreativeProjectManifest,
  CreativeProjectSummary,
  CreativeReleaseEvent,
  CreativeReviewIssue,
  CreativeReviewReport,
  CreativeTopic,
  CreativeTopicsPayload,
  CreativeVersion
} from "../../shared/contracts";

type WorkflowStagePolicy = {
  autoVersionOnStageChange: boolean;
  reviewRequiredForReady: boolean;
  publishChecklistEnabled: boolean;
};

const DEFAULT_WORKFLOW_STAGE_POLICY: WorkflowStagePolicy = {
  autoVersionOnStageChange: true,
  reviewRequiredForReady: true,
  publishChecklistEnabled: true
};

const STAGE_FOLDERS = CREATIVE_STAGE_DISK_FOLDERS;

function relativeContentPath(absolutePath: string): string {
  return resolveOpenmindRoot()
    ? relativeToOpenmind(absolutePath)
    : path.relative(findRepoRoot(), absolutePath).split(path.sep).join("/");
}

// 内部类型：从 ai_topic_*.md 解析出来的原始选题条目。
interface ParsedTopic {
  section?: string;
  platform?: string;
  title?: string;
  score?: number;
  body?: string;
  bodyLines?: string[];
}

// 内部类型：readCreativeTopicFile 的缓存值。
interface CachedTopicFile {
  mtimeMs: number;
  size: number;
  raw: string;
  topics: ParsedTopic[];
}

// 内部类型：readCreativeTopicState 返回的 day → topicId → state。
type TopicStateStore = Record<string, Record<string, { ignored?: boolean; projectDir?: string | null; updatedAt?: string }>>;

// 内部类型：readManualTopics 返回的 store（day → 手动选题数组）。
type ManualTopicStore = Record<string, ManualTopicEntry[]>;

interface ManualTopicEntry {
  title: string;
  body: string;
  score: number;
  section: string;
  platform: string;
  createdAt: string;
}

// 内部类型：listCreativeProjects 返回的条目（在 CreativeProjectSummary 基础上补充几个内部字段）。
interface CreativeProjectEntry extends CreativeProjectSummary {
  date: string;
  status: string;
  platforms: Record<string, string>;
  tags: string[];
  updatedAt: string;
  hasAssets: boolean;
  completion: number;
  createdAt: string | null;
  publishedAt: string | null;
}

// 内部类型：calcCompletion 的入参 manifest 形状（来自磁盘 + 注入的 stage）。
interface CompletionManifest {
  platforms?: Record<string, string>;
  asset_collection?: string | null;
  review?: string;
  stage?: string;
  [key: string]: unknown;
}

// 内部类型：getCreativeReleaseLog 的缓存值。
interface CachedReleaseLog {
  mtimeMs: number;
  size: number;
  events: CreativeReleaseEvent[];
}

// 内部类型：appendReleaseLog 的事件载荷（不含 id/createdAt，由 appendReleaseLog 补齐）。
type ReleaseEventInput = Omit<CreativeReleaseEvent, "id" | "createdAt">;

// 内部类型：createCreativeProject 入参。
interface CreateCreativeProjectInput {
  date?: string;
  topic?: Partial<CreativeTopic> & { id?: string };
  sourceTopicId?: string;
}

// 内部类型：saveCreativeFile 入参。
interface SaveCreativeFileInput {
  projectDir?: string;
  file?: string;
  content?: string;
  createVersion?: boolean;
  versionNote?: string;
  acceptTruncated?: boolean;
}

// 内部类型：updateCreativeManifest 的 patch。
interface ManifestPatch {
  status?: string;
  tags?: string[];
  owner?: string;
  platforms?: Record<string, string>;
  asset_collection?: string | null;
  publish?: Partial<CreativeProjectManifest["publish"]> & Record<string, unknown>;
}

// 内部类型：updateCreativeTopicState 的 patch。
interface TopicStatePatch {
  projectDir?: string;
  ignored?: boolean;
}

// 内部类型：磁盘上的 manifest 宽松形状（getCreativeProject / updateCreativeManifest 等用 readJson 读）。
type DiskManifest = Record<string, unknown> & {
  topic?: string;
  date?: string;
  status?: string;
  stage?: string;
  platforms?: Record<string, string>;
  tags?: string[];
  updated_at?: string;
  created_at?: string;
  asset_collection?: string | null;
  review?: string;
  reviewReport?: CreativeReviewReport | null;
  publish?: PublishConfig & { status?: string };
  aiSessionIds?: string[];
  sourceTopicId?: string | null;
};

// 内部类型：publish 配置（磁盘上）。
interface PublishConfig {
  platform?: string;
  scheduledAt?: string | null;
  coverPath?: string | null;
  summary?: string;
  tags?: string[];
  status?: string;
  exportedPath?: string | null;
  publishedUrl?: string | null;
  publishedAt?: string | null;
}

let creativeProjectsCache: CreativeProjectEntry[] | null = null;
let creativeProjectsFingerprint = "";
const creativeTopicFileCache = new Map<string, CachedTopicFile>();
const creativeReleaseLogCache = new Map<string, CachedReleaseLog>();

function invalidateCreativeProjectsCache(): void {
  creativeProjectsCache = null;
  creativeProjectsFingerprint = "";
}

function writeJsonSafe(filePath: string, value: unknown): void {
  writeJsonAtomic(filePath, value);
  if (String(filePath).replaceAll("\\", "/").includes("/文稿库/")) invalidateCreativeProjectsCache();
  creativeReleaseLogCache.delete(filePath);
}

// 落盘 manifest.json 并追加一条 release log。统一此前 8+ 处 readJson→改→writeJsonSafe→appendReleaseLog 样板。
function persistManifest(absDir: string, manifest: unknown, releaseEvent: ReleaseEventInput): void {
  writeJsonSafe(path.join(absDir, "manifest.json"), manifest);
  appendReleaseLog(absDir, releaseEvent);
}

// 选题 markdown 的 section 头见 shared/creative-registry TOPIC_SECTION_HEADERS。
export function parseTopicMarkdown(markdown: string): ParsedTopic[] {
  const topics: ParsedTopic[] = [];
  const lines = markdown.split("\n");
  let currentSection: string | null = null;
  let currentTopic: ParsedTopic | null = null;
  let todayPickBody: string[] = [];
  let todayPick: ParsedTopic | null = null;

  for (const line of lines) {
    if (line.startsWith(TOPIC_SECTION_HEADERS.recommendation)) { currentSection = "recommendation"; continue; }
    if (line.startsWith(TOPIC_SECTION_HEADERS.xiaohongshu)) {
      if (todayPick) { todayPick.body = todayPickBody.join("\n").trim(); topics.push(todayPick); todayPick = null; todayPickBody = []; }
      currentSection = "xiaohongshu"; continue;
    }
    if (line.startsWith(TOPIC_SECTION_HEADERS.wechat)) {
      if (currentTopic) { topics.push(currentTopic); currentTopic = null; }
      currentSection = "wechat"; continue;
    }
    if (line.startsWith(TOPIC_SECTION_HEADERS.pool)) {
      if (currentTopic) { topics.push(currentTopic); currentTopic = null; }
      currentSection = "pool"; continue;
    }
    if (TOPIC_SECTION_HEADERS.end.some((h) => line.startsWith(h))) {
      if (currentTopic) { topics.push(currentTopic); currentTopic = null; }
      currentSection = null; continue;
    }

    if (currentSection === "recommendation") {
      const bold = line.match(/^\*\*(.+?)\*\*$/);
      if (bold && !todayPick) {
        todayPick = { title: bold[1], section: "today_pick", platform: TOPIC_SECTION_PLATFORM.recommendation, score: 9, body: "" };
      } else if (todayPick) {
        todayPickBody.push(line);
      }
    }
    if (currentSection === "xiaohongshu" || currentSection === "wechat") {
      if (line.startsWith("### 选题")) {
        if (currentTopic) topics.push(currentTopic);
        const headerTitle = line.match(/### 选题[一二三四五六七八九十\d]+[：:](.+)/);
        currentTopic = {
          section: currentSection,
          platform: TOPIC_SECTION_PLATFORM[currentSection as keyof typeof TOPIC_SECTION_PLATFORM],
          bodyLines: [],
          title: headerTitle ? headerTitle[1].trim() : undefined
        };
        continue;
      }
      if (currentTopic) {
        const titleMatch = line.match(/^[-*]\s+(?:核心观点|核心判断|标题)：(.+)/);
        if (titleMatch && !currentTopic.title) {
          currentTopic.title = titleMatch[1].trim();
        }
        const scoreMatch = line.match(/推荐指数[：:]\s*(\d+)/);
        if (scoreMatch) {
          currentTopic.score = parseInt(scoreMatch[1], 10);
        }
        currentTopic.bodyLines!.push(line);
      }
    }
  }
  if (currentTopic) topics.push(currentTopic);

  for (const t of topics) {
    if (t.bodyLines) { t.body = t.bodyLines.join("\n").trim(); delete t.bodyLines; }
    if (!t.title) t.title = messages.common.unnamedTopic;
  }
  return topics;
}

export function getCreativeTopics(date: string): TopicsPayload {
  const day = String(date || "").replace(/\D/g, "").slice(0, 8);
  const formatted = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
  const topicDir = ensureInsideRepo(path.join("openmind", "creative", "01-内容生产", "选题管理"));
  const candidates: string[] = [];
  try {
    for (const entry of fs.readdirSync(topicDir)) {
      if (entry.includes(formatted) && entry.endsWith(".md") && entry.startsWith("ai_topic_")) {
        candidates.push(path.join(topicDir, entry));
      }
    }
  } catch { /* no topic directory yet */ }
  candidates.sort();
  return buildCreativeTopicsPayload(
    date,
    day,
    candidates.at(-1),
    readManualTopics(),
    readCreativeTopicState()
  );
}

// 内部类型：buildCreativeTopicsPayload / getCreativeTopics 的返回载荷。
// 比 contracts 的 CreativeTopicsPayload 多出 raw/file 两个字段（原 JS 行为，保留）。
interface TopicsPayload {
  date: string;
  topics: CreativeTopic[];
  raw: string;
  file?: string;
}

interface AllCreativeTopicDay extends TopicsPayload {
  label: string;
}

export function getAllCreativeTopics(): AllCreativeTopicDay[] {
  const topicDir = ensureInsideRepo(path.join("openmind", "creative", "01-内容生产", "选题管理"));
  const days: AllCreativeTopicDay[] = [];
  const seen = new Set<string>();
  let entries: string[];
  try { entries = fs.readdirSync(topicDir); } catch { entries = []; }
  const files = entries.filter((e) => e.startsWith("ai_topic_") && e.endsWith(".md")).sort().reverse();
  const manualStore = readManualTopics();
  const topicState = readCreativeTopicState();
  for (const file of files) {
    const m = file.match(/ai_topic_(\d{4})-(\d{2})-(\d{2})/);
    if (!m) continue;
    const date = `${m[1]}${m[2]}${m[3]}`;
    if (seen.has(date)) continue;
    seen.add(date);
    const payload = buildCreativeTopicsPayload(date, date, path.join(topicDir, file), manualStore, topicState);
    if (payload.topics.length) {
      days.push({ date, label: `${m[1]}-${m[2]}-${m[3]}`, topics: payload.topics, file: payload.file, raw: payload.raw });
    }
  }
  for (const date of Object.keys(manualStore)) {
    if (seen.has(date) || !Array.isArray(manualStore[date]) || !manualStore[date].length) continue;
    const payload = buildCreativeTopicsPayload(date, date, undefined, manualStore, topicState);
    if (payload.topics.length) {
      days.push({ date, label: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`, topics: payload.topics, file: payload.file, raw: payload.raw });
    }
  }
  return days.sort((a, b) => b.date.localeCompare(a.date));
}

function buildCreativeTopicsPayload(
  date: string,
  day: string,
  filePath: string | undefined,
  manualStore: ManualTopicStore,
  topicState: TopicStateStore
): TopicsPayload {
  const cachedFile = filePath ? readCreativeTopicFile(filePath) : null;
  const parsed = cachedFile ? decorateTopics(day, cachedFile.topics, topicState) : [];
  const manual = (manualStore[day] || [])
    .map((topic, index) => decorateTopic(day, topic, parsed.length + index, topicState))
    .filter((topic) => !topic.ignored);
  return {
    date,
    topics: [...parsed, ...manual],
    raw: cachedFile?.raw || "",
    file: filePath ? relativeContentPath(filePath) : undefined
  };
}

function readCreativeTopicFile(filePath: string): CachedTopicFile | null {
  let stat: fs.Stats;
  try { stat = fs.statSync(filePath); } catch { return null; }
  const cached = creativeTopicFileCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;
  const raw = fs.readFileSync(filePath, "utf8");
  const value: CachedTopicFile = { mtimeMs: stat.mtimeMs, size: stat.size, raw, topics: parseTopicMarkdown(raw) };
  creativeTopicFileCache.set(filePath, value);
  return value;
}

export function listCreativeProjects(): CreativeProjectEntry[] {
  const draftRoot = ensureInsideRepo(path.join(...CREATIVE_WORKSPACE_SEGMENTS));
  const stages = CREATIVE_STAGE_SCAN_FOLDERS.map(({ diskFolder, stage }) => [diskFolder, stage] as const);
  const fingerprint = `${draftRoot}|${stages.map(([folder]) => {
    try {
      const stat = fs.statSync(path.join(draftRoot, folder));
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "0:0";
    }
  }).join("|")}`;
  if (creativeProjectsCache && creativeProjectsFingerprint === fingerprint) return creativeProjectsCache;
  const projects: CreativeProjectEntry[] = [];

  function scanDir(directory: string, stage: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectDir = path.join(directory, entry.name);
      let projectEntries: fs.Dirent[];
      try { projectEntries = fs.readdirSync(projectDir, { withFileTypes: true }); } catch { continue; }
      if (!projectEntries.some((item) => item.isFile() && item.name === "manifest.json")) continue;
      const manifestPath = path.join(projectDir, "manifest.json");
      const manifest = readJson<DiskManifest>(manifestPath, {});
      const files = projectEntries.filter((item) => item.name !== "assets").map((item) => item.name);
      const hasAssets = projectEntries.some((item) => item.isDirectory() && item.name === "assets");
      const completion = calcCompletion({ ...manifest, stage }, files, hasAssets);
      projects.push({
        id: entry.name,
        dir: relativeContentPath(projectDir),
        topic: manifest.topic || entry.name,
        date: manifest.date || entry.name.slice(0, 8),
        status: manifest.status || "unknown",
        stage,
        platforms: manifest.platforms || {},
        tags: Array.isArray(manifest.tags) ? manifest.tags : [],
        updatedAt: manifest.updated_at || fs.statSync(projectDir).mtime.toISOString(),
        archived: stage === "archived",
        completion,
        hasAssets,
        createdAt: manifest.created_at || null,
        publishedAt: (manifest.publish as PublishConfig | undefined)?.publishedAt || null
      });
    }
  }

  for (const [folder, stage] of stages) {
    scanDir(path.join(draftRoot, folder), stage);
  }
  creativeProjectsCache = projects.sort((a, b) => b.date.localeCompare(a.date));
  creativeProjectsFingerprint = fingerprint;
  return creativeProjectsCache;
}

// 创意项目完成度权重（总和 100）。
const COMPLETION_WEIGHTS = { topicBrief: 20, drafts: 45, assets: 15, review: 10, stageReady: 5, stagePublished: 5 };
// review.md 不存在、或 manifest.review 为这些哨兵值时，视为「未做 review」。
const REVIEW_ABSENT_VALUES: Array<string | undefined | null> = ["not_requested", undefined, null];

export function calcCompletion(manifest: CompletionManifest, files: string[], hasAssets: boolean): number {
  const w = COMPLETION_WEIGHTS;
  let completion = 0;
  if (files.includes("topic-brief.md")) completion += w.topicBrief;

  const platformStates = Object.values(manifest.platforms || {});
  const completedDrafts = platformStates.filter((state) => ["draft", "reviewed", "ready", "published"].includes(state)).length;
  if (platformStates.length) {
    completion += Math.round((completedDrafts / platformStates.length) * w.drafts);
  }

  if (hasAssets || manifest.asset_collection === "manifest_created") completion += w.assets;
  if (files.includes("review.md") || !REVIEW_ABSENT_VALUES.includes(manifest.review)) completion += w.review;
  if (["ready", "published"].includes(manifest.stage || "")) completion += w.stageReady;
  if (manifest.stage === "published") completion += w.stagePublished;
  return Math.min(completion, 100);
}

export function stageFromProjectDir(projectDir: string): string {
  return stageFromProjectPath(projectDir);
}

interface CreativeProjectFullDetail extends Omit<CreativeProjectDetail, "manifest"> {
  manifest: DiskManifest;
  stage: string;
  files: Record<string, string>;
  truncatedFiles: string[];
  assetsManifest: unknown;
  missingAssets: unknown;
  reviewReport: CreativeReviewReport | null;
  releaseLog: CreativeReleaseEvent[];
  dir: string;
}

export function getCreativeProject(projectDir: string): CreativeProjectFullDetail {
  const absDir = ensureInsideRepo(projectDir);
  const manifest = readJson<DiskManifest>(path.join(absDir, "manifest.json"), {});
  const files: Record<string, string> = {};
  const truncatedFiles: string[] = [];
  const maxBytes = 512 * 1024;
  const possibleFiles = fs.existsSync(absDir)
    ? fs.readdirSync(absDir).filter((name) => name.endsWith(".md")).sort()
    : [];
  for (const name of possibleFiles) {
    const fp = path.join(absDir, name);
    if (fs.existsSync(fp)) {
      const raw = fs.readFileSync(fp, "utf8");
      if (Buffer.byteLength(raw, "utf8") > maxBytes) {
        files[name] = raw.slice(0, maxBytes);
        truncatedFiles.push(name);
      } else {
        files[name] = raw;
      }
    }
  }
  const assetsManifest = readJson<unknown>(path.join(absDir, "assets", "manifest.json"), null);
  const missingAssets = readJson<unknown>(path.join(absDir, "assets", "missing_assets.json"), null) ||
                        readJson<unknown>(path.join(absDir, "missing_assets.json"), null);
  const stage = stageFromProjectDir(projectDir);
  const reviewReport = readJson<CreativeReviewReport | null>(path.join(absDir, "review-report.json"), (manifest.reviewReport as CreativeReviewReport | null) || null);
  const releaseLog = readJson<CreativeReleaseEvent[]>(path.join(absDir, "release-log.json"), []);
  return { manifest: { ...manifest, stage, reviewReport }, stage, files, truncatedFiles, assetsManifest, missingAssets, reviewReport, releaseLog: Array.isArray(releaseLog) ? releaseLog : [], dir: projectDir };
}

export function advanceProjectStage(
  projectDir: string,
  nextStage: string,
  policy: WorkflowStagePolicy = DEFAULT_WORKFLOW_STAGE_POLICY
): CreativeProjectFullDetail {
  const absDir = ensureInsideRepo(projectDir);
  const currentStage = stageFromProjectDir(projectDir);
  const draftRoot = ensureInsideRepo(path.join(...CREATIVE_WORKSPACE_SEGMENTS));
  const targetFolder = STAGE_FOLDERS[nextStage as Exclude<CreativeStageId, "today">];
  if (!targetFolder) throw new Error(messages.errors.creative.invalidStage(nextStage));
  if (!(ALLOWED_STAGE_TRANSITIONS[currentStage] || []).includes(nextStage as CreativeStageId)) {
    throw new Error(messages.errors.creative.invalidStageTransition(currentStage, nextStage));
  }
  const currentManifest = readJson<DiskManifest>(path.join(absDir, "manifest.json"), {});
  if (policy.reviewRequiredForReady && currentStage === "review" && nextStage === "ready" && (currentManifest.reviewReport as CreativeReviewReport | undefined)?.status !== "approved") {
    throw new Error(messages.errors.creative.reviewNotApproved);
  }
  if (currentStage === "ready" && nextStage === "published") {
    const publish = (currentManifest.publish as PublishConfig | undefined) || {};
    const exported = Boolean(publish.platform && publish.status === "exported" && publish.exportedPath);
    if (!exported || (policy.publishChecklistEnabled && !publishChecklistComplete(absDir, publish))) {
      throw new Error(messages.errors.creative.publishNotReady);
    }
  }
  if (policy.autoVersionOnStageChange) createStageVersions(absDir, currentStage, nextStage);
  const dirName = path.basename(absDir);
  const destDir = path.join(draftRoot, targetFolder, dirName);
  if (path.resolve(absDir) === path.resolve(destDir)) return getCreativeProject(projectDir);
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  if (fs.existsSync(destDir)) throw new Error(messages.errors.creative.duplicateStageProject);
  moveDirectoryWithFallback(absDir, destDir);
  const manifestPath = path.join(destDir, "manifest.json");
  const manifest = readJson<DiskManifest>(manifestPath, {});
  manifest.stage = nextStage;
  manifest.package_dir = relativeContentPath(destDir);
  manifest.status = nextStage === "published" ? "exported" : `${nextStage}_ready`;
  manifest.progress = stageProgress(nextStage);
  if (nextStage === "published") {
    manifest.publish ||= {};
    (manifest.publish as PublishConfig).publishedAt ||= new Date().toISOString();
  }
  manifest.updated_at = new Date().toISOString();
  persistManifest(destDir, manifest, { action: "stage_changed", stage: nextStage, detail: messages.creativeUi.releaseDetail.stageEntered(nextStage) });
  return getCreativeProject(relativeContentPath(destDir));
}

interface CreatedCreativeProject extends CreativeProjectFullDetail {
  reused?: boolean;
}

export function createCreativeProject(input: CreateCreativeProjectInput): CreatedCreativeProject {
  const date = String((input && input.date) || "").replace(/\D/g, "").slice(0, 8);
  const topic = (input && input.topic) || {};
  if (!/^\d{8}$/.test(date)) throw new Error(messages.errors.creative.invalidCreateDate);
  const title = String(topic.title || "").trim();
  if (!title) throw new Error(messages.errors.creative.emptyTopicTitle);
  const sourceTopicId = String((input && input.sourceTopicId) || topic.id || "").trim() || null;
  if (sourceTopicId) {
    const existing = listCreativeProjects().find((project) => {
      if (project.archived) return false;
      const manifest = readJson<DiskManifest>(path.join(ensureInsideRepo(project.dir), "manifest.json"), {});
      return manifest.sourceTopicId === sourceTopicId;
    });
    if (existing) return { ...getCreativeProject(existing.dir), reused: true };
  }
  const draftRoot = ensureInsideRepo(path.join(...CREATIVE_WORKSPACE_SEGMENTS, STAGE_FOLDERS.drafting));
  fs.mkdirSync(draftRoot, { recursive: true });
  const baseName = `${date}-${sanitizeProjectName(title)}`.slice(0, 120);
  let projectName = baseName;
  let counter = 2;
  while (fs.existsSync(path.join(draftRoot, projectName))) projectName = `${baseName}-${counter++}`;
  const projectDir = path.join(draftRoot, projectName);
  fs.mkdirSync(projectDir, { recursive: true });
  const now = new Date().toISOString();
  const manifest: DiskManifest = {
    schemaVersion: 1,
    date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
    topic: title,
    stage: "drafting",
    status: "topic_ready",
    sourceTopicId,
    sources: [],
    platforms: {},
    tags: [],
    owner: messages.creative.defaults.owner,
    progress: 20,
    asset_collection: null,
    reviewReport: null,
    publish: {
      platform: "",
      scheduledAt: null,
      coverPath: null,
      summary: "",
      tags: [],
      status: "draft",
      exportedPath: null,
      publishedUrl: null,
      publishedAt: null
    },
    source_topic_file: null,
    created_at: now,
    updated_at: now
  };
  writeJsonSafe(path.join(projectDir, "manifest.json"), manifest);
  const topicBody = String(topic.body || "").trim();
  fs.writeFileSync(path.join(projectDir, "topic-brief.md"), `# ${title}\n\n${topicBody || messages.creative.defaults.topicBriefPlaceholder}\n`, "utf8");
  fs.writeFileSync(path.join(projectDir, "draft.md"), `# ${title}\n\n`, "utf8");
  appendReleaseLog(projectDir, { action: "project_created", stage: "drafting", detail: messages.creativeUi.releaseDetail.createdFromTopic });
  if (sourceTopicId) updateCreativeTopicState(date, sourceTopicId, { projectDir: relativeContentPath(projectDir) });
  return getCreativeProject(relativeContentPath(projectDir));
}

export function saveCreativeFile(input: SaveCreativeFileInput): CreativeProjectFullDetail {
  const projectDir = ensureInsideRepo(String((input && input.projectDir) || ""));
  const file = safeMarkdownName(input && input.file);
  const content = String((input && input.content) || "");
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) throw new Error(messages.errors.creative.invalidProjectDir);
  const target = path.join(projectDir, file);
  if (fs.existsSync(target) && !(input && input.acceptTruncated) && Buffer.byteLength(content, "utf8") < Buffer.byteLength(fs.readFileSync(target, "utf8"), "utf8") * 0.5 && Buffer.byteLength(fs.readFileSync(target, "utf8"), "utf8") > 512 * 1024) {
    throw new Error(messages.errors.creative.truncatedSaveBlocked(file));
  }
  if (input && input.createVersion && fs.existsSync(target)) {
    createCreativeVersion(relativeContentPath(projectDir), file, fs.readFileSync(target, "utf8"), input.versionNote || messages.creative.version.beforeSave);
  }
  writeTextAtomic(target, content);
  const manifestPath = path.join(projectDir, "manifest.json");
  const manifest = readJson<DiskManifest>(manifestPath, {});
  manifest.updated_at = new Date().toISOString();
  persistManifest(projectDir, manifest, { action: "file_saved", stage: (manifest.stage as string) || stageFromProjectDir(projectDir), file, detail: messages.creativeUi.releaseDetail.fileSaved(file) });
  return getCreativeProject(relativeContentPath(projectDir));
}

export function createCreativeVersion(projectDir: string, file: string, content: string, note: string): CreativeVersion {
  const absDir = ensureInsideRepo(projectDir);
  const safeFile = safeMarkdownName(file);
  const createdAt = new Date();
  const id = createdAt.toISOString().replace(/[:.]/g, "-");
  const versionDir = path.join(absDir, "versions", safeFile.replace(/\.md$/i, ""));
  fs.mkdirSync(versionDir, { recursive: true });
  const versionPath = path.join(versionDir, `${id}.md`);
  fs.writeFileSync(versionPath, String(content || ""), "utf8");
  writeJsonSafe(`${versionPath}.json`, { id, file: safeFile, createdAt: createdAt.toISOString(), note: String(note || messages.creative.version.manual) });
  return { id, file: safeFile, path: relativeContentPath(versionPath), createdAt: createdAt.toISOString(), note: String(note || messages.creative.version.manual), size: Buffer.byteLength(String(content || ""), "utf8") };
}

interface VersionMetadata {
  id?: string;
  createdAt?: string;
  note?: string;
}

export function listCreativeVersions(projectDir: string, file: string): CreativeVersion[] {
  const absDir = ensureInsideRepo(projectDir);
  const safeFile = safeMarkdownName(file);
  const versionDir = path.join(absDir, "versions", safeFile.replace(/\.md$/i, ""));
  if (!fs.existsSync(versionDir)) return [];
  return fs.readdirSync(versionDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const versionPath = path.join(versionDir, name);
      const metadata = readJson<VersionMetadata>(`${versionPath}.json`, {});
      const stat = fs.statSync(versionPath);
      return {
        id: metadata.id || name.replace(/\.md$/, ""),
        file: safeFile,
        path: relativeContentPath(versionPath),
        createdAt: metadata.createdAt || stat.mtime.toISOString(),
        note: metadata.note || messages.creative.version.history,
        size: stat.size
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getCreativeAnalytics(): CreativeAnalytics {
  const projects = listCreativeProjects();
  const releaseLogs = new Map(projects.map((project) => [project.dir, getCreativeReleaseLog(project.dir)]));
  const stages = ["drafting", "review", "ready", "published"].map((stage) => ({ stage, count: projects.filter((item) => item.stage === stage).length }));
  const platformCounts = new Map<string, number>();
  for (const project of projects) {
    for (const platform of Object.keys(project.platforms || {})) {
      platformCounts.set(platform, (platformCounts.get(platform) || 0) + 1);
    }
  }
  return {
    total: projects.length,
    stages,
    platforms: [...platformCounts.entries()].map(([platform, count]) => ({ platform, count })),
    averageCompletion: projects.length ? Math.round(projects.reduce((sum, item) => sum + item.completion, 0) / projects.length) : 0,
    averageCycleHours: averageCycle(projects),
    stageDurations: ["drafting", "review", "ready", "published"].map((stage) => ({
      stage,
      averageHours: averageStageDuration(projects, stage, releaseLogs)
    }))
  };
}

export function updateCreativeManifest(projectDir: string, patch: ManifestPatch): CreativeProjectFullDetail {
  const absDir = ensureInsideRepo(projectDir);
  const manifestPath = path.join(absDir, "manifest.json");
  const manifest = readJson<DiskManifest>(manifestPath, {});
  if (patch.status !== undefined) manifest.status = String(patch.status);
  if (Array.isArray(patch.tags)) manifest.tags = [...new Set(patch.tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 30);
  if (patch.owner !== undefined) manifest.owner = String(patch.owner);
  if (patch.platforms && typeof patch.platforms === "object") manifest.platforms = { ...(manifest.platforms || {}), ...patch.platforms };
  if (patch.asset_collection !== undefined) manifest.asset_collection = patch.asset_collection;
  if (patch.publish && typeof patch.publish === "object") {
    const previousStatus = (manifest.publish as PublishConfig | undefined)?.status;
    manifest.publish = { ...((manifest.publish as PublishConfig | undefined) || {}), ...patch.publish } as PublishConfig;
    const publishTags = (manifest.publish as PublishConfig).tags;
    if (Array.isArray(publishTags)) (manifest.publish as PublishConfig).tags = [...new Set(publishTags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 30);
    if ((manifest.publish as PublishConfig).status !== previousStatus) {
      appendReleaseLog(absDir, {
        action: publishAction((manifest.publish as PublishConfig).status || ""),
        stage: (manifest.stage as string) || stageFromProjectDir(projectDir),
        platform: (manifest.publish as PublishConfig).platform || undefined,
        status: (manifest.publish as PublishConfig).status,
        target: (manifest.publish as PublishConfig).exportedPath || (manifest.publish as PublishConfig).publishedUrl || undefined,
        detail: messages.creativeUi.releaseDetail.publishStatus((manifest.publish as PublishConfig).status || "")
      });
    }
  }
  manifest.progress = calcCompletion({ ...manifest, stage: stageFromProjectDir(projectDir) }, fs.readdirSync(absDir), fs.existsSync(path.join(absDir, "assets")));
  manifest.updated_at = new Date().toISOString();
  writeJsonSafe(manifestPath, manifest);
  return getCreativeProject(relativeContentPath(absDir));
}

export function bindCreativeSession(projectDir: string, sessionId: string): CreativeProjectFullDetail {
  const absDir = ensureInsideRepo(projectDir);
  const manifest = readJson<DiskManifest>(path.join(absDir, "manifest.json"), {});
  const ids = Array.isArray(manifest.aiSessionIds) ? manifest.aiSessionIds : [];
  if (!ids.includes(sessionId)) ids.push(sessionId);
  manifest.aiSessionIds = ids;
  manifest.updated_at = new Date().toISOString();
  persistManifest(absDir, manifest, { action: "session_bound", stage: (manifest.stage as string) || stageFromProjectDir(projectDir), detail: messages.creativeUi.releaseDetail.sessionBound(sessionId) });
  return getCreativeProject(relativeContentPath(absDir));
}

export function updateCreativeTopicState(date: string, topicId: string, patch: TopicStatePatch): TopicsPayload {
  const statePath = appPrivateStatePath("creative-topic-state.json");
  const state = readJson<TopicStateStore>(statePath, {});
  const day = String(date || "").replace(/\D/g, "").slice(0, 8);
  state[day] ||= {};
  state[day][topicId] = { ...(state[day][topicId] || {}), ...patch, updatedAt: new Date().toISOString() };
  writeJsonSafe(statePath, state);
  return getCreativeTopics(day);
}

export function reviewCreativeProject(projectDir: string): CreativeProjectFullDetail {
  const absDir = ensureInsideRepo(projectDir);
  const detail = getCreativeProject(projectDir);
  const preferred = ["draft.md", "wechat-draft.md", "xiaohongshu-draft.md", "twitter-thread.md"].find((file) => detail.files?.[file]) || Object.keys(detail.files || {}).find((file) => file !== "topic-brief.md");
  if (!preferred) throw new Error(messages.errors.creative.noDraftForReview);
  const content = detail.files[preferred] || "";
  const report = buildReviewReport(content);
  writeJsonSafe(path.join(absDir, "review-report.json"), report);
  const manifest = readJson<DiskManifest>(path.join(absDir, "manifest.json"), {});
  manifest.reviewReport = report;
  manifest.review = report.status;
  manifest.updated_at = new Date().toISOString();
  persistManifest(absDir, manifest, { action: "review_generated", stage: stageFromProjectDir(projectDir), file: preferred, status: report.status, detail: messages.creativeUi.releaseDetail.reviewScore(report.score) });
  return getCreativeProject(relativeContentPath(absDir));
}

export function setCreativeReviewStatus(projectDir: string, status: "pending" | "changes-requested" | "approved"): CreativeProjectFullDetail {
  if (!["pending", "changes-requested", "approved"].includes(status)) throw new Error(messages.errors.creative.invalidReviewStatus);
  const absDir = ensureInsideRepo(projectDir);
  const reportPath = path.join(absDir, "review-report.json");
  const report = readJson<CreativeReviewReport | null>(reportPath, null);
  if (!report) throw new Error(messages.errors.creative.reviewReportRequired);
  report.status = status;
  report.updatedAt = new Date().toISOString();
  writeJsonSafe(reportPath, report);
  const manifest = readJson<DiskManifest>(path.join(absDir, "manifest.json"), {});
  manifest.reviewReport = report;
  manifest.review = status;
  manifest.updated_at = new Date().toISOString();
  persistManifest(absDir, manifest, { action: "review_status_changed", stage: stageFromProjectDir(projectDir), status, detail: messages.creativeUi.releaseDetail.reviewStatus(status) });
  return getCreativeProject(relativeContentPath(absDir));
}

export function readCreativeVersion(versionPath: string): { path: string; content: string } {
  const absPath = ensureInsideRepo(versionPath);
  if (!absPath.includes(`${path.sep}versions${path.sep}`) || !absPath.endsWith(".md")) throw new Error(messages.errors.creative.invalidVersionPath);
  return { path: relativeContentPath(absPath), content: fs.readFileSync(absPath, "utf8") };
}

export function restoreCreativeVersion(projectDir: string, file: string, versionPath: string): CreativeProjectFullDetail {
  const absDir = ensureInsideRepo(projectDir);
  const safeFile = safeMarkdownName(file);
  const version = readCreativeVersion(versionPath);
  const target = path.join(absDir, safeFile);
  if (fs.existsSync(target)) createCreativeVersion(projectDir, safeFile, fs.readFileSync(target, "utf8"), messages.creative.version.beforeRestore);
  createCreativeVersion(projectDir, safeFile, version.content, messages.creative.version.restoredFrom(path.basename(version.path)));
  fs.writeFileSync(target, version.content, "utf8");
  appendReleaseLog(absDir, { action: "version_restored", stage: stageFromProjectDir(projectDir), file: safeFile, target: version.path, detail: messages.creativeUi.releaseDetail.versionRestored });
  return getCreativeProject(relativeContentPath(absDir));
}

export function getCreativeReleaseLog(projectDir: string): CreativeReleaseEvent[] {
  const absDir = ensureInsideRepo(projectDir);
  const filePath = path.join(absDir, "release-log.json");
  let stat: fs.Stats;
  try { stat = fs.statSync(filePath); } catch { return []; }
  let cached = creativeReleaseLogCache.get(filePath);
  if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
    const events = readJson<CreativeReleaseEvent[]>(filePath, []);
    cached = { mtimeMs: stat.mtimeMs, size: stat.size, events: Array.isArray(events) ? events : [] };
    creativeReleaseLogCache.set(filePath, cached);
  }
  return cached.events.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function copyCreativeProject(projectDir: string): CreativeProjectFullDetail {
  const absDir = ensureInsideRepo(projectDir);
  const parent = path.dirname(absDir);
  const base = `${path.basename(absDir)}-copy`;
  let target = path.join(parent, base);
  let counter = 2;
  while (fs.existsSync(target)) target = path.join(parent, `${base}-${counter++}`);
  copyDirectoryRecursively(absDir, target, { errorOnExist: true });
  const manifestPath = path.join(target, "manifest.json");
  const manifest = readJson<DiskManifest>(manifestPath, {});
  manifest.topic = `${(manifest.topic as string) || path.basename(absDir)}${messages.creative.defaults.copySuffix}`;
  manifest.sourceTopicId = null;
  manifest.created_at = new Date().toISOString();
  manifest.updated_at = manifest.created_at;
  manifest.publish = { ...((manifest.publish as PublishConfig | undefined) || {}), status: "draft", exportedPath: null, publishedUrl: null, publishedAt: null } as PublishConfig;
  writeJsonSafe(manifestPath, manifest);
  writeJsonSafe(path.join(target, "release-log.json"), []);
  appendReleaseLog(target, { action: "project_copied", stage: stageFromProjectDir(target), detail: messages.creativeUi.releaseDetail.copiedFrom(relativeContentPath(absDir)) });
  return getCreativeProject(relativeContentPath(target));
}

export function archiveCreativeProject(projectDir: string): CreativeProjectFullDetail {
  const absDir = ensureInsideRepo(projectDir);
  if (stageFromProjectDir(projectDir) === "archived") return getCreativeProject(projectDir);
  const draftRoot = ensureInsideRepo(path.join(...CREATIVE_WORKSPACE_SEGMENTS));
  const targetRoot = path.join(draftRoot, STAGE_FOLDERS.archived);
  fs.mkdirSync(targetRoot, { recursive: true });
  let target = path.join(targetRoot, path.basename(absDir));
  if (fs.existsSync(target)) target = path.join(targetRoot, `${path.basename(absDir)}-${Date.now()}`);
  moveDirectory(absDir, target);
  const manifest = readJson<DiskManifest>(path.join(target, "manifest.json"), {});
  manifest.stage = "archived";
  manifest.updated_at = new Date().toISOString();
  writeJsonSafe(path.join(target, "manifest.json"), manifest);
  appendReleaseLog(target, { action: "project_archived", stage: "archived", detail: messages.creativeUi.releaseDetail.archived });
  return getCreativeProject(relativeContentPath(target));
}

export function restoreCreativeProject(projectDir: string): CreativeProjectFullDetail {
  const absDir = ensureInsideRepo(projectDir);
  if (stageFromProjectDir(projectDir) !== "archived") throw new Error(messages.errors.creative.onlyArchivedRestorable);
  const targetRoot = ensureInsideRepo(path.join(...CREATIVE_WORKSPACE_SEGMENTS, STAGE_FOLDERS.drafting));
  fs.mkdirSync(targetRoot, { recursive: true });
  let target = path.join(targetRoot, path.basename(absDir));
  if (fs.existsSync(target)) target = path.join(targetRoot, `${path.basename(absDir)}-${Date.now()}`);
  moveDirectory(absDir, target);
  const manifest = readJson<DiskManifest>(path.join(target, "manifest.json"), {});
  manifest.stage = "drafting";
  manifest.status = "drafting_ready";
  manifest.updated_at = new Date().toISOString();
  writeJsonSafe(path.join(target, "manifest.json"), manifest);
  appendReleaseLog(target, { action: "stage_changed", stage: "drafting", detail: messages.creativeUi.releaseDetail.restoredFromArchive });
  return getCreativeProject(relativeContentPath(target));
}

export function deleteCreativeProject(projectDir: string): true {
  const absDir = ensureInsideRepo(projectDir);
  const projectRoot = ensureInsideRepo(path.join(...CREATIVE_WORKSPACE_SEGMENTS));
  if (!isInside(projectRoot, absDir) || path.resolve(projectRoot) === path.resolve(absDir)) throw new Error(messages.errors.creative.deleteScopeOnly);
  fs.rmSync(absDir, { recursive: true, force: false });
  invalidateCreativeProjectsCache();
  return true;
}

function appendReleaseLog(projectDir: string, event: ReleaseEventInput): void {
  const filePath = path.join(projectDir, "release-log.json");
  const current = readJson<CreativeReleaseEvent[]>(filePath, []);
  const events = Array.isArray(current) ? current : [];
  events.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, createdAt: new Date().toISOString(), ...event });
  writeJsonSafe(filePath, events);
}

function decorateTopics(date: string, topics: ParsedTopic[], state: TopicStateStore = readCreativeTopicState()): CreativeTopic[] {
  const day = String(date || "").replace(/\D/g, "").slice(0, 8);
  return topics.map((topic, index) => decorateTopic(day, topic, index, state)).filter((topic) => !topic.ignored);
}

function decorateTopic(day: string, topic: ParsedTopic | ManualTopicEntry, index: number, state: TopicStateStore): CreativeTopic {
  const id = crypto.createHash("sha1").update(`${day}:${(topic as ParsedTopic).section || ""}:${(topic as ParsedTopic).title || ""}:${index}`).digest("hex");
  const dayState = (state || readJson<TopicStateStore>(appPrivateStatePath("creative-topic-state.json"), {}))?.[day] || {};
  const saved = dayState[id] || {};
  return { ...(topic as CreativeTopic), id, ignored: Boolean(saved.ignored), projectDir: saved.projectDir || null };
}

function readManualTopics(): ManualTopicStore {
  return readJson<ManualTopicStore>(appPrivateStatePath("creative-manual-topics.json"), {});
}

function readCreativeTopicState(): TopicStateStore {
  return readJson<TopicStateStore>(appPrivateStatePath("creative-topic-state.json"), {});
}

export function addManualTopic(date: string, input: { title?: string; body?: string; score?: number; platform?: string } | undefined): CreativeTopicsPayload {
  const day = String(date || "").replace(/\D/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(day)) throw new Error(messages.errors.creative.invalidTopicDate);
  const title = String(input?.title || "").trim();
  if (!title) throw new Error(messages.errors.creative.emptyTopicTitle);
  const store = readManualTopics();
  store[day] = Array.isArray(store[day]) ? store[day] : [];
  if (store[day].some((entry) => entry.title === title)) throw new Error(messages.errors.creative.duplicateTopic);
  store[day].push({
    title,
    body: String(input?.body || ""),
    score: Number.isFinite(input?.score) ? Math.max(0, Math.min(100, input!.score!)) : 0,
    section: "manual",
    platform: input?.platform || messages.common.unspecified,
    createdAt: new Date().toISOString()
  });
  writeJsonSafe(appPrivateStatePath("creative-manual-topics.json"), store);
  return getCreativeTopics(day);
}

function createStageVersions(absDir: string, fromStage: string, toStage: string): void {
  for (const file of fs.readdirSync(absDir).filter((name) => name.endsWith(".md"))) {
    createCreativeVersion(relativeContentPath(absDir), file, fs.readFileSync(path.join(absDir, file), "utf8"), messages.creative.version.stageChange(fromStage, toStage));
  }
}

function publishChecklistComplete(absDir: string, publish: PublishConfig): boolean {
  const markdown = fs.readdirSync(absDir)
    .filter((name) => name.endsWith(".md") && name !== "review.md")
    .map((name) => fs.readFileSync(path.join(absDir, name), "utf8"))
    .find((content) => /^#\s+\S+/m.test(content));
  return Boolean(
    markdown &&
    String(publish.summary || "").trim() &&
    Array.isArray(publish.tags) && publish.tags.some((tag) => String(tag).trim()) &&
    String(publish.coverPath || "").trim()
  );
}

// 审稿规则阈值与扣分。
const REVIEW_THRESHOLDS = { minBodyChars: 800, maxLineLength: 240, maxTitleLength: 42 };
const REVIEW_PENALTY: Record<string, number> = { error: 35, warning: 18, info: 8 };
const REVIEW_DIMENSIONS = ["structure", "accuracy", "readability", "platform", "seo"];

function scoreDimension(issues: CreativeReviewIssue[], dimension: string): number {
  return Math.max(0, 100 - issues.filter((issue) => issue.dimension === dimension).reduce(issuePenalty, 0));
}

function buildReviewReport(content: string): CreativeReviewReport {
  const now = new Date().toISOString();
  const lines = content.split(/\r?\n/);
  const issues: CreativeReviewIssue[] = [];
  const add = (dimension: CreativeReviewIssue["dimension"], severity: CreativeReviewIssue["severity"], title: string, detail: string, line: number | null = null): void => {
    issues.push({ id: crypto.randomUUID(), dimension, severity, title, detail, line });
  };
  const h = messages.creativeUi.review.heuristics;
  if (content.trim().length < REVIEW_THRESHOLDS.minBodyChars) add("readability", "warning", h.bodyTooShort.title, h.bodyTooShort.detail(content.trim().length), 1);
  if (!/^##\s+/m.test(content)) add("structure", "error", h.missingStructure.title, h.missingStructure.detail, 1);
  if (!/https?:\/\//.test(content)) add("accuracy", "warning", h.missingSource.title, h.missingSource.detail, null);
  const longLine = lines.findIndex((line) => line.length > REVIEW_THRESHOLDS.maxLineLength);
  if (longLine >= 0) add("readability", "info", h.longParagraph.title, h.longParagraph.detail, longLine + 1);
  const title = lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, "").trim() || "";
  if (!title) add("seo", "error", h.missingTitle.title, h.missingTitle.detail, 1);
  else if (title.length > REVIEW_THRESHOLDS.maxTitleLength) add("platform", "warning", h.titleTooLong.title, h.titleTooLong.detail(title.length), 1);
  if (!/[\u4e00-\u9fffA-Za-z0-9][。！？.!?]\s*$/.test(content.trim())) add("readability", "info", h.weakEnding.title, h.weakEnding.detail, lines.length);
  const dimensions = Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => [dimension, scoreDimension(issues, dimension)]));
  const score = Math.round(Object.values(dimensions).reduce((sum, value) => sum + value, 0) / Object.keys(dimensions).length);
  return { score, status: issues.some((issue) => issue.severity === "error") ? "changes-requested" : "pending", dimensions, issues, createdAt: now, updatedAt: now };
}

function issuePenalty(sum: number, issue: CreativeReviewIssue): number {
  return sum + (REVIEW_PENALTY[issue.severity] ?? REVIEW_PENALTY.info);
}

function stageProgress(stage: string): number {
  return (({ drafting: 35, review: 60, ready: 85, published: 100, archived: 100 } as Record<string, number>)[stage] || 0);
}

function publishAction(status: string): string {
  return (({ scheduled: "publish_scheduled", exported: "content_exported", cancelled: "schedule_cancelled", draft: "publish_draft" } as Record<string, string>)[status] || "publish_updated");
}

function moveDirectory(source: string, target: string): void {
  moveDirectoryWithFallback(source, target);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function averageCycle(projects: CreativeProjectEntry[]): number | null {
  const values = projects.flatMap((project) => {
    const start = Date.parse(project.createdAt || "");
    const end = Date.parse(project.publishedAt || "");
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? [(end - start) / 3_600_000] : [];
  });
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null;
}

function averageStageDuration(projects: CreativeProjectEntry[], stage: string, releaseLogs: Map<string, CreativeReleaseEvent[]>): number | null {
  const values = projects.flatMap((project) => {
    const log = (releaseLogs?.get(project.dir) || getCreativeReleaseLog(project.dir))
      .slice()
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const enterActions = stage === "drafting" ? ["project_created", "stage_changed"] : ["stage_changed"];
    const entered = log.find((event) => enterActions.includes(event.action) && event.stage === stage);
    if (!entered) return [];
    const next = log.find((event) => String(event.createdAt) > String(entered.createdAt) && event.action === "stage_changed" && event.stage !== stage);
    const start = Date.parse(entered.createdAt);
    const end = Date.parse(next?.createdAt || new Date().toISOString());
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? [(end - start) / 3_600_000] : [];
  });
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null;
}

function safeMarkdownName(value: unknown): string {
  const name = path.basename(String(value || ""));
  if (!name || !name.endsWith(".md") || name !== String(value || "")) throw new Error(messages.errors.creative.markdownOnly);
  return name;
}

function sanitizeProjectName(value: string): string {
  return String(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^[.-]+|[.-]+$/g, "") || "untitled";
}

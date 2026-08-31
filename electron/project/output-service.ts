import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ProjectOutputSchema,
  type ProjectCreateOutputInput,
  type ProjectOutput,
  type ProjectOutputRead,
  type ProjectSaveOutputInput
} from "../../shared/project-contracts";
import { writeJsonAtomic, writeTextAtomic } from "../lib/fs-utils";
import { ProjectPathResolver } from "./project-path-resolver";

const OUTPUT_INDEX_FILE = "outputs/.openmind-outputs.json";
const OUTPUTS_TOP_LEVEL = ["outputs"] as const;
const OutputIndexSchema = z.array(ProjectOutputSchema);

export class ProjectOutputService {
  constructor(private readonly paths: ProjectPathResolver) {}

  initializeProject(projectName: string): void {
    this.paths.withProjectMutationLock(() => {
      const directory = this.paths.resolveInsideProject(projectName, "outputs", {
        allowedTopLevels: OUTPUTS_TOP_LEVEL,
        allowMissingLeaf: true
      });
      fs.mkdirSync(directory, { recursive: true });
      const index = this.indexPath(projectName, true);
      if (!fs.existsSync(index)) writeJsonAtomic(index, []);
    });
  }

  list(projectName: string): ProjectOutput[] {
    return this.readIndex(projectName).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  create(input: ProjectCreateOutputInput & { projectName: string }): ProjectOutputRead {
    return this.paths.withProjectMutationLock(() => {
      const projectName = this.paths.resolveProject(input.projectName).name;
      this.initializeProject(projectName);
      const records = this.readIndex(projectName);
      const fileName = allocateOutputName(input.title, records, (candidate) => fs.existsSync(
        this.paths.resolveInsideProject(projectName, `outputs/${candidate}`, {
          allowedTopLevels: OUTPUTS_TOP_LEVEL,
          allowMissingLeaf: true
        })
      ));
      const relativePath = `outputs/${fileName}`;
      const timestamp = now();
      const output = ProjectOutputSchema.parse({
        projectName,
        relativePath,
        title: input.title,
        sourceTaskId: input.sourceTaskId ?? null,
        sourceSessionId: input.sourceSessionId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      const absolute = this.paths.resolveInsideProject(projectName, relativePath, {
        allowedTopLevels: OUTPUTS_TOP_LEVEL,
        allowMissingLeaf: true
      });
      writeTextAtomic(absolute, input.content ?? "");
      try {
        this.writeIndex(projectName, [...records, output]);
      } catch (error) {
        fs.rmSync(absolute, { force: true });
        throw error;
      }
      return { output, content: input.content ?? "" };
    });
  }

  read(projectName: string, relativePath: string): ProjectOutputRead {
    const output = this.find(projectName, relativePath);
    const absolute = this.paths.resolveInsideProject(projectName, output.relativePath, { allowedTopLevels: OUTPUTS_TOP_LEVEL });
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("项目产物文件无效。");
    return { output, content: fs.readFileSync(absolute, "utf8") };
  }

  save(input: ProjectSaveOutputInput & { projectName: string }): ProjectOutputRead {
    return this.paths.withProjectMutationLock(() => {
      const records = this.readIndex(input.projectName);
      const index = records.findIndex((item) => item.relativePath === input.relativePath);
      if (index < 0) throw new Error("项目产物不存在。");
      const output = ProjectOutputSchema.parse({
        ...records[index],
        ...(input.title === undefined ? {} : { title: input.title }),
        updatedAt: now()
      });
      const absolute = this.paths.resolveInsideProject(input.projectName, output.relativePath, { allowedTopLevels: OUTPUTS_TOP_LEVEL });
      writeTextAtomic(absolute, input.content);
      records[index] = output;
      this.writeIndex(input.projectName, records);
      return { output, content: input.content };
    });
  }

  remove(projectName: string, relativePath: string): boolean {
    return this.paths.withProjectMutationLock(() => {
      const records = this.readIndex(projectName);
      const index = records.findIndex((item) => item.relativePath === relativePath);
      if (index < 0) return false;
      const [removed] = records.splice(index, 1);
      this.writeIndex(projectName, records);
      const absolute = this.paths.resolveInsideProject(projectName, removed.relativePath, {
        allowedTopLevels: OUTPUTS_TOP_LEVEL,
        allowMissingLeaf: true
      });
      fs.rmSync(absolute, { force: true });
      return true;
    });
  }

  renameProject(previousName: string, nextName: string): void {
    this.paths.withProjectMutationLock(() => {
      const records = this.readIndex(nextName, { allowedProjectNames: [previousName, nextName] })
        .map((item) => ProjectOutputSchema.parse({ ...item, projectName: nextName }));
      this.writeIndex(nextName, records);
    });
  }

  /** Restores a schema- and path-validated pre-rename index snapshot. */
  restoreProjectSnapshot(projectName: string, snapshot: readonly ProjectOutput[]): void {
    this.paths.withProjectMutationLock(() => this.writeIndex(projectName, snapshot));
  }

  private find(projectName: string, relativePath: string): ProjectOutput {
    const output = this.readIndex(projectName).find((item) => item.relativePath === relativePath);
    if (!output) throw new Error("项目产物不存在。");
    return output;
  }

  private readIndex(
    projectName: string,
    options: { allowedProjectNames?: readonly string[] } = {}
  ): ProjectOutput[] {
    this.initializeProject(projectName);
    const canonicalProjectName = this.paths.resolveProject(projectName).name;
    const records = OutputIndexSchema.parse(JSON.parse(fs.readFileSync(this.indexPath(canonicalProjectName), "utf8")));
    this.validateRecords(canonicalProjectName, records, options.allowedProjectNames ?? [canonicalProjectName]);
    return records;
  }

  private writeIndex(projectName: string, records: readonly ProjectOutput[]): void {
    const canonicalProjectName = this.paths.resolveProject(projectName).name;
    const parsed = OutputIndexSchema.parse(records);
    this.validateRecords(canonicalProjectName, parsed, [canonicalProjectName]);
    writeJsonAtomic(this.indexPath(canonicalProjectName, true), parsed);
  }

  private indexPath(projectName: string, allowMissingLeaf = false): string {
    return this.paths.resolveInsideProject(projectName, OUTPUT_INDEX_FILE, {
      allowedTopLevels: OUTPUTS_TOP_LEVEL,
      allowMissingLeaf
    });
  }

  private validateRecords(
    projectName: string,
    records: readonly ProjectOutput[],
    allowedProjectNames: readonly string[]
  ): void {
    const allowedNames = new Set(allowedProjectNames);
    const relativePaths = new Set<string>();
    for (const record of records) {
      if (!allowedNames.has(record.projectName)) {
        throw new Error(`项目产物的 projectName 与索引所在项目不一致：${record.relativePath}`);
      }
      const portable = record.relativePath.replaceAll("\\", "/");
      if (portable !== record.relativePath
        || path.posix.dirname(portable) !== "outputs"
        || path.posix.extname(portable).toLocaleLowerCase() !== ".md") {
        throw new Error(`项目产物路径不属于 outputs 目录：${record.relativePath}`);
      }
      const identity = portable.normalize("NFKC").toLocaleLowerCase("en-US");
      if (relativePaths.has(identity)) throw new Error(`项目产物索引包含重复路径：${record.relativePath}`);
      relativePaths.add(identity);
      const absolute = this.paths.resolveInsideProject(projectName, record.relativePath, { allowedTopLevels: OUTPUTS_TOP_LEVEL });
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`项目产物文件不存在或无效：${record.relativePath}`);
    }
  }
}

function allocateOutputName(title: string, records: readonly ProjectOutput[], exists: (candidate: string) => boolean): string {
  const stem = safeStem(title);
  const reserved = new Set(records.map((item) => path.posix.basename(item.relativePath).normalize("NFKC").toLocaleLowerCase("en-US")));
  for (let index = 1; index <= 10_000; index += 1) {
    const candidate = index === 1 ? `${stem}.md` : `${stem} (${index}).md`;
    if (!reserved.has(candidate.normalize("NFKC").toLocaleLowerCase("en-US")) && !exists(candidate)) return candidate;
  }
  throw new Error("无法为项目产物分配唯一文件名。");
}

function safeStem(raw: string): string {
  const normalized = raw.normalize("NFC").trim()
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/gu, "-")
    .replace(/[. ]+$/u, "")
    .slice(0, 180);
  if (!normalized
    || /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com(?:[1-9]|[¹²³])|lpt(?:[1-9]|[¹²³]))(?:\..*)?$/iu.test(normalized)) {
    return "未命名产物";
  }
  return /^(?:agents|claude)$/iu.test(normalized) || normalized.startsWith(".") ? `产物-${normalized.replace(/^\.+/u, "")}` : normalized;
}

function now(): string {
  return new Date().toISOString();
}

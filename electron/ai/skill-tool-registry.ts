import fs from "node:fs";
import path from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { SkillDefinition } from "../../shared/contracts";
import { messages } from "../../shared/messages";
import { decodeProcessOutput, killProcessTree, spawnInDirectory } from "./process-utils";
import { discoverSkills, type SkillConfig } from "./skill-discovery";

export interface SkillTool {
  id: string;
  name: string;
  description: string;
  cwd: string;
  runner: string;
  args: string[];
  inputSchema: Record<string, unknown>;
  permission: "read-only" | "edit" | "auto";
  outputArtifacts: string[];
  timeoutMs: number;
}

export interface SkillExecutionEvent {
  skillId: string;
  invocationId: string;
  sourceId?: string;
  type: "status" | "output";
  state?: "running" | "success" | "failed" | "stopped" | "timed-out";
  stream?: "system" | "stdout" | "stderr";
  text?: string;
  code?: number | null;
  durationMs?: number;
  timestamp: string;
}

interface SkillExecutionOptions {
  invocationId?: string;
  signal?: AbortSignal;
  onEvent?(event: SkillExecutionEvent): void;
}

interface ActiveSkill {
  child: ChildProcessWithoutNullStreams;
  stopped: boolean;
}

export class SkillToolRegistry {
  private skills: SkillConfig[];
  private readonly active = new Map<string, ActiveSkill>();

  constructor(private projectRoot: string) {
    this.skills = discoverSkills(projectRoot);
  }

  /** 重新扫描 .claude/skills/ 下所有 SKILL.md,刷新内存里的 skill 列表。 */
  refresh(): void {
    this.skills = discoverSkills(this.projectRoot);
  }

  list(): SkillTool[] {
    return this.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      cwd: skill.cwd,
      runner: skill.runner,
      args: skill.args,
      permission: skill.permission || "edit",
      outputArtifacts: skill.outputArtifacts || [],
      timeoutMs: skill.timeoutMs || 30 * 60 * 1000,
      inputSchema: {
        type: "object",
        properties: { date: { type: "string", description: messages.skillInput.optionalDate } },
        additionalProperties: false
      }
    }));
  }

  listDefinitions(): SkillDefinition[] {
    return this.skills.map((skill) => ({
      id: skill.id,
      title: skill.name,
      description: skill.description,
      cwd: skill.cwd,
      command: skill.runner,
      runner: skill.runner,
      args: skill.args,
      envFile: skill.envFile ?? null,
      group: skill.group,
      permission: skill.permission || "edit",
      outputArtifacts: skill.outputArtifacts || [],
      timeoutMs: skill.timeoutMs || 30 * 60 * 1000
    }));
  }

  isRunning(invocationId: string): boolean {
    return this.active.has(invocationId);
  }

  async run(
    skillId: string,
    input: Record<string, unknown> = {},
    executionRoot = this.projectRoot,
    options: SkillExecutionOptions = {}
  ): Promise<string> {
    const skill = this.skills.find((item) => item.id === skillId);
    if (!skill) throw new Error(messages.errors.unregisteredSkill(skillId));
    if (this.isSkillDisabled(skillId) && !input.sourceId) throw new Error(messages.errors.skill.sourceDisabled(skill.name));
    const invocationId = options.invocationId || `ai:${skillId}:${Date.now()}`;
    if (this.active.has(invocationId)) throw new Error(messages.errors.skill.alreadyRunning(skillId));
    const date = typeof input.date === "string" ? input.date.replaceAll("-", "") : localDate();
    const args = skill.args.map((arg) => arg === "${date}" ? date : arg);
    const cwd = path.resolve(executionRoot, skill.cwd);
    if (!fs.existsSync(cwd)) throw new Error(messages.errors.skill.cwdMissing(skill.cwd));
    const child = spawnInDirectory(cwd, skill.runner, args, {
      env: {
        PYTHONIOENCODING: "utf-8",
        PYTHONUNBUFFERED: "1",
        CCTOOLS_SKILL_ID: skill.id,
        CCTOOLS_PROJECT_ROOT: executionRoot,
        ...(typeof input.sourceId === "string" ? { CCTOOLS_SOURCE_ID: input.sourceId } : {}),
        ...(typeof input.sourceUrl === "string" ? { CCTOOLS_SOURCE_URL: input.sourceUrl } : {}),
        ...(typeof input.sourceName === "string" ? { CCTOOLS_SOURCE_NAME: input.sourceName } : {})
      }
    });
    const active = { child, stopped: false };
    this.active.set(invocationId, active);
    const startedAt = Date.now();
    const output: string[] = [];
    const emit = (event: Omit<SkillExecutionEvent, "skillId" | "invocationId" | "timestamp">) => options.onEvent?.({
      skillId,
      invocationId,
      ...(typeof input.sourceId === "string" ? { sourceId: input.sourceId } : {}),
      timestamp: new Date().toISOString(),
      ...event
    });
    emit({ type: "status", state: "running" });
    emit({ type: "output", stream: "system", text: `$ ${skill.runner} ${args.join(" ")}\n` });

    const collect = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const text = decodeProcessOutput(chunk);
      output.push(text);
      emit({ type: "output", stream, text });
    };
    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
    child.stdin.end();

    const timeoutMs = skill.timeoutMs || 30 * 60 * 1000;
    const timeout = setTimeout(() => {
      active.stopped = true;
      void killProcessTree(child);
      emit({ type: "status", state: "timed-out", durationMs: Date.now() - startedAt });
    }, timeoutMs);
    const abort = () => {
      active.stopped = true;
      void killProcessTree(child);
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      const durationMs = Date.now() - startedAt;
      if (active.stopped || options.signal?.aborted) {
        emit({ type: "status", state: "stopped", code, durationMs });
        throw new Error(messages.errors.skill.stopped(skill.name));
      }
      if (code !== 0) {
        emit({ type: "status", state: "failed", code, durationMs });
        throw new Error(messages.errors.skill.failed(code, skill.name, output.join("")));
      }
      emit({ type: "status", state: "success", code, durationMs });
      return output.join("");
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      this.active.delete(invocationId);
    }
  }

  async stop(invocationId: string): Promise<boolean> {
    const active = this.active.get(invocationId);
    if (!active) return false;
    active.stopped = true;
    await killProcessTree(active.child);
    return true;
  }

  private isSkillDisabled(skillId: string): boolean {
    const skill = this.skills.find((item) => item.id === skillId);
    const sourceId = skill?.surfacesAsSource?.sourceId;
    if (!sourceId) return false;
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(this.projectRoot, ".cctools", "source-settings.json"), "utf8")) as {
        sources?: Record<string, { enabled?: boolean }>;
      };
      return settings.sources?.[sourceId]?.enabled === false;
    } catch {
      return false;
    }
  }
}

function localDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

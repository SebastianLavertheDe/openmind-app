import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  BrokerRunEventSchema,
  BrokerRunRecordSchema,
  EXECUTION_SCHEMA_VERSION,
  type BrokerRunEvent,
  type BrokerRunRecord,
  type BrokerRunState,
  type BrokerTerminalState,
  type SkillRunRequest,
  toStoredSkillRunRequest
} from "../../shared/execution-contracts";
import { writeJsonAtomic } from "../lib/fs-utils";

const TERMINAL_STATES = new Set<BrokerRunState>(["succeeded", "failed", "timed_out", "cancelled"]);
const ALLOWED_TRANSITIONS: Record<BrokerRunState, readonly BrokerRunState[]> = {
  queued: ["inspecting", "cancelled"],
  inspecting: ["waiting_execution_consent", "preparing_runtime", "failed", "cancelled"],
  waiting_execution_consent: ["preparing_runtime", "failed", "cancelled"],
  preparing_runtime: ["running", "failed", "cancelling", "cancelled"],
  running: ["cancelling", "preparing_runtime", "succeeded", "failed", "timed_out"],
  cancelling: ["cancelled", "failed"],
  succeeded: [],
  failed: [],
  timed_out: [],
  cancelled: []
};

export class RunStore {
  private readonly root: string;
  private readonly records = new Map<string, BrokerRunRecord>();

  constructor(
    runsRoot: string,
    private readonly now: () => Date = () => new Date()
  ) {
    this.root = path.resolve(runsRoot);
    fs.mkdirSync(this.root, { recursive: true });
    this.load();
  }

  create(
    request: SkillRunRequest,
    runId = crypto.randomUUID()
  ): BrokerRunRecord {
    if (this.records.has(runId)) throw new Error(`Run 已存在：${runId}`);
    const createdAt = this.now().toISOString();
    const record = BrokerRunRecordSchema.parse({
      schemaVersion: EXECUTION_SCHEMA_VERSION,
      id: runId,
      request: toStoredSkillRunRequest(request),
      state: "queued",
      sequence: 0,
      attempt: 0,
      rootGeneration: request.rootGeneration,
      skillDigest: request.digest?.toLowerCase() || null,
      createdAt,
      startedAt: null,
      completedAt: null,
      terminalState: null,
      error: null,
      processPid: null,
      ownerPid: process.pid,
      orphanPid: null,
      usage: null,
      agentCheckpoint: null,
      resumedFromRunId: null,
      artifacts: []
    });
    this.records.set(runId, record);
    this.persist(record);
    this.appendEvent(this.event(record, "queued", { reason: "run-created" }));
    return cloneRecord(record);
  }

  get(runId: string): BrokerRunRecord {
    if (this.records.get(runId)?.ownerPid !== process.pid) this.load();
    const record = this.records.get(runId);
    if (!record) throw new Error(`Run 不存在：${runId}`);
    return cloneRecord(record);
  }

  list(): BrokerRunRecord[] {
    this.load();
    return Array.from(this.records.values())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(cloneRecord);
  }

  listArtifacts(runId?: string): BrokerRunRecord["artifacts"] {
    if (runId) return this.get(runId).artifacts;
    return this.list().flatMap((record) => record.artifacts);
  }

  deleteHistory(runId: string): boolean {
    const current = this.records.get(runId);
    if (!current) return false;
    if (!TERMINAL_STATES.has(current.state)) throw new Error("只能删除已经结束的 Run 历史。");
    const target = path.resolve(this.root, runId);
    if (path.dirname(target) !== this.root) throw new Error("Run 历史路径无效。");
    this.records.delete(runId);
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  }

  bindSkill(runId: string, digest: string): BrokerRunRecord {
    if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error("Run Skill digest 无效。");
    const current = this.records.get(runId);
    if (!current) throw new Error(`Run 不存在：${runId}`);
    if (current.skillDigest && current.skillDigest !== digest.toLowerCase()) throw new Error("Run Skill digest 不能被替换。");
    const next = BrokerRunRecordSchema.parse({ ...current, skillDigest: digest.toLowerCase() });
    this.records.set(runId, next);
    this.persist(next);
    return cloneRecord(next);
  }

  bindRuntime(runId: string, runtime: NonNullable<BrokerRunRecord["runtime"]>): BrokerRunRecord {
    const current = this.records.get(runId);
    if (!current) throw new Error(`Run 不存在：${runId}`);
    if (current.runtime && JSON.stringify(current.runtime) !== JSON.stringify(runtime)) throw new Error("Run Runtime fingerprint 不能被替换。");
    const next = BrokerRunRecordSchema.parse({ ...current, runtime });
    this.records.set(runId, next);
    this.persist(next);
    return cloneRecord(next);
  }

  bindProcessPid(runId: string, pid: number): BrokerRunRecord {
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("Process PID 无效。");
    const current = this.records.get(runId);
    if (!current) throw new Error(`Run 不存在：${runId}`);
    const next = BrokerRunRecordSchema.parse({ ...current, processPid: pid });
    this.records.set(runId, next);
    this.persist(next);
    return cloneRecord(next);
  }

  clearProcessPid(runId: string): BrokerRunRecord {
    const current = this.records.get(runId);
    if (!current) throw new Error(`Run 不存在：${runId}`);
    const next = BrokerRunRecordSchema.parse({ ...current, processPid: null });
    this.records.set(runId, next);
    this.persist(next);
    return cloneRecord(next);
  }

  attachUsage(runId: string, usage: BrokerRunRecord["usage"]): BrokerRunRecord {
    const current = this.get(runId);
    const next = BrokerRunRecordSchema.parse({ ...current, usage });
    this.records.set(runId, next);
    this.persist(next);
    return cloneRecord(next);
  }

  beginAttempt(runId: string): BrokerRunRecord {
    const current = this.requireMutable(runId);
    const next = BrokerRunRecordSchema.parse({ ...current, attempt: current.attempt + 1, sequence: current.sequence + 1 });
    this.records.set(runId, next);
    this.persist(next);
    this.appendEvent(this.event(next, next.state, { reason: "attempt-started" }));
    return cloneRecord(next);
  }

  transition(runId: string, state: BrokerRunState, patch: { reason?: string; error?: string; code?: number | null; signal?: string | null } = {}): BrokerRunRecord {
    const current = this.records.get(runId);
    if (!current) throw new Error(`Run 不存在：${runId}`);
    if (current.state === state) return cloneRecord(current);
    if (TERMINAL_STATES.has(current.state)) throw new Error(`Run 已经结束：${runId}`);
    if (!ALLOWED_TRANSITIONS[current.state].includes(state)) {
      throw new Error(`Run 状态不能从 ${current.state} 转为 ${state}：${runId}`);
    }
    const nextSequence = current.sequence + 1;
    const timestamp = this.now().toISOString();
    const terminal = TERMINAL_STATES.has(state) ? state as BrokerTerminalState : null;
    const next = BrokerRunRecordSchema.parse({
      ...current,
      state,
      sequence: nextSequence,
      startedAt: current.startedAt || (state === "running" ? timestamp : null),
      completedAt: terminal ? timestamp : current.completedAt,
      terminalState: terminal,
      error: patch.error ?? current.error
    });
    this.records.set(runId, next);
    this.persist(next);
    this.appendEvent(this.event(next, state, patch));
    return cloneRecord(next);
  }

  appendOutput(runId: string, stream: "system" | "stdout" | "stderr", text: string, droppedBytes = 0): BrokerRunEvent {
    const current = this.requireMutable(runId);
    const eventRecord = { ...current, sequence: current.sequence + 1 };
    const event = this.event(eventRecord, current.state, {
      stream,
      text: text.slice(-32 * 1024),
      ...(droppedBytes ? { droppedBytes } : {})
    });
    this.appendEvent(event);
    const next = { ...current, sequence: event.sequence };
    this.records.set(runId, next);
    this.persist(next);
    return event;
  }

  attachArtifacts(runId: string, artifacts: BrokerRunRecord["artifacts"]): BrokerRunRecord {
    const current = this.get(runId);
    const next = BrokerRunRecordSchema.parse({ ...current, artifacts });
    this.records.set(runId, next);
    this.persist(next);
    return cloneRecord(next);
  }

  events(runId: string): BrokerRunEvent[] {
    const files = [3, 2, 1, 0]
      .map((index) => index === 0 ? this.eventsFile(runId) : this.rotatedEventsFile(runId, index))
      .filter((file) => fs.existsSync(file));
    return files.flatMap((file) => fs.readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => BrokerRunEventSchema.parse(JSON.parse(line))));
  }

  /** Marks in-flight work as failed after a Main/Worker restart. */
  recoverInterrupted(reason = "application-restarted"): BrokerRunRecord[] {
    const recovered: BrokerRunRecord[] = [];
    for (const record of this.list()) {
      if (TERMINAL_STATES.has(record.state)) continue;
      if (record.ownerPid && isProcessAlive(record.ownerPid)) continue;
      const current = this.records.get(record.id)!;
      const timestamp = this.now().toISOString();
      const orphanPid = current.processPid && isProcessAlive(current.processPid) ? current.processPid : null;
      const next = BrokerRunRecordSchema.parse({
        ...current,
        state: "failed",
        sequence: current.sequence + 1,
        completedAt: timestamp,
        terminalState: "failed",
        error: orphanPid ? `Run 在应用重启时中断：${reason}；发现可能残留进程 PID ${orphanPid}，需要人工诊断。` : `Run 在应用重启时中断：${reason}`,
        processPid: null,
        orphanPid
      });
      this.records.set(record.id, next);
      this.persist(next);
      this.appendEvent(this.event(next, "failed", { reason, text: "Run recovered as failed after restart" }));
      recovered.push(cloneRecord(next));
    }
    return recovered;
  }

  private requireMutable(runId: string): BrokerRunRecord {
    const record = this.records.get(runId);
    if (!record) throw new Error(`Run 不存在：${runId}`);
    if (record.ownerPid && record.ownerPid !== process.pid && isProcessAlive(record.ownerPid)) throw new Error("This run is owned by another active OpenMind process.");
    if (TERMINAL_STATES.has(record.state)) {
      throw new Error(`Run 已经结束：${runId}`);
    }
    return record;
  }

  private event(
    record: BrokerRunRecord,
    state: BrokerRunState,
    patch: { reason?: string; error?: string; code?: number | null; signal?: string | null; stream?: "system" | "stdout" | "stderr"; text?: string; droppedBytes?: number }
  ): BrokerRunEvent {
    return BrokerRunEventSchema.parse({
      schemaVersion: EXECUTION_SCHEMA_VERSION,
      runId: record.id,
      sequence: record.sequence,
      timestamp: this.now().toISOString(),
      state,
      ...(record.attempt > 0 ? { attempt: record.attempt } : {}),
      ...patch
    });
  }

  private persist(record: BrokerRunRecord): void {
    writeJsonAtomic(this.runFile(record.id), record);
  }

  private appendEvent(event: BrokerRunEvent): void {
    const file = this.eventsFile(event.runId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size >= 8 * 1024 * 1024) {
      for (let index = 3; index >= 1; index--) {
        const current = this.rotatedEventsFile(event.runId, index);
        const previous = index === 1 ? file : this.rotatedEventsFile(event.runId, index - 1);
        if (fs.existsSync(current)) fs.rmSync(current, { force: true });
        if (fs.existsSync(previous)) fs.renameSync(previous, current);
      }
    }
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
  }

  private runFile(runId: string): string { return path.join(this.root, runId, "run.json"); }
  private eventsFile(runId: string): string { return path.join(this.root, runId, "events.jsonl"); }

  private rotatedEventsFile(runId: string, index: number): string { return `${this.eventsFile(runId)}.${index}`; }

  private load(): void {
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = this.runFile(entry.name);
      if (!fs.existsSync(file)) continue;
      try {
        const record = BrokerRunRecordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
        if (this.records.get(record.id)?.ownerPid === process.pid) continue;
        this.records.set(record.id, record);
      } catch {
        // Preserve corrupt records for manual recovery; never overwrite them.
      }
    }
  }
}

function cloneRecord(record: BrokerRunRecord): BrokerRunRecord {
  return JSON.parse(JSON.stringify(record)) as BrokerRunRecord;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

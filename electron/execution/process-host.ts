import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { decodeProcessOutput, killProcessTree } from "../ai/process-utils";
import { logRedactor } from "../security/log-redactor";
import type { RunUsage } from "../../shared/execution-contracts";

const FORBIDDEN_ENV_NAMES = new Set(["PATH", "HOME", "NODE_OPTIONS", "PYTHONPATH", "LD_PRELOAD"]);

export type ProcessSpec = {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  gracefulStopMs: number;
};

export type ProcessOutput = {
  stream: "stdout" | "stderr";
  text: string;
  droppedBytes: number;
};

export type ProcessResult = {
  outcome: "succeeded" | "failed" | "cancelled" | "timed_out";
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  droppedBytes: number;
  usage?: RunUsage;
};

export type ProcessHostOptions = {
  signal?: AbortSignal;
  onOutput?(output: ProcessOutput): void;
  onSpawn?(pid: number): void;
  knownSecrets?: readonly string[];
};

export class ProcessHostError extends Error {
  constructor(readonly code: "invalid-spec" | "spawn-error" | "already-aborted", message: string) {
    super(message);
    this.name = "ProcessHostError";
  }
}

export class ProcessHost {
  constructor(private readonly maxOutputBytes = 1024 * 1024) {}

  async run(spec: ProcessSpec, options: ProcessHostOptions = {}): Promise<ProcessResult> {
    validateProcessSpec(spec);
    if (options.signal?.aborted) throw new ProcessHostError("already-aborted", "进程启动前 Run 已取消。");

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(spec.executable, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      throw new ProcessHostError("spawn-error", error instanceof Error ? error.message : String(error));
    }
    if (child.pid) options.onSpawn?.(child.pid);

    const output = { stdout: new OutputRing(this.maxOutputBytes), stderr: new OutputRing(this.maxOutputBytes) };
    let termination: "cancelled" | "timed_out" | null = null;
    let stopping: Promise<void> | null = null;
    const stop = (reason: "cancelled" | "timed_out") => {
      if (termination) return stopping || Promise.resolve();
      termination = reason;
      stopping = terminateProcess(child, spec.gracefulStopMs);
      return stopping;
    };
    const abort = () => { void stop("cancelled"); };
    options.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => { void stop("timed_out"); }, spec.timeoutMs);

    const collect = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const text = decodeProcessOutput(chunk);
      const ring = output[stream];
      const before = ring.droppedBytes;
      const safeText = ring.redact(text, options.knownSecrets ?? []);
      ring.append(safeText);
      options.onOutput?.({ stream, text: safeText, droppedBytes: ring.droppedBytes - before });
    };
    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
    child.stdin.end();

    try {
      const closed = await waitForClose(child);
      const outcome = termination || (closed.code === 0 ? "succeeded" : "failed");
      return {
        outcome,
        code: closed.code,
        signal: closed.signal,
        stdout: output.stdout.value(),
        stderr: output.stderr.value(),
        droppedBytes: output.stdout.droppedBytes + output.stderr.droppedBytes
      };
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}

export function validateProcessSpec(spec: ProcessSpec): void {
  if (!path.isAbsolute(spec.executable) || !fs.existsSync(spec.executable)) {
    throw new ProcessHostError("invalid-spec", "Process executable 必须是存在的绝对路径。");
  }
  if (!path.isAbsolute(spec.cwd) || !fs.existsSync(spec.cwd) || !fs.statSync(spec.cwd).isDirectory()) {
    throw new ProcessHostError("invalid-spec", "Process cwd 必须是存在的绝对目录。");
  }
  if (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs < 1 || spec.timeoutMs > 86_400_000) {
    throw new ProcessHostError("invalid-spec", "Process timeout 不在允许范围内。");
  }
  if (!Number.isInteger(spec.gracefulStopMs) || spec.gracefulStopMs < 0 || spec.gracefulStopMs > 600_000) {
    throw new ProcessHostError("invalid-spec", "Process graceful stop 时间不在允许范围内。");
  }
  for (const name of Object.keys(spec.env)) {
    if (FORBIDDEN_ENV_NAMES.has(name) || name.startsWith("DYLD_")) {
      throw new ProcessHostError("invalid-spec", `拒绝注入危险环境变量：${name}`);
    }
  }
}

class OutputRing {
  private textValue = "";
  droppedBytes = 0;

  constructor(private readonly maxBytes: number) {}

  append(value: string): void {
    const combined = this.textValue + value;
    if (Buffer.byteLength(combined, "utf8") <= this.maxBytes) {
      this.textValue = combined;
      return;
    }
    const bytes = Buffer.from(combined, "utf8");
    const retained = bytes.subarray(Math.max(0, bytes.length - this.maxBytes));
    this.droppedBytes += bytes.length - retained.length;
    this.textValue = retained.toString("utf8");
  }

  value(): string { return this.textValue; }
  redact(value: string, knownSecrets: readonly string[]): string {
    return logRedactor.redact(value, knownSecrets)
      .replace(/\b(?:sk|nvapi)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
      .replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
  }
}

function waitForClose(child: ChildProcessWithoutNullStreams): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function terminateProcess(child: ChildProcessWithoutNullStreams, gracefulStopMs: number): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    child.kill();
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  }
  if (!gracefulStopMs) {
    await killProcessTree(child);
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, gracefulStopMs));
  if (child.exitCode === null && child.signalCode === null) await killProcessTree(child);
}

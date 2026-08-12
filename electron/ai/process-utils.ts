import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams, type ExecFileOptions, type SpawnOptionsWithoutStdio } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { parseWslPath, replaceFileAtomicallySync, type WslPath } from "../lib/fs-utils";

export { parseWslPath, replaceFileAtomicallySync, type WslPath };

const execFileAsync = promisify(execFile);

export function toWslPath(value: string, distro?: string): string {
  const parsed = parseWslPath(value);
  if (parsed && (!distro || parsed.distro === distro)) return parsed.linuxPath;
  return value.replace(/^([A-Za-z]):\\/, (_, drive) => `/mnt/${String(drive).toLowerCase()}/`).replaceAll("\\", "/");
}

/**
 * Run a WSL CLI through the user's login shell so ~/.profile contributes paths
 * such as ~/.local/bin. Resolve the executable before exec so probing and the
 * long-running provider process select the same installation.
 */
export function buildWslLoginCommand(command: string, args: string[]): { command: string; args: string[] } {
  return {
    command: "/bin/sh",
    args: [
      "-lc",
      'resolved="$(command -v "$1")" || exit 127; shift; exec "$resolved" "$@"',
      "cctools-wsl-login",
      command,
      ...args
    ]
  };
}

export interface WslLoginExecutable {
  executable: string;
  loginPath: string;
}

/** Resolve a WSL executable and PATH through the login shell without using that shell for the managed run. */
export function resolveWslLoginExecutable(cwd: string, command: string): WslLoginExecutable {
  const wsl = parseWslPath(cwd);
  if (process.platform !== "win32" || !wsl) {
    return { executable: command, loginPath: process.env.PATH || "" };
  }
  const output = String(execFileSync("wsl.exe", [
    "-d", wsl.distro,
    "--cd", wsl.linuxPath,
    "--exec", "/bin/sh", "-lc",
    'resolved="$(command -v "$1")" || exit 127; printf \'__CCTOOLS_EXEC__%s\\n__CCTOOLS_PATH__%s\\n\' "$resolved" "$PATH"',
    "cctools-wsl-resolve",
    command
  ], {
    windowsHide: true,
    timeout: 10_000,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }));
  const lines = output.replaceAll("\r", "").split("\n");
  const executable = lines.find((line) => line.startsWith("__CCTOOLS_EXEC__"))?.slice("__CCTOOLS_EXEC__".length) || "";
  const loginPath = lines.find((line) => line.startsWith("__CCTOOLS_PATH__"))?.slice("__CCTOOLS_PATH__".length) || "";
  if (!executable.startsWith("/")) throw new Error(`WSL 中未找到可执行文件：${command}`);
  if (!loginPath) throw new Error("无法读取 WSL 登录 PATH。");
  return { executable, loginPath };
}

export async function execInProject(projectRoot: string, command: string, args: string[], options: ExecFileOptions & { input?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  if (options.input !== undefined) {
    const input = options.input;
    const { input: _input, ...spawnOptions } = options;
    const child = spawnInDirectory(projectRoot, command, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.stdin.end(input, "utf8");
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    if (code !== 0) throw new Error(stderr || `${command} 退出码 ${code}`);
    return { stdout, stderr };
  }
  const wsl = parseWslPath(projectRoot);
  if (wsl && process.platform === "win32") {
    const result = await execFileAsync("wsl.exe", ["-d", wsl.distro, "--cd", wsl.linuxPath, "--exec", command, ...args.map((arg) => toWslPath(arg, wsl.distro))], {
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      ...options
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  }
  const result = await execFileAsync(command, args, { cwd: projectRoot, windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...options });
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
}

export async function execInProjectToFile(projectRoot: string, command: string, args: string[], outputPath: string): Promise<{ stderr: string }> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const child = spawnInDirectory(projectRoot, command, args);
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, decodeProcessOutput(chunk)); });
  const output = pipeline(child.stdout, fs.createWriteStream(outputPath));
  const code = await waitForExit(child);
  await output;
  if (code !== 0) throw new Error(stderr || `${command} 退出码 ${code}`);
  return { stderr };
}

export async function execInProjectFromFile(projectRoot: string, command: string, args: string[], inputPath: string): Promise<{ stdout: string; stderr: string }> {
  const child = spawnInDirectory(projectRoot, command, args);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, decodeProcessOutput(chunk)); });
  child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, decodeProcessOutput(chunk)); });
  const input = pipeline(fs.createReadStream(inputPath), child.stdin).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
  });
  const code = await waitForExit(child);
  await input;
  if (code !== 0) throw new Error(stderr || `${command} 退出码 ${code}`);
  return { stdout, stderr };
}

export function spawnInDirectory(
  cwd: string,
  command: string,
  args: string[],
  options: Omit<SpawnOptionsWithoutStdio, "cwd" | "stdio"> = {}
): ChildProcessWithoutNullStreams {
  return spawnResolved(cwd, command, args, options, true);
}

export function spawnNativeInDirectory(
  cwd: string,
  command: string,
  args: string[],
  options: Omit<SpawnOptionsWithoutStdio, "cwd" | "stdio"> = {}
): ChildProcessWithoutNullStreams {
  return spawnResolved(cwd, command, args, options, false);
}

function spawnResolved(
  cwd: string,
  command: string,
  args: string[],
  options: Omit<SpawnOptionsWithoutStdio, "cwd" | "stdio">,
  allowWsl: boolean
): ChildProcessWithoutNullStreams {
  const wsl = parseWslPath(cwd);
  if (allowWsl && wsl && process.platform === "win32") {
    return spawn("wsl.exe", ["-d", wsl.distro, "--cd", wsl.linuxPath, "--exec", command, ...args], {
      windowsHide: true,
      ...options,
      env: { ...process.env, ...options.env, WSL_UTF8: "1" },
      stdio: ["pipe", "pipe", "pipe"]
    });
  }
  if (process.platform === "win32") {
    const candidate = resolveWindowsCommand(command);
    const extension = path.extname(candidate).toLowerCase();
    if (extension === ".cmd" || extension === ".bat") {
      const unc = cwd.startsWith("\\\\");
      const commandLine = unc ? `pushd ${quoteCmd(cwd)} && ${buildCmdCommand(candidate, args)}` : buildCmdCommand(candidate, args);
      return spawn("cmd.exe", ["/d", "/s", "/c", commandLine], {
        cwd: unc ? process.env.SystemRoot || "C:\\Windows" : cwd,
        windowsHide: true,
        ...options,
        env: { ...process.env, ...options.env },
        stdio: ["pipe", "pipe", "pipe"]
      });
    }
    if (extension === ".ps1") {
      return spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", candidate, ...args], {
        cwd,
        windowsHide: true,
        ...options,
        env: { ...process.env, ...options.env },
        stdio: ["pipe", "pipe", "pipe"]
      });
    }
    command = candidate;
  }
  return spawn(command, args, {
    cwd,
    windowsHide: true,
    detached: process.platform !== "win32",
    ...options,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function resolveWindowsCommand(command: string): string {
  if (path.isAbsolute(command) && fs.existsSync(command)) return command;
  try {
    return String(execFileSync("where.exe", [command], {
      windowsHide: true,
      timeout: 5000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    })).split(/\r?\n/).map((item) => item.trim()).find(Boolean) || command;
  } catch {
    return command;
  }
}

function buildCmdCommand(command: string, args: string[]): string {
  return [command, ...args].map(quoteCmd).join(" ");
}

function quoteCmd(value: string): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export async function killProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await execFileAsync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }).catch(() => undefined);
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  }
}

export function decodeProcessOutput(chunk: Buffer | string): string {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  let nullBytes = 0;
  for (const byte of buffer) {
    if (byte === 0) nullBytes++;
  }
  return buffer.toString(nullBytes > buffer.length * 0.1 ? "utf16le" : "utf8").replaceAll("\0", "");
}

export function safeRelative(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("路径超出项目目录。");
  return relative;
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
}

function appendBounded(current: string, next: string, limit = 8 * 1024 * 1024): string {
  const combined = current + next;
  return combined.length <= limit ? combined : combined.slice(combined.length - limit);
}

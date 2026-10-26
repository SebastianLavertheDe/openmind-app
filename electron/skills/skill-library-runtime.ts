import { spawnSync } from "node:child_process";
import path from "node:path";
import type { AppPaths } from "../paths/app-paths-service";
import { SharedPythonRuntimeService } from "../runtime/shared-python-runtime";
import { YoutubeToolsService } from "../install/youtube-tools-service";

export type SkillLibraryTools = { python: string | null; ffmpeg: string | null; electron: string };
const cache = new Map<string, { at: number; tools: SkillLibraryTools }>();
/** Discover existing tools only. Opening the library never installs dependencies. */
export function resolveSkillLibraryTools(paths: AppPaths): SkillLibraryTools {
  const key = `${paths.userData}:${process.env.PATH || process.env.Path || ""}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 5000) return cached.tools;
  let python = new SharedPythonRuntimeService(paths).readyExecutable();
  if (!python) for (const command of ["python3", "python"]) {
    const result = spawnSync(command, ["-c", "import sys; assert sys.version_info >= (3, 9); print(sys.executable)"], { timeout: 1500, windowsHide: true, encoding: "utf8", maxBuffer: 4096 });
    if (result.status === 0 && result.stdout.trim()) { python = result.stdout.trim(); break; }
  }
  const candidate = new YoutubeToolsService(paths).candidateTool("ffmpeg");
  const ffprobe = candidate ? path.join(path.dirname(candidate), `ffprobe${process.platform === "win32" ? ".exe" : ""}`) : null;
  const ready = (file: string) => spawnSync(file, ["-version"], { timeout: 1500, windowsHide: true, stdio: "ignore" }).status === 0;
  const tools = { python, ffmpeg: candidate && ffprobe && ready(candidate) && ready(ffprobe) ? candidate : null, electron: process.execPath };
  if (cache.size > 100) cache.clear();
  cache.set(key, { at: Date.now(), tools });
  return tools;
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BrowserSkillStatus } from "../shared/contracts";
import type { SkillPackageService } from "./skills/skill-package-service";
import { buildAiWorkerEnvironment } from "./ai/worker-environment";

export const BROWSER_SKILL_REPOSITORY = "https://github.com/Tencent/BrowserSkill";
export const BROWSER_SKILL_ID = "browser-skill";
const execute = promisify(execFile);

export function resolveBrowserSkillExecutable(userData: string | undefined, environment: NodeJS.ProcessEnv = process.env): string | null {
  const filename = process.platform === "win32" ? "bsk.exe" : "bsk";
  const candidates = [
    ...(userData && path.isAbsolute(userData) ? [path.join(userData, "tools", "bin", filename)] : []),
    path.join(environment.USERPROFILE || environment.HOME || os.homedir(), ".local", "bin", filename),
    ...(environment.PATH || environment.Path || "").split(path.delimiter).filter(Boolean).map((folder) => path.join(folder, filename))
  ];
  return candidates.find((candidate) => {
    try { fs.accessSync(candidate, fs.constants.X_OK); return fs.statSync(candidate).isFile(); }
    catch { return false; }
  }) || null;
}

export type BrowserSkillCommand = (executable: string, args: string[], environment: NodeJS.ProcessEnv) => Promise<string>;

/** Browser automation is supplied by an Installed Skill, never an app-owned MCP. */
export async function browserSkillStatus(
  packages: Pick<SkillPackageService, "listInstalled" | "inspectInstalledCopy" | "isEnabled">,
  executable: string | null,
  run: BrowserSkillCommand = async (command, args, env) => (await execute(command, args, { env, timeout: 5_000, maxBuffer: 1024 * 1024 })).stdout,
  startDaemon = false
): Promise<BrowserSkillStatus> {
  const installed = packages.listInstalled().find((record) => record.id === BROWSER_SKILL_ID);
  let skillInstalled = false;
  let skillEnabled = false;
  try {
    skillInstalled = Boolean(installed && packages.inspectInstalledCopy(installed).valid);
    skillEnabled = Boolean(skillInstalled && installed && packages.isEnabled(installed));
  } catch { /* Invalid packages/preferences must never be reported ready. */ }
  let cliVersion: string | null = null;
  let browserConnected = false;
  let runtimeError: string | null = null;
  if (executable) {
    const environment = buildAiWorkerEnvironment(process.env, {
      ...(process.env.BSK_HOME ? { BSK_HOME: process.env.BSK_HOME } : {}),
      BSK_AUTO_START: startDaemon && skillEnabled ? "1" : "0",
      BSK_BROWSER_WAIT_MS: "0"
    });
    try {
      cliVersion = (await run(executable, ["--version"], environment)).trim() || null;
      const status: unknown = JSON.parse(await run(executable, ["status", "--json"], environment));
      browserConnected = Boolean(status && typeof status === "object" && "browsers" in status
        && Array.isArray(status.browsers) && status.browsers.length > 0);
    } catch (error) {
      runtimeError = error instanceof Error ? error.message : String(error);
    }
  }
  const ready = skillEnabled && Boolean(cliVersion) && browserConnected;
  const diagnostic = !skillInstalled ? "请安装 BrowserSkill，AI 会话会自动发现并按需使用。"
    : !skillEnabled ? "BrowserSkill 已安装但未启用，请在 Skills 中启用。"
      : !executable || !cliVersion ? "未找到可用的 bsk CLI，请按官方说明安装。"
        : !browserConnected ? `请连接 BrowserSkill 浏览器扩展。${runtimeError ? ` ${runtimeError}` : ""}`
          : "BrowserSkill 已就绪，普通会话与 Project 会话均可按需使用。";
  return { skillInstalled, skillEnabled, cliAvailable: Boolean(cliVersion), cliVersion, browserConnected, ready, diagnostic };
}

import path from "node:path";
import type { ApprovalDecision, AiContextState, AiEvent, AiRun, AiSession, ProviderCapabilities } from "../../../shared/contracts";
import type { BrowserAutomationConfig } from "../browser-evidence";
import type { ProviderSkillBridge } from "./skill-bridge";

export interface ProviderSkillInvocation {
  name: string;
  argument: string;
  raw: string;
  prompt: string;
}

export interface ProviderRunContext {
  session: AiSession;
  run: AiRun;
  provider: ProviderCapabilities;
  cwd: string;
  prompt: string;
  contextState: AiContextState;
  signal: AbortSignal;
  emit(kind: AiEvent["kind"], payload: Record<string, unknown>): Promise<void>;
  requestApproval(input: {
    providerRequestId: string | number;
    category: "command" | "file-change" | "delete" | "outside-workspace" | "network" | "elevation" | "tool";
    title: string;
    detail: string;
    cwd?: string;
    command?: string;
    paths?: string[];
  }): Promise<ApprovalDecision>;
  updateProviderSession(id: string): void;
  /** Provider 通过真实模式事件切换状态时，同步到本地会话。 */
  updateInteractionMode?(mode: AiSession["interactionMode"]): void;
  skillInvocation: ProviderSkillInvocation | null;
  /** 用户为该 provider 选定的模型覆盖（"auto" = 跟随 CLI 配置，不覆盖）。 */
  providerModel: string;
  /** Main-only bridge for an approved Agent package in the app-private SkillStore. */
  skillBridge?: ProviderSkillBridge | null;
  /** OpenMind 托管的写作证据截图能力。 */
  browserAutomation: BrowserAutomationConfig;
  /** 粘贴图片等附件（已 materialize 到临时文件）：provider 转 image content block 传 SDK。 */
  images: Array<{ id: string; path: string; mediaType: string }>;
}

export interface ProviderPrewarmContext extends Omit<ProviderRunContext, "session" | "run" | "prompt" | "contextState" | "signal" | "emit" | "requestApproval" | "updateProviderSession" | "updateInteractionMode" | "skillInvocation"> {
  session: AiSession | null;
  provider: ProviderCapabilities;
  cwd: string;
  permissionProfile: AiSession["permissionProfile"];
  interactionMode?: AiSession["interactionMode"];
  providerSessionId: string | null;
}

export interface ProviderAdapter {
  run(context: ProviderRunContext): Promise<void>;
  prewarm?(context: ProviderPrewarmContext): Promise<boolean>;
  disposeSession?(sessionId: string): void;
  /** Close every idle prewarmed process after provider configuration changes. */
  disposeWarmSlots?(): void;
  /** 该 provider 的运行是否依赖预先捕获的 turnContext（Claude 用，Codex 不用）。 */
  needsTurnContext?: boolean;
}

/** Provider 注册表项：kind + adapter。新增 provider = scheduler.providers 加一行 + 实现 ProviderAdapter。 */
export type ProviderDefinition = {
  kind: string;
  adapter: ProviderAdapter;
};

export function classifyApproval(command: string, toolName = ""): {
  category: "command" | "file-change" | "delete" | "outside-workspace" | "network" | "elevation" | "tool";
  title: string;
} {
  const normalized = `${toolName} ${command}`.toLowerCase();
  if (/\b(rm|rmdir|del|remove-item|git clean|unlink)\b/.test(normalized)) return { category: "delete", title: "请求删除文件" };
  if (/\b(sudo|runas|chmod 777|chown)\b/.test(normalized)) return { category: "elevation", title: "请求高权限操作" };
  if (/\b(curl|wget|invoke-webrequest|ssh|scp|npm publish|git push)\b/.test(normalized)) return { category: "network", title: "请求网络操作" };
  if (/write|edit|patch|notebookedit/i.test(toolName)) return { category: "file-change", title: "请求修改文件" };
  return { category: "command", title: "请求执行命令" };
}

export function canAutoApprove(
  context: ProviderRunContext,
  category: "command" | "file-change" | "delete" | "outside-workspace" | "network" | "elevation" | "tool",
  command = "",
  paths: string[] = []
): boolean {
  if (context.session.permissionProfile === "read-only") return false;
  if (category === "delete" || category === "outside-workspace" || category === "elevation") return false;
  if (paths.some((candidate) => isOutsideWorkspace(context.cwd, candidate))) return false;
  if (/\b(rm|rmdir|del|remove-item|git clean|unlink|sudo|runas|chmod 777|chown)\b/i.test(command)) return false;
  if (context.session.permissionProfile === "auto") return true;
  return category === "command" || category === "file-change";
}

export function isOutsideWorkspace(cwd: string, candidate: string): boolean {
  if (!candidate) return false;
  const wslCwd = parseWslUncPath(cwd);
  const wslCandidate = parseWslUncPath(candidate);
  if (wslCwd) {
    if (wslCandidate) {
      return wslCwd.distro !== wslCandidate.distro || !isPathWithin(wslCwd.path, wslCandidate.path);
    }
    const normalizedCandidate = candidate.replaceAll("\\", "/");
    if (/^\/(?!\/)/.test(normalizedCandidate)) {
      return !isPathWithin(wslCwd.path, path.posix.resolve("/", normalizedCandidate));
    }
    if (/^[a-z]:\//i.test(normalizedCandidate)) return true;
  } else if (wslCandidate) {
    return true;
  }
  if (!path.isAbsolute(candidate)) return false;
  const relative = path.relative(path.resolve(cwd), path.resolve(candidate));
  return relative.startsWith("..") || path.isAbsolute(relative);
}

function parseWslUncPath(value: string): { distro: string; path: string } | null {
  const normalized = value.replaceAll("\\", "/");
  const match = /^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)(\/.*)?$/i.exec(normalized);
  if (!match) return null;
  return {
    distro: match[1].toLocaleLowerCase(),
    path: path.posix.resolve("/", match[2] || "/")
  };
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.posix.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.posix.isAbsolute(relative));
}

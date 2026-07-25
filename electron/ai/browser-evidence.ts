import path from "node:path";
import type { ProviderCapabilities } from "../../shared/contracts";
import { toWslPath } from "./process-utils";

export const BROWSER_MCP_SERVER_NAME = "cctools_browser";
export const BROWSER_EVIDENCE_TOOL = "capture_source_evidence";
export const CLAUDE_BROWSER_EVIDENCE_TOOL = `mcp__${BROWSER_MCP_SERVER_NAME}__${BROWSER_EVIDENCE_TOOL}`;

export interface BrowserAutomationConfig {
  enabled: boolean;
  reuseExistingTabs: boolean;
  evidenceDir: string;
  extensionToken: string | null;
}

export interface BrowserMcpProcessConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function browserAutomationConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BrowserAutomationConfig {
  return {
    enabled: env.CCTOOLS_BROWSER_AUTOMATION_ENABLED === "true",
    reuseExistingTabs: env.CCTOOLS_BROWSER_REUSE_EXISTING_TABS !== "false",
    evidenceDir: env.CCTOOLS_BROWSER_EVIDENCE_DIR?.trim() || ".cctools/browser-evidence",
    extensionToken: env.PLAYWRIGHT_MCP_EXTENSION_TOKEN?.trim() || null
  };
}

export function buildBrowserMcpProcess(
  provider: Pick<ProviderCapabilities, "runtime">,
  cwd: string,
  config: BrowserAutomationConfig | undefined
): BrowserMcpProcessConfig | null {
  if (!config?.enabled) return null;
  const bridgePath = path.resolve(__dirname, "browser-evidence-mcp.js");
  const outputDir = resolveEvidenceDir(cwd, config.evidenceDir);
  const electronExecutable = process.execPath;
  const command = provider.runtime === "wsl" && process.platform === "win32"
    ? toWslPath(electronExecutable)
    : electronExecutable;
  return {
    command,
    args: [
      bridgePath,
      "--workspace", cwd,
      "--output-dir", outputDir,
      "--reuse-existing-tabs", String(config.reuseExistingTabs)
    ],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      ...(config.extensionToken ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: config.extensionToken } : {})
    }
  };
}

export function buildCodexBrowserConfig(
  provider: Pick<ProviderCapabilities, "runtime">,
  cwd: string,
  config: BrowserAutomationConfig | undefined
): Record<string, unknown> | null {
  const server = buildBrowserMcpProcess(provider, cwd, config);
  if (!server) return null;
  return {
    mcp_servers: {
      [BROWSER_MCP_SERVER_NAME]: {
        command: server.command,
        args: server.args,
        env: server.env,
        enabled: true,
        required: true,
        startup_timeout_sec: 30,
        tool_timeout_sec: 90,
        enabled_tools: [BROWSER_EVIDENCE_TOOL],
        // This server exposes one read-only, side-effect-free evidence tool. Keep
        // that tool autonomous even when the surrounding coding session asks for
        // approvals on commands or file edits.
        default_tools_approval_mode: "approve"
      }
    }
  };
}

export function browserEvidenceInstructions(config: BrowserAutomationConfig | undefined): string {
  if (!config?.enabled) return "";
  const reuse = config.reuseExistingTabs
    ? "先检查扩展已授权的 Chrome 标签页；若目标 URL 已打开，必须复用该标签页，并在截图后恢复原滚动位置和原活动标签。"
    : "为目标来源使用受管标签页，不改动用户正在阅读的标签页。";
  return [
    "<cc_tools_browser_evidence>",
    "你具备 capture_source_evidence 工具，用于在写作中获取原始来源的证据截图。请自主判断：当关键事实、引用、数据或争议性结论配上原文截图会显著增强说服力时，主动调用；普通链接无需逐一截图。",
    reuse,
    "调用时提供原始 HTTP(S) URL、准备引用的准确原文 quote，以及简洁 caption。工具会使用用户已登录的 Chrome、精确截取包含该原文的元素，并把 PNG 与 JSON 元数据保存到项目素材目录。",
    "工具成功后，在相关段落附近插入返回的相对 PNG 路径，并保留来源 URL 与图片说明。不要把截图只当作后台参考而遗漏在稿件中。",
    "如果页面要求登录、扩展尚未授权该标签页或原文找不到，明确告诉用户需要在 Chrome 中完成登录/授权后重试；不要索取、填写或处理密码。",
    "浏览器仅用于阅读、导航和截图。禁止提交表单、发送消息、购买、发布、修改账号设置或执行其他有外部副作用的操作。",
    "</cc_tools_browser_evidence>"
  ].join("\n");
}

function resolveEvidenceDir(cwd: string, configured: string): string {
  const normalized = configured.replaceAll("\\", "/");
  if (!normalized || path.isAbsolute(normalized) || normalized.split("/").some((part) => part === "..")) {
    throw new Error("浏览器证据目录必须是项目内的相对路径。");
  }
  return path.resolve(cwd, normalized);
}

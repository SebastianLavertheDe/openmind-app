import path from "node:path";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildAiWorkerEnvironment } from "./worker-environment";

const MAX_RESULT_BYTES = 32 * 1024;
const MAX_WAIT_SECONDS = 60;

export type BrowserToolInput = Record<string, unknown>;

export type BrowserToolSessionOptions = {
  workspaceRoot: string;
  outputDir: string;
  reuseExistingTabs: boolean;
  extensionToken: string | null;
  /** Optional managed Chromium path for isolated/headless clean-machine runs. */
  browserExecutablePath?: string;
  clientFactory?: () => BrowserMcpClient;
};

export type BrowserMcpClient = {
  connect(transport: StdioClientTransport): Promise<void>;
  callTool(input: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
};

type BrowserMcpResult = {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string; mimeType?: string }>;
  structuredContent?: unknown;
};

/**
 * Host-owned Browser Tool for Internal Agent.
 *
 * The Agent receives a small action vocabulary, while the host owns the MCP
 * process, output directory and unsafe-tool deny list. In particular, the
 * arbitrary-code `browser_run_code_unsafe` MCP tool is intentionally absent.
 */
export class BrowserToolSession {
  private readonly client: BrowserMcpClient;
  private readonly transport: StdioClientTransport;
  private connected: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly options: BrowserToolSessionOptions) {
    const workspaceRoot = path.resolve(options.workspaceRoot);
    const outputDir = path.resolve(options.outputDir);
    fs.mkdirSync(outputDir, { recursive: true });
    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: playwrightArgs(outputDir, options.reuseExistingTabs, options.browserExecutablePath),
      cwd: workspaceRoot,
      env: buildAiWorkerEnvironment(process.env, {
        ELECTRON_RUN_AS_NODE: "1",
        ...(options.extensionToken ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: options.extensionToken } : {})
      }),
      stderr: "inherit"
    });
    this.client = options.clientFactory?.() || new Client({ name: "cctools-internal-agent-browser", version: "1.0.0" });
  }

  async call(input: BrowserToolInput): Promise<unknown> {
    if (this.closed) throw new Error("Browser Tool 会话已关闭。");
    const mapped = mapBrowserAction(input, this.options.outputDir);
    await this.ensureConnected();
    const raw = await this.client.callTool(mapped) as BrowserMcpResult;
    if (raw.isError) throw new Error(resultText(raw) || "Browser Tool 调用失败。");
    return {
      action: String(input.action || ""),
      tool: mapped.name,
      text: truncate(resultText(raw)),
      ...(raw.structuredContent !== undefined ? { structuredContent: raw.structuredContent } : {})
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.connected) await this.connected.catch(() => undefined);
    await this.client.close().catch(() => undefined);
  }

  private ensureConnected(): Promise<void> {
    if (!this.connected) this.connected = this.client.connect(this.transport);
    return this.connected;
  }
}

export function mapBrowserAction(input: BrowserToolInput, outputDir: string): { name: string; arguments: Record<string, unknown> } {
  const action = String(input.action || "").trim().toLowerCase();
  const target = stringValue(input.target ?? input.ref);
  switch (action) {
    case "open":
    case "navigate": {
      const url = stringValue(input.url);
      if (!/^https?:\/\//i.test(url)) throw new Error("Browser navigate 只允许 HTTP(S) URL。");
      return { name: "browser_navigate", arguments: { url } };
    }
    case "back": return { name: "browser_navigate_back", arguments: {} };
    case "snapshot": return { name: "browser_snapshot", arguments: optionalArguments(input, ["target", "depth", "boxes"]) };
    case "get_text":
    case "text": {
      if (!target) throw new Error("Browser get_text 缺少 ref/target。");
      return { name: "browser_snapshot", arguments: { target } };
    }
    case "click": {
      if (!target) throw new Error("Browser click 缺少 ref/target。");
      return { name: "browser_click", arguments: { target, ...(input.element ? { element: String(input.element) } : {}) } };
    }
    case "fill":
    case "type": {
      if (!target) throw new Error("Browser type 缺少 ref/target。");
      return {
        name: "browser_type",
        arguments: { target, text: String(input.text ?? input.value ?? ""), ...(input.submit !== undefined ? { submit: Boolean(input.submit) } : {}) }
      };
    }
    case "press": {
      const key = stringValue(input.key || input.value);
      if (!key) throw new Error("Browser press 缺少 key。");
      return { name: "browser_press_key", arguments: { key } };
    }
    case "screenshot": {
      const filename = safeOutputFilename(input.filename, outputDir);
      return {
        name: "browser_take_screenshot",
        arguments: { type: "png", scale: "css", fullPage: Boolean(input.fullPage), filename }
      };
    }
    case "tabs": {
      const tabAction = stringValue(input.tabAction || input.operation || "list").toLowerCase();
      if (!["list", "new", "close", "select"].includes(tabAction)) throw new Error("Browser tabs action 无效。");
      const args: Record<string, unknown> = { action: tabAction };
      if (input.index !== undefined) args.index = numberInRange(input.index, 0, 10_000, "tab index");
      if (input.url !== undefined) {
        const url = stringValue(input.url);
        if (!/^https?:\/\//i.test(url)) throw new Error("Browser tab URL 只允许 HTTP(S)。");
        args.url = url;
      }
      return { name: "browser_tabs", arguments: args };
    }
    case "wait": {
      const args: Record<string, unknown> = {};
      if (input.time !== undefined) args.time = numberInRange(input.time, 0, MAX_WAIT_SECONDS, "wait time");
      if (input.text !== undefined) args.text = String(input.text);
      if (input.textGone !== undefined) args.textGone = String(input.textGone);
      if (!Object.keys(args).length) throw new Error("Browser wait 需要 time、text 或 textGone。");
      return { name: "browser_wait_for", arguments: args };
    }
    case "close": return { name: "browser_close", arguments: {} };
    default: throw new Error(`Browser Tool 不支持 action：${action || "(empty)"}`);
  }
}

export function playwrightArgs(outputDir: string, reuseExistingTabs: boolean, browserExecutablePath?: string): string[] {
  const packagePath = require.resolve("@playwright/mcp/package.json");
  const cliPath = path.join(path.dirname(packagePath), "cli.js");
  return [
    cliPath,
    ...(reuseExistingTabs ? ["--extension"] : ["--headless"]),
    ...(browserExecutablePath ? ["--executable-path", path.resolve(browserExecutablePath)] : []),
    "--image-responses", "omit",
    "--output-dir", outputDir,
    "--output-mode", "stdout",
    "--snapshot-mode", "none",
    "--codegen", "none"
  ];
}

function optionalArguments(input: BrowserToolInput, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const value = key === "target" ? input.target ?? input.ref : input[key];
    if (value !== undefined) result[key] = key === "target" ? String(value) : value;
  }
  return result;
}

function safeOutputFilename(value: unknown, outputDir: string): string {
  const requested = String(value || `agent-browser-${Date.now()}.png`).trim();
  const filename = path.basename(requested).replace(/\.png$/i, "") + ".png";
  const target = path.resolve(outputDir, filename);
  const relative = path.relative(path.resolve(outputDir), target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Browser screenshot 路径越界。");
  return filename;
}

function numberInRange(value: unknown, min: number, max: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${label} 超出允许范围。`);
  return parsed;
}

function stringValue(value: unknown): string {
  return String(value || "").trim();
}

function resultText(result: BrowserMcpResult): string {
  return (result.content || []).filter((item) => item.type === "text").map((item) => item.text || "").join("\n").trim();
}

function truncate(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= MAX_RESULT_BYTES) return value;
  return `${Buffer.from(value, "utf8").subarray(0, MAX_RESULT_BYTES).toString("utf8")}\n...[truncated]`;
}

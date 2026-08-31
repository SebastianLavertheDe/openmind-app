import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildAiWorkerEnvironment } from "./worker-environment";
import { resolvePathInsideCanonicalRoot } from "../paths/openmind-path-resolver";
import {
  CAPTURE_SCOPES,
  buildControlledCaptureCode,
  type CaptureScope
} from "./browser-evidence-capture";

type UpstreamContent = { type?: string; text?: string; data?: string; mimeType?: string };
type UpstreamResult = { content?: UpstreamContent[]; isError?: boolean };
type TabInfo = { index: number; current: boolean; title: string; url: string };

const args = parseArguments(process.argv.slice(2));
const workspace = path.resolve(requiredArgument(args, "workspace"));
const outputDir = path.resolve(requiredArgument(args, "output-dir"));
const reuseExistingTabs = args.get("reuse-existing-tabs") !== "false";
assertInsideWorkspace(workspace, outputDir);
fs.mkdirSync(outputDir, { recursive: true });

const playwrightPackage = require.resolve("@playwright/mcp/package.json");
const playwrightCli = path.join(path.dirname(playwrightPackage), "cli.js");
const upstreamTransport = new StdioClientTransport({
  command: process.execPath,
  args: [
    playwrightCli,
    "--extension",
    "--image-responses", "omit",
    "--output-dir", outputDir,
    "--output-mode", "stdout",
    "--snapshot-mode", "none",
    "--codegen", "none"
  ],
  cwd: workspace,
  env: buildAiWorkerEnvironment(process.env, {
    ELECTRON_RUN_AS_NODE: "1",
    ...(process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN
      ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN }
      : {})
  }),
  stderr: "inherit"
});
const upstream = new Client({ name: "openmind-browser-evidence-bridge", version: "1.0.0" });
const server = new McpServer({ name: "openmind-browser-evidence", version: "1.0.0" });

server.registerTool("capture_source_evidence", {
  title: "截取原文证据",
  description: "在用户已登录且由 Playwright 扩展授权的 Chrome 中复用目标标签页（若存在），精确截取包含指定原文的元素，保存为项目素材，并返回截图、来源信息和相对路径。仅用于阅读与截图。",
  inputSchema: {
    url: z.string().url().refine((value) => /^https?:\/\//i.test(value), "只支持 HTTP(S) URL"),
    quote: z.string().trim().min(2).max(4000).describe("必须在原始网页中出现的准确引用文本"),
    capture_scope: z.enum(CAPTURE_SCOPES).default("auto").describe("截图范围：自动、精确文本、段落、内容组件、单条评论或文章"),
    caption: z.string().trim().max(300).optional().describe("插入稿件时使用的图片说明"),
    filename: z.string().trim().max(180).optional().describe("可选 PNG 文件名；只使用文件名，不接受目录")
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true
  }
}, async ({ url, quote, capture_scope, caption, filename }) => {
  try {
    return await captureEvidence({ url, quote, captureScope: capture_scope, caption, filename });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: `证据截图失败：${detail}\n请确认 Playwright Chrome 扩展已安装并授权目标标签页；若页面需要登录，请先在 Chrome 中完成登录后重试。`
      }]
    };
  }
});

async function captureEvidence(input: {
  url: string;
  quote: string;
  captureScope: CaptureScope;
  caption?: string;
  filename?: string;
}) {
  const before = parseTabs(await callText("browser_tabs", { action: "list" }));
  const original = before.find((tab) => tab.current) || null;
  const existing = reuseExistingTabs
    ? before.find((tab) => canonicalUrl(tab.url) === canonicalUrl(input.url)) || null
    : null;
  let target: TabInfo | null = existing;
  let access: "reused" | "created" = existing ? "reused" : "created";

  if (existing) {
    if (!existing.current) await callText("browser_tabs", { action: "select", index: existing.index });
  } else {
    const created = parseTabs(await callText("browser_tabs", { action: "new", url: input.url }));
    target = created.find((tab) => tab.current) || created.at(-1) || null;
  }
  if (!target) throw new Error("Chrome 没有返回可操作的目标标签页。");

  const outputName = evidenceFilename(input.filename, input.caption, input.url);
  const imagePath = path.join(outputDir, outputName);
  assertInsideWorkspace(workspace, imagePath);
  try {
    const captured = await runControlledCapture(input.quote, imagePath, input.captureScope);
    if (!fs.existsSync(imagePath)) throw new Error("浏览器没有生成截图文件。");
    assertInsideWorkspace(workspace, imagePath);
    const relativeImagePath = path.relative(workspace, imagePath).split(path.sep).join("/");
    const metadataPath = imagePath.replace(/\.png$/i, ".json");
    assertInsideWorkspace(workspace, metadataPath);
    const metadata = {
      schemaVersion: 2,
      sourceUrl: captured.url || input.url,
      sourceTitle: captured.title || target.title,
      quote: input.quote,
      captureScope: captured.scope,
      captureKind: captured.kind,
      capturedText: captured.text,
      capturedBounds: { width: captured.width, height: captured.height },
      caption: input.caption || captured.title || "原文证据",
      imagePath: relativeImagePath,
      tabAccess: access,
      capturedAt: new Date().toISOString()
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
    assertInsideWorkspace(workspace, metadataPath);
    assertInsideWorkspace(workspace, imagePath);
    return {
      content: [
        {
          type: "text" as const,
          text: [
            "原文证据截图已保存。",
            `- 来源：${metadata.sourceTitle}`,
            `- URL：${metadata.sourceUrl}`,
            `- 范围：${metadata.captureScope}（识别为 ${metadata.captureKind}，${metadata.capturedBounds.width}×${metadata.capturedBounds.height}px）`,
            `- 标签页：${access === "reused" ? "复用已打开标签页" : "新建 OpenMind 受管标签页"}`,
            `- 截图：${relativeImagePath}`,
            `- 元数据：${path.relative(workspace, metadataPath).split(path.sep).join("/")}`,
            `- 建议 Markdown：![${metadata.caption}](${relativeImagePath})`
          ].join("\n")
        },
        { type: "image" as const, data: fs.readFileSync(imagePath, "base64"), mimeType: "image/png" }
      ],
      structuredContent: metadata
    };
  } finally {
    if (access === "created" && target) {
      await callText("browser_tabs", { action: "close", index: target.index }).catch(() => undefined);
    }
    if (original && (!target || original.index !== target.index)) {
      await callText("browser_tabs", { action: "select", index: original.index }).catch(() => undefined);
    }
  }
}

async function runControlledCapture(
  quote: string,
  imagePath: string,
  captureScope: CaptureScope
): Promise<{
  url: string;
  title: string;
  text: string;
  scope: CaptureScope;
  kind: CaptureScope;
  width: number;
  height: number;
}> {
  const code = buildControlledCaptureCode({ quote, imagePath, scope: captureScope });
  const result = await call("browser_run_code_unsafe", { code });
  const text = resultText(result);
  const parsed = extractJsonObject(text);
  if (!parsed) {
    if (/SOURCE_QUOTE_NOT_FOUND/i.test(text)) throw new Error("目标页面中没有找到指定原文；页面可能尚未登录、正文未加载或引用文本不准确。");
    if (/SOURCE_CONTEXT_INCOMPLETE|SOURCE_TARGET_NOT_VISIBLE/i.test(text)) throw new Error("已找到原文，但无法得到完整可见的截图范围；请改用更明确的 capture_scope 或提供正文中的准确引文。");
    throw new Error(text || "无法读取浏览器截图结果。");
  }
  return {
    url: String(parsed.url || ""),
    title: String(parsed.title || ""),
    text: String(parsed.text || ""),
    scope: captureScopeValue(parsed.scope, captureScope),
    kind: captureScopeValue(parsed.kind, captureScope),
    width: finiteNumber(parsed.width),
    height: finiteNumber(parsed.height)
  };
}

function captureScopeValue(value: unknown, fallback: CaptureScope): CaptureScope {
  return CAPTURE_SCOPES.includes(value as CaptureScope) ? value as CaptureScope : fallback;
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function callText(name: string, toolArgs: Record<string, unknown>): Promise<string> {
  return resultText(await call(name, toolArgs));
}

async function call(name: string, toolArgs: Record<string, unknown>): Promise<UpstreamResult> {
  const result = await upstream.callTool({ name, arguments: toolArgs }) as UpstreamResult;
  if (result.isError) throw new Error(resultText(result) || `${name} 调用失败。`);
  return result;
}

function resultText(result: UpstreamResult): string {
  return (result.content || []).filter((item) => item.type === "text").map((item) => item.text || "").join("\n").trim();
}

export function parseTabs(text: string): TabInfo[] {
  const tabs: TabInfo[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^- (\d+):(\s+\(current\))? \[(.*)\]\((.*)\)(?: \[crashed\])?$/);
    if (!match) continue;
    tabs.push({ index: Number(match[1]), current: Boolean(match[2]), title: match[3], url: match[4] });
  }
  return tabs;
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return value.trim();
  }
}

function evidenceFilename(requested: string | undefined, caption: string | undefined, sourceUrl: string): string {
  const explicit = requested ? path.basename(requested).replace(/\.png$/i, "") : "";
  const host = (() => { try { return new URL(sourceUrl).hostname; } catch { return "source"; } })();
  const base = slug(explicit || caption || host || "source").slice(0, 80) || "source";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(".", "-");
  return `${stamp}-${base}.png`;
}

function slug(value: string): string {
  return value.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
}

function extractJsonObject(value: string): Record<string, unknown> | null {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* try the next candidate */ }
  }
  return null;
}

function parseArguments(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "");
    const value = values[index + 1];
    if (key && value !== undefined) result.set(key, value);
  }
  return result;
}

function requiredArgument(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

function assertInsideWorkspace(root: string, candidate: string): void {
  resolvePathInsideCanonicalRoot(root, candidate, "证据文件路径超出允许的项目目录。");
}

async function main(): Promise<void> {
  await upstream.connect(upstreamTransport);
  await server.connect(new StdioServerTransport());
}

async function close(): Promise<void> {
  await upstream.close().catch(() => undefined);
}

process.once("SIGTERM", () => { void close().finally(() => process.exit(0)); });
process.once("SIGINT", () => { void close().finally(() => process.exit(0)); });

void main().catch((error) => {
  process.stderr.write(`OpenMind browser evidence server failed: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});

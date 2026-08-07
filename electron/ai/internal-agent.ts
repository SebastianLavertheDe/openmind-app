import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AgentManifest } from "../../shared/skill-manifest-schema";
import type { ProviderProfile } from "../../shared/provider-profiles";
import type { ExecutionPlan } from "../execution/execution-broker";
import type { ProcessResult } from "../execution/process-host";
import type { ExternalBinding } from "../execution/artifact-collector";
import type { AgentCheckpoint, RunUsage } from "../../shared/execution-contracts";
import { estimateModelCost } from "../../shared/model-pricing-catalog";
import { logRedactor } from "../security/log-redactor";
import { Agent as UndiciAgent, ProxyAgent } from "undici";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOOL_OUTPUT = 32 * 1024;
const MAX_INSTRUCTIONS = 180 * 1024;
const DEFAULT_MAX_TURNS = 12;
const MAX_TOTAL_TOOL_OUTPUT = 256 * 1024;
const MAX_PROVIDER_REQUEST_BYTES = 512 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024;
const MAX_TOTAL_TOKENS = 2_000_000;
const MAX_COST_USD = 100;

type AgentToolName = "mymind_read" | "mymind_write" | "shell" | "web_fetch" | "browser" | "skill_run";

export type InternalAgentApproval = (request: {
  tool: AgentToolName;
  detail: string;
  paths?: string[];
  network?: boolean;
}) => Promise<"allow" | "deny">;

export type InternalAgentToolHandlers = {
  runSkill?: (skillId: string, inputs: Record<string, unknown>) => Promise<string>;
  browser?: (input: Record<string, unknown>) => Promise<unknown>;
  close?: () => Promise<void> | void;
};

export type InternalAgentPlanInput = {
  manifest: AgentManifest;
  skillHome: string;
  mymindRoot: string;
  provider: ProviderProfile;
  providerSecret?: string;
  providerSecretRef?: { value: string };
  externalBindings?: Record<string, ExternalBinding>;
  inputs: Record<string, unknown>;
  checkpoint?: AgentCheckpoint;
  digest: string;
  rootGeneration: number;
  approval?: InternalAgentApproval;
  handlers?: InternalAgentToolHandlers;
};

type AgentRunInput = {
  signal: AbortSignal;
  onOutput(stream: "system" | "stdout" | "stderr", text: string): void;
  saveCheckpoint?(checkpoint: AgentCheckpoint | null): void;
};

type ToolCall = { id: string; name: AgentToolName; arguments: Record<string, unknown> };

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
};

type AgentResponse = { text: string; toolCalls: ToolCall[]; responseId?: string; usage?: RunUsage; streamed?: boolean };
type ResponsesContinuation = { previousResponseId: string; toolOutputs: Array<{ callId: string; output: string }> };
type AnthropicContinuation = { messageId: string; toolResults: Array<{ toolUseId: string; toolName: string; output: string }> };
type ProviderContinuation =
  | { protocol: "openai-responses"; state: ResponsesContinuation }
  | { protocol: "anthropic-messages"; state: AnthropicContinuation };

const TOOL_DEFINITIONS = [
  {
    name: "mymind_read",
    description: "读取 mymind 根下的逻辑相对路径。只能读取 Manifest 声明的范围。",
    parameters: objectSchema({ path: { type: "string", description: "相对 mymind 根的文件路径" } })
  },
  {
    name: "mymind_write",
    description: "写入 mymind 根下的逻辑相对路径。只能写入 Manifest 声明的范围。",
    parameters: objectSchema({ path: { type: "string", description: "相对 mymind 根的文件路径" }, content: { type: "string" } })
  },
  {
    name: "shell",
    description: "在当前用户权限下执行一个不经过 shell 的命令；危险或越界操作需要审批。",
    parameters: objectSchema({ command: { type: "string" }, args: { type: "array", items: { type: "string" } } })
  },
  {
    name: "web_fetch",
    description: "读取一个允许的公开 HTTP(S) URL 的文本响应。",
    parameters: objectSchema({ url: { type: "string" } })
  },
  {
    name: "browser",
    description: "调用宿主提供的受控 Browser Tool。只允许 navigate、back、snapshot、get_text、click、fill、type、press、screenshot、tabs、wait、close；不支持任意代码执行。",
    parameters: objectSchema({
      action: { type: "string" },
      url: { type: "string" },
      ref: { type: "string" },
      target: { type: "string" },
      value: { type: "string" },
      text: { type: "string" },
      key: { type: "string" },
      element: { type: "string" },
      tabAction: { type: "string" },
      index: { type: "number" },
      filename: { type: "string" },
      fullPage: { type: "boolean" },
      submit: { type: "boolean" },
      time: { type: "number" },
      textGone: { type: "string" },
      depth: { type: "number" },
      boxes: { type: "boolean" }
    })
  },
  {
    name: "skill_run",
    description: "调用宿主已注册的 Process/Workflow Skill。Skill ID 和输入由宿主管理。",
    parameters: objectSchema({ skillId: { type: "string" }, inputs: { type: "object" } })
  }
] as const;

/**
 * Internal Agent is deliberately a small host-owned runtime. Provider HTTP,
 * tool dispatch, path policy, approval and output limits live here instead of
 * inside a Skill package, so an Agent Skill cannot replace its own policy by
 * shipping another runner.
 */
export class InternalAgentRuntime {
  createPlan(input: InternalAgentPlanInput): ExecutionPlan {
    let secret = input.providerSecretRef?.value || input.providerSecret || "";
    const credentialId = input.provider.credentialId;
    const agent = {
      timeoutMs: input.manifest.execution.timeoutSeconds * 1000,
      run: async ({ signal, onOutput, saveCheckpoint }: AgentRunInput): Promise<ProcessResult> => {
        try {
          const usage = await this.run(input, secret, signal, onOutput, saveCheckpoint);
          return emptyResult("succeeded", usage);
        } catch (error) {
          if (signal.aborted) return emptyResult("cancelled");
          onOutput("stderr", `${safeError(error)}\n`);
          return { ...emptyResult("failed"), code: 1, stderr: safeError(error) };
        } finally {
          await input.handlers?.close?.();
        }
      }
    };
    return {
      skillId: input.manifest.id,
      version: input.manifest.version,
      digest: input.digest,
      rootGeneration: input.rootGeneration,
      skillHome: input.skillHome,
      mymindRoot: input.mymindRoot,
      capabilities: input.manifest.capabilities,
      // The Broker requires a ProcessSpec for schema compatibility, but the
      // Agent branch never launches it. Keeping it inert avoids a second Run
      // contract and makes old plan consumers type-safe.
      process: {
        executable: process.execPath,
        args: ["-e", "process.exit(0)"],
        cwd: input.skillHome,
        env: {},
        timeoutMs: input.manifest.execution.timeoutSeconds * 1000,
        gracefulStopMs: input.manifest.execution.gracefulStopSeconds * 1000
      },
      agent,
      retry: { maxAttempts: input.manifest.execution.retry.maxAttempts },
      maxInstances: input.manifest.execution.concurrency.maxInstances,
      mutexes: [...input.manifest.execution.concurrency.mutexes],
      artifacts: input.manifest.artifacts.map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        ...(artifact.path ? { logicalPath: resolveInputTemplate(artifact.path, input.inputs) } : {}),
        ...(artifact.externalExportId ? { externalPathRef: artifact.externalExportId } : {})
      })),
      externalBindings: input.externalBindings,
      requiresHostConsent: true,
      credentialIds: credentialId ? [credentialId] : [],
      knownSecrets: [],
      prepareRuntime: async () => {
        // The resolver replaces this closure with the scoped secret loader.
        // A supplied secret is already held only in the worker process.
        secret = input.providerSecretRef?.value || input.providerSecret || "";
      }
    };
  }

  async run(
    input: InternalAgentPlanInput,
    secret: string,
    signal: AbortSignal,
    onOutput: AgentRunInput["onOutput"],
    saveCheckpoint?: AgentRunInput["saveCheckpoint"]
  ): Promise<RunUsage | undefined> {
    const startedAt = Date.now();
    let usage: RunUsage | undefined = { model: input.provider.model };
    let totalToolOutputBytes = 0;
    if (input.checkpoint && input.checkpoint.protocol !== input.provider.protocol) {
      throw new Error("Agent checkpoint 与当前 Provider Protocol 不匹配。 ");
    }
    let continuation: ProviderContinuation | null = input.checkpoint?.protocol === "openai-responses"
      ? {
        protocol: "openai-responses",
        state: { previousResponseId: input.checkpoint.responseId, toolOutputs: input.checkpoint.toolOutputs.map((item) => ({ ...item })) }
      }
      : input.checkpoint?.protocol === "anthropic-messages"
        ? {
          protocol: "anthropic-messages",
          state: {
            messageId: input.checkpoint.messageId,
            toolResults: input.checkpoint.toolResults.map((item) => ({ ...item }))
          }
        }
        : null;
    const instructions = loadInstructions(input.skillHome);
    const policy = new AgentPolicy(input.manifest, input.mymindRoot, input.approval, input.handlers);
    const system = [
      "You are CC Tools Internal Agent. Follow the installed Skill instructions and host tool policy.",
      "Use logical mymind paths only; never invent physical paths or read credentials.",
      instructions,
      `Run inputs (JSON): ${JSON.stringify(input.inputs)}`
    ].join("\n\n");
    const user = typeof input.inputs.prompt === "string"
      ? input.inputs.prompt
      : typeof input.inputs.task === "string"
        ? input.inputs.task
        : `Execute the ${input.manifest.id} Skill for the supplied inputs and produce its declared artifacts.`;
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: user }
    ];

    const firstTurn = input.checkpoint?.turn || 0;
    for (let turn = firstTurn; turn < DEFAULT_MAX_TURNS; turn += 1) {
      if (signal.aborted) throw new Error("Internal Agent 已取消。");
      const response = await requestProvider(input.provider, secret, messages, signal, continuation, (delta) => onOutput("stdout", delta));
      usage = mergeUsage(usage, enrichUsageCost(input.provider.protocol, input.provider.model, response.usage));
      enforceUsageBudget(usage);
      if (response.text && !response.streamed) onOutput("stdout", `${response.text}\n`);
      if (!response.toolCalls.length) {
        saveCheckpoint?.(null);
        return { ...usage, durationMs: Date.now() - startedAt };
      }
      if (input.provider.protocol === "openai-responses") {
        if (!response.responseId) throw new Error("OpenAI Responses 缺少 response id，无法继续 Tool Loop。");
        continuation = { protocol: "openai-responses", state: { previousResponseId: response.responseId, toolOutputs: [] } };
      } else if (input.provider.protocol === "anthropic-messages") {
        if (!response.responseId) throw new Error("Anthropic Messages 缺少 message id，无法保存恢复边界。");
        const toolResults = continuation?.protocol === "anthropic-messages" ? continuation.state.toolResults : [];
        continuation = { protocol: "anthropic-messages", state: { messageId: response.responseId, toolResults } };
      }
      messages.push({
        role: "assistant",
        content: response.text,
        tool_calls: response.toolCalls.map((item) => ({
          id: item.id,
          type: "function",
          function: { name: item.name, arguments: JSON.stringify(item.arguments) }
        }))
      });
      for (const call of response.toolCalls) {
        onOutput("system", `[tool] ${call.name}\n`);
        const result = await policy.dispatch(call, signal);
        const output = truncate(JSON.stringify(result) ?? String(result));
        totalToolOutputBytes += Buffer.byteLength(output, "utf8");
        if (totalToolOutputBytes > MAX_TOTAL_TOOL_OUTPUT) {
          throw new Error("Internal Agent 累计 Tool 输出超过上下文预算。 ");
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: output });
        if (continuation?.protocol === "openai-responses") {
          continuation.state.toolOutputs.push({ callId: call.id, output });
          saveCheckpoint?.({
            protocol: "openai-responses",
            responseId: continuation.state.previousResponseId,
            toolOutputs: continuation.state.toolOutputs.slice(-32).map((item) => ({
              callId: item.callId,
              output: checkpointOutput(item.output, secret, input.inputs)
            })),
            turn: turn + 1,
            updatedAt: new Date().toISOString()
          });
        } else if (continuation?.protocol === "anthropic-messages") {
          continuation.state.toolResults.push({ toolUseId: call.id, toolName: call.name, output: checkpointOutput(output, secret, input.inputs) });
          saveCheckpoint?.({
            protocol: "anthropic-messages",
            messageId: continuation.state.messageId,
            toolResults: continuation.state.toolResults.slice(-32),
            turn: turn + 1,
            updatedAt: new Date().toISOString()
          });
        }
      }
    }
    throw new Error(`Internal Agent 超过最大工具轮数：${DEFAULT_MAX_TURNS}`);
  }
}

class AgentPolicy {
  constructor(
    private readonly manifest: AgentManifest,
    private readonly root: string,
    private readonly approval: InternalAgentApproval | undefined,
    private readonly handlers: InternalAgentToolHandlers | undefined
  ) {}

  async dispatch(call: ToolCall, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new Error("Internal Agent 已取消。");
    switch (call.name) {
      case "mymind_read": return this.read(call.arguments);
      case "mymind_write": return this.writeAsync(call.arguments);
      case "shell": return this.shell(call.arguments, signal);
      case "web_fetch": return this.web(call.arguments, signal);
      case "browser": return this.browser(call.arguments);
      case "skill_run": return this.skill(call.arguments);
      default: throw new Error(`未知 Internal Agent Tool：${call.name}`);
    }
  }

  private read(args: Record<string, unknown>): unknown {
    const logical = logicalPath(args.path);
    const file = this.safePath(logical, "read");
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("mymind_read 只允许读取普通文件。");
    return { path: logical, content: truncate(fs.readFileSync(file, "utf8"), MAX_FILE_BYTES) };
  }

  private async writeAsync(args: Record<string, unknown>): Promise<unknown> {
    const logical = logicalPath(args.path);
    const content = String(args.content ?? "");
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error("mymind_write 内容过大。");
    const file = this.safePath(logical, "write");
    const decision = await this.approve({ tool: "mymind_write", detail: `写入 mymind/${logical}`, paths: [file] });
    if (decision !== "allow") throw new Error("mymind_write 被拒绝。");
    ensureSafeParent(this.root, file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temp, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, file);
    return { path: logical, bytes: Buffer.byteLength(content, "utf8") };
  }

  private async shell(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    if (!this.manifest.capabilities.subprocess.allowed) throw new Error("该 Agent 未声明 subprocess 能力。");
    const command = String(args.command || "").trim();
    const values = Array.isArray(args.args) ? args.args.map(String) : [];
    if (!command) throw new Error("shell 缺少 command。");
    const decision = await this.approve({ tool: "shell", detail: `${command} ${values.join(" ")}` });
    if (decision !== "allow") throw new Error("shell 被拒绝。");
    return runCommand(command, values, this.root, signal);
  }

  private async web(args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const raw = String(args.url || "").trim();
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) throw new Error("web_fetch 只允许 HTTP(S)。");
    const hosts = this.manifest.capabilities.network.hosts;
    if (!this.manifest.capabilities.network.required || !hostAllowed(url.hostname, hosts)) throw new Error("该 Agent 未声明此网络主机。");
    const decision = await this.approve({ tool: "web_fetch", detail: raw, network: true });
    if (decision !== "allow") throw new Error("web_fetch 被拒绝。");
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`web_fetch 返回 HTTP ${response.status}。`);
    return { url: raw, content: truncate(await response.text()) };
  }

  private async browser(args: Record<string, unknown>): Promise<unknown> {
    if (!this.manifest.capabilities.browser || !this.handlers?.browser) throw new Error("Browser Tool 未就绪或未声明。");
    const decision = await this.approve({ tool: "browser", detail: JSON.stringify(args), network: true });
    if (decision !== "allow") throw new Error("browser 被拒绝。");
    return this.handlers.browser(args);
  }

  private async skill(args: Record<string, unknown>): Promise<unknown> {
    const skillId = String(args.skillId || "").trim();
    const inputs = args.inputs && typeof args.inputs === "object" && !Array.isArray(args.inputs) ? args.inputs as Record<string, unknown> : {};
    if (!skillId || !this.handlers?.runSkill) throw new Error("Process/Workflow Skill Tool 未注册。");
    const decision = await this.approve({ tool: "skill_run", detail: skillId });
    if (decision !== "allow") throw new Error("skill_run 被拒绝。");
    return { skillId, output: await this.handlers.runSkill(skillId, inputs) };
  }

  private safePath(logical: string, mode: "read" | "write"): string {
    const patterns = mode === "read" ? this.manifest.capabilities.mymind.read : this.manifest.capabilities.mymind.write;
    if (!patterns.some((pattern) => matchesPattern(pattern, logical))) throw new Error(`mymind ${mode} 越出 Manifest 声明范围：${logical}`);
    const candidate = path.resolve(this.root, logical);
    const relative = path.relative(path.resolve(this.root), candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("mymind 路径越界。");
    ensureSafeParent(this.root, candidate);
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) throw new Error("拒绝通过 symlink 访问 mymind。");
    return candidate;
  }

  private async approve(request: Parameters<InternalAgentApproval>[0]): Promise<"allow" | "deny"> {
    if (this.approval) return this.approval(request);
    // Reads and declared mymind writes are safe after host execution consent;
    // shell/network/browser/child-Skill calls remain deny-by-default.
    return request.tool === "mymind_write" ? "allow" : request.tool === "mymind_read" ? "allow" : "deny";
  }
}

function objectSchema(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties, required: Object.keys(properties).filter((key) => key === "path" || key === "content" || key === "command" || key === "url"), additionalProperties: false };
}

function loadInstructions(skillHome: string): string {
  const files: string[] = [];
  const skill = path.join(skillHome, "SKILL.md");
  if (fs.existsSync(skill)) files.push(skill);
  const references = path.join(skillHome, "references");
  if (fs.existsSync(references)) walkFiles(references, files);
  let result = "## Installed Skill instructions\n";
  for (const file of files.sort()) {
    const remaining = MAX_INSTRUCTIONS - Buffer.byteLength(result, "utf8");
    if (remaining <= 0) break;
    const content = fs.readFileSync(file, "utf8");
    result += `\n### ${path.relative(skillHome, file).replaceAll(path.sep, "/")}\n${content.slice(0, remaining)}\n`;
  }
  return result;
}

function walkFiles(root: string, output: string[]): void {
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) walkFiles(file, output);
    else if (entry.isFile() && /\.(md|yaml|yml|json|txt)$/i.test(entry.name)) output.push(file);
  }
}

function logicalPath(value: unknown): string {
  const raw = String(value || "").replaceAll("\\", "/").replace(/^mymind\//, "").replace(/^\/+/, "");
  if (!raw || raw.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("mymind 路径格式无效。");
  return raw;
}

function ensureSafeParent(root: string, target: string): void {
  const canonicalRoot = fs.realpathSync(root);
  const relativeParent = path.relative(canonicalRoot, path.dirname(target));
  if (relativeParent.startsWith("..") || path.isAbsolute(relativeParent)) throw new Error("mymind 父目录越界。");
  let current = canonicalRoot;
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    if (fs.lstatSync(current).isSymbolicLink() || fs.realpathSync(current) !== current) throw new Error("拒绝通过 symlink 访问 mymind 父目录。");
  }
}

function matchesPattern(pattern: string, value: string): boolean {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/$/, "");
  const expression = normalized.split("**").map((part) => part.split("*").map(escapeRegExp).join("[^/]*")).join(".*");
  return new RegExp(`^${expression}(?:/.*)?$`).test(value);
}

function hostAllowed(host: string, patterns: readonly string[]): boolean {
  const normalized = host.toLowerCase();
  return patterns.some((pattern) => {
    if (pattern.trim() === "*") return true;
    const candidate = pattern.toLowerCase().replace(/^\*\./, "");
    return normalized === candidate || normalized.endsWith(`.${candidate}`);
  });
}

async function requestProvider(
  profile: ProviderProfile,
  secret: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  continuation: ProviderContinuation | null = null,
  onTextDelta?: (text: string) => void
): Promise<AgentResponse> {
  if (profile.protocol === "provider-native") throw new Error("Internal Agent 不支持 provider-native Profile，请配置 OpenAI 或 Anthropic 协议。");
  const endpoint = resolveEndpoint(profile);
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (secret) {
    if (profile.protocol === "anthropic-messages") headers["x-api-key"] = secret;
    else headers.Authorization = `Bearer ${secret}`;
  }
  const providerOptions = profile.providerOptions || {};
  if (profile.protocol === "anthropic-messages") headers["anthropic-version"] = providerOptions.anthropicVersion || "2023-06-01";
  if (providerOptions.organization) headers["OpenAI-Organization"] = providerOptions.organization;
  if (providerOptions.project) headers["OpenAI-Project"] = providerOptions.project;
  if (providerOptions.apiVersion) headers["api-version"] = providerOptions.apiVersion;
  const body = profile.protocol === "anthropic-messages"
    ? { model: profile.model, max_tokens: 4096, stream: true, system: anthropicSystem(messages, continuation?.protocol === "anthropic-messages" ? continuation.state : null), messages: anthropicMessages(messages), tools: TOOL_DEFINITIONS.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) }
    : profile.protocol === "openai-responses"
      ? continuation?.protocol === "openai-responses"
        ? { model: profile.model, stream: true, previous_response_id: continuation.state.previousResponseId, input: continuation.state.toolOutputs.map((item) => ({ type: "function_call_output", call_id: item.callId, output: item.output })), tools: TOOL_DEFINITIONS.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters })) }
        : { model: profile.model, stream: true, input: messages.map((message) => ({ role: message.role, content: message.content })), tools: TOOL_DEFINITIONS.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters })) }
      : { model: profile.model, stream: true, messages, temperature: 0, tools: TOOL_DEFINITIONS.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) };

  let lastError: unknown = null;
  const bodyText = JSON.stringify(body);
  if (Buffer.byteLength(bodyText, "utf8") > MAX_PROVIDER_REQUEST_BYTES) {
    throw new Error("Internal Agent Provider 请求上下文超过大小上限。 ");
  }
  for (let attempt = 0; attempt <= profile.maxRetries; attempt += 1) {
    const dispatcher = createProviderDispatcher(profile);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: bodyText,
        signal,
        ...(dispatcher ? { dispatcher } : {})
      } as RequestInit & { dispatcher?: UndiciAgent | ProxyAgent });
      if (!response.ok) {
        lastError = new Error(`Provider 返回 HTTP ${response.status}。`);
        if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt >= profile.maxRetries) throw lastError;
        continue;
      }
      const contentType = response.headers.get("content-type") || "";
      if (contentType.toLowerCase().includes("text/event-stream") && response.body) {
        return {
          ...(await parseStreamingProviderResponse(profile.protocol, response.body, onTextDelta)),
          streamed: true
        };
      }
      return parseProviderResponse(profile.protocol, await response.json());
    } catch (error) {
      if (signal.aborted) throw new Error("Internal Agent 已取消。");
      lastError = error;
      if (attempt >= profile.maxRetries) throw error;
    } finally {
      await dispatcher?.close().catch(() => undefined);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Provider 请求失败。");
}

function createProviderDispatcher(profile: ProviderProfile): UndiciAgent | ProxyAgent | undefined {
  if (profile.proxyPolicy === "explicit") {
    if (!profile.proxyUrl) throw new Error("显式代理策略尚未配置代理地址。 ");
    return new ProxyAgent({
      uri: profile.proxyUrl,
      requestTls: { rejectUnauthorized: profile.tlsPolicy !== "allow-insecure" },
      proxyTls: { rejectUnauthorized: profile.tlsPolicy !== "allow-insecure" }
    });
  }
  if (profile.tlsPolicy === "allow-insecure") {
    return new UndiciAgent({ connect: { rejectUnauthorized: false } });
  }
  return undefined;
}

type StreamingTool = { id: string; name: string; arguments: string };
type StreamingState = {
  text: string;
  responseId?: string;
  usage?: RunUsage;
  bytes: number;
  tools: Map<string, StreamingTool>;
  indexes: Map<number, string>;
  ids: Map<string, string>;
};

async function parseStreamingProviderResponse(
  protocol: ProviderProfile["protocol"],
  body: ReadableStream<Uint8Array>,
  onTextDelta?: (text: string) => void
): Promise<AgentResponse> {
  const state: StreamingState = { text: "", bytes: 0, tools: new Map(), indexes: new Map(), ids: new Map() };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];

  const consumeEvent = (name: string, data: string) => {
    if (!data || data === "[DONE]") return;
    let payload: unknown;
    try { payload = JSON.parse(data); } catch { return; }
    consumeStreamingPayload(protocol, state, name, payload, onTextDelta);
  };
  const flushEvent = () => {
    consumeEvent(eventName, dataLines.join("\n"));
    eventName = "";
    dataLines = [];
  };

  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line) flushEvent();
      else if (line.startsWith("event:")) eventName = line.slice("event:".length).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).replace(/^ /, ""));
      newline = buffer.indexOf("\n");
    }
    if (chunk.done) break;
  }
  if (buffer) dataLines.push(buffer.replace(/\r$/, ""));
  flushEvent();

  return {
    text: state.text,
    toolCalls: [...state.tools.values()].map((tool) => ({ id: tool.id, name: tool.name as AgentToolName, arguments: parseArguments(tool.arguments) })),
    ...(state.responseId ? { responseId: state.responseId } : {}),
    ...(state.usage ? { usage: state.usage } : {})
  };
}

function consumeStreamingPayload(
  protocol: ProviderProfile["protocol"],
  state: StreamingState,
  eventName: string,
  payload: unknown,
  onTextDelta?: (text: string) => void
): void {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  const body = payload as Record<string, unknown>;
  if (protocol === "anthropic-messages") {
    consumeAnthropicStream(state, body, onTextDelta);
    return;
  }
  if (protocol === "openai-responses") {
    consumeResponsesStream(state, body, onTextDelta);
    return;
  }
  consumeChatStream(state, body, onTextDelta);
  if (eventName === "error" && body.error) throw new Error(`Provider 流式响应错误：${safeError(body.error)}`);
}

function consumeChatStream(state: StreamingState, body: Record<string, unknown>, onTextDelta?: (text: string) => void): void {
  if (typeof body.id === "string") state.responseId = body.id;
  state.usage = mergeUsage(state.usage, parseUsage(body));
  const choices = Array.isArray(body.choices) ? body.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const value = choice as Record<string, unknown>;
    const delta = (value.delta && typeof value.delta === "object" ? value.delta : value.message) as Record<string, unknown> | undefined;
    if (!delta) continue;
    if (typeof delta.content === "string") appendStreamText(state, delta.content, onTextDelta);
    const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const item of toolCalls) {
      if (!item || typeof item !== "object") continue;
      const part = item as Record<string, unknown>;
      const index = typeof part.index === "number" ? part.index : undefined;
      const fn = part.function && typeof part.function === "object" ? part.function as Record<string, unknown> : {};
      const tool = getStreamingTool(state, index, typeof part.id === "string" ? part.id : undefined);
      if (typeof part.id === "string") tool.id = part.id;
      if (typeof fn.name === "string") tool.name += fn.name;
      if (typeof fn.arguments === "string") appendToolArguments(state, tool, fn.arguments);
    }
  }
}

function consumeResponsesStream(state: StreamingState, body: Record<string, unknown>, onTextDelta?: (text: string) => void): void {
  const type = String(body.type || "");
  const response = body.response && typeof body.response === "object" ? body.response as Record<string, unknown> : undefined;
  if (typeof body.id === "string" && (type === "response.created" || type === "response.in_progress")) state.responseId = body.id;
  if (response && typeof response.id === "string") state.responseId = response.id;
  if (type === "response.output_text.delta" && typeof body.delta === "string") appendStreamText(state, body.delta, onTextDelta);
  if (type === "response.function_call_arguments.delta" && typeof body.delta === "string") {
    const tool = getStreamingTool(state, undefined, stringValue(body.call_id || body.item_id));
    appendToolArguments(state, tool, body.delta);
  }
  if (type === "response.output_item.added" || type === "response.output_item.done") {
    const item = body.item && typeof body.item === "object" ? body.item as Record<string, unknown> : {};
    if (item.type === "function_call") {
      const tool = getStreamingTool(state, undefined, stringValue(item.call_id || item.id));
      if (typeof item.name === "string") tool.name = item.name;
      if (typeof item.arguments === "string" && !tool.arguments) tool.arguments = item.arguments;
    }
  }
  if (type === "response.completed" && response) {
    state.usage = mergeUsage(state.usage, parseUsage(response));
    const parsed = parseProviderResponse("openai-responses", response);
    if (!state.text && parsed.text) appendStreamText(state, parsed.text, onTextDelta);
    for (const call of parsed.toolCalls) {
      const tool = getStreamingTool(state, undefined, call.id);
      tool.id = call.id;
      tool.name = call.name;
      if (!tool.arguments) tool.arguments = JSON.stringify(call.arguments);
    }
  }
}

function consumeAnthropicStream(state: StreamingState, body: Record<string, unknown>, onTextDelta?: (text: string) => void): void {
  const type = String(body.type || "");
  if (type === "message_start") {
    const message = body.message && typeof body.message === "object" ? body.message as Record<string, unknown> : {};
    if (typeof message.id === "string") state.responseId = message.id;
    state.usage = mergeUsage(state.usage, parseUsage(message));
  }
  if (type === "content_block_start") {
    const index = typeof body.index === "number" ? body.index : undefined;
    const block = body.content_block && typeof body.content_block === "object" ? body.content_block as Record<string, unknown> : {};
    if (block.type === "text" && typeof block.text === "string") appendStreamText(state, block.text, onTextDelta);
    if (block.type === "tool_use") {
      const tool = getStreamingTool(state, index, stringValue(block.id));
      if (typeof block.id === "string") tool.id = block.id;
      if (typeof block.name === "string") tool.name = block.name;
      if (block.input && typeof block.input === "object") tool.arguments = JSON.stringify(block.input);
    }
  }
  if (type === "content_block_delta") {
    const index = typeof body.index === "number" ? body.index : undefined;
    const delta = body.delta && typeof body.delta === "object" ? body.delta as Record<string, unknown> : {};
    if (delta.type === "text_delta" && typeof delta.text === "string") appendStreamText(state, delta.text, onTextDelta);
    if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
      const tool = getStreamingTool(state, index, undefined);
      appendToolArguments(state, tool, delta.partial_json);
    }
  }
  if (type === "message_delta") state.usage = mergeUsage(state.usage, parseUsage(body));
}

function getStreamingTool(state: StreamingState, index?: number, id?: string): StreamingTool {
  const existingKey = (index !== undefined ? state.indexes.get(index) : undefined) || (id ? state.ids.get(id) : undefined);
  if (existingKey) return state.tools.get(existingKey)!;
  const key = `tool-${state.tools.size}`;
  const tool = { id: id || `stream-${state.tools.size}`, name: "", arguments: "" };
  state.tools.set(key, tool);
  if (index !== undefined) state.indexes.set(index, key);
  if (id) state.ids.set(id, key);
  return tool;
}

function appendStreamText(state: StreamingState, value: string, onTextDelta?: (text: string) => void): void {
  if (!value) return;
  addStreamBytes(state, value);
  state.text += value;
  onTextDelta?.(value);
}

function appendToolArguments(state: StreamingState, tool: StreamingTool, value: string): void {
  if (!value) return;
  addStreamBytes(state, value);
  tool.arguments += value;
}

function addStreamBytes(state: StreamingState, value: string): void {
  state.bytes += Buffer.byteLength(value, "utf8");
  if (state.bytes > MAX_PROVIDER_RESPONSE_BYTES) throw new Error("Internal Agent Provider 流式响应超过大小上限。 ");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function parseProviderResponse(protocol: ProviderProfile["protocol"], payload: unknown): AgentResponse {
  const body = payload as Record<string, unknown>;
  const usage = parseUsage(body);
  if (protocol === "anthropic-messages") {
    const content = Array.isArray(body.content) ? body.content : [];
    const text = content.filter((item) => (item as Record<string, unknown>)?.type === "text").map((item) => String((item as Record<string, unknown>).text || "")).join("");
    const toolCalls = content.filter((item) => (item as Record<string, unknown>)?.type === "tool_use").map((item) => {
      const value = item as Record<string, unknown>;
      return { id: String(value.id || `tool-${Date.now()}`), name: String(value.name) as AgentToolName, arguments: (value.input && typeof value.input === "object" ? value.input : {}) as Record<string, unknown> };
    });
    return { text, toolCalls, responseId: String(body.id || "") || undefined, usage };
  }
  if (protocol === "openai-responses") {
    const output = Array.isArray(body.output) ? body.output : [];
    const text = output.flatMap((item) => Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : []).map((item) => String((item as Record<string, unknown>).text || "")).join("") || String(body.output_text || "");
    const toolCalls = output.filter((item) => (item as Record<string, unknown>).type === "function_call").map((item) => {
      const value = item as Record<string, unknown>;
      return { id: String(value.call_id || value.id), name: String(value.name) as AgentToolName, arguments: parseArguments(value.arguments) };
    });
    return { text, toolCalls, responseId: String(body.id || "") || undefined, usage };
  }
  const choice = Array.isArray(body.choices) ? body.choices[0] as Record<string, unknown> | undefined : undefined;
  const message = choice?.message as Record<string, unknown> | undefined;
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls.map((item) => {
    const value = item as Record<string, unknown>;
    const fn = value.function as Record<string, unknown> | undefined;
    return { id: String(value.id || `tool-${Date.now()}`), name: String(fn?.name || "") as AgentToolName, arguments: parseArguments(fn?.arguments) };
  }) : [];
  return { text: String(message?.content || ""), toolCalls, usage };
}

function anthropicMessages(messages: ChatMessage[]): Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      if (message.role === "assistant" && message.tool_calls?.length) {
        return {
          role: "assistant",
          content: [
            ...(message.content ? [{ type: "text", text: message.content }] : []),
            ...message.tool_calls.map((call) => ({ type: "tool_use", id: call.id, name: call.function.name, input: parseArguments(call.function.arguments) }))
          ]
        };
      }
      if (message.role === "tool") {
        return { role: "user", content: [{ type: "tool_result", tool_use_id: message.tool_call_id || "", content: message.content }] };
      }
      return { role: message.role === "user" ? "user" : "assistant", content: message.content };
    });
}

function anthropicSystem(messages: ChatMessage[], continuation: AnthropicContinuation | null): string {
  const base = messages.find((message) => message.role === "system")?.content || "";
  if (!continuation) return base;
  const completed = continuation.toolResults.length
    ? continuation.toolResults.map((item) => `- ${item.toolName} (${item.toolUseId}): ${item.output}`).join("\n")
    : "(无已完成工具结果)";
  return [
    base,
    "",
    "This Internal Agent is resuming from a host-owned safe boundary.",
    `The previous Anthropic message id was ${continuation.messageId}; it is an audit correlation id, not a server-side session resume token.`,
    "The following tool results are already completed. Do not repeat side effects solely to recreate them; continue the task from this state.",
    completed
  ].join("\n");
}

function parseUsage(body: Record<string, unknown>): RunUsage | undefined {
  const raw = body.usage;
  const usage = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const inputTokens = optionalNumber(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = optionalNumber(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = optionalNumber(usage.total_tokens) ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
  const costUsd = optionalNumber(body.total_cost_usd ?? body.cost_usd ?? body.cost);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined && costUsd === undefined) return undefined;
  return { ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}), ...(totalTokens !== undefined ? { totalTokens } : {}), ...(costUsd !== undefined ? { costUsd } : {}) };
}

function enrichUsageCost(protocol: ProviderProfile["protocol"], model: string, usage: RunUsage | undefined): RunUsage | undefined {
  if (!usage || usage.costUsd !== undefined || usage.inputTokens === undefined || usage.outputTokens === undefined) return usage;
  const estimate = estimateModelCost({ protocol, model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
  if (!estimate) return usage;
  return {
    ...usage,
    costUsd: estimate.costUsd,
    costSource: "catalog-estimate",
    pricingCatalogVersion: estimate.rate.catalogVersion,
    pricingRateId: estimate.rate.id
  };
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function mergeUsage(previous: RunUsage | undefined, current: RunUsage | undefined): RunUsage | undefined {
  if (!previous && !current) return undefined;
  const left = previous || {};
  const right = current || {};
  const inputTokens = sumOptional(left.inputTokens, right.inputTokens);
  const outputTokens = sumOptional(left.outputTokens, right.outputTokens);
  const totalTokens = sumOptional(left.totalTokens, right.totalTokens) ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
  const costUsd = sumOptional(left.costUsd, right.costUsd);
  const costSource = mergeCostSource(left.costSource, right.costSource);
  const pricingRateId = costSource === "catalog-estimate" ? mergeSameOptional(left.pricingRateId, right.pricingRateId) : undefined;
  const pricingCatalogVersion = costSource === "catalog-estimate" ? mergeSameOptional(left.pricingCatalogVersion, right.pricingCatalogVersion) : undefined;
  return {
    ...(right.model || left.model ? { model: right.model || left.model } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(costSource ? { costSource } : {}),
    ...(pricingCatalogVersion !== undefined ? { pricingCatalogVersion } : {}),
    ...(pricingRateId ? { pricingRateId } : {})
  };
}

function mergeCostSource(left: RunUsage["costSource"], right: RunUsage["costSource"]): RunUsage["costSource"] {
  if (!left) return right;
  if (!right || left === right) return left;
  return "mixed";
}

function mergeSameOptional<T>(left: T | undefined, right: T | undefined): T | undefined {
  if (left !== undefined && right !== undefined && left !== right) return undefined;
  return right ?? left;
}

function sumOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined && right === undefined) return undefined;
  return (left || 0) + (right || 0);
}

function enforceUsageBudget(usage: RunUsage | undefined): void {
  if (usage?.totalTokens !== undefined && usage.totalTokens > MAX_TOTAL_TOKENS) {
    throw new Error("Internal Agent 累计 Token 用量超过安全上限。 ");
  }
  if (usage?.costUsd !== undefined && usage.costUsd > MAX_COST_USD) {
    throw new Error("Internal Agent 累计 Cost 超过安全上限。 ");
  }
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function resolveEndpoint(profile: ProviderProfile): string {
  if (!profile.baseUrl) throw new Error("Provider Profile 缺少 Base URL。");
  const url = new URL(profile.baseUrl);
  const suffix = profile.protocol === "openai-chat" ? "chat/completions" : profile.protocol === "openai-responses" ? "responses" : profile.protocol === "anthropic-messages" ? "messages" : "";
  if (profile.protocol === "provider-native" || !suffix || url.pathname.endsWith(`/${suffix}`)) return url.toString();
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${suffix}`;
  return url.toString();
}

function runCommand(command: string, args: string[], cwd: string, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout = truncate(stdout + chunk.toString("utf8")); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = truncate(stderr + chunk.toString("utf8")); });
    const abort = () => { try { child.kill(); } catch { /* best effort */ } };
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => { signal.removeEventListener("abort", abort); reject(error); });
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new Error("shell 已取消。"));
      else resolve({ code, stdout, stderr });
    });
  });
}

function resolveInputTemplate(value: string, inputs: Record<string, unknown>): string {
  return value.replace(/\{\{\s*inputs\.([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const resolved = inputs[key];
    if (resolved === undefined || resolved === null || typeof resolved === "object") throw new Error(`Agent Artifact 输入无效：${key}`);
    return String(resolved);
  });
}

function emptyResult(outcome: ProcessResult["outcome"], usage?: RunUsage): ProcessResult {
  return { outcome, code: outcome === "succeeded" ? 0 : null, signal: null, stdout: "", stderr: "", droppedBytes: 0, ...(usage ? { usage } : {}) };
}

function truncate(value: string, max = MAX_TOOL_OUTPUT): string {
  return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value;
}

function checkpointOutput(value: string, providerSecret: string, inputs: Record<string, unknown>): string {
  const knownValues = [
    ...(providerSecret ? [providerSecret] : []),
    ...collectInputValues(inputs)
  ].filter(Boolean).sort((left, right) => right.length - left.length);
  let redacted = logRedactor.redact(value, knownValues);
  for (const knownValue of knownValues) redacted = redacted.split(knownValue).join("[REDACTED]");
  return redacted;
}

function collectInputValues(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectInputValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectInputValues);
  return [];
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 2000);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

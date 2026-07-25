import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type { AiEvent } from "../../../shared/contracts";
import { AUTO_MODEL } from "../../../shared/model-catalog";
import type { ProviderAdapter, ProviderRunContext } from "./types";
import { canAutoApprove, classifyApproval } from "./types";
import { killProcessTree, parseWslPath, spawnInDirectory, spawnNativeInDirectory, toWslPath } from "../process-utils";
import { browserEvidenceInstructions, buildCodexBrowserConfig } from "../browser-evidence";

interface RpcMessage {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

export interface CodexNativeSkill {
  name: string;
  path: string;
  enabled: boolean;
}

const CODEX_TOOL_ITEM_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "imageView",
  "imageGeneration"
]);

const CODEX_TERMINAL_AGENT_STATUSES = new Set([
  "interrupted",
  "completed",
  "errored",
  "shutdown",
  "notFound"
]);

export class CodexAppServerAdapter implements ProviderAdapter {
  async run(context: ProviderRunContext): Promise<void> {
    const child = spawnCodex(context);
    const rpc = new JsonRpcClient(child);
    context.signal.addEventListener("abort", () => rpc.close(), { once: true });
    rpc.onNotification = async (message) => {
      for (const event of normalizeCodexNotification(message)) {
        await context.emit(event.kind, event.payload);
      }
    };
    rpc.onServerRequest = async (message) => this.handleServerRequest(context, message);
    try {
      await rpc.request("initialize", {
        clientInfo: { name: "cctools-desktop", title: "CC Tools", version: "1.0.0" },
        capabilities: { experimentalApi: true }
      });
      rpc.notify("initialized", {});
      const cwd = providerCwd(context);
      const sandbox = context.session.permissionProfile === "read-only" ? "read-only" : "workspace-write";
      const browserConfig = buildCodexBrowserConfig(context.provider, context.cwd, context.browserAutomation);
      const browserInstructions = browserEvidenceInstructions(context.browserAutomation);
      const threadBrowserOptions = {
        ...(browserConfig ? { config: browserConfig } : {}),
        ...(browserInstructions ? { developerInstructions: browserInstructions } : {})
      };
      const threadResult = context.session.providerSessionId
        ? await rpc.request("thread/resume", {
          threadId: context.session.providerSessionId,
          cwd,
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox,
          ...threadBrowserOptions
        })
        : await rpc.request("thread/start", {
          cwd,
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox,
          serviceName: "cctools-desktop",
          ...threadBrowserOptions
        });
      const thread = threadResult.thread as { id?: string } | undefined;
      if (!thread?.id) throw new Error("Codex App Server 未返回 thread id。");
      context.updateProviderSession(thread.id);
      let nativeSkill: CodexNativeSkill | null = null;
      if (context.skillInvocation) {
        const projectSkill = resolveProjectCodexSkill(context, cwd, context.skillInvocation.name);
        let discoveredSkill: CodexNativeSkill | null = null;
        try {
          discoveredSkill = resolveCodexNativeSkill(
            await rpc.request("skills/list", { cwds: [cwd] }),
            context.skillInvocation.name
          );
          nativeSkill = discoveredSkill || projectSkill;
        } catch (error) {
          if (!projectSkill) throw error;
          nativeSkill = projectSkill;
        }
        if (discoveredSkill && !discoveredSkill.enabled) {
          throw new Error(`Codex Skill 已被禁用：${context.skillInvocation.name}`);
        }
      }
      if (context.skillInvocation && !nativeSkill) {
        throw new Error(`Codex 没有在 ${cwd} 发现 Skill：${context.skillInvocation.name}。请确认 .claude/skills 或 .agents/skills 中存在对应的 SKILL.md。`);
      }
      const collaborationMode = buildCodexCollaborationMode(context);
      await rpc.request("turn/start", {
        threadId: thread.id,
        cwd,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: context.session.permissionProfile === "read-only"
          ? { type: "readOnly", networkAccess: false }
          : {
            type: "workspaceWrite",
            writableRoots: [cwd],
            networkAccess: context.session.permissionProfile === "auto",
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false
          },
        input: buildCodexTurnInput(context, nativeSkill),
        ...(collaborationMode ? { collaborationMode } : {})
      });
      await rpc.waitForTurn();
    } finally {
      rpc.close();
    }
  }

  private async handleServerRequest(context: ProviderRunContext, message: RpcMessage): Promise<Record<string, unknown>> {
    const method = String(message.method || "");
    const modernCommand = method === "item/commandExecution/requestApproval";
    const modernFile = method === "item/fileChange/requestApproval" || method === "fileChange";
    const legacyCommand = method === "execCommandApproval";
    const legacyFile = method === "applyPatchApproval";
    if (!modernCommand && !modernFile && !legacyCommand && !legacyFile) {
      // Other app-server requests have different response contracts
      // (permissions, user-input, MCP elicitation, dynamic tool calls, auth).
      // A generic {decision} would look accepted locally but be invalid or
      // unsafe at the provider boundary.
      throw new Error(`Unsupported Codex app-server request: ${method || "unknown"}`);
    }

    const params = message.params || {};
    const command = Array.isArray(params.command) ? params.command.map(String).join(" ") : String(params.command || "");
    const classified = classifyApproval(command, method);
    const category = modernFile || legacyFile ? "file-change" : classified.category;
    const paths = params.grantRoot ? [String(params.grantRoot)] : [];
    const availableDecisions = Array.isArray(params.availableDecisions) ? params.availableDecisions : null;
    const acceptsPlainApproval = !availableDecisions || availableDecisions.includes("accept");
    if (canAutoApprove(context, category, command, paths) && (legacyCommand || legacyFile || acceptsPlainApproval)) {
      return { decision: legacyCommand || legacyFile ? "approved" : selectCodexApprovalDecision("accept", availableDecisions) };
    }
    const detailParts = [params.reason, command];
    if (availableDecisions?.length) detailParts.push(`Available decisions: ${availableDecisions.map(codexDecisionLabel).join(", ")}`);
    const decision = await context.requestApproval({
      providerRequestId: message.id || "",
      category,
      title: modernFile || legacyFile ? "请求修改文件" : classified.title,
      detail: detailParts.filter(Boolean).map(String).join("\n") || JSON.stringify(params),
      cwd: typeof params.cwd === "string" ? params.cwd : undefined,
      command,
      paths
    });
    const mapped = legacyCommand || legacyFile
      ? decision === "accept-session" ? "approved_for_session" : decision === "accept" ? "approved" : "denied"
      : selectCodexApprovalDecision(decision, availableDecisions);
    return { decision: mapped };
  }
}

function selectCodexApprovalDecision(
  decision: "accept" | "accept-session" | "decline",
  available: unknown[] | null
): "accept" | "acceptForSession" | "decline" | "cancel" {
  const allowed = available
    ? new Set(available.filter((value): value is string => typeof value === "string"))
    : null;
  const candidates = decision === "accept-session"
    ? ["acceptForSession", "accept"] as const
    : decision === "accept"
      ? ["accept"] as const
      : ["decline", "cancel"] as const;
  for (const candidate of candidates) {
    if (!allowed || allowed.has(candidate)) return candidate;
  }
  // Never manufacture an amendment-bearing approval the UI did not show.
  if (!allowed || allowed.has("decline")) return "decline";
  if (allowed.has("cancel")) return "cancel";
  throw new Error("Codex approval request does not offer a safely representable decision.");
}

function codexDecisionLabel(value: unknown): string {
  if (typeof value === "string") return value;
  return value && typeof value === "object" ? Object.keys(value as Record<string, unknown>)[0] || "custom" : String(value);
}

export function normalizeCodexNotification(message: RpcMessage): Array<{ kind: AiEvent["kind"]; payload: Record<string, unknown> }> {
  const params = message.params || {};
  const item = params.item as Record<string, unknown> | undefined;
  if (message.method === "item/agentMessage/delta") {
    return [{
      kind: "assistant-delta",
      payload: {
        text: String(params.delta || ""),
        // App-server deltas do not carry MessagePhase. They remain provisional
        // until item/completed identifies a final_answer item.
        phase: "commentary",
        itemId: params.itemId,
        threadId: params.threadId,
        turnId: params.turnId
      }
    }];
  }
  if (message.method === "item/reasoning/summaryTextDelta") {
    return [{
      kind: "reasoning-delta",
      payload: {
        text: String(params.delta || ""),
        source: "codex-summary",
        summaryIndex: params.summaryIndex,
        itemId: params.itemId,
        threadId: params.threadId,
        turnId: params.turnId
      }
    }];
  }
  if (message.method === "turn/plan/updated") {
    const plan = Array.isArray(params.plan) ? params.plan : [];
    return [{
      kind: "todo",
      payload: {
        items: plan.map((raw, index) => {
          const step = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
          const status = step.status === "inProgress" ? "in-progress" : step.status;
          return { id: `${params.turnId || "turn"}:${index}`, text: String(step.step || ""), status };
        }),
        explanation: params.explanation ?? null,
        sourceEvent: "turn/plan/updated",
        threadId: params.threadId,
        turnId: params.turnId
      }
    }];
  }
  if (message.method === "item/started" && item?.type === "collabAgentToolCall") {
    return [codexSubtaskEvent(item, params, item.tool === "spawnAgent" ? "subtask_started" : "subtask_updated")];
  }
  if (message.method === "item/started" && item && CODEX_TOOL_ITEM_TYPES.has(String(item.type || ""))) {
    const input = codexToolInput(item);
    return [{
      kind: "tool-start",
      payload: {
        tool: codexToolName(item),
        providerItemType: item.type,
        server: item.server,
        namespace: item.namespace,
        command: item.command,
        changes: item.changes,
        input,
        arguments: input,
        cwd: item.cwd,
        status: item.status,
        itemId: item.id,
        turnId: params.turnId
      }
    }];
  }
  if (message.method === "item/completed" && item?.type === "agentMessage") {
    const providerPhase = String(item.phase || "");
    const phase = providerPhase === "final_answer"
      ? "final"
      : providerPhase === "commentary"
        ? "commentary"
        : "unknown";
    return [{
      kind: "assistant-message",
      payload: {
        text: String(item.text || ""),
        itemId: item.id,
        threadId: params.threadId,
        turnId: params.turnId,
        // Only the explicit app-server final_answer phase is eligible for the
        // conversation's authoritative final reply. Unknown/legacy phases are
        // kept as process commentary to avoid publishing an interim message.
        phase,
        providerPhase: providerPhase || null
      }
    }];
  }
  if (message.method === "item/completed" && item?.type === "reasoning") {
    return [{
      kind: "reasoning-summary",
      payload: {
        text: joinCodexTextParts(item.summary || item.text || item.content),
        itemId: item.id,
        threadId: params.threadId,
        turnId: params.turnId,
        source: "codex-summary"
      }
    }];
  }
  if (message.method === "item/completed" && item?.type === "plan") {
    return [{
      kind: "plan",
      payload: {
        text: String(item.text || ""),
        itemId: item.id,
        turnId: params.turnId,
        sourceEvent: "item/completed",
        providerItemType: "plan"
      }
    }];
  }
  if (message.method === "item/completed" && item?.type === "collabAgentToolCall") {
    return [codexSubtaskEvent(item, params, codexSubtaskCompletionSubtype(item))];
  }
  if (message.method === "item/completed" && item?.type === "contextCompaction") {
    return [{
      kind: "system",
      payload: {
        text: "Codex compacted the conversation context.",
        subtype: "context_compacted",
        semanticType: "context_compaction",
        itemId: item.id,
        threadId: params.threadId,
        turnId: params.turnId
      }
    }];
  }
  if (message.method === "item/completed" && item && CODEX_TOOL_ITEM_TYPES.has(String(item.type || ""))) {
    const input = codexToolInput(item);
    return [{
      kind: "tool-complete",
      payload: {
        tool: codexToolName(item),
        providerItemType: item.type,
        server: item.server,
        namespace: item.namespace,
        item,
        itemId: item.id,
        turnId: params.turnId,
        status: item.status,
        durationMs: item.durationMs,
        command: item.command,
        cwd: item.cwd,
        exitCode: item.exitCode,
        aggregatedOutput: item.aggregatedOutput,
        output: codexToolOutput(item),
        error: item.error,
        isError: item.status === "failed" || item.success === false || Boolean(item.error),
        arguments: input,
        input
      }
    }];
  }
  if (message.method?.endsWith("/outputDelta")) {
    return [{
      kind: "tool-output",
      payload: {
        text: params.delta || params.output || "",
        itemId: params.itemId,
        threadId: params.threadId,
        turnId: params.turnId
      }
    }];
  }
  if (message.method === "thread/tokenUsage/updated") {
    const tokenUsage = asCodexRecord(params.tokenUsage);
    return [{
      kind: "usage",
      payload: {
        ...params,
        // tokenUsage is a replaceable snapshot, not a delta. `last` is the
        // latest model call; `total` is the cumulative thread total.
        usage: asCodexRecord(tokenUsage.last),
        totalUsage: asCodexRecord(tokenUsage.total),
        modelContextWindow: tokenUsage.modelContextWindow ?? null,
        snapshot: true,
        snapshotKey: `codex-token-usage:${String(params.turnId || "thread")}`
      }
    }];
  }
  if (message.method === "thread/compacted") {
    return [{
      kind: "system",
      payload: {
        text: "Codex compacted the conversation context.",
        subtype: "context_compacted",
        ...params
      }
    }];
  }
  if (message.method === "turn/diff/updated") {
    return [{
      kind: "changes",
      payload: {
        ...params,
        // App-server sends the latest aggregated unified diff for the turn.
        // Preserve it both under the protocol name and the UI's patch alias.
        patch: String(params.diff || ""),
        snapshot: true,
        snapshotKey: `codex-turn-diff:${String(params.turnId || "turn")}`
      }
    }];
  }
  if (message.method === "error") {
    const error = asCodexRecord(params.error);
    const text = String(error.message || params.message || "Codex error");
    if (params.willRetry === true) {
      return [{
        kind: "status",
        payload: {
          state: "retrying",
          subtype: "provider_retry",
          text,
          error,
          willRetry: true,
          threadId: params.threadId,
          turnId: params.turnId
        }
      }];
    }
    return [{
      kind: "error",
      payload: {
        text,
        error,
        willRetry: false,
        threadId: params.threadId,
        turnId: params.turnId
      }
    }];
  }
  if (message.method === "warning" || message.method === "configWarning") return [{ kind: "system", payload: { text: String(params.message || params.summary || "Codex warning") } }];
  return [];
}

function joinCodexTextParts(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .filter((part): part is string => typeof part === "string")
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n");
  }
  return typeof value === "string" ? value : "";
}

function codexToolName(item: Record<string, unknown>): string {
  const type = String(item.type || "tool");
  if (type === "mcpToolCall" || type === "dynamicToolCall") return String(item.tool || type);
  return type;
}

function codexToolInput(item: Record<string, unknown>): unknown {
  if (item.arguments !== undefined) return item.arguments;
  if (item.command !== undefined) return { command: item.command, cwd: item.cwd };
  if (item.changes !== undefined) return { changes: item.changes };
  if (item.query !== undefined) return { query: item.query, action: item.action };
  if (item.path !== undefined) return { path: item.path };
  if (item.revisedPrompt !== undefined) return { prompt: item.revisedPrompt };
  return {};
}

function codexToolOutput(item: Record<string, unknown>): unknown {
  return item.aggregatedOutput
    ?? item.result
    ?? item.contentItems
    ?? item.error
    ?? (item.type === "fileChange" ? item.changes : undefined)
    ?? (item.type === "imageView" ? item.path : undefined)
    ?? (item.type === "imageGeneration" ? item.savedPath || item.result : undefined)
    ?? null;
}

function codexSubtaskEvent(
  item: Record<string, unknown>,
  params: Record<string, unknown>,
  subtype: "subtask_started" | "subtask_updated" | "subtask_completed"
): { kind: "system"; payload: Record<string, unknown> } {
  return {
    kind: "system",
    payload: {
      semanticType: "subtask",
      subtype,
      itemId: item.id,
      threadId: params.threadId,
      turnId: params.turnId,
      tool: item.tool,
      status: item.status,
      senderThreadId: item.senderThreadId,
      receiverThreadIds: Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : [],
      prompt: item.prompt ?? null,
      model: item.model ?? null,
      reasoningEffort: item.reasoningEffort ?? null,
      agentsStates: asCodexRecord(item.agentsStates)
    }
  };
}

function codexSubtaskCompletionSubtype(item: Record<string, unknown>): "subtask_updated" | "subtask_completed" {
  const states = Object.values(asCodexRecord(item.agentsStates))
    .map((value) => String(asCodexRecord(value).status || ""))
    .filter(Boolean);
  if (states.length > 0 && states.every((status) => CODEX_TERMINAL_AGENT_STATUSES.has(status))) return "subtask_completed";
  if (item.tool === "closeAgent") return "subtask_completed";
  return "subtask_updated";
}

function asCodexRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function codexTurnStatus(params: Record<string, unknown> | undefined): string {
  const values = params || {};
  const turn = asCodexRecord(values.turn);
  // Old app-server builds emitted a bare turn/completed notification. Keep the
  // historical success fallback while honoring all statuses from modern v2.
  return String(turn.status || values.status || "completed");
}

/**
 * Codex app-server v2 (verified against CLI 0.128.0) requires
 * CollaborationMode.settings.model.
 * provider.detectedModel 来自同一台机器的 Codex config；显式模型覆盖优先。
 */
export function buildCodexCollaborationMode(context: Pick<ProviderRunContext, "session" | "provider" | "providerModel">): Record<string, unknown> | null {
  const model = context.providerModel && context.providerModel !== AUTO_MODEL
    ? context.providerModel
    : context.provider.detectedModel;
  if (!model) {
    if (context.session.interactionMode === "plan") {
      throw new Error("无法进入 Codex Plan 模式：当前 CLI 没有可用的模型配置。请先在 Codex 中选择模型。");
    }
    return null;
  }
  return {
    mode: context.session.interactionMode || "default",
    settings: {
      model,
      reasoning_effort: null,
      developer_instructions: null
    }
  };
}

/** 构造 `codex app-server` 的启动参数；非 auto 模型时追加 `-c model=<id>` 覆盖。 */
export function buildCodexAppServerArgs(providerModel: string | null | undefined): string[] {
  const args = ["app-server"];
  if (providerModel && providerModel !== AUTO_MODEL) {
    // codex 支持 `-c key=value` 覆盖 ~/.codex/config.toml，值按 TOML 解析、失败则按字面量。
    args.push("-c", `model=${providerModel}`);
  }
  return args;
}

function spawnCodex(context: ProviderRunContext): ChildProcessWithoutNullStreams {
  const args = buildCodexAppServerArgs(context.providerModel);
  return context.provider.runtime === "wsl"
    ? spawnInDirectory(context.cwd, "codex", args)
    : spawnNativeInDirectory(context.cwd, "codex", args);
}

function providerCwd(context: ProviderRunContext): string {
  if (context.provider.runtime !== "wsl") return context.cwd;
  const parsed = parseWslPath(context.cwd);
  return parsed ? parsed.linuxPath : toWslPath(context.cwd);
}

function resolveProjectCodexSkill(context: ProviderRunContext, providerWorkingDirectory: string, name: string): CodexNativeSkill | null {
  const relativeSkillPath = path.join(".claude", "skills", name, "SKILL.md");
  const hostPath = path.resolve(context.cwd, relativeSkillPath);
  if (!fs.existsSync(hostPath)) return null;
  return {
    name,
    path: context.provider.runtime === "wsl"
      ? path.posix.join(providerWorkingDirectory, ".claude", "skills", name, "SKILL.md")
      : hostPath,
    enabled: true
  };
}

export function resolveCodexNativeSkill(result: Record<string, unknown>, requestedName: string): CodexNativeSkill | null {
  const entries = Array.isArray(result.data) ? result.data : [];
  for (const entry of entries) {
    const skills = Array.isArray((entry as { skills?: unknown }).skills)
      ? (entry as { skills: unknown[] }).skills
      : [];
    for (const rawSkill of skills) {
      if (!rawSkill || typeof rawSkill !== "object") continue;
      const skill = rawSkill as Record<string, unknown>;
      if (String(skill.name || "").toLocaleLowerCase() !== requestedName.toLocaleLowerCase()) continue;
      if (typeof skill.path !== "string") return null;
      return { name: String(skill.name), path: skill.path, enabled: skill.enabled !== false };
    }
  }
  return null;
}

export function buildCodexTurnInput(
  context: Pick<ProviderRunContext, "prompt" | "skillInvocation">,
  nativeSkill: CodexNativeSkill | null
): Array<Record<string, unknown>> {
  if (!context.skillInvocation) {
    return [{ type: "text", text: context.prompt, text_elements: [] }];
  }
  if (!nativeSkill?.enabled) throw new Error(`Codex Skill 不可用：${context.skillInvocation.name}`);
  const input: Array<Record<string, unknown>> = [{
    type: "skill",
    name: nativeSkill.name,
    path: nativeSkill.path
  }];
  if (context.skillInvocation.prompt) {
    input.push({ type: "text", text: context.skillInvocation.prompt, text_elements: [] });
  }
  return input;
}

class JsonRpcClient {
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  private turnResolve: (() => void) | null = null;
  private turnReject: ((error: Error) => void) | null = null;
  private turnOutcome: { error: Error | null } | null = null;
  private notificationTail: Promise<void> = Promise.resolve();
  onNotification: (message: RpcMessage) => Promise<void> = async () => {};
  onServerRequest: (message: RpcMessage) => Promise<Record<string, unknown>> = async () => ({});

  constructor(private child: ChildProcessWithoutNullStreams) {
    readline.createInterface({ input: child.stdout }).on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) void this.enqueueNotification({ method: "warning", params: { message: text } });
    });
    child.on("error", (error) => this.fail(error));
    child.on("close", (code) => {
      if (code && code !== 0) this.fail(new Error(`Codex App Server 退出码 ${code}`));
    });
  }

  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = ++this.sequence;
    this.write({ id, method, params });
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  notify(method: string, params: Record<string, unknown>): void { this.write({ method, params }); }

  waitForTurn(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.turnResolve = resolve;
      this.turnReject = reject;
      this.flushTurnOutcome();
    });
  }

  close(): void { void killProcessTree(this.child); }

  private write(message: RpcMessage): void { this.child.stdin.write(`${JSON.stringify(message)}\n`); }

  private handleLine(line: string): void {
    let message: RpcMessage;
    try { message = JSON.parse(line) as RpcMessage; } catch { return; }
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(Number(message.id));
      if (!pending) return;
      this.pending.delete(Number(message.id));
      if (message.error) pending.reject(new Error(message.error.message || "Codex RPC error"));
      else pending.resolve(message.result || {});
      return;
    }
    if (message.id !== undefined && message.method) {
      void this.onServerRequest(message)
        .then((result) => this.write({ id: message.id, result }))
        .catch((error) => {
          const failure = error instanceof Error ? error : new Error(String(error));
          this.write({ id: message.id, error: { message: failure.message } });
          this.fail(failure);
        });
      return;
    }
    // Preserve protocol order even when persisting one event is asynchronous.
    // In particular, do not let turn/completed mark the run terminal before the
    // preceding final_answer item has reached the event store.
    const delivery = this.enqueueNotification(message);
    if (message.method === "turn/completed") {
      void delivery.then(() => this.captureTurnOutcome(message)).catch(() => undefined);
    }
  }

  private enqueueNotification(message: RpcMessage): Promise<void> {
    const delivery = this.notificationTail.then(() => this.onNotification(message));
    this.notificationTail = delivery.catch((error) => this.fail(error instanceof Error ? error : new Error(String(error))));
    return delivery;
  }

  private captureTurnOutcome(message: RpcMessage): void {
    const turn = asCodexRecord(message.params?.turn);
    const status = codexTurnStatus(message.params);
    if (status === "completed") {
      this.turnOutcome = { error: null };
    } else if (status === "failed") {
      const error = asCodexRecord(turn.error);
      this.turnOutcome = { error: new Error(String(error.message || "Codex turn failed.")) };
    } else if (status === "interrupted") {
      this.turnOutcome = { error: new Error("Codex turn was interrupted.") };
    } else {
      this.turnOutcome = { error: new Error(`Codex turn/completed returned unexpected status: ${status}`) };
    }
    this.flushTurnOutcome();
  }

  private flushTurnOutcome(): void {
    if (!this.turnOutcome || !this.turnResolve || !this.turnReject) return;
    const outcome = this.turnOutcome;
    this.turnOutcome = null;
    if (outcome.error) this.turnReject(outcome.error);
    else this.turnResolve();
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    if (this.turnReject) this.turnReject(error);
    else this.turnOutcome = { error };
  }
}

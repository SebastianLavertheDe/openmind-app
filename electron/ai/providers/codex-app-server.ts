import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type { AiEvent } from "../../../shared/contracts";
import type { ProviderYamlEntry } from "../../../shared/providers-yaml";
import { AUTO_MODEL } from "../../../shared/model-catalog";
import type { ProviderAdapter, ProviderRunContext } from "./types";
import { canAutoApprove, classifyApproval } from "./types";
import { killProcessTree, parseWslPath, spawnInDirectory, spawnNativeInDirectory, toWslPath } from "../process-utils";
import { browserEvidenceInstructions, buildCodexBrowserConfig } from "../browser-evidence";
import { buildProviderSkillContext } from "./skill-bridge";
import { resolveAppToolExecutable } from "../../install/cli-installer-service";
import { resolveCliProvider } from "../../config/providers-yaml";
import { fileReferenceInstructions, openmindFilesystemInstructions, projectSessionInstructions } from "../scheduler-prompts";
import { resolvePathInsideRoot } from "../scheduler-paths";

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
    const serviceProvider = resolveCliProvider("codex", context.session.serviceProviderId ?? null, context.session.serviceProviderRevision ?? null);
    const child = spawnCodex(context, serviceProvider);
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
        clientInfo: { name: "openmind-desktop", title: "OpenMind", version: "1.0.0" },
        capabilities: { experimentalApi: true }
      });
      rpc.notify("initialized", {});
      const cwd = providerCwd(context);
      const openmindRoot = providerOpenmindRoot(context);
      const projectScoped = context.session.scope?.type === "project-task";
      if (projectScoped && context.session.permissionProfile !== "read-only") {
        throw new Error("Project Codex 会话必须使用只读权限配置。");
      }
      if (projectScoped && context.skillInvocation) {
        throw new Error("Project Codex 会话不允许调用全局 Skill。");
      }
      const browserConfig = projectScoped ? null : buildCodexBrowserConfig(context.provider, context.cwd, context.browserAutomation);
      const hostConfig = projectScoped ? buildProjectCodexConfig() : buildWorkspaceBoundaryCodexConfig(context);
      const genericConfig = mergeCodexConfigs(browserConfig, hostConfig);
      const browserInstructions = projectScoped ? "" : browserEvidenceInstructions(context.browserAutomation);
      const projectInstructions = projectSessionInstructions(context.session);
      const developerInstructions = [
        openmindFilesystemInstructions(openmindRoot, projectScoped),
        projectInstructions,
        fileReferenceInstructions(),
        browserInstructions
      ].filter(Boolean).join("\n\n");
      const threadOptions = {
        ...(genericConfig ? { config: genericConfig } : {}),
        runtimeWorkspaceRoots: [openmindRoot],
        ...(developerInstructions ? { developerInstructions } : {})
      };
      const sandbox = projectScoped ? "read-only" : "danger-full-access";
      const threadResult = context.session.providerSessionId
        ? await rpc.request("thread/resume", {
          threadId: context.session.providerSessionId,
          cwd,
          approvalPolicy: projectScoped ? "never" : "on-request",
          approvalsReviewer: "user",
          sandbox,
          ...threadOptions
        })
        : await rpc.request("thread/start", {
          cwd,
          approvalPolicy: projectScoped ? "never" : "on-request",
          approvalsReviewer: "user",
          sandbox,
          serviceName: "openmind-desktop",
          ...threadOptions
        });
      const thread = threadResult.thread as { id?: string } | undefined;
      if (!thread?.id) throw new Error("Codex App Server 未返回 thread id。");
      context.updateProviderSession(thread.id);
      let nativeSkill: CodexNativeSkill | null = null;
      if (context.skillInvocation) {
        if (!context.skillBridge) throw new Error("Codex 会话只允许应用已校验的 Installed Skill。");
        nativeSkill = {
          name: context.skillBridge.id,
          path: context.skillBridge.skillPath,
          enabled: true
        };
      }
      if (context.skillInvocation && !nativeSkill) {
        throw new Error(`Codex 没有在 ${cwd} 发现 Skill：${context.skillInvocation.name}。请确认 .claude/skills 或 .agents/skills 中存在对应的 SKILL.md。`);
      }
      const collaborationMode = buildCodexCollaborationMode(context, serviceProvider);
      await rpc.request("turn/start", {
        threadId: thread.id,
        cwd,
        approvalPolicy: projectScoped ? "never" : "on-request",
        approvalsReviewer: "user",
        runtimeWorkspaceRoots: [openmindRoot],
        sandboxPolicy: projectScoped ? { type: "readOnly" } : { type: "dangerFullAccess" },
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
    if (context.session.scope?.type === "project-task") {
      const availableDecisions = Array.isArray(params.availableDecisions) ? params.availableDecisions : null;
      return {
        decision: legacyCommand || legacyFile
          ? "denied"
          : selectCodexApprovalDecision("decline", availableDecisions)
      };
    }
    if ((modernFile || legacyFile) && firstProtectedApprovalPath(context, params)) {
      const availableDecisions = Array.isArray(params.availableDecisions) ? params.availableDecisions : null;
      return {
        decision: legacyFile
          ? "denied"
          : selectCodexApprovalDecision("decline", availableDecisions)
      };
    }
    // Native command requests cannot be made path-safe by approving a command
    // string. Keep those denied; filesystem tools are checked separately.
    if (modernCommand || legacyCommand) {
      const availableDecisions = Array.isArray(params.availableDecisions) ? params.availableDecisions : null;
      return { decision: legacyCommand ? "denied" : selectCodexApprovalDecision("decline", availableDecisions) };
    }
    for (const candidate of [params.cwd, params.grantRoot]) {
      if (typeof candidate !== "string" || !candidate.trim()) continue;
      try {
        const target = path.isAbsolute(candidate.trim()) ? candidate.trim() : path.resolve(context.cwd, candidate.trim());
        resolvePathInsideRoot(context.openmindRoot, target);
      } catch {
        const availableDecisions = Array.isArray(params.availableDecisions) ? params.availableDecisions : null;
        return { decision: legacyFile ? "denied" : selectCodexApprovalDecision("decline", availableDecisions) };
      }
    }
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

function firstProtectedApprovalPath(
  context: Pick<ProviderRunContext, "cwd" | "protectedPaths">,
  params: Record<string, unknown>
): string | null {
  const candidates = [params.grantRoot, params.path, params.filePath]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim());
  const listed = Array.isArray(params.paths)
    ? params.paths.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())
    : [];
  for (const candidate of [...candidates, ...listed]) {
    const target = path.isAbsolute(candidate) ? candidate : path.resolve(context.cwd, candidate);
    for (const protectedRoot of context.protectedPaths ?? []) {
      try {
        resolvePathInsideRoot(protectedRoot, target, "not-protected");
        return candidate;
      } catch {
        // Outside this write-protected root.
      }
    }
  }
  return null;
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
export function buildCodexCollaborationMode(
  context: Pick<ProviderRunContext, "session" | "provider" | "providerModel">,
  serviceProvider: ProviderYamlEntry | null = null
): Record<string, unknown> | null {
  const model = context.providerModel && context.providerModel !== AUTO_MODEL
    ? context.providerModel
    : serviceProvider?.model || context.provider.detectedModel;
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

// Intentionally collision-resistant: Codex recursively merges config tables,
// so a common id could retain user-defined sibling headers/auth fields.
export const CODEX_MANAGED_PROVIDER_ID = "openmind_managed_6f1b38d4b0e94c6a";
export const CODEX_MANAGED_API_KEY_ENV = "OPENMIND_CODEX_API_KEY";

/** Provider-owned discovery stays disabled even though process sandboxing is off. */
export function buildProjectCodexConfig(): Record<string, unknown> {
  return {
    project_doc_max_bytes: 0,
    project_root_markers: [],
    web_search: "disabled",
    notify: [],
    features: {
      apps: false,
      hooks: false,
      memories: false,
      goals: false,
      multi_agent: false,
      plugins: false,
      skill_search: false,
      skill_mcp_dependency_install: false
    },
    // Project content is untrusted. Do not let repo-local or user-installed
    // Skills become model instructions even though this run uses an isolated
    // CODEX_HOME: Codex also discovers Skills from the Project and ~/.agents.
    skills: { include_instructions: false },
    apps: { _default: { enabled: false } }
  };
}

/**
 * Generic Workspace runs use the same provider-discovery hardening as Project
 * runs. Filesystem admission is owned by OpenMind instead of a Codex named
 * permission profile or sandbox policy.
 */
export function buildWorkspaceBoundaryCodexConfig(
  context: Pick<ProviderRunContext, "session">
): Record<string, unknown> | null {
  if (context.session.scope?.type === "project-task") return null;
  return {
    project_doc_max_bytes: 0,
    project_root_markers: [],
    web_search: "disabled",
    notify: [],
    features: {
      apps: false,
      hooks: false,
      memories: false,
      goals: false,
      multi_agent: false,
      plugins: false,
      skill_search: false,
      skill_mcp_dependency_install: false
    },
    skills: { include_instructions: false },
    apps: { _default: { enabled: false } }
  };
}

function mergeCodexConfigs(...configs: Array<Record<string, unknown> | null>): Record<string, unknown> | null {
  const present = configs.filter((value): value is Record<string, unknown> => Boolean(value));
  if (present.length === 0) return null;
  return Object.assign({}, ...present);
}

/** 构造 `codex app-server` 启动参数，并把选中的 Responses Provider 映射为临时 config 覆盖。 */
export function buildCodexAppServerArgs(
  providerModel: string | null | undefined,
  serviceProvider: ProviderYamlEntry | null = null
): string[] {
  const args = ["app-server"];
  const model = providerModel && providerModel !== AUTO_MODEL
    ? providerModel
    : serviceProvider?.model;
  if (model) {
    // codex 支持 `-c key=value` 覆盖 ~/.codex/config.toml，值按 TOML 解析、失败则按字面量。
    args.push("-c", `model=${tomlString(model)}`);
  }
  if (serviceProvider) {
    if (serviceProvider.protocol !== "openai-responses") {
      throw new Error("Codex CLI 只能使用 openai-responses Provider。");
    }
    if (serviceProvider.tlsPolicy !== "verify") {
      throw new Error("Codex CLI 托管 Provider 仅支持 tlsPolicy: verify。");
    }
    args.push(
      "-c", `model_provider=${tomlString(CODEX_MANAGED_PROVIDER_ID)}`,
      "-c", `model_providers.${CODEX_MANAGED_PROVIDER_ID}.name=${tomlString(serviceProvider.name)}`,
      "-c", `model_providers.${CODEX_MANAGED_PROVIDER_ID}.base_url=${tomlString(codexBaseUrl(serviceProvider.baseUrl))}`,
      "-c", `model_providers.${CODEX_MANAGED_PROVIDER_ID}.wire_api=${tomlString("responses")}`,
      "-c", `model_providers.${CODEX_MANAGED_PROVIDER_ID}.requires_openai_auth=false`,
      // The app-server needs the credential, but model-invoked shell commands
      // must not inherit KEY/SECRET/TOKEN variables. Enabling Codex's built-in
      // filter preserves any user-defined exclude/include_only policy.
      "-c", "shell_environment_policy.ignore_default_excludes=false",
      // Hooks and legacy notify commands inherit the app-server environment
      // outside the shell policy. Disable both for managed credentials.
      "-c", "features.codex_hooks=false",
      "-c", "notify=[]"
    );
    args.push(
      "-c",
      serviceProvider.authMode === "x-api-key"
        ? `model_providers.${CODEX_MANAGED_PROVIDER_ID}.env_http_headers={ ${tomlString("X-API-Key")} = ${tomlString(CODEX_MANAGED_API_KEY_ENV)} }`
        : `model_providers.${CODEX_MANAGED_PROVIDER_ID}.env_key=${tomlString(CODEX_MANAGED_API_KEY_ENV)}`
    );
  }
  return args;
}

export function codexProviderEnvironment(serviceProvider: ProviderYamlEntry): Record<string, string> {
  const environment: Record<string, string> = { [CODEX_MANAGED_API_KEY_ENV]: serviceProvider.apiKey };
  if (serviceProvider.proxyPolicy === "explicit" && serviceProvider.proxyUrl) {
    Object.assign(environment, {
      HTTP_PROXY: serviceProvider.proxyUrl,
      HTTPS_PROXY: serviceProvider.proxyUrl,
      http_proxy: serviceProvider.proxyUrl,
      https_proxy: serviceProvider.proxyUrl,
      NO_PROXY: "",
      no_proxy: "",
      ALL_PROXY: "",
      all_proxy: ""
    });
  } else if (serviceProvider.proxyPolicy === "disabled") {
    Object.assign(environment, {
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      http_proxy: "",
      https_proxy: "",
      ALL_PROXY: "",
      all_proxy: "",
      NO_PROXY: "*",
      no_proxy: "*"
    });
  }
  return environment;
}

function spawnCodex(context: ProviderRunContext, serviceProvider: ProviderYamlEntry | null): ChildProcessWithoutNullStreams {
  const args = buildCodexAppServerArgs(context.providerModel, serviceProvider);
  const isolatedEnvironment = prepareIsolatedCodexEnvironment(context);
  const environment = {
    ...(serviceProvider ? codexProviderEnvironment(serviceProvider) : {}),
    ...isolatedEnvironment
  };
  const hasEnvironment = Object.keys(environment).length > 0;
  // A one-click installed codex lives in the app-private tools/bin; prefer it
  // over the bare name so runs work without a shell PATH entry.
  const command = context.provider.runtime === "wsl" ? "codex" : resolveAppToolExecutable("codex") || "codex";
  if (context.provider.runtime === "wsl" && hasEnvironment) {
    // WSLENV forwards the credential and isolated CODEX_HOME via the child
    // environment, keeping both out of the visible wsl.exe command line.
    return spawnInDirectory(context.cwd, command, args, {
      env: {
        ...environment,
        WSLENV: mergeWslenv(process.env.WSLENV, Object.keys(environment!))
      }
    });
  }
  return context.provider.runtime === "wsl"
    ? spawnInDirectory(context.cwd, command, args)
    : spawnNativeInDirectory(context.cwd, command, args, hasEnvironment ? { env: environment } : {});
}

function prepareIsolatedCodexEnvironment(context: ProviderRunContext): Record<string, string> {
  if (!context.stateRoot) {
    throw new Error("Codex 隔离目录尚未初始化。");
  }
  const parsedWsl = context.provider.runtime === "wsl" ? parseWslPath(context.cwd) : null;
  const runtimeId = parsedWsl
    ? `wsl-${crypto.createHash("sha256").update(parsedWsl.distro.toLocaleLowerCase()).digest("hex").slice(0, 12)}`
    : "native";
  const scopeDirectory = context.session.scope?.type === "project-task" ? "project-codex" : "workspace-codex";
  const hostHome = path.join(context.stateRoot, ".openmind", "ai", scopeDirectory, runtimeId);
  fs.mkdirSync(hostHome, { recursive: true, mode: 0o700 });
  sanitizeCodexHome(hostHome);

  if (parsedWsl && process.platform === "win32") {
    const providerHome = toWslPath(hostHome, parsedWsl.distro);
    const wslHome = String(execFileSync("wsl.exe", [
      "-d", parsedWsl.distro,
      "--exec", "/bin/sh", "-lc", 'printf "%s" "$HOME"'
    ], {
      windowsHide: true,
      timeout: 10_000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    })).trim();
    if (!wslHome.startsWith("/")) throw new Error("无法解析 WSL Codex 用户目录。");
    execFileSync("wsl.exe", ["-d", parsedWsl.distro, "--exec", "/bin/mkdir", "-p", providerHome], {
      windowsHide: true,
      timeout: 10_000,
      stdio: "ignore"
    });
    const sourceAuth = path.posix.join(wslHome, ".codex", "auth.json");
    const targetAuth = path.posix.join(providerHome, "auth.json");
    try {
      execFileSync("wsl.exe", ["-d", parsedWsl.distro, "--exec", "/usr/bin/test", "-f", sourceAuth], {
        windowsHide: true,
        timeout: 10_000,
        stdio: "ignore"
      });
      execFileSync("wsl.exe", ["-d", parsedWsl.distro, "--exec", "/bin/cp", sourceAuth, targetAuth], {
        windowsHide: true,
        timeout: 10_000,
        stdio: "ignore"
      });
    } catch {
      // Managed providers carry their credential in the child environment. A
      // native ChatGPT login without auth.json will produce Codex's normal
      // authentication diagnostic rather than falling back to user config.
    }
    return { CODEX_HOME: providerHome };
  }

  const sourceAuth = path.join(os.homedir(), ".codex", "auth.json");
  if (fs.existsSync(sourceAuth)) {
    const targetAuth = path.join(hostHome, "auth.json");
    fs.copyFileSync(sourceAuth, targetAuth);
    try { fs.chmodSync(targetAuth, 0o600); } catch { /* Windows ACLs are host-managed. */ }
  }
  return { CODEX_HOME: hostHome };
}

/**
 * The Project Codex home is app-owned and must contain credentials only.
 * Remove stale or externally planted discovery/config surfaces before every
 * launch so they cannot re-enable MCP, Skills, plugins, hooks, or rules.
 */
function sanitizeCodexHome(projectCodexHome: string): void {
  for (const entry of [
    "config.toml",
    "config.json",
    "AGENTS.md",
    "instructions.md",
    ".mcp.json",
    "mcp.json",
    "skills",
    "commands",
    "prompts",
    "plugins",
    "hooks",
    "rules",
    "memories",
    "goals",
    ".agents",
    ".claude",
    ".codex-plugin"
  ]) {
    fs.rmSync(path.join(projectCodexHome, entry), { recursive: true, force: true });
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function codexBaseUrl(value: string): string {
  return value.replace(/\/+$/, "").replace(/\/responses$/i, "");
}

function mergeWslenv(current: string | undefined, names: string[]): string {
  const replacements = new Set(names.map((name) => name.toUpperCase()));
  const entries = (current || "").split(":").filter(Boolean).filter((entry) => (
    !replacements.has(entry.split("/")[0].toUpperCase())
  ));
  return [...entries, ...names].join(":");
}

function providerCwd(context: ProviderRunContext): string {
  if (context.provider.runtime !== "wsl") return context.cwd;
  const parsed = parseWslPath(context.cwd);
  return parsed ? parsed.linuxPath : toWslPath(context.cwd);
}

function providerOpenmindRoot(context: ProviderRunContext): string {
  if (context.provider.runtime !== "wsl") return context.openmindRoot;
  const parsed = parseWslPath(context.openmindRoot);
  return parsed ? parsed.linuxPath : toWslPath(context.openmindRoot);
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
  context: Pick<ProviderRunContext, "prompt" | "skillInvocation" | "skillBridge">,
  nativeSkill: CodexNativeSkill | null
): Array<Record<string, unknown>> {
  if (!context.skillInvocation) {
    return [{ type: "text", text: context.prompt, text_elements: [] }];
  }
  if (!nativeSkill?.enabled) throw new Error(`Codex Skill 不可用：${context.skillInvocation.name}`);
  if (context.skillBridge) {
    return [{
      type: "text",
      text: [context.skillInvocation.prompt, buildProviderSkillContext(context.skillBridge)].filter(Boolean).join("\n\n"),
      text_elements: []
    }];
  }
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

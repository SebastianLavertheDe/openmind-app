import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { ProviderAdapter, ProviderPrewarmContext, ProviderRunContext } from "./types";
import { canAutoApprove, classifyApproval, isOutsideWorkspace } from "./types";
import { buildWslLoginCommand, decodeProcessOutput, resolveWslLoginExecutable, spawnInDirectory } from "../process-utils";
import type { AiEvent } from "../../../shared/contracts";
import type { ProviderYamlEntry } from "../../../shared/providers-yaml";
import { AUTO_MODEL } from "../../../shared/model-catalog";
import type { Options, SDKUserMessage, SpawnOptions, SpawnedProcess, WarmQuery } from "@anthropic-ai/claude-agent-sdk";
import {
  CLAUDE_BROWSER_EVIDENCE_TOOL,
  browserEvidenceInstructions,
  buildBrowserMcpProcess
} from "../browser-evidence";
import { buildClaudeSkillBridgeInstructions } from "./skill-bridge";
import { providerConfigurationRevision, resolveCliProvider } from "../../config/providers-yaml";
import { resolveAppToolExecutable } from "../../install/cli-installer-service";

/** 有图片附件时，把 prompt 转成 SDK 多模态 user message 流（image blocks + text block）。 */
async function* claudeImageMessageStream(
  prompt: string,
  images: ProviderRunContext["images"]
): AsyncGenerator<SDKUserMessage> {
  const content: unknown[] = [];
  for (const image of images) {
    try {
      const data = fs.readFileSync(image.path, "base64");
      content.push({ type: "image", source: { type: "base64", data, media_type: image.mediaType } });
    } catch (err) {
      console.warn(`[image] 读取 ${image.path} 失败，跳过：${err}`);
    }
  }
  content.push({ type: "text", text: prompt });
  yield { type: "user", message: { role: "user", content: content as never } } as unknown as SDKUserMessage;
}

const CLAUDE_WORKBENCH_TOOLS = [
  "Read", "Write", "Edit", "Bash", "PowerShell", "Glob", "Grep", "NotebookEdit", "WebFetch", "WebSearch",
  "EnterPlanMode", "ExitPlanMode", "TodoWrite", "TaskCreate", "TaskGet", "TaskUpdate", "TaskList"
];
export const CLAUDE_SETTING_SOURCES = ["user", "project"] as const;
export const CLAUDE_SKILL_SELECTION = "all" as const;

export type ClaudePermissionDecision =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string }
  | {
      behavior: "ask";
      category: "command" | "file-change" | "delete" | "outside-workspace" | "network" | "elevation" | "tool";
      title: string;
      command: string;
      paths: string[];
    };

/**
 * Resolves the parts of a `canUseTool` decision that need no user interaction.
 * The SDK's runtime schema requires an allow result to carry `updatedInput` as a
 * record — omitting it makes every approved tool call fail validation and surface
 * as a ZodError, which the model then retries in a loop.
 */
export function decideClaudePermission(
  runContext: ProviderRunContext | null,
  toolName: string,
  input: Record<string, unknown>,
  blockedPath?: string
): ClaudePermissionDecision {
  if (!runContext) return { behavior: "deny", message: "Claude Code 预热进程尚未绑定到运行。" };
  if (toolName === CLAUDE_BROWSER_EVIDENCE_TOOL && runContext.browserAutomation?.enabled) {
    return { behavior: "allow", updatedInput: input };
  }
  if (runContext.session.permissionProfile === "read-only" && /write|edit|bash|notebook/i.test(toolName)) {
    return { behavior: "deny", message: "当前会话为只读模式。" };
  }
  const command = String(input.command || input.file_path || "");
  const outsideBlockedPath = blockedPath && isOutsideWorkspace(runContext.cwd, blockedPath) ? blockedPath : undefined;
  const classified = outsideBlockedPath
    ? { category: "outside-workspace" as const, title: "请求访问项目目录外路径" }
    : classifyApproval(command, toolName);
  const paths = typeof input.file_path === "string" ? [input.file_path] : [];
  if (canAutoApprove(runContext, classified.category, command, paths)) return { behavior: "allow", updatedInput: input };
  return { behavior: "ask", category: classified.category, title: classified.title, command, paths };
}
type ClaudeSemanticEvent = { kind: AiEvent["kind"]; payload: Record<string, unknown> };

const CLAUDE_FINAL_TRANSPARENT_TOOLS = new Set(["TaskUpdate", "TodoWrite"]);

type ClaudeFinalBridge = {
  toolsByItemId: Map<string, string>;
  pendingItemIds: Set<string>;
  completedItemIds: Set<string>;
};

function isClaudeAssistantCommentary(event: ClaudeSemanticEvent | undefined): boolean {
  return event?.kind === "assistant-message" && event.payload.phase === "commentary";
}

function isClaudeFinalMessage(event: ClaudeSemanticEvent): boolean {
  return event.kind === "assistant-message" && event.payload.phase === "final";
}

function equivalentClaudeAssistantText(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => String(value || "").replace(/\r\n?/g, "\n").trim();
  return normalize(left) === normalize(right);
}

function joinClaudeAssistantText(parts: string[]): string {
  const meaningful = parts.filter((part) => part.trim());
  return meaningful.reduce((combined, part) => {
    if (!combined) return part;
    if (combined.endsWith("\n\n") || part.startsWith("\n\n")) return combined + part;
    if (combined.endsWith("\n") && part.startsWith("\n")) return combined + part;
    if (combined.endsWith("\n") || part.startsWith("\n")) return `${combined}\n${part}`;
    return `${combined}\n\n${part}`;
  }, "");
}

function claudeToolEventFailed(event: ClaudeSemanticEvent): boolean {
  if (event.payload.isError === true) return true;
  const output = event.payload.output;
  return Boolean(output && typeof output === "object" && !Array.isArray(output)
    && (output as Record<string, unknown>).success === false);
}
type ClaudeRunContextGetter = () => ProviderRunContext | null;
type WarmSlot = {
  key: string;
  ownerSessionId: string | null;
  promise: Promise<WarmQuery>;
  activeContext: ProviderRunContext | null;
  stderr: string;
};

export class ClaudeAgentSdkAdapter implements ProviderAdapter {
  public readonly needsTurnContext = true;
  private readonly warmSlots = new Map<string, WarmSlot>();

  async prewarm(context: ProviderPrewarmContext): Promise<boolean> {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    const serviceProvider = context.session
      ? resolveCliProvider("claude", context.session.serviceProviderId ?? null, context.session.serviceProviderRevision ?? null)
      : resolveCliProvider("claude");
    const key = warmKey(context.session?.id || null, context.provider.id, context.cwd, context.permissionProfile, context.interactionMode || "default", context.providerSessionId, serviceProvider);
    const existing = this.warmSlots.get(key);
    if (existing) return true;
    // A manually edited providers.yaml may change a draft before Main has sent
    // refresh-providers. Never retain the obsolete credential-bearing process.
    if (!context.session) this.disposeDraftWarmSlots();
    let slot!: WarmSlot;
    const captureStderr = (text: string) => { slot.stderr = appendBounded(slot.stderr, text); };
    slot = {
      key,
      ownerSessionId: context.session?.id || null,
      activeContext: null,
      stderr: "",
      promise: sdk.startup({
        options: this.createOptions(
          {
            provider: context.provider,
            cwd: context.cwd,
            permissionProfile: context.permissionProfile,
            interactionMode: context.interactionMode || "default",
            providerSessionId: context.providerSessionId,
            providerModel: context.providerModel,
            serviceProvider,
            browserAutomation: context.browserAutomation
          },
          () => slot.activeContext,
          captureStderr
        ),
        initializeTimeoutMs: 45_000
      })
    };
    this.warmSlots.set(key, slot);
    slot.promise.catch(() => {
      if (this.warmSlots.get(key) === slot) this.warmSlots.delete(key);
    });
    return true;
  }

  disposeSession(sessionId: string): void {
    for (const [key, slot] of this.warmSlots) {
      if (slot.ownerSessionId !== sessionId) continue;
      this.warmSlots.delete(key);
      void slot.promise.then((warm) => warm.close()).catch(() => undefined);
    }
  }

  disposeWarmSlots(): void {
    for (const [key, slot] of this.warmSlots) {
      this.warmSlots.delete(key);
      void slot.promise.then((warm) => warm.close()).catch(() => undefined);
    }
  }

  private disposeDraftWarmSlots(): void {
    for (const [key, slot] of this.warmSlots) {
      if (slot.ownerSessionId !== null) continue;
      this.warmSlots.delete(key);
      void slot.promise.then((warm) => warm.close()).catch(() => undefined);
    }
  }

  async run(context: ProviderRunContext): Promise<void> {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    const prompt = context.images.length ? claudeImageMessageStream(context.prompt, context.images) : context.prompt;
    let stderr = "";
    const captureStderr = (text: string) => { stderr = appendBounded(stderr, text); };
    // A warm Claude process was created without a per-run SkillStore bridge;
    // never reuse it for an installed Agent or its instructions could fall
    // back to project-local `.claude/skills`.
    let claimedWarm = context.skillBridge ? null : this.claimWarmSlot(context);
    const query = claimedWarm
      ? await (async () => {
        const slot = claimedWarm;
        if (!slot) throw new Error("Claude Code 预热进程已失效。");
        try {
          slot.activeContext = context;
          const warmed = await waitForWarmSlot(slot, context.signal);
          return warmed.query(prompt);
        } catch (error) {
          claimedWarm = null;
          slot.activeContext = null;
          if (context.signal.aborted) {
            void slot.promise.then((warmQuery) => warmQuery.close()).catch(() => undefined);
            throw error;
          }
          return sdk.query({
            prompt,
            options: this.createOptions(runOptionsContext(context), () => context, captureStderr)
          });
        }
      })()
      : sdk.query({
        prompt: context.prompt,
        options: this.createOptions(runOptionsContext(context), () => context, captureStderr)
      });
    context.signal.addEventListener("abort", () => {
      void query.interrupt().catch(() => undefined);
      query.close();
    }, { once: true });
    let pendingAssistantCandidate: ClaudeSemanticEvent | null = null;
    let pendingAssistantParts: string[] = [];
    let finalBridge: ClaudeFinalBridge | null = null;
    const clearPendingAssistantCandidate = () => {
      pendingAssistantCandidate = null;
      pendingAssistantParts = [];
      finalBridge = null;
    };
    const emitPendingAssistantCandidate = async () => {
      if (!pendingAssistantCandidate) return;
      const candidate = {
        ...pendingAssistantCandidate,
        payload: {
          ...pendingAssistantCandidate.payload,
          text: joinClaudeAssistantText(pendingAssistantParts)
        }
      };
      clearPendingAssistantCandidate();
      await context.emit(candidate.kind, candidate.payload);
    };
    const setPendingAssistantCandidate = (event: ClaudeSemanticEvent) => {
      pendingAssistantCandidate = event;
      pendingAssistantParts = [String(event.payload.text || "")];
      finalBridge = null;
    };
    const appendPendingAssistantCandidate = (event: ClaudeSemanticEvent) => {
      const text = String(event.payload.text || "");
      if (!equivalentClaudeAssistantText(pendingAssistantParts.at(-1), text)) pendingAssistantParts.push(text);
    };
    const bridgeCanFinalize = () => Boolean(finalBridge
      && finalBridge.pendingItemIds.size === 0
      && finalBridge.completedItemIds.size > 0);
    const preservePendingAcrossFinalTransparentEvent = (event: ClaudeSemanticEvent): boolean => {
      if (!pendingAssistantCandidate) return false;
      const itemId = String(event.payload.itemId || "");
      const tool = String(event.payload.tool || event.payload.sourceTool || "");
      if (event.kind === "tool-start") {
        if (!itemId || !CLAUDE_FINAL_TRANSPARENT_TOOLS.has(tool)) return false;
        finalBridge ||= { toolsByItemId: new Map(), pendingItemIds: new Set(), completedItemIds: new Set() };
        finalBridge.toolsByItemId.set(itemId, tool);
        finalBridge.pendingItemIds.add(itemId);
        return true;
      }
      if (!finalBridge) return false;
      if (event.kind === "tool-output") {
        return Boolean(itemId && finalBridge.toolsByItemId.get(itemId) === tool);
      }
      if (event.kind === "tool-complete") {
        if (!itemId || finalBridge.toolsByItemId.get(itemId) !== tool || claudeToolEventFailed(event)) return false;
        finalBridge.pendingItemIds.delete(itemId);
        finalBridge.completedItemIds.add(itemId);
        return true;
      }
      if (event.kind === "todo") {
        return Boolean(itemId && finalBridge.toolsByItemId.get(itemId) === tool);
      }
      return ["assistant-delta", "reasoning-delta", "reasoning-summary"].includes(event.kind);
    };
    try {
      let reasoning = "";
      const normalizerState = createClaudeNormalizerState();
      for await (const message of query) {
        const value = message as unknown as Record<string, unknown>;
        const normalized = normalizeClaudeMessage(value, normalizerState);
        if (normalized.sessionId) context.updateProviderSession(normalized.sessionId);
        const ordered = orderClaudeEvents(normalized.events, reasoning);
        reasoning = ordered.pendingReasoning;
        for (let index = 0; index < ordered.events.length; index++) {
          const event = ordered.events[index];
          if (isClaudeAssistantCommentary(event)) {
            const textParts = [String(event.payload.text || "")];
            while (isClaudeAssistantCommentary(ordered.events[index + 1])) {
              index++;
              textParts.push(String(ordered.events[index].payload.text || ""));
            }
            const candidate = {
              ...event,
              payload: { ...event.payload, text: textParts.join("") }
            };
            if (bridgeCanFinalize()) appendPendingAssistantCandidate(candidate);
            else {
              await emitPendingAssistantCandidate();
              setPendingAssistantCandidate(candidate);
            }
            continue;
          }
          if (isClaudeFinalMessage(event)) {
            let pendingText = joinClaudeAssistantText(pendingAssistantParts);
            const duplicateCandidate = pendingAssistantCandidate
              && equivalentClaudeAssistantText(pendingText, event.payload.text);
            if (pendingAssistantCandidate && bridgeCanFinalize()) {
              const repeatsLastBridgedPart = equivalentClaudeAssistantText(pendingAssistantParts.at(-1), event.payload.text);
              if (!duplicateCandidate && !repeatsLastBridgedPart) {
                pendingAssistantParts.push(String(event.payload.text || ""));
                pendingText = joinClaudeAssistantText(pendingAssistantParts);
              }
              const bridgedFinal = { ...event, payload: { ...event.payload, text: pendingText } };
              clearPendingAssistantCandidate();
              await context.emit(bridgedFinal.kind, bridgedFinal.payload);
              continue;
            }
            if (pendingAssistantCandidate && !duplicateCandidate) await emitPendingAssistantCandidate();
            else clearPendingAssistantCandidate();
          } else if (preservePendingAcrossFinalTransparentEvent(event)) {
            // TaskUpdate/TodoWrite only record provider work state. Keep the
            // preceding answer candidate pending until the authoritative result,
            // while still emitting their tool and Todo trace events normally.
          } else {
            // A tool, another reasoning block, or a terminal error proves that
            // the buffered text was process commentary rather than the final reply.
            await emitPendingAssistantCandidate();
          }
          if (event.kind === "system" && event.payload.subtype === "interaction_mode") {
            context.updateInteractionMode?.(event.payload.mode === "plan" ? "plan" : "default");
          }
          await context.emit(event.kind, event.payload);
        }
        if (value.type === "result" && (value.is_error === true || String(value.subtype || "").startsWith("error_"))) {
          const errors = Array.isArray(value.errors) ? value.errors.map(String).filter(Boolean) : [];
          const terminalError = errors.join("; ")
            || (typeof value.result === "string" ? value.result : "")
            || String(value.subtype || "Claude Code run failed");
          throw new Error(terminalError);
        }
      }
      await emitPendingAssistantCandidate();
      if (reasoning) await context.emit("reasoning-summary", { text: reasoning, source: "claude-thinking" });
    } catch (error) {
      // Preserve a complete assistant frame if the SDK iterator or normalizer
      // fails before a semantic boundary. Never mask the original provider error.
      await emitPendingAssistantCandidate().catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      const detail = `${stderr}\n${claimedWarm?.stderr || ""}`.trim();
      throw new Error(detail && !message.includes(detail) ? `${message}\n${detail}` : message);
    } finally {
      if (claimedWarm) claimedWarm.activeContext = null;
    }
  }

  private createOptions(
    context: Pick<ProviderRunContext, "provider" | "cwd"> & {
      permissionProfile: ProviderRunContext["session"]["permissionProfile"];
      interactionMode: ProviderRunContext["session"]["interactionMode"];
      providerSessionId: string | null;
      providerModel: string;
      serviceProvider: ProviderYamlEntry | null;
      browserAutomation: ProviderRunContext["browserAutomation"];
      skillBridge?: ProviderRunContext["skillBridge"];
    },
    getRunContext: ClaudeRunContextGetter,
    captureStderr: (text: string) => void
  ): Options {
    if (context.serviceProvider && context.provider.runtime === "wsl") {
      assertManagedClaudeVersion(context.provider.version);
    }
    const nativeExecutable = context.provider.runtime === "native" && process.platform === "win32"
      ? context.serviceProvider ? resolveNativeClaudeExecutable() : resolveClaudeExecutable()
      : null;
    const browserServer = buildBrowserMcpProcess(context.provider, context.cwd, context.browserAutomation);
    const browserInstructions = browserEvidenceInstructions(context.browserAutomation);
    const skillBridgeInstructions = context.skillBridge ? buildClaudeSkillBridgeInstructions(context.skillBridge) : "";
    const systemAppend = [browserInstructions, skillBridgeInstructions].filter(Boolean).join("\n\n");
    return {
      ...(context.providerModel && context.providerModel !== AUTO_MODEL
        ? { model: context.providerModel }
        : context.serviceProvider ? { model: context.serviceProvider.model } : {}),
      ...(context.serviceProvider ? { env: claudeProviderEnvironment(context.serviceProvider) } : {}),
      cwd: context.cwd,
      resume: context.providerSessionId || undefined,
      permissionMode: context.interactionMode === "plan" ? "plan" : "default",
      // An installed bridge may use user-level authentication/configuration,
      // but must not discover project-local skills. Its package instructions
      // are injected transiently below after Main-side boundary checks.
      settingSources: context.skillBridge ? ["user"] : [...CLAUDE_SETTING_SOURCES],
      skills: context.skillBridge ? [] : CLAUDE_SKILL_SELECTION,
      tools: CLAUDE_WORKBENCH_TOOLS,
      systemPrompt: { type: "preset", preset: "claude_code", ...(systemAppend ? { append: systemAppend } : {}) },
      ...(browserServer ? {
        mcpServers: {
          cctools_browser: {
            type: "stdio",
            command: browserServer.command,
            args: browserServer.args,
            env: browserServer.env,
            timeout: 90_000,
            alwaysLoad: true
          }
        }
      } : {}),
      sandbox: process.platform === "win32" && context.provider.runtime === "native"
        ? { enabled: false }
        : { enabled: true, allowUnsandboxedCommands: false },
      includePartialMessages: true,
      persistSession: true,
      stderr: captureStderr,
      ...(nativeExecutable ? { pathToClaudeCodeExecutable: nativeExecutable } : {}),
      ...(context.provider.runtime === "wsl"
        ? { spawnClaudeCodeProcess: (options: SpawnOptions) => spawnWslClaude(options, captureStderr) }
        : {}),
      canUseTool: async (toolName, input, options) => {
        const runContext = getRunContext();
        const prefetched = decideClaudePermission(runContext, toolName, input, options.blockedPath);
        if (prefetched.behavior === "allow") return { behavior: "allow", updatedInput: prefetched.updatedInput, toolUseID: options.toolUseID };
        if (prefetched.behavior === "deny") return { behavior: "deny", message: prefetched.message, toolUseID: options.toolUseID };
        if (!runContext) return { behavior: "deny", message: "Claude Code 预热进程尚未绑定到运行。", toolUseID: options.toolUseID };
        const approval = await runContext.requestApproval({
          providerRequestId: options.toolUseID,
          category: prefetched.category,
          title: prefetched.title,
          detail: prefetched.command || JSON.stringify(input),
          command: prefetched.command,
          paths: prefetched.paths
        });
        if (approval === "decline") return { behavior: "deny", message: "用户拒绝了该操作。", toolUseID: options.toolUseID };
        return { behavior: "allow", updatedInput: input, toolUseID: options.toolUseID };
      }
    };
  }

  private claimWarmSlot(context: ProviderRunContext): WarmSlot | null {
    const serviceProvider = resolveCliProvider("claude", context.session.serviceProviderId ?? null, context.session.serviceProviderRevision ?? null);
    const keys = [
      warmKey(context.session.id, context.provider.id, context.cwd, context.session.permissionProfile, context.session.interactionMode || "default", context.session.providerSessionId, serviceProvider)
    ];
    if (!context.session.providerSessionId) {
      keys.push(warmKey(null, context.provider.id, context.cwd, context.session.permissionProfile, context.session.interactionMode || "default", null, serviceProvider));
    }
    for (const key of keys) {
      const slot = this.warmSlots.get(key);
      if (!slot) continue;
      this.warmSlots.delete(key);
      return slot;
    }
    return null;
  }
}

function warmKey(sessionId: string | null, providerId: string, cwd: string, permissionProfile: string, interactionMode: string, providerSessionId: string | null, serviceProvider: ProviderYamlEntry | null): string {
  const serviceRevision = serviceProvider
    ? providerConfigurationRevision(serviceProvider)
    : "cli";
  return [sessionId || "draft", providerId, cwd, permissionProfile, interactionMode, providerSessionId || "", serviceRevision].join("\0");
}

function runOptionsContext(context: ProviderRunContext): Pick<ProviderRunContext, "provider" | "cwd"> & {
  permissionProfile: ProviderRunContext["session"]["permissionProfile"];
  interactionMode: ProviderRunContext["session"]["interactionMode"];
  providerSessionId: string | null;
  providerModel: string;
  serviceProvider: ProviderYamlEntry | null;
  browserAutomation: ProviderRunContext["browserAutomation"];
  skillBridge?: ProviderRunContext["skillBridge"];
} {
  return {
    provider: context.provider,
    cwd: context.cwd,
    permissionProfile: context.session.permissionProfile,
    interactionMode: context.session.interactionMode || "default",
    providerSessionId: context.session.providerSessionId,
    providerModel: context.providerModel,
    serviceProvider: resolveCliProvider("claude", context.session.serviceProviderId ?? null, context.session.serviceProviderRevision ?? null),
    browserAutomation: context.browserAutomation,
    skillBridge: context.skillBridge
  };
}

export function claudeProviderEnvironment(provider: ProviderYamlEntry): NodeJS.ProcessEnv {
  if (provider.protocol !== "anthropic-messages") {
    throw new Error("Claude Code 只能使用 anthropic-messages Provider。");
  }
  if (provider.tlsPolicy !== "verify") {
    throw new Error("Claude Code 托管 Provider 仅支持 tlsPolicy: verify。");
  }
  const environment: NodeJS.ProcessEnv = {
    ...process.env
  };
  scrubInheritedClaudeProviderEnvironment(environment, provider.proxyPolicy);
  Object.assign(environment, {
    ANTHROPIC_BASE_URL: provider.baseUrl.replace(/\/+$/, ""),
    ANTHROPIC_MODEL: provider.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: provider.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: provider.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: provider.model,
    CLAUDE_CODE_SUBAGENT_MODEL: provider.model,
    // Prevent user/project settings.json from replacing the host-selected
    // endpoint, credentials, model or proxy after this environment is built.
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1"
  });
  if (provider.authMode === "x-api-key") environment.ANTHROPIC_API_KEY = provider.apiKey;
  else environment.ANTHROPIC_AUTH_TOKEN = provider.apiKey;
  if (provider.proxyPolicy === "explicit" && provider.proxyUrl) {
    environment.HTTP_PROXY = provider.proxyUrl;
    environment.HTTPS_PROXY = provider.proxyUrl;
    environment.http_proxy = provider.proxyUrl;
    environment.https_proxy = provider.proxyUrl;
  } else if (provider.proxyPolicy === "disabled") {
    environment.NO_PROXY = "*";
    environment.no_proxy = "*";
  }
  return environment;
}

const CLAUDE_PROVIDER_ROUTE_ENV = new Set([
  "_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL",
  "CLAUDE_CODE_API_BASE_URL",
  "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
  "CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL",
  "CLAUDE_CODE_CUSTOM_OAUTH_URL",
  "CLAUDE_CODE_EXTRA_BODY",
  "CLAUDE_CODE_FORCE_BRIDGE",
  "CLAUDE_CODE_GB_BASE_URL",
  "CLAUDE_CODE_HFI_BEARER_TOKEN",
  "CLAUDE_CODE_HOST_AUTH_ENV_VAR",
  "CLAUDE_CODE_HOST_AUTH_REFRESH_TIMEOUT_MS",
  "CLAUDE_CODE_HOST_HTTP_PROXY_PORT",
  "CLAUDE_CODE_HOST_SOCKS_PROXY_PORT",
  "CLAUDE_CODE_HTTP_PROXY",
  "CLAUDE_CODE_HTTPS_PROXY",
  "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH",
  "CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH",
  "CLAUDE_CODE_SESSION_ACCESS_TOKEN",
  "CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH",
  "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
  "CLAUDE_CODE_SKIP_FOUNDRY_AUTH",
  "CLAUDE_CODE_SKIP_MANTLE_AUTH",
  "CLAUDE_CODE_SKIP_VERTEX_AUTH",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_CCR_V2",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_GATEWAY",
  "CLAUDE_CODE_USE_MANTLE",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR",
  "NODE_TLS_REJECT_UNAUTHORIZED"
]);

const STANDARD_PROXY_ENV = new Set(["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY"]);

function scrubInheritedClaudeProviderEnvironment(environment: NodeJS.ProcessEnv, proxyPolicy: ProviderYamlEntry["proxyPolicy"]): void {
  for (const key of Object.keys(environment)) {
    if (isClaudeProviderControlledEnv(key, proxyPolicy !== "system")) delete environment[key];
  }
}

function isClaudeProviderControlledEnv(key: string, includeStandardProxy: boolean): boolean {
  const normalized = key.toUpperCase();
  return normalized.startsWith("ANTHROPIC_")
    || normalized.startsWith("AGENT_PROXY_")
    || normalized.startsWith("CLAUDE_CODE_OAUTH_")
    || normalized.startsWith("CLAUDE_CODE_PROXY_")
    || normalized.startsWith("CLAUDE_CODE_CLIENT_")
    || normalized === "API_TOKEN"
    || normalized === "AWS_BEARER_TOKEN_BEDROCK"
    || CLAUDE_PROVIDER_ROUTE_ENV.has(normalized)
    || (includeStandardProxy && STANDARD_PROXY_ENV.has(normalized));
}

function waitForWarmSlot(slot: WarmSlot, signal: AbortSignal): Promise<WarmQuery> {
  if (signal.aborted) return Promise.reject(new Error("运行已取消。"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("运行已取消。"));
    signal.addEventListener("abort", onAbort, { once: true });
    slot.promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

type ClaudeToolUse = { name: string; input: Record<string, unknown> };
export type ClaudeNormalizerState = {
  toolUses: Map<string, ClaudeToolUse>;
  toolHistory: Map<string, ClaudeToolUse>;
};

export function createClaudeNormalizerState(): ClaudeNormalizerState {
  return { toolUses: new Map(), toolHistory: new Map() };
}

export function normalizeClaudeMessage(value: Record<string, unknown>, state: ClaudeNormalizerState = createClaudeNormalizerState()): {
  sessionId: string | null;
  events: ClaudeSemanticEvent[];
} {
  const events: ClaudeSemanticEvent[] = [];
  const sessionId = typeof value.session_id === "string" ? value.session_id : null;
  if (value.type === "assistant") {
    const content = ((value.message as Record<string, unknown> | undefined)?.content || []) as Array<Record<string, unknown>>;
    for (const block of content) {
      if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
        events.push({ kind: "reasoning-summary", payload: { text: block.thinking, source: "claude-thinking" } });
      }
      // Claude may split one API message across separate SDK frames (text
      // first, tool_use later), so this is provisional commentary. run() buffers
      // the latest text frame and reconciles it with the authoritative result.
      if (block.type === "text") events.push({ kind: "assistant-message", payload: { text: String(block.text || ""), phase: "commentary" } });
      if (block.type === "tool_use") {
        const itemId = String(block.id || "");
        const tool = String(block.name || "");
        const input = asClaudeRecord(block.input);
        if (itemId) {
          const call = { name: tool, input };
          state.toolUses.set(itemId, call);
          state.toolHistory.set(itemId, call);
        }
        events.push({ kind: "tool-start", payload: { tool, input, itemId } });
      }
    }
  } else if (value.type === "user") {
    const content = ((value.message as Record<string, unknown> | undefined)?.content || []) as Array<Record<string, unknown>>;
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      const itemId = String(block.tool_use_id || "");
      const call = state.toolUses.get(itemId);
      const output = structuredClaudeToolResult(value.tool_use_result, block.content);
      const isError = Boolean(block.is_error);
      events.push({ kind: "tool-complete", payload: { itemId, tool: call?.name, input: call?.input, output, isError } });
      if (!isError && call) events.push(...claudeToolSemanticEvents(call.name, call.input, output, itemId));
      state.toolUses.delete(itemId);
    }
  } else if (value.type === "stream_event") {
    const event = value.event as Record<string, unknown> | undefined;
    const delta = event?.delta as Record<string, unknown> | undefined;
    if (event?.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") {
      events.push({ kind: "assistant-delta", payload: { text: delta.text } });
    }
    if (event?.type === "content_block_delta" && delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
      events.push({ kind: "reasoning-delta", payload: { text: delta.thinking, source: "claude-thinking" } });
    }
  } else if (value.type === "result") {
    if (value.subtype === "success" && value.is_error !== true && typeof value.result === "string" && value.result.trim()) {
      events.push({ kind: "assistant-message", payload: { text: value.result, phase: "final" } });
    }
    events.push({ kind: "usage", payload: { usage: value.usage, cost: value.total_cost_usd, duration: value.duration_ms } });
  } else if (value.type === "tool_progress") {
    const itemId = String(value.tool_use_id || "");
    const call = state.toolUses.get(itemId) || state.toolHistory.get(itemId);
    events.push({
      kind: "tool-output",
      payload: {
        itemId,
        tool: String(value.tool_name || call?.name || ""),
        input: call?.input,
        elapsedTimeSeconds: value.elapsed_time_seconds,
        taskId: value.task_id,
        message: value
      }
    });
  } else if (value.type === "tool_use_summary") {
    const precedingItemIds = Array.isArray(value.preceding_tool_use_ids)
      ? value.preceding_tool_use_ids.map(String).filter(Boolean)
      : [];
    const itemId = precedingItemIds.slice().reverse().find((candidate) => state.toolHistory.has(candidate))
      || precedingItemIds.at(-1)
      || "";
    const call = state.toolHistory.get(itemId);
    events.push({
      kind: "tool-output",
      payload: {
        itemId,
        tool: call?.name,
        input: call?.input,
        text: typeof value.summary === "string" ? value.summary : "",
        precedingItemIds,
        message: value
      }
    });
  } else if (value.type === "system") {
    const subtype = String(value.subtype || "");
    if (subtype === "init") {
      events.push({
        kind: "system",
        payload: {
          text: "Claude Code 已初始化",
          subtype,
          model: value.model,
          version: value.claude_code_version,
          permissionMode: value.permissionMode
        }
      });
      if (value.permissionMode === "plan" || value.permissionMode === "default") {
        events.push({ kind: "system", payload: { subtype: "interaction_mode", mode: value.permissionMode, sourceEvent: "system/init" } });
      }
    } else if (subtype === "status" && (value.permissionMode === "plan" || value.permissionMode === "default")) {
      events.push({ kind: "system", payload: { subtype: "interaction_mode", mode: value.permissionMode, sourceEvent: "system/status" } });
    } else if (subtype === "task_started" || subtype === "task_updated" || subtype === "task_notification") {
      // These SDK messages describe background Bash/subagent execution, not the
      // provider's user-facing Todo list. Preserve them as a distinct process
      // trace so the UI can show task chips without inventing Todo entries.
      events.push({
        kind: "system",
        payload: {
          subtype,
          semanticType: "subtask",
          sourceEvent: `system/${subtype}`,
          taskId: value.task_id,
          toolUseId: value.tool_use_id,
          description: value.description,
          summary: value.summary,
          status: value.status,
          patch: value.patch,
          taskType: value.task_type,
          subagentType: value.subagent_type,
          skipTranscript: value.skip_transcript
        }
      });
    } else if (subtype === "compact_boundary") {
      events.push({ kind: "system", payload: { text: "Claude Code 已压缩上下文", subtype } });
    }
  }
  return { sessionId, events };
}

function asClaudeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function structuredClaudeToolResult(toolUseResult: unknown, blockContent: unknown): Record<string, unknown> {
  const direct = asClaudeRecord(toolUseResult);
  if (Object.keys(direct).length) return direct;
  const block = asClaudeRecord(blockContent);
  if (Object.keys(block).length) return block;
  if (typeof blockContent === "string") {
    try { return asClaudeRecord(JSON.parse(blockContent)); } catch { return { text: blockContent }; }
  }
  return {};
}

function claudeToolSemanticEvents(tool: string, input: Record<string, unknown>, output: Record<string, unknown>, itemId: string): ClaudeSemanticEvent[] {
  const source = { sourceTool: tool, sourceEvent: "user/tool_result", itemId };
  if (tool === "TodoWrite") {
    const items = Array.isArray(output.newTodos) ? output.newTodos : Array.isArray(input.todos) ? input.todos : [];
    return [{ kind: "todo", payload: { items: normalizeClaudeTodoItems(items), ...source } }];
  }
  if (tool === "ExitPlanMode") {
    const result: ClaudeSemanticEvent[] = [];
    if (typeof output.plan === "string" && output.plan.trim()) {
      result.push({ kind: "plan", payload: { text: output.plan, filePath: output.filePath, planWasEdited: output.planWasEdited, ...source } });
    }
    return result;
  }
  return [];
}

function normalizeClaudeTodoItems(items: unknown[]): Array<Record<string, unknown>> {
  return items.map((raw, index) => {
    const item = asClaudeRecord(raw);
    return {
      id: String(item.id || index),
      text: String(item.subject || item.content || item.description || ""),
      activeForm: typeof item.activeForm === "string" ? item.activeForm : undefined,
      owner: typeof item.owner === "string" ? item.owner : undefined,
      blockedBy: Array.isArray(item.blockedBy) ? item.blockedBy : [],
      status: normalizeClaudeTaskStatus(item.status)
    };
  }).filter((item) => item.text);
}

function normalizeClaudeTaskStatus(status: unknown): "pending" | "in-progress" | "completed" {
  return status === "completed" ? "completed" : status === "in_progress" || status === "running" ? "in-progress" : "pending";
}

export function orderClaudeEvents(events: ClaudeSemanticEvent[], initialReasoning = ""): {
  events: ClaudeSemanticEvent[];
  pendingReasoning: string;
} {
  const ordered: ClaudeSemanticEvent[] = [];
  let pendingReasoning = initialReasoning;
  for (const event of events) {
    if (event.kind === "reasoning-delta") {
      pendingReasoning += String(event.payload.text || "");
      ordered.push(event);
      continue;
    }
    if (event.kind === "reasoning-summary" && pendingReasoning) {
      const durableReasoning = String(event.payload.text || "");
      const pending = pendingReasoning.trim();
      const durable = durableReasoning.trim();
      if (pending && durable && (pending.startsWith(durable) || durable.startsWith(pending))) {
        ordered.push(
          pending.length > durable.length
            ? { ...event, payload: { ...event.payload, text: pendingReasoning } }
            : event
        );
        pendingReasoning = "";
        continue;
      }
    }
    if (pendingReasoning) {
      ordered.push({ kind: "reasoning-summary", payload: { text: pendingReasoning, source: "claude-thinking" } });
      pendingReasoning = "";
    }
    ordered.push(event);
  }
  return { events: ordered, pendingReasoning };
}

function spawnWslClaude(options: SpawnOptions, captureStderr: (text: string) => void): SpawnedProcess {
  const forwarded = Object.fromEntries(Object.entries(options.env)
    .filter(([key, value]) => value !== undefined && shouldForwardToWsl(key))) as Record<string, string>;
  const managed = options.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST === "1";
  // Managed runs use the login shell only to discover the user's CLI path.
  // Starting that absolute executable directly prevents ~/.profile from
  // replacing the host-selected URL, credential, backend or proxy afterwards.
  const invocation = managed
    ? (() => {
        const resolved = resolveWslLoginExecutable(options.cwd || process.cwd(), "claude");
        // npm/NVM launchers commonly use `#!/usr/bin/env node`. Preserve the
        // login PATH for that interpreter without running the managed turn
        // through a profile-reading shell.
        return {
          command: "/usr/bin/env",
          args: [`PATH=${resolved.loginPath}`, resolved.executable, ...options.args]
        };
      })()
    : buildWslLoginCommand("claude", options.args);
  const child = spawnInDirectory(options.cwd || process.cwd(), invocation.command, invocation.args, {
    signal: options.signal,
    env: {
      ...forwarded,
      WSLENV: mergeWslenv(
        process.env.WSLENV,
        Object.keys(forwarded),
        managed
      )
    }
  });
  child.stderr.on("data", (chunk) => captureStderr(decodeProcessOutput(chunk)));
  return child;
}

function mergeWslenv(current: string | undefined, names: string[], managed = false): string {
  const entries = (current || "").split(":").filter(Boolean).filter((entry) => {
    if (!managed) return true;
    return !isClaudeProviderControlledEnv(entry.split("/")[0], true);
  });
  const existing = new Set(entries.map((entry) => entry.split("/")[0]));
  for (const name of names) if (!existing.has(name)) entries.push(name);
  return entries.join(":");
}

function shouldForwardToWsl(key: string): boolean {
  if (key === "CLAUDE_CONFIG_DIR" || key === "CLAUDE_SECURESTORAGE_CONFIG_DIR") return false;
  return key === "DEBUG"
    || key.startsWith("CLAUDE_")
    || key.startsWith("ANTHROPIC_")
    || ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy"].includes(key);
}

function appendBounded(current: string, next: string, limit = 512 * 1024): string {
  const combined = current + next;
  return combined.length <= limit ? combined : combined.slice(combined.length - limit);
}

export function toAsarUnpackedPath(value: string): string {
  return value.replace(/([\\/])app\.asar([\\/])/i, "$1app.asar.unpacked$2");
}

export function resolveNativeClaudeExecutable(): string {
  const packageName = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  let packageJson: string;
  try {
    packageJson = require.resolve(`${packageName}/package.json`);
  } catch {
    throw new Error(`未找到 Claude Code 本机二进制包：${packageName}`);
  }
  const candidate = path.join(path.dirname(packageJson), process.platform === "win32" ? "claude.exe" : "claude");
  const unpacked = toAsarUnpackedPath(candidate);
  if (fs.existsSync(unpacked)) return unpacked;
  if (!isAsarPath(candidate) && fs.existsSync(candidate)) return candidate;
  throw new Error(`Claude Code 本机二进制不可执行：${unpacked}`);
}

function resolveLocalClaudePath(): string | null {
  // A one-click installed claude lives in the app-private tools/bin; prefer
  // it over user-managed installs.
  const appTool = resolveAppToolExecutable("claude");
  if (appTool) return appTool;
  if (process.platform !== "win32") return null;
  const home = process.env.USERPROFILE || "";
  const appdata = process.env.APPDATA || "";
  const explicit = [path.join(home, ".local\\bin\\claude.exe"), path.join(appdata, "npm\\claude.cmd")].find((candidate) => candidate && fs.existsSync(candidate));
  if (explicit) return explicit;
  try {
    const output = String(execFileSync("where.exe", ["claude"], { windowsHide: true, timeout: 5000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    const first = output.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
    return first && fs.existsSync(first) ? first : null;
  } catch {
    return null;
  }
}

export function resolveClaudeExecutable(): string {
  return resolveLocalClaudePath() || resolveNativeClaudeExecutable();
}

export const MIN_MANAGED_CLAUDE_VERSION = [2, 1, 175] as const;

export function supportsManagedClaudeVersion(value: string | null | undefined): boolean {
  const match = String(value || "").match(/(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$)/);
  if (!match) return false;
  const version = match.slice(1, 4).map(Number);
  for (let index = 0; index < MIN_MANAGED_CLAUDE_VERSION.length; index += 1) {
    if (version[index] !== MIN_MANAGED_CLAUDE_VERSION[index]) {
      return version[index] > MIN_MANAGED_CLAUDE_VERSION[index];
    }
  }
  return true;
}

function assertManagedClaudeVersion(value: string | null | undefined): void {
  if (supportsManagedClaudeVersion(value)) return;
  throw new Error(`WSL Claude Code 托管 Provider 需要 ${MIN_MANAGED_CLAUDE_VERSION.join(".")} 或更高版本，当前版本：${value || "未知"}。`);
}

function isAsarPath(value: string): boolean {
  return /([\\/])app\.asar([\\/])/i.test(value);
}

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProviderYamlEntry } from "../../../shared/providers-yaml";
import type { ProviderRunContext } from "./types";
import { canAutoApprove, classifyApproval, commandDeletesDirectory } from "./types";
import {
  buildCodexTurnInput,
  buildCodexAppServerArgs,
  CODEX_MANAGED_API_KEY_ENV,
  CODEX_MANAGED_PROVIDER_ID,
  normalizeCodexNotification,
  resolveCodexNativeSkill
} from "./codex-app-server";
import { CLAUDE_SETTING_SOURCES, CLAUDE_SKILL_SELECTION, decideClaudePermission, normalizeClaudeMessage, orderClaudeEvents, toAsarUnpackedPath } from "./claude-agent-sdk";
import { parseClaudeAuthStatus } from "../provider-registry";
import { ArtifactFenceParser, type AssistantContentBlock } from "../../../renderer/src/features/ai-console/artifact-fence";

const context = {
  session: { permissionProfile: "edit", projectRoot: "/project", cwd: ".", scope: { type: "workspace" } },
  openmindRoot: "/project",
  cwd: "/project"
} as ProviderRunContext;

function makeCodexServiceProvider(overrides: Partial<ProviderYamlEntry> = {}): ProviderYamlEntry {
  return {
    id: "yaml.provider.with-dots",
    name: "Managed Responses",
    enabled: true,
    protocol: "openai-responses",
    authMode: "bearer",
    apiKey: "secret-must-not-enter-argv",
    baseUrl: "https://gateway.example/v1/responses/",
    model: "vendor/model-fast",
    proxyUrl: "",
    proxyPolicy: "system",
    tlsPolicy: "verify",
    ...overrides
  };
}

describe("provider contracts", () => {
  it("produces identical artifact blocks from Codex and Claude text delta protocols", () => {
    const deltas = ["开场\n~~", "~~openmind-artifact\n# Provider", " artifact\nbody", "\n~~~~\n结束"];
    const codexText = deltas.flatMap((delta) => normalizeCodexNotification({
      method: "item/agentMessage/delta",
      params: { delta }
    })).map((event) => String(event.payload.text || ""));
    const claudeText = deltas.flatMap((text) => normalizeClaudeMessage({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text } }
    }).events).map((event) => String(event.payload.text || ""));

    const parse = (chunks: string[]) => {
      const parser = new ArtifactFenceParser("provider");
      for (const chunk of chunks) parser.push(chunk);
      return parser.finish().map(({ key: _key, ...block }: AssistantContentBlock) => block);
    };
    expect(parse(codexText)).toEqual(parse(claudeText));
    expect(parse(codexText)).toContainEqual(expect.objectContaining({
      type: "artifact",
      title: "Provider artifact",
      status: "complete"
    }));
  });

  it("normalizes Codex semantic events", () => {
    expect(normalizeCodexNotification({ method: "item/agentMessage/delta", params: { delta: "hello" } })[0]).toMatchObject({
      kind: "assistant-delta",
      payload: { text: "hello" }
    });
    expect(normalizeCodexNotification({ method: "item/reasoning/summaryTextDelta", params: { delta: "checking" } })[0]).toMatchObject({
      kind: "reasoning-delta",
      payload: { text: "checking", source: "codex-summary" }
    });
    expect(normalizeCodexNotification({ method: "item/completed", params: { item: { id: "1", type: "commandExecution", command: "npm test" } } })[0].kind).toBe("tool-complete");
    expect(normalizeCodexNotification({ method: "thread/compacted", params: { threadId: "thread-1" } })[0]).toMatchObject({
      kind: "system",
      payload: { subtype: "context_compacted", threadId: "thread-1" }
    });
  });

  it("normalizes Claude semantic events", () => {
    const normalized = normalizeClaudeMessage({
      type: "assistant",
      session_id: "session-1",
      message: { content: [{ type: "text", text: "done" }, { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "a" } }] }
    });
    expect(normalized.sessionId).toBe("session-1");
    expect(normalized.events.map((event) => event.kind)).toEqual(["assistant-message", "tool-start"]);
    expect(normalized.events[0]).toEqual({ kind: "assistant-message", payload: { text: "done", phase: "commentary" } });
    expect(normalizeClaudeMessage({ type: "system", subtype: "thinking_tokens", estimated_tokens: 10 }).events).toEqual([]);
    expect(normalizeClaudeMessage({ type: "system", subtype: "status", status: "requesting" }).events).toEqual([]);
    expect(normalizeClaudeMessage({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "stream" } }
    }).events).toEqual([{ kind: "assistant-delta", payload: { text: "stream" } }]);
    expect(normalizeClaudeMessage({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "private" } }
    }).events).toEqual([{ kind: "reasoning-delta", payload: { text: "private", source: "claude-thinking" } }]);
    expect(normalizeClaudeMessage({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "inspect first" }, { type: "text", text: "done" }] }
    }).events).toEqual([
      { kind: "reasoning-summary", payload: { text: "inspect first", source: "claude-thinking" } },
      { kind: "assistant-message", payload: { text: "done", phase: "commentary" } }
    ]);
    expect(normalizeClaudeMessage({
      type: "result",
      subtype: "success",
      result: "authoritative final",
      usage: { input_tokens: 10 },
      total_cost_usd: 0.01,
      duration_ms: 200
    }).events).toEqual([
      { kind: "assistant-message", payload: { text: "authoritative final", phase: "final" } },
      { kind: "usage", payload: { usage: { input_tokens: 10 }, cost: 0.01, duration: 200 } }
    ]);
    expect(normalizeClaudeMessage({ type: "system", subtype: "init", model: "glm-5.1", claude_code_version: "2.1.177" }).events).toEqual([{
      kind: "system",
      payload: {
        text: "Claude Code 已初始化",
        subtype: "init",
        model: "glm-5.1",
        version: "2.1.177",
        permissionMode: undefined
      }
    }]);
    expect(normalizeClaudeMessage({ type: "system", subtype: "compact_boundary" }).events[0]).toMatchObject({
      kind: "system",
      payload: { subtype: "compact_boundary" }
    });
  });

  it("does not expose Claude private status deltas as semantic conversation events", () => {
    expect(normalizeClaudeMessage({ type: "system", subtype: "thinking_tokens", estimated_tokens: 1 }).events).toEqual([]);
    expect(normalizeClaudeMessage({ type: "system", subtype: "status", status: "requesting" }).events).toEqual([]);
  });

  it("persists Claude reasoning before the tool event that follows it", () => {
    const reasoning = orderClaudeEvents([
      { kind: "reasoning-delta", payload: { text: "先检查目录" } }
    ]);
    const tool = orderClaudeEvents([
      { kind: "tool-start", payload: { tool: "Bash", input: { command: "ls -la .claude/" } } }
    ], reasoning.pendingReasoning);

    expect(tool.events.map((event) => event.kind)).toEqual(["reasoning-summary", "tool-start"]);
    expect(tool.events[0].payload.text).toBe("先检查目录");
  });

  it.each([
    ["matching", "inspect the repository", "inspect the repository", "inspect the repository"],
    ["durable-prefix", "inspect", "inspect the repository", "inspect the repository"],
    ["streamed-prefix", "inspect the repository", "inspect", "inspect the repository"]
  ])("coalesces Claude %s streamed thinking with its durable block", (_, streamedText, durableText, expected) => {
    const streamed = orderClaudeEvents([
      { kind: "reasoning-delta", payload: { text: streamedText } }
    ]);
    const durable = orderClaudeEvents([
      { kind: "reasoning-summary", payload: { text: durableText, source: "claude-thinking" } },
      { kind: "tool-start", payload: { tool: "Read", input: { file_path: "src/app.ts" } } }
    ], streamed.pendingReasoning);

    expect(durable.events.map((event) => event.kind)).toEqual(["reasoning-summary", "tool-start"]);
    expect(durable.events[0].payload.text).toBe(expected);
    expect(durable.pendingReasoning).toBe("");
  });

  it("isolates Claude from user/project settings and native Skill discovery", () => {
    expect(CLAUDE_SETTING_SOURCES).toEqual([]);
    expect(CLAUDE_SKILL_SELECTION).toEqual([]);
    expect(normalizeClaudeMessage({ type: "result", is_error: true, result: "Not logged in" }).events.map((event) => event.kind))
      .toEqual(["usage"]);
  });

  it("detects Claude authentication status", () => {
    expect(parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"oauth_token"}')).toBe(true);
    expect(parseClaudeAuthStatus('{"loggedIn":false}')).toBe(false);
    expect(parseClaudeAuthStatus("Not logged in · Please run /login")).toBe(false);
  });

  it("maps Electron asar binaries to their executable unpacked path", () => {
    expect(toAsarUnpackedPath("C:\\OpenMind\\resources\\app.asar\\node_modules\\claude.exe"))
      .toBe("C:\\OpenMind\\resources\\app.asar.unpacked\\node_modules\\claude.exe");
  });

  it("allows safe direct-project edits but never auto-approves destructive actions", () => {
    expect(canAutoApprove(context, "file-change", "", ["/project/a.ts"])).toBe(true);
    expect(canAutoApprove(context, "delete", "rm a.ts", ["/project/a.ts"])).toBe(false);
    expect(canAutoApprove(context, "file-change", "", ["/outside/a.ts"])).toBe(false);
    expect(classifyApproval("git push").category).toBe("network");
  });

  it("auto-approves file deletions in auto mode but keeps directory deletion for approval", () => {
    const auto = { ...context, session: { ...context.session, permissionProfile: "auto" } } as ProviderRunContext;
    expect(canAutoApprove(auto, "delete", "rm a.ts", ["/project/a.ts"])).toBe(true);
    expect(canAutoApprove(auto, "delete", "rm -rf build", [])).toBe(false);
    expect(canAutoApprove(auto, "command", "sudo systemctl restart", [])).toBe(true);
    expect(canAutoApprove(auto, "file-change", "", ["/outside/a.ts"])).toBe(false);
  });

  it("detects common directory-deletion forms in commands", () => {
    expect(commandDeletesDirectory("rm -rf build")).toBe(true);
    expect(commandDeletesDirectory("rm -r build")).toBe(true);
    expect(commandDeletesDirectory("rm -fr dist && npm run build")).toBe(true);
    expect(commandDeletesDirectory("rm build --recursive")).toBe(true);
    expect(commandDeletesDirectory("find . -name '*.ts' | xargs rm -r")).toBe(true);
    expect(commandDeletesDirectory("rmdir build")).toBe(true);
    expect(commandDeletesDirectory("rd /s build")).toBe(true);
    expect(commandDeletesDirectory("Remove-Item -Recurse -Force dist")).toBe(true);
    expect(commandDeletesDirectory("git clean -fd")).toBe(true);
    expect(commandDeletesDirectory("git clean -xdf")).toBe(true);
  });

  it("does not flag plain file deletions or unrelated commands as directory deletion", () => {
    expect(commandDeletesDirectory("rm a.txt")).toBe(false);
    expect(commandDeletesDirectory("unlink a.txt")).toBe(false);
    expect(commandDeletesDirectory("del a.txt")).toBe(false);
    expect(commandDeletesDirectory("git clean -f")).toBe(false);
    expect(commandDeletesDirectory("git clean --dry-run")).toBe(false);
    expect(commandDeletesDirectory("git ls-files | awk -F/ '{print $1}' | sort | uniq -c | sort -rn | head -20")).toBe(false);
    expect(commandDeletesDirectory("echo rd && echo rm")).toBe(false);
  });

  it("returns updatedInput on auto-approved Claude file tools so the SDK schema accepts the result", () => {
    const decision = decideClaudePermission(context, "Read", { file_path: "/project/a.md" });
    expect(decision.behavior).toBe("allow");
    if (decision.behavior !== "allow") throw new Error("expected allow");
    expect(decision.updatedInput).toEqual({ file_path: "/project/a.md" });
  });

  it("auto-allows plain commands in auto mode, including with a reported WSL path", () => {
    const autoWslContext = {
      session: {
        permissionProfile: "auto",
        projectRoot: "\\\\wsl$\\Ubuntu\\home\\test-user\\work\\openmind-data",
        cwd: ".",
        scope: { type: "workspace" }
      },
      openmindRoot: "\\\\wsl$\\Ubuntu\\home\\test-user\\work\\openmind-data",
      cwd: "\\\\wsl$\\Ubuntu\\home\\test-user\\work\\openmind-data"
    } as ProviderRunContext;
    const file = "//wsl.localhost/Ubuntu/home/test-user/work/openmind-data/.agent/skills/cctools/daily-topic-selector/SKILL.md";
    const decision = decideClaudePermission(autoWslContext, "Bash", { command: `cat "${file}"` }, file);

    expect(decision.behavior).toBe("allow");
  });

  it("sends directory-deletion commands to explicit approval in auto mode while allowing file deletion", () => {
    const auto = {
      session: { permissionProfile: "auto", projectRoot: "/project", cwd: "/project", scope: { type: "workspace" } },
      openmindRoot: "/project",
      cwd: "/project"
    } as ProviderRunContext;
    expect(decideClaudePermission(auto, "Bash", { command: "git ls-files | awk -F/ '{print $1}' | sort | uniq -c | sort -rn | head -20" }).behavior).toBe("allow");
    expect(decideClaudePermission(auto, "Bash", { command: "rm a.txt" }).behavior).toBe("allow");
    expect(decideClaudePermission(auto, "Bash", { command: "rm -rf build" })).toMatchObject({ behavior: "ask", category: "delete" });
    expect(decideClaudePermission(auto, "Bash", { command: "rmdir build" }).behavior).toBe("ask");
    expect(decideClaudePermission(auto, "Bash", { command: "Remove-Item -Recurse -Force dist" }).behavior).toBe("ask");
    expect(decideClaudePermission(auto, "Bash", { command: "git clean -fd" }).behavior).toBe("ask");
    expect(decideClaudePermission(auto, "Bash", { command: "git clean -f" }).behavior).toBe("allow");
  });

  it("denies mutating tools in read-only Claude sessions", () => {
    const readOnly = { session: { permissionProfile: "read-only" }, openmindRoot: "/project", cwd: "/project" } as ProviderRunContext;
    const decision = decideClaudePermission(readOnly, "Write", { file_path: "/project/a.ts" });
    expect(decision.behavior).toBe("deny");
  });

  it("auto-allows only root-contained Read/Glob/Grep for Project Task sessions", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-project-permission-"));
    const projectRoot = path.join(fixture, "AI安全");
    const materials = path.join(projectRoot, "materials");
    fs.mkdirSync(materials, { recursive: true });
    fs.writeFileSync(path.join(materials, "report.md"), "safe material");
    const projectContext = {
      session: {
        permissionProfile: "read-only",
        projectRoot,
        scope: { type: "project-task", projectName: "AI安全", taskId: "task-1" }
      },
      openmindRoot: fixture,
      cwd: projectRoot
    } as ProviderRunContext;
    try {
      for (const [tool, input] of [
        ["Read", { file_path: "materials/report.md" }],
        ["Glob", { path: "materials", pattern: "**/*.md" }],
        ["Grep", { directory: "materials", pattern: "safe" }]
      ] as const) {
        expect(decideClaudePermission(projectContext, tool, input)).toMatchObject({ behavior: "allow", updatedInput: input });
      }
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("allows Project reads across openmindRoot but denies mutations and realpath escapes", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-project-deny-"));
    const openmindRoot = path.join(fixture, "openmind");
    const projectRoot = path.join(openmindRoot, "projects", "AI安全");
    const sibling = path.join(openmindRoot, "projects", "sibling");
    const outside = path.join(fixture, "outside");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(sibling, { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(sibling, "shared.md"), "shared");
    fs.writeFileSync(path.join(outside, "secret.md"), "secret");
    fs.symlinkSync(outside, path.join(projectRoot, "escape"), process.platform === "win32" ? "junction" : "dir");
    const projectContext = {
      session: {
        permissionProfile: "read-only",
        projectRoot,
        scope: { type: "project-task", projectName: "AI安全", taskId: "task-1" }
      },
      openmindRoot,
      cwd: projectRoot
    } as ProviderRunContext;
    try {
      for (const tool of ["Write", "Edit", "NotebookEdit", "Bash", "PowerShell"]) {
        expect(decideClaudePermission(projectContext, tool, { file_path: "materials/new.md", command: "echo unsafe" }))
          .toMatchObject({ behavior: "deny" });
      }
      expect(decideClaudePermission(projectContext, "Read", { file_path: "../sibling/shared.md" }))
        .toMatchObject({ behavior: "allow" });
      expect(decideClaudePermission(projectContext, "Read", { file_path: "escape/secret.md" }))
        .toMatchObject({ behavior: "deny" });
      expect(decideClaudePermission(projectContext, "Glob", { path: outside, pattern: "**/*" }))
        .toMatchObject({ behavior: "deny" });
      expect(decideClaudePermission(projectContext, "Glob", { path: sibling, pattern: "**/*.md" }))
        .toMatchObject({ behavior: "allow" });
      expect(decideClaudePermission(projectContext, "Glob", { pattern: "escape/**" }))
        .toMatchObject({ behavior: "deny" });
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("builds Codex native skill input from skills/list metadata", () => {
    const nativeSkill = resolveCodexNativeSkill({
      data: [{
        cwd: "/project",
        skills: [{ name: "rss-article-saver", path: "/project/.claude/skills/rss-article-saver/SKILL.md", enabled: true }]
      }]
    }, "rss-article-saver");
    expect(nativeSkill).toEqual({
      name: "rss-article-saver",
      path: "/project/.claude/skills/rss-article-saver/SKILL.md",
      enabled: true
    });
    expect(buildCodexTurnInput({
      prompt: "/rss-article-saver today",
      skillInvocation: {
        name: "rss-article-saver",
        argument: "today",
        raw: "/rss-article-saver today",
        prompt: "today"
      }
    }, nativeSkill)).toEqual([
      { type: "skill", name: "rss-article-saver", path: "/project/.claude/skills/rss-article-saver/SKILL.md" },
      { type: "text", text: "today", text_elements: [] }
    ]);
    expect(resolveCodexNativeSkill({
      data: [{ cwd: "/project", skills: [{ name: "rss-article-saver", path: "/skill/SKILL.md", enabled: false }] }]
    }, "rss-article-saver")).toMatchObject({ enabled: false });
  });

  it("builds codex app-server args with model override only when not auto", () => {
    expect(buildCodexAppServerArgs("auto")).toEqual(["app-server"]);
    expect(buildCodexAppServerArgs(undefined)).toEqual(["app-server"]);
    expect(buildCodexAppServerArgs(null)).toEqual(["app-server"]);
    expect(buildCodexAppServerArgs("gpt-5")).toEqual(["app-server", "-c", 'model="gpt-5"']);
    // `-c` 的值按 TOML 解析，模型 id 必须始终是有引号的 TOML 字符串。
    const model = 'glm-5.2[1m] "fast"';
    expect(buildCodexAppServerArgs(model)).toEqual(["app-server", "-c", `model=${JSON.stringify(model)}`]);
  });

  it("maps a YAML Responses provider to a fixed internal Codex provider without leaking its key", () => {
    const provider = makeCodexServiceProvider({
      name: 'Vendor "Responses"',
      model: 'vendor/model "fast"'
    });

    const args = buildCodexAppServerArgs("auto", provider);

    expect(args).toEqual([
      "app-server",
      "-c", `model=${JSON.stringify(provider.model)}`,
      "-c", `model_provider=${JSON.stringify(CODEX_MANAGED_PROVIDER_ID)}`,
      "-c", `model_providers.${CODEX_MANAGED_PROVIDER_ID}.name=${JSON.stringify(provider.name)}`,
      "-c", `model_providers.${CODEX_MANAGED_PROVIDER_ID}.base_url="https://gateway.example/v1"`,
      "-c", `model_providers.${CODEX_MANAGED_PROVIDER_ID}.wire_api="responses"`,
      "-c", `model_providers.${CODEX_MANAGED_PROVIDER_ID}.requires_openai_auth=false`,
      "-c", "shell_environment_policy.ignore_default_excludes=false",
      "-c", "features.codex_hooks=false",
      "-c", "notify=[]",
      "-c", `model_providers.${CODEX_MANAGED_PROVIDER_ID}.env_key=${JSON.stringify(CODEX_MANAGED_API_KEY_ENV)}`
    ]);
    expect(JSON.stringify(args)).not.toContain(provider.apiKey);
    expect(JSON.stringify(args)).not.toContain(provider.id);
  });

  it("uses an environment-backed X-API-Key header for x-api-key providers", () => {
    const provider = makeCodexServiceProvider({ authMode: "x-api-key" });

    const args = buildCodexAppServerArgs("auto", provider);

    expect(args).toContain(
      `model_providers.${CODEX_MANAGED_PROVIDER_ID}.env_http_headers={ "X-API-Key" = ${JSON.stringify(CODEX_MANAGED_API_KEY_ENV)} }`
    );
    expect(args.some((arg) => arg.includes(".env_key="))).toBe(false);
    expect(JSON.stringify(args)).not.toContain(provider.apiKey);
  });

  it("rejects non-Responses YAML providers before Codex starts", () => {
    const provider = makeCodexServiceProvider({ protocol: "openai-chat" });
    expect(() => buildCodexAppServerArgs("auto", provider)).toThrow("openai-responses");
  });
});

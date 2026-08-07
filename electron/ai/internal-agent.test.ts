import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderProfileSchema, type ProviderProfile } from "../../shared/provider-profiles";
import type { AgentCheckpoint } from "../../shared/execution-contracts";
import type { AgentManifest } from "../../shared/skill-manifest-schema";
import { InternalAgentRuntime } from "./internal-agent";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function profile(baseUrl: string, protocol: ProviderProfile["protocol"] = "openai-chat", model = "test-model"): ProviderProfile {
  return ProviderProfileSchema.parse({
    schemaVersion: 1,
    id: "local-provider",
    name: "Local Provider",
    protocol,
    credentialId: null,
    baseUrl,
    model,
    timeoutMs: 10_000,
    maxRetries: 0,
    proxyPolicy: "disabled",
    tlsPolicy: "verify",
    fallbackProfileId: null,
    test: { status: "success", testedAt: new Date().toISOString(), diagnostic: null }
  });
}

function manifest(options: { allowSubprocess?: boolean } = {}): AgentManifest {
  return {
    apiVersion: "cctools.dev/skill/v1",
    id: "test-agent",
    version: "1.0.0",
    publisher: { id: "cctools", displayName: "cctools" },
    display: { name: "Test Agent", description: "test", group: "test" },
    config: {},
    provider: { required: true, fallbackOk: false },
    capabilities: {
      mymind: { read: ["daily-summary/**"], write: ["creative/**"] },
      network: { required: false, hosts: [] },
      browser: false,
      subprocess: { allowed: options.allowSubprocess === true },
      clipboard: false,
      notification: false
    },
    artifacts: [{ id: "output", type: "directory", path: "creative/**" }],
    execution: {
      concurrency: { maxInstances: 1, mutexes: [] },
      timeoutSeconds: 30,
      gracefulStopSeconds: 1,
      retry: { maxAttempts: 0 }
    },
    platforms: ["linux-x64"],
    compatibility: { minAppVersion: "1.0.0" }
  };
}

async function serve(responses: unknown[], requests: string[]): Promise<string> {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push(Buffer.concat(chunks).toString("utf8"));
      const body = JSON.stringify(responses[Math.min(requests.length - 1, responses.length - 1)]);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(body);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}/v1/chat/completions`;
}

async function serveStreaming(responses: string[][], requests: string[]): Promise<string> {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const index = Math.min(requests.length, responses.length - 1);
      requests.push(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      response.end(responses[index].join(""));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("streaming server did not bind");
  return `http://127.0.0.1:${address.port}/v1/chat/completions`;
}

describe("InternalAgentRuntime", () => {
  it("runs a Provider Profile tool loop and writes only through the logical mymind tool", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-internal-agent-"));
    fs.mkdirSync(path.join(root, "daily-summary"), { recursive: true });
    fs.writeFileSync(path.join(root, "daily-summary", "today.md"), "local material");
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-agent-package-"));
    fs.writeFileSync(path.join(packageRoot, "SKILL.md"), "Write the selected topic to the declared output.");
    const requests: string[] = [];
    const endpoint = await serve([
      { choices: [{ message: { content: "", tool_calls: [{ id: "write-1", type: "function", function: { name: "mymind_write", arguments: JSON.stringify({ path: "creative/result.md", content: "# 今日选题\n" }) } }] } }] },
      { choices: [{ message: { content: "已完成" } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, cost_usd: 0.01 }
    ], requests);
    const runtime = new InternalAgentRuntime();
    const plan = runtime.createPlan({
      manifest: manifest(),
      skillHome: packageRoot,
      mymindRoot: root,
      provider: profile(endpoint),
      inputs: { date: "20260806" },
      digest: "a".repeat(64),
      rootGeneration: 1
    });
    const output: string[] = [];
    const result = await plan.agent!.run({
      signal: new AbortController().signal,
      onOutput: (_stream, text) => output.push(text)
    });
    expect(result.outcome).toBe("succeeded");
    expect(fs.readFileSync(path.join(root, "creative", "result.md"), "utf8")).toContain("今日选题");
    expect(requests).toHaveLength(2);
    expect(requests[0]).toContain("Installed Skill instructions");
    expect(output.join("")).toContain("已完成");
    expect(result.usage).toMatchObject({ model: "test-model", inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.01 });
  });

  it("marks a catalog-derived cost when the Provider omits cost metadata", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-internal-agent-pricing-"));
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-agent-package-"));
    fs.writeFileSync(path.join(packageRoot, "SKILL.md"), "Return a result.");
    const endpoint = await serve([{ choices: [{ message: { content: "完成" } }], usage: { prompt_tokens: 1_000, completion_tokens: 2_000, total_tokens: 3_000 } }], []);
    const result = await new InternalAgentRuntime().createPlan({
      manifest: manifest(),
      skillHome: packageRoot,
      mymindRoot: root,
      provider: profile(endpoint, "openai-chat", "gpt-5.4"),
      inputs: {},
      digest: "q".repeat(64),
      rootGeneration: 1
    }).agent!.run({ signal: new AbortController().signal, onOutput: () => undefined });

    expect(result.outcome).toBe("succeeded");
    expect(result.usage).toMatchObject({
      costUsd: 0.0325,
      costSource: "catalog-estimate",
      pricingCatalogVersion: 1,
      pricingRateId: "openai:gpt-5.4:standard-global:short"
    });
  });

  it("fails closed when an explicit Provider proxy has no endpoint", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-internal-agent-proxy-"));
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-agent-package-"));
    fs.writeFileSync(path.join(packageRoot, "SKILL.md"), "Return a result.");
    const endpoint = await serve([{ choices: [{ message: { content: "should-not-be-called" } }] }], []);
    const result = await new InternalAgentRuntime().createPlan({
      manifest: manifest(),
      skillHome: packageRoot,
      mymindRoot: root,
      provider: ProviderProfileSchema.parse({ ...profile(endpoint), proxyPolicy: "explicit" }),
      inputs: {},
      digest: "p".repeat(64),
      rootGeneration: 1
    }).agent!.run({ signal: new AbortController().signal, onOutput: () => undefined });

    expect(result.outcome).toBe("failed");
    expect(result.stderr).toContain("显式代理");
  });

  it("streams OpenAI Chat text and fragmented tool arguments without duplicating output", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-internal-agent-stream-"));
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-agent-package-"));
    fs.writeFileSync(path.join(packageRoot, "SKILL.md"), "Write the streamed artifact.");
    const requests: string[] = [];
    const endpoint = await serveStreaming([
      [
        `data: ${JSON.stringify({ id: "chat-stream-1", choices: [{ delta: { tool_calls: [{ index: 0, id: "write-stream", function: { name: "mymind_write", arguments: '{"path":"creative/stream.md","content":"' } }] } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "流式" } }] } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"}' } }] } }] })}\n\n`,
        "data: [DONE]\n\n"
      ],
      [
        `data: ${JSON.stringify({ id: "chat-stream-2", choices: [{ delta: { content: "流" } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "式完成" } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } })}\n\n`,
        "data: [DONE]\n\n"
      ]
    ], requests);
    const stdout: string[] = [];
    const result = await new InternalAgentRuntime().createPlan({
      manifest: manifest(),
      skillHome: packageRoot,
      mymindRoot: root,
      provider: profile(endpoint),
      inputs: {},
      digest: "s".repeat(64),
      rootGeneration: 1
    }).agent!.run({
      signal: new AbortController().signal,
      onOutput: (stream, text) => { if (stream === "stdout") stdout.push(text); }
    });

    expect(result.outcome).toBe("succeeded");
    expect(fs.readFileSync(path.join(root, "creative", "stream.md"), "utf8")).toBe("流式");
    expect(stdout.join("")).toBe("流式完成");
    expect(result.usage).toMatchObject({ inputTokens: 4, outputTokens: 3, totalTokens: 7 });
    expect(JSON.parse(requests[0]).stream).toBe(true);
  });

  it("streams Anthropic text deltas and usage", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-internal-agent-anthropic-stream-"));
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-agent-package-"));
    fs.writeFileSync(path.join(packageRoot, "SKILL.md"), "Return the streamed answer.");
    const requests: string[] = [];
    const endpoint = await serveStreaming([[
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg-stream-1", usage: { input_tokens: 6 } } })}\n\n`,
      `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Anthropic " } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "流式完成" } })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 4 } })}\n\n`,
      "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
    ]], requests);
    const stdout: string[] = [];
    const result = await new InternalAgentRuntime().createPlan({
      manifest: manifest(),
      skillHome: packageRoot,
      mymindRoot: root,
      provider: profile(endpoint.replace("/v1/chat/completions", "/v1"), "anthropic-messages"),
      inputs: {},
      digest: "t".repeat(64),
      rootGeneration: 1
    }).agent!.run({
      signal: new AbortController().signal,
      onOutput: (stream, text) => { if (stream === "stdout") stdout.push(text); }
    });

    expect(result.outcome).toBe("succeeded");
    expect(stdout.join("")).toBe("Anthropic 流式完成");
    expect(result.usage).toMatchObject({ inputTokens: 6, outputTokens: 4, totalTokens: 10 });
    expect(JSON.parse(requests[0]).stream).toBe(true);
  });

  it("streams OpenAI Responses output deltas", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-internal-agent-responses-stream-"));
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-agent-package-"));
    fs.writeFileSync(path.join(packageRoot, "SKILL.md"), "Return the Responses stream.");
    const requests: string[] = [];
    const endpoint = await serveStreaming([[
      `event: response.created\ndata: ${JSON.stringify({ type: "response.created", response: { id: "resp-stream-1" } })}\n\n`,
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "Responses " })}\n\n`,
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "流式" })}\n\n`,
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp-stream-1", output: [{ type: "message", content: [{ type: "output_text", text: "Responses 流式" }] }], usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } } })}\n\n`
    ]], requests);
    const stdout: string[] = [];
    const result = await new InternalAgentRuntime().createPlan({
      manifest: manifest(),
      skillHome: packageRoot,
      mymindRoot: root,
      provider: profile(endpoint.replace("/v1/chat/completions", "/v1"), "openai-responses"),
      inputs: {},
      digest: "r".repeat(64),
      rootGeneration: 1
    }).agent!.run({
      signal: new AbortController().signal,
      onOutput: (stream, text) => { if (stream === "stdout") stdout.push(text); }
    });

    expect(result.outcome).toBe("succeeded");
    expect(stdout.join("")).toBe("Responses 流式");
    expect(result.usage).toMatchObject({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    expect(JSON.parse(requests[0]).stream).toBe(true);
  });

  it("continues OpenAI Responses tool calls with response id and tool output", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-internal-agent-responses-"));
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-agent-package-"));
    fs.writeFileSync(path.join(packageRoot, "SKILL.md"), "Write the response artifact.");
    const requests: string[] = [];
    const endpoint = await serve([
      {
        id: "resp-1",
        output: [{ type: "function_call", call_id: "call-1", name: "mymind_write", arguments: JSON.stringify({ path: "creative/responses.md", content: "responses" }) }],
        usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 }
      },
      {
        id: "resp-2",
        output: [{ type: "message", content: [{ type: "output_text", text: "Responses 已完成" }] }],
        usage: { input_tokens: 6, output_tokens: 3, total_tokens: 9 }
      }
    ], requests);
    const plan = new InternalAgentRuntime().createPlan({
      manifest: manifest(), skillHome: packageRoot, mymindRoot: root, provider: profile(endpoint.replace("/v1/chat/completions", "/v1"), "openai-responses"),
      inputs: {}, digest: "c".repeat(64), rootGeneration: 1
    });
    const result = await plan.agent!.run({ signal: new AbortController().signal, onOutput: () => undefined });
    const continuation = JSON.parse(requests[1]) as Record<string, unknown>;
    expect(result.outcome).toBe("succeeded");
    expect(fs.readFileSync(path.join(root, "creative", "responses.md"), "utf8")).toBe("responses");
    expect(continuation.previous_response_id).toBe("resp-1");
    expect(continuation.input).toEqual([{ type: "function_call_output", call_id: "call-1", output: expect.stringContaining("responses.md") }]);
    expect(result.usage).toMatchObject({ inputTokens: 14, outputTokens: 7, totalTokens: 21 });
  });

  it("resumes from a durable Responses checkpoint and clears it after completion", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-internal-agent-resume-"));
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-agent-package-"));
    fs.writeFileSync(path.join(packageRoot, "SKILL.md"), "Continue the provider task.");
    const requests: string[] = [];
    const endpoint = await serve([
      {
        id: "resp-resumed",
        output: [{ type: "message", content: [{ type: "output_text", text: "恢复完成" }] }],
        usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 }
      }
    ], requests);
    const saved: unknown[] = [];
    const plan = new InternalAgentRuntime().createPlan({
      manifest: manifest(),
      skillHome: packageRoot,
      mymindRoot: root,
      provider: profile(endpoint.replace("/v1/chat/completions", "/v1"), "openai-responses"),
      checkpoint: {
        protocol: "openai-responses",
        responseId: "resp-before-crash",
        toolOutputs: [{ callId: "call-before-crash", output: '{"ok":true}' }],
        turn: 1,
        updatedAt: new Date().toISOString()
      },
      inputs: { task: "re-entered task" },
      digest: "d".repeat(64),
      rootGeneration: 1
    });
    const result = await plan.agent!.run({
      signal: new AbortController().signal,
      onOutput: () => undefined,
      saveCheckpoint: (checkpoint) => saved.push(checkpoint)
    });
    const continuation = JSON.parse(requests[0]) as Record<string, unknown>;
    expect(result.outcome).toBe("succeeded");
    expect(continuation.previous_response_id).toBe("resp-before-crash");
    expect(continuation.input).toEqual([{ type: "function_call_output", call_id: "call-before-crash", output: '{"ok":true}' }]);
    expect(saved).toEqual([null]);
  });

  it("resumes Anthropic from a safe boundary without persisting inputs or credentials", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-internal-agent-anthropic-resume-"));
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-agent-package-"));
    fs.writeFileSync(path.join(packageRoot, "SKILL.md"), "Continue the provider task.");
    const requests: string[] = [];
    const endpoint = await serve([
      {
        id: "msg-before-crash",
        type: "message",
        role: "assistant",
        content: [{ type: "tool_use", id: "tool-before-crash", name: "skill_run", input: { skillId: "child", inputs: { value: "SECRET-INPUT" } } }],
        usage: { input_tokens: 5, output_tokens: 2 }
      },
      {
        id: "msg-after-resume",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Anthropic 恢复完成" }],
        usage: { input_tokens: 7, output_tokens: 3 }
      }
    ], requests);
    const controller = new AbortController();
    let checkpoint: AgentCheckpoint | undefined;
    const firstPlan = new InternalAgentRuntime().createPlan({
      manifest: manifest(),
      skillHome: packageRoot,
      mymindRoot: root,
      provider: profile(endpoint.replace("/v1/chat/completions", "/v1"), "anthropic-messages"),
      providerSecret: "SECRET-CREDENTIAL",
      inputs: { task: "SECRET-INPUT" },
      digest: "a".repeat(64),
      rootGeneration: 1,
      approval: async () => "allow",
      handlers: { runSkill: async () => "child result SECRET-INPUT SECRET-CREDENTIAL" }
    });
    const firstResult = await firstPlan.agent!.run({
      signal: controller.signal,
      onOutput: () => undefined,
      saveCheckpoint: (value) => {
        if (value) {
          checkpoint = value;
          controller.abort();
        }
      }
    });

    expect(firstResult.outcome).toBe("cancelled");
    expect(checkpoint).toMatchObject({ protocol: "anthropic-messages", messageId: "msg-before-crash", turn: 1 });
    expect(JSON.stringify(checkpoint)).not.toContain("SECRET-INPUT");
    expect(JSON.stringify(checkpoint)).not.toContain("SECRET-CREDENTIAL");
    expect(JSON.stringify(checkpoint)).toContain("[REDACTED]");

    const saved: Array<AgentCheckpoint | null> = [];
    const resumed = await new InternalAgentRuntime().createPlan({
      manifest: manifest(),
      skillHome: packageRoot,
      mymindRoot: root,
      provider: profile(endpoint.replace("/v1/chat/completions", "/v1"), "anthropic-messages"),
      providerSecret: "SECRET-CREDENTIAL",
      checkpoint,
      inputs: { task: "re-entered task" },
      digest: "a".repeat(64),
      rootGeneration: 1
    }).agent!.run({
      signal: new AbortController().signal,
      onOutput: () => undefined,
      saveCheckpoint: (value) => saved.push(value)
    });
    const resumedRequest = JSON.parse(requests[1]) as { system: string };
    expect(resumed.outcome).toBe("succeeded");
    expect(resumedRequest.system).toContain("msg-before-crash");
    expect(resumedRequest.system).toContain("child");
    expect(resumedRequest.system).not.toContain("SECRET-INPUT");
    expect(resumedRequest.system).not.toContain("SECRET-CREDENTIAL");
    expect(saved).toEqual([null]);
  });

  it("fails closed when the Provider request context exceeds the hard budget", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-internal-agent-budget-"));
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-agent-package-"));
    fs.writeFileSync(path.join(packageRoot, "SKILL.md"), "Use the bounded context.");
    const requests: string[] = [];
    const endpoint = await serve([{ choices: [{ message: { content: "should not be called" } }] }], requests);
    const plan = new InternalAgentRuntime().createPlan({
      manifest: manifest(),
      skillHome: packageRoot,
      mymindRoot: root,
      provider: profile(endpoint),
      inputs: { prompt: "x".repeat(600 * 1024) },
      digest: "e".repeat(64),
      rootGeneration: 1
    });

    const result = await plan.agent!.run({ signal: new AbortController().signal, onOutput: () => undefined });
    expect(result.outcome).toBe("failed");
    expect(result.stderr).toContain("请求上下文超过大小上限");
    expect(requests).toHaveLength(0);
  });

  it("denies shell by default even after the Agent host run is approved", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-internal-agent-"));
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-agent-package-"));
    fs.writeFileSync(path.join(packageRoot, "SKILL.md"), "Do not shell.");
    const requests: string[] = [];
    const endpoint = await serve([
      { choices: [{ message: { content: "", tool_calls: [{ id: "shell-1", type: "function", function: { name: "shell", arguments: JSON.stringify({ command: "node", args: ["-e", "process.exit(0)"] }) } }] } }] }
    ], requests);
    const plan = new InternalAgentRuntime().createPlan({
      manifest: manifest({ allowSubprocess: true }), skillHome: packageRoot, mymindRoot: root, provider: profile(endpoint),
      inputs: {}, digest: "b".repeat(64), rootGeneration: 1
    });
    const result = await plan.agent!.run({ signal: new AbortController().signal, onOutput: () => undefined });
    expect(result.outcome).toBe("failed");
    expect(result.stderr).toContain("shell 被拒绝");
  });
});

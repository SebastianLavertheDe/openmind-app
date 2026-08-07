import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderProfileSchema, type ProviderProfile } from "../../shared/provider-profiles";
import { SkillRunRequestSchema } from "../../shared/execution-contracts";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { ExecutionBroker } from "../execution/execution-broker";
import { InternalAgentRuntime } from "../ai/internal-agent";
import { RuntimeManager } from "../runtime/runtime-manager";
import { SkillPackageService } from "./skill-package-service";
import { InstalledSkillExecutionResolver } from "./installed-skill-execution-resolver";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function provider(baseUrl: string): ProviderProfile {
  return ProviderProfileSchema.parse({
    schemaVersion: 1,
    id: "local-agent-provider",
    name: "Local Agent Provider",
    protocol: "openai-chat",
    credentialId: null,
    baseUrl,
    model: "test-model",
    timeoutMs: 10_000,
    maxRetries: 0,
    proxyPolicy: "disabled",
    tlsPolicy: "verify",
    fallbackProfileId: null,
    test: { status: "success", testedAt: new Date().toISOString(), diagnostic: null }
  });
}

async function startProvider(requests: string[]): Promise<string> {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push(Buffer.concat(chunks).toString("utf8"));
      const body = requests.length === 1
        ? { choices: [{ message: { content: "", tool_calls: [{ id: "topic-write", type: "function", function: { name: "mymind_write", arguments: JSON.stringify({ path: "creative/01-内容生产/选题管理/ai_topic_2026-08-06.md", content: "# 今日最终推荐\n\nInternal Agent E2E\n" }) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }
        : { choices: [{ message: { content: "选题文件已生成。" } }], usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 } };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("provider did not bind");
  return `http://127.0.0.1:${address.port}/v1/chat/completions`;
}

async function waitFor(read: () => string, expected: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (read() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${expected}; got ${read()}`);
}

describe("Installed Internal Agent execution", () => {
  it("runs a real Agent package through Resolver/Broker and persists its declared Artifact", async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-agent-broker-"));
    const paths = buildAppPaths(path.join(fixture, "user-data"));
    ensureAppPaths(paths);
    const mymindRoot = path.join(fixture, "mymind");
    fs.mkdirSync(path.join(mymindRoot, "daily-summary"), { recursive: true });
    fs.writeFileSync(path.join(mymindRoot, "daily-summary", "20260806_daily_summary.md"), "AI local material");
    const packages = new SkillPackageService(paths);
    const installed = packages.install(path.resolve(__dirname, "../../../.claude/skills/ai-media-topic-selector"));
    packages.markReadiness(installed.key, installed.digest, "ready");
    packages.activate(installed.key, installed.digest);
    packages.approveHostExecution(installed.key, installed.digest);

    const requests: string[] = [];
    const endpoint = await startProvider(requests);
    const profile = provider(endpoint);
    const runtime = new InternalAgentRuntime();
    const resolver = new InstalledSkillExecutionResolver(
      packages,
      new RuntimeManager(paths),
      mymindRoot,
      1,
      undefined,
      undefined,
      (id) => id === profile.id ? profile : null,
      (input) => runtime.createPlan({ ...input, skillHome: input.packageRoot })
    );
    const request = SkillRunRequestSchema.parse({
      skillId: "ai-media-topic-selector",
      version: "1.0.0",
      digest: installed.digest,
      inputs: { date: "2026-08-06" },
      providerBindings: { default: profile.id },
      trigger: { type: "manual" },
      externalExportBindingIds: [],
      rootGeneration: 1
    });
    const broker = new ExecutionBroker(paths, (nextRequest, runId) => resolver.resolve(nextRequest, runId), undefined, { maxConcurrentRuns: 1 });
    const run = broker.submit(request);
    try {
      await waitFor(() => broker.get(run.id).state, "waiting_execution_consent");
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${broker.events(run.id).map((event) => JSON.stringify(event)).join("\n")}`);
    }
    expect(broker.approveExecution(run.id)).toBe(true);
    await waitFor(() => broker.get(run.id).state, "succeeded", 30_000);

    const output = path.join(mymindRoot, "creative/01-内容生产/选题管理/ai_topic_2026-08-06.md");
    expect(fs.readFileSync(output, "utf8")).toContain("Internal Agent E2E");
    expect(requests).toHaveLength(2);
    const completed = broker.get(run.id);
    expect(completed.processPid).toBeNull();
    expect(completed.usage).toMatchObject({ model: "test-model", inputTokens: 18, outputTokens: 7, totalTokens: 25 });
    expect(completed.usage?.durationMs).toBeGreaterThanOrEqual(0);
    expect(completed.artifacts.some((artifact) => artifact.logicalPath === `mymind/creative/01-内容生产/选题管理/ai_topic_2026-08-06.md`)).toBe(true);
    expect(broker.events(run.id).some((event) => event.text?.includes("mymind_write"))).toBe(true);
  }, 60_000);

  it("runs all three Agent package kinds with only a Provider Profile", async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-agent-suite-"));
    const paths = buildAppPaths(path.join(fixture, "user-data"));
    ensureAppPaths(paths);
    const mymindRoot = path.join(fixture, "mymind");
    fs.mkdirSync(mymindRoot, { recursive: true });
    const browserExport = path.join(fixture, "browser-evidence");
    fs.mkdirSync(browserExport, { recursive: true });
    const packages = new SkillPackageService(paths);
    const ids = ["ai-media-topic-selector", "creative-writing", "agent-browser"] as const;
    const installed = ids.map((id) => packages.install(path.resolve(__dirname, `../../../.claude/skills/${id}`)));
    for (const record of installed) {
      packages.markReadiness(record.key, record.digest, "ready");
      packages.activate(record.key, record.digest);
      packages.approveHostExecution(record.key, record.digest);
    }
    const requests: string[] = [];
    const endpoint = await startProvider(requests);
    const profile = provider(endpoint);
    const agentRuntime = new InternalAgentRuntime();
    const resolver = new InstalledSkillExecutionResolver(
      packages,
      new RuntimeManager(paths),
      mymindRoot,
      1,
      undefined,
      (id) => id === "browserEvidenceDir" ? { bindingId: id, canonicalPath: browserExport, revoked: false } : undefined,
      (id) => id === profile.id ? profile : null,
      (input) => agentRuntime.createPlan({ ...input, skillHome: input.packageRoot })
    );
    const broker = new ExecutionBroker(paths, (request, runId) => resolver.resolve(request, runId), undefined, { maxConcurrentRuns: 1 });
    for (const record of installed) {
      const externalExportBindingIds = record.id === "agent-browser" ? ["browserEvidenceDir"] : [];
      const run = broker.submit(SkillRunRequestSchema.parse({
        skillId: record.id,
        version: record.version,
        digest: record.digest,
        inputs: record.id === "ai-media-topic-selector" ? { date: "2026-08-06" } : { task: "完成一个本地测试任务" },
        providerBindings: { default: profile.id },
        trigger: { type: "manual" },
        externalExportBindingIds,
        rootGeneration: 1
      }));
      await waitFor(() => broker.get(run.id).state, "waiting_execution_consent");
      expect(broker.approveExecution(run.id)).toBe(true);
      await waitFor(() => broker.get(run.id).state, "succeeded", 30_000);
      expect(broker.get(run.id).terminalState).toBe("succeeded");
    }
    expect(requests).toHaveLength(4);
  }, 90_000);
});

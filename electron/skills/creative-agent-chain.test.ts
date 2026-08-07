import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillRunRequestSchema } from "../../shared/execution-contracts";
import { RuntimePackMetadataSchema } from "../../shared/runtime-targets";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { ExecutionBroker } from "../execution/execution-broker";
import { InternalAgentRuntime } from "../ai/internal-agent";
import { RuntimeManager } from "../runtime/runtime-manager";
import { canonicalRuntimePackPayload } from "../runtime/runtime-pack-verifier";
import { RuntimePackService } from "../runtime/runtime-pack-service";
import { SkillPackageService } from "./skill-package-service";
import { InstalledSkillExecutionResolver } from "./installed-skill-execution-resolver";

const roots: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function waitFor(read: () => string, expected: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (read() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${expected}; got ${read()}`);
}

function pythonExecutable(): string {
  for (const candidate of ["python3", "python"]) {
    try {
      const value = execFileSync(candidate, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim();
      if (path.isAbsolute(value) && fs.statSync(value).isFile()) return value;
    } catch { /* try next */ }
  }
  throw new Error("test Python is unavailable");
}

function installPythonPack(paths: ReturnType<typeof buildAppPaths>): RuntimePackService {
  const bytes = Buffer.from("creative-chain-python-pack");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const metadata = RuntimePackMetadataSchema.parse({
    schemaVersion: 1, packId: "python-core", version: "3.12.1", target: "linux-x64",
    filename: "python-core.pack", size: bytes.length, sha256, publisherKeyId: "runtimeRoot",
    signatureAlgorithm: "ed25519", signature: "placeholder", expiresAt: "2027-01-01T00:00:00.000Z",
    license: "Apache-2.0", sbom: { format: "spdx", digest: sha256 }
  });
  const keys = crypto.generateKeyPairSync("ed25519");
  const service = new RuntimePackService(paths, { runtimeRoot: keys.publicKey.export({ type: "spki", format: "pem" }).toString() });
  service.install({ ...metadata, signature: crypto.sign(null, Buffer.from(canonicalRuntimePackPayload(metadata)), keys.privateKey).toString("base64") }, bytes);
  service.activate("python-core", "linux-x64", sha256);
  return service;
}

async function providerServer(requests: string[], draftPath: { value: string }): Promise<string> {
  const topic = [
    "# AI 选题日报",
    "",
    "## 1. 今日最终推荐",
    "### 今日最值得优先写的主题",
    "**本地 Internal Agent 如何把素材变成可审计内容**",
    "",
    "### 主编判断",
    "本地素材和执行边界值得持续观察。",
    "",
    "## 2. 小红书选题 Agent 输出",
    "### 选题一：本地 Agent 实操",
    "- 推荐指数：9",
    "",
    "## 3. 微信公众号选题 Agent 输出",
    "### 选题一：内容生产链路",
    "- 推荐指数：9",
    "",
    "## 4. 今日候选热点池",
    "|热点|来源|可靠性|传播潜力|写作价值|风险|主编备注|",
    "|---|---|---|---|---|---|---|",
    "|本地 Agent|local|高|高|高|低|可验证|",
    "",
    "## 5. 明日可追踪话题",
    "- Agent Runtime",
    "",
    "## 6. 可沉淀成长期内容的主题",
    "- 审计式内容生产"
  ].join("\n");
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push(Buffer.concat(chunks).toString("utf8"));
      const body = requests.length === 1
        ? { choices: [{ message: { content: "", tool_calls: [{ id: "topic", type: "function", function: { name: "mymind_write", arguments: JSON.stringify({ path: "creative/01-内容生产/选题管理/ai_topic_2026-08-06.md", content: topic }) } }] } }] }
        : requests.length === 2
          ? { choices: [{ message: { content: "选题文件已保存。" } }] }
          : requests.length === 3
            ? { choices: [{ message: { content: "", tool_calls: [{ id: "draft", type: "function", function: { name: "mymind_write", arguments: JSON.stringify({ path: `${draftPath.value}/wechat-draft.md`, content: "# Internal Agent 草稿\n\n这是围绕本地 Agent 的可编辑公众号草稿。\n\n[图1：来源截图，证明 Agent 的执行边界]\n\n来源：https://example.com/source\n" }) } }] } }] }
            : { choices: [{ message: { content: "正式草稿已完成。" } }] };
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

describe("Internal Agent creative chain", () => {
  it("chains AI topic Agent -> writing orchestrator -> asset collector under one root", async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-creative-chain-"));
    roots.push(fixture);
    const paths = buildAppPaths(path.join(fixture, "user-data"));
    ensureAppPaths(paths);
    const mymindRoot = path.join(fixture, "mymind");
    fs.mkdirSync(mymindRoot, { recursive: true });
    const packages = new SkillPackageService(paths);
    const ids = ["ai-media-topic-selector", "daily-writing-orchestrator", "creative-writing", "asset-collector"];
    const records = ids.map((id) => packages.install(path.resolve(__dirname, `../../../.claude/skills/${id}`)));
    for (const record of records) {
      packages.markReadiness(record.key, record.digest, "ready");
      packages.activate(record.key, record.digest);
      packages.approveHostExecution(record.key, record.digest);
    }
    const runtimePacks = installPythonPack(paths);
    const runtime = new RuntimeManager(paths, {
      target: "linux-x64",
      getActivePack: (packId, target) => runtimePacks.getActive(packId, target),
      resolveExecutable: () => pythonExecutable(),
      prepareEnvironment: async () => undefined
    });
    const requests: string[] = [];
    const draftPath = { value: "" };
    const endpoint = await providerServer(requests, draftPath);
    const provider = {
      schemaVersion: 1 as const,
      id: "creative-local",
      name: "Creative local",
      protocol: "openai-chat" as const,
      credentialId: null,
      baseUrl: endpoint,
      model: "test-model",
      timeoutMs: 10_000,
      maxRetries: 0,
      proxyPolicy: "disabled" as const,
      tlsPolicy: "verify" as const,
      fallbackProfileId: null,
      test: { status: "success" as const, testedAt: new Date().toISOString(), diagnostic: null }
    };
    const agentRuntime = new InternalAgentRuntime();
    const resolver = new InstalledSkillExecutionResolver(
      packages,
      runtime,
      mymindRoot,
      1,
      undefined,
      undefined,
      (id) => id === provider.id ? provider : null,
      (input) => agentRuntime.createPlan({ ...input, skillHome: input.packageRoot })
    );
    const broker = new ExecutionBroker(paths, (request, runId) => resolver.resolve(request, runId), undefined, { maxConcurrentRuns: 1 });
    const agent = records[0];
    const agentRun = broker.submit(SkillRunRequestSchema.parse({
      skillId: agent.id,
      version: agent.version,
      digest: agent.digest,
      inputs: { date: "2026-08-06" },
      providerBindings: { default: provider.id },
      trigger: { type: "manual" },
      externalExportBindingIds: [],
      rootGeneration: 1
    }));
    await waitFor(() => broker.get(agentRun.id).state, "waiting_execution_consent");
    expect(broker.approveExecution(agentRun.id)).toBe(true);
    await waitFor(() => broker.get(agentRun.id).state, "succeeded");

    const orchestrator = records[1];
    const orchestratorRun = broker.submit(SkillRunRequestSchema.parse({
      skillId: orchestrator.id,
      version: orchestrator.version,
      digest: orchestrator.digest,
      inputs: { date: "20260806", topic: "auto", platform: "all" },
      providerBindings: {},
      trigger: { type: "manual" },
      externalExportBindingIds: [],
      rootGeneration: 1
    }));
    await waitFor(() => broker.get(orchestratorRun.id).state, "waiting_execution_consent");
    expect(broker.approveExecution(orchestratorRun.id)).toBe(true);
    await waitFor(() => broker.get(orchestratorRun.id).state, "succeeded");
    const packageRoot = path.join(mymindRoot, "creative/01-内容生产/文稿库/02-制作中");
    const packageDir = fs.readdirSync(packageRoot, { withFileTypes: true }).find((entry) => entry.isDirectory());
    expect(packageDir).toBeTruthy();
    const logicalDraftDir = `creative/01-内容生产/文稿库/02-制作中/${packageDir!.name}`;
    draftPath.value = logicalDraftDir;

    const writer = records[2];
    const writerRun = broker.submit(SkillRunRequestSchema.parse({
      skillId: writer.id,
      version: writer.version,
      digest: writer.digest,
      inputs: { task: "接管这个写作包并生成公众号草稿", draftDir: logicalDraftDir },
      providerBindings: { default: provider.id },
      trigger: { type: "manual" },
      externalExportBindingIds: [],
      rootGeneration: 1
    }));
    await waitFor(() => broker.get(writerRun.id).state, "waiting_execution_consent");
    expect(broker.approveExecution(writerRun.id)).toBe(true);
    await waitFor(() => broker.get(writerRun.id).state, "succeeded");
    expect(broker.get(writerRun.id).artifacts.some((artifact) => artifact.logicalPath?.endsWith("wechat-draft.md"))).toBe(true);

    const collector = records[3];
    const collectorRun = broker.submit(SkillRunRequestSchema.parse({
      skillId: collector.id,
      version: collector.version,
      digest: collector.digest,
      inputs: { draftDir: logicalDraftDir, date: "20260806" },
      providerBindings: {},
      trigger: { type: "manual" },
      externalExportBindingIds: [],
      rootGeneration: 1
    }));
    await waitFor(() => broker.get(collectorRun.id).state, "waiting_execution_consent");
    expect(broker.approveExecution(collectorRun.id)).toBe(true);
    await waitFor(() => broker.get(collectorRun.id).state, "succeeded");
    expect(broker.get(agentRun.id).artifacts.some((artifact) => artifact.logicalPath?.includes("ai_topic_2026-08-06.md"))).toBe(true);
    expect(broker.get(orchestratorRun.id).artifacts.some((artifact) => artifact.logicalPath?.includes("topic-brief.md"))).toBe(true);
    expect(broker.get(writerRun.id).artifacts.some((artifact) => artifact.logicalPath?.endsWith("wechat-draft.md"))).toBe(true);
    expect(broker.get(collectorRun.id).artifacts.some((artifact) => artifact.logicalPath?.endsWith("assets/manifest.json"))).toBe(true);
    expect(requests).toHaveLength(4);
  }, 120_000);
});

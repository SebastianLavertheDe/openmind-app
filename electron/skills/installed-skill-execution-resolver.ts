import fs from "node:fs";
import path from "node:path";
import type { SkillRunRequest } from "../../shared/execution-contracts";
import type { SkillDefinition } from "../../shared/contracts";
import { matchesSemverRange, type ProcessManifest, type SkillManifest } from "../../shared/skill-manifest-schema";
import { SkillPackageService } from "./skill-package-service";
import type { InstalledSkillRecord } from "./installed-skill-repository";
import { RuntimeManager } from "../runtime/runtime-manager";
import type { ExecutionPlan } from "../execution/execution-broker";
import type { ExternalBinding } from "../execution/artifact-collector";
import type { ProviderSkillBridge } from "../ai/providers/skill-bridge";
import { readDefaultProviderEnv } from "../config/providers-yaml";

const FORBIDDEN_ENV_NAMES = new Set(["PATH", "HOME", "NODE_OPTIONS", "PYTHONPATH", "LD_PRELOAD"]);

export type SkillExportBindingResolver = (bindingId: string) => ExternalBinding | undefined;

export class InstalledSkillExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstalledSkillExecutionError";
  }
}

/**
 * Converts one active, ready, approved-host package into a Broker plan. This
 * resolver performs package/input checks; RuntimeManager owns execution-time
 * preparation, and Broker owns process lifecycle. The AI provider comes from
 * the single plaintext `config/providers.yaml` source of truth (injected as
 * `CCTOOLS_PROVIDER_*` env), shared with the crontab-driven Python path.
 */
export class InstalledSkillExecutionResolver {
  constructor(
    private readonly packages: SkillPackageService,
    private readonly runtimes: RuntimeManager,
    private readonly mymindRoot: string,
    private readonly rootGeneration: number,
    private readonly resolveExportBinding?: SkillExportBindingResolver
  ) {}

  active(skillId: string): InstalledSkillRecord | undefined {
    return this.packages.getActiveInstalled(skillId);
  }

  /** Agent packages are executed only by the selected Claude Code/Codex CLI bridge. */
  assertBrokerRunnable(skillId: string): void {
    const record = this.active(skillId);
    if (!record) return;
    const inspection = this.packages.inspect(record.packagePath);
    if (inspection.valid && inspection.manifest?.kind === "agent") throw cliOnlyAgentError(skillId);
  }

  /**
   * Resolves an approved Agent package for the external Codex/Claude bridge.
   * The returned physical paths never cross the Renderer boundary; adapters
   * re-check the package boundary before reading or handing them to a host.
   */
  providerSkillBridge(skillId: string): ProviderSkillBridge | null {
    const record = this.active(skillId);
    if (!record) return null;
    const inspection = this.packages.inspect(record.packagePath);
    if (!inspection.valid || !inspection.manifest || inspection.digest !== record.digest) {
      throw new InstalledSkillExecutionError("active Agent Skill 内容 digest 已变化，拒绝交给 Provider Bridge。 ");
    }
    if (inspection.manifest.kind !== "agent") return null;
    if (record.status !== "active" || record.readiness !== "ready" || record.executionTrust !== "approved-host") {
      throw new InstalledSkillExecutionError(`Agent Skill 尚未 ready/approved-host：${skillId}`);
    }
    const packageRoot = canonicalDirectory(record.packagePath);
    const skillPath = resolvePackageFile(packageRoot, "SKILL.md");
    return {
      id: inspection.manifest.id,
      version: inspection.manifest.version,
      digest: record.digest,
      packageRoot,
      skillPath,
      referencePaths: listReferenceFiles(packageRoot),
      mymindRoot: canonicalDirectory(this.mymindRoot),
      capabilities: inspection.manifest.capabilities
    };
  }

  /**
   * Exposes only runnable Installed Skill metadata to AI/Renderer surfaces.
   * Legacy workspace discovery remains available for migration/inspection, but
   * it must not be presented as a Broker-runnable slash command once the
   * installed resolver is active.
   */
  listDefinitions(): SkillDefinition[] {
    return this.packages.listInstalled()
      .filter((record) => record.status === "active" && record.readiness === "ready" && record.executionTrust === "approved-host")
      .flatMap((record) => {
        try {
          const inspection = this.packages.inspect(record.packagePath);
          if (!inspection.valid || !inspection.manifest || inspection.digest !== record.digest) return [];
          const manifest = inspection.manifest;
          return [{
            id: manifest.id,
            title: manifest.display.name,
            description: manifest.display.description,
            // This is a logical identifier, not a filesystem path. The real
            // executable is resolved only inside Main/RuntimeManager.
            cwd: `installed/${record.publisherId}/${record.id}/${record.version}`,
            command: "managed-runtime",
            runner: "managed-runtime",
            args: [],
            envFile: null,
            group: manifest.display.group,
            permission: manifest.capabilities.mymind.write.length ? "edit" as const : "read-only" as const,
            outputArtifacts: manifest.artifacts.map((artifact) => artifact.path
              ? `mymind/${artifact.path}`
              : `external:${artifact.externalExportId}`),
            timeoutMs: manifest.execution.timeoutSeconds * 1000
          } satisfies SkillDefinition];
        } catch {
          return [];
        }
      });
  }

  workflowManifest(skillId: string, version?: string): Extract<SkillManifest, { kind: "workflow" }> {
    const record = this.active(skillId);
    if (!record) throw new InstalledSkillExecutionError(`Workflow Skill 不存在：${skillId}`);
    if (version && record.version !== version) throw new InstalledSkillExecutionError("请求的 Workflow version 不是 active 版本。 ");
    const inspection = this.packages.inspect(record.packagePath);
    if (!inspection.valid || !inspection.manifest || inspection.digest !== record.digest || inspection.manifest.kind !== "workflow") {
      throw new InstalledSkillExecutionError("active Workflow Manifest 校验失败。 ");
    }
    if (record.readiness !== "ready") throw new InstalledSkillExecutionError(`Workflow Skill 尚未 ready：${skillId}`);
    return inspection.manifest;
  }

  async resolve(request: SkillRunRequest, runId: string): Promise<ExecutionPlan> {
    const record = this.active(request.skillId);
    if (!record) throw new InstalledSkillExecutionError(`没有 active Installed Skill：${request.skillId}`);
    if (request.version && !matchesSemverRange(record.version, request.version)) throw new InstalledSkillExecutionError("请求的 Skill version 不是 active 版本。 ");
    if (request.digest && request.digest.toLowerCase() !== record.digest.toLowerCase()) throw new InstalledSkillExecutionError("请求的 Skill digest 不是 active 版本。 ");

    const inspection = this.packages.inspect(record.packagePath);
    if (!inspection.valid || !inspection.manifest) throw new InstalledSkillExecutionError("active Installed Skill Manifest 校验失败。 ");
    if (inspection.digest !== record.digest) throw new InstalledSkillExecutionError("active Installed Skill 内容 digest 已变化，拒绝运行。 ");
    if (record.readiness !== "ready") throw new InstalledSkillExecutionError("Installed Skill 尚未 ready，拒绝运行。 ");
    // Automation rules and their workflow step runs are explicit user
    // authorisation to run a Skill on a schedule; treat a configured
    // Automation rule (and the workflow steps it drives) as the approved-host
    // grant so users are not forced to flip executionTrust per-Skill before a
    // scheduled run can execute.
    const automationAuthorised = request.trigger.type === "automation" || request.trigger.type === "workflow";
    if (!automationAuthorised && record.executionTrust !== "approved-host") throw new InstalledSkillExecutionError("Installed Skill 尚未获得 approved-host 授权。 ");
    const manifest = inspection.manifest;
    const inputs = applyInputDefaults(manifest, request.inputs);
    validateInputs(manifest, inputs);
    if (request.rootGeneration !== this.rootGeneration) throw new InstalledSkillExecutionError("Run root generation 已过期。 ");
    if (manifest.kind === "agent") throw cliOnlyAgentError(manifest.id);
    const packageRoot = canonicalDirectory(record.packagePath);
    // The single plaintext config/providers.yaml feeds the 7 CCTOOLS_PROVIDER_*
    // env vars; the crontab Python path reads the same file directly.
    const provider = readDefaultProviderEnv();
    const externalBindings: Record<string, ExternalBinding> = {};
    for (const artifact of manifest.artifacts) {
      if (!artifact.externalExportId) continue;
      if (!request.externalExportBindingIds.includes(artifact.externalExportId)) {
        throw new InstalledSkillExecutionError(`缺少 Artifact Export Location Binding：${artifact.externalExportId}`);
      }
      const binding = this.resolveExportBinding?.(artifact.externalExportId);
      if (!binding) throw new InstalledSkillExecutionError(`Export Location Binding 不可用：${artifact.externalExportId}`);
      externalBindings[artifact.externalExportId] = binding;
    }
    if (manifest.kind !== "process") throw new InstalledSkillExecutionError("只有 Process Skill 可由 Execution Broker 执行。 ");
    const script = resolvePackageFile(packageRoot, manifest.entrypoint.script);
    const runtime = this.runtimes.resolve(manifest, packageRoot, record.digest);
    const args = manifest.entrypoint.args.map((arg) => resolveTemplate(arg, inputs, externalBindings));
    const manifestEnv = resolveEntrypointEnv(manifest, inputs);
    const artifacts = manifest.artifacts.map((artifact) => artifact.path
      ? { id: artifact.id, type: artifact.type, logicalPath: resolveTemplate(artifact.path, inputs) }
      : { id: artifact.id, type: artifact.type, externalPathRef: artifact.externalExportId });
    const plan: ExecutionPlan = {
      skillId: manifest.id,
      version: manifest.version,
      digest: record.digest,
      rootGeneration: this.rootGeneration,
      skillHome: packageRoot,
      mymindRoot: canonicalDirectory(this.mymindRoot),
      capabilities: manifest.capabilities,
      runtime: {
        target: runtime.target,
        packId: runtime.packId,
        packDigest: runtime.packDigest,
        fingerprint: runtime.fingerprint
      },
      process: {
        executable: runtime.executable,
        args: [script, ...args],
        cwd: packageRoot,
        env: { ...runtime.env, ...manifestEnv.values, ...provider.env },
        timeoutMs: manifest.execution.timeoutSeconds * 1000,
        gracefulStopMs: manifest.execution.gracefulStopSeconds * 1000
      },
      acquireRuntime: () => runtime.acquire(runId),
      releaseRuntime: () => runtime.release(runId),
      retry: { maxAttempts: manifest.execution.retry.maxAttempts },
      maxInstances: manifest.execution.concurrency.maxInstances,
      mutexes: [...manifest.execution.concurrency.mutexes],
      artifacts,
      ...(Object.keys(externalBindings).length ? { externalBindings } : {}),
      requiresHostConsent: true,
      credentialIds: [],
      knownSecrets: provider.apiKey ? [provider.apiKey] : [],
      prepareRuntime: async () => {
        await runtime.prepare();
        // Python environments are created only after host-execution consent;
        // refresh the process spec with the prepared absolute interpreter.
        plan.process.executable = runtime.executable;
        plan.process.env = { ...plan.process.env, ...runtime.env, ...manifestEnv.values, ...provider.env };
      }
    };
    return plan;
  }
}

function validateInputs(manifest: SkillManifest, inputs: Record<string, unknown>): void {
  const schema = manifest.inputs;
  if (!schema) return;
  for (const key of schema.required || []) {
    if (!(key in inputs) || inputs[key] === undefined || inputs[key] === null || inputs[key] === "") {
      throw new InstalledSkillExecutionError(`缺少必填输入：${key}`);
    }
  }
  for (const [key, descriptor] of Object.entries(schema.properties || {})) {
    if (!(key in inputs) || !descriptor || typeof descriptor !== "object") continue;
    const type = String((descriptor as { type?: unknown }).type || "");
    const value = inputs[key];
    if (type === "string" && typeof value !== "string") throw new InstalledSkillExecutionError(`输入 ${key} 必须是 string。`);
    if (type === "number" && typeof value !== "number") throw new InstalledSkillExecutionError(`输入 ${key} 必须是 number。`);
    if (type === "boolean" && typeof value !== "boolean") throw new InstalledSkillExecutionError(`输入 ${key} 必须是 boolean。`);
  }
}

function applyInputDefaults(manifest: SkillManifest, inputs: Record<string, unknown>): Record<string, unknown> {
  const properties = manifest.inputs?.properties || {};
  const resolved = { ...inputs };
  for (const [name, descriptor] of Object.entries(properties)) {
    if (name in resolved || !descriptor || typeof descriptor !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(descriptor, "default")) {
      resolved[name] = (descriptor as { default?: unknown }).default;
    }
  }
  return resolved;
}

function resolveEntrypointEnv(
  manifest: ProcessManifest,
  inputs: Record<string, unknown>
): {
  values: Record<string, string>;
} {
  const env = manifest.entrypoint.env || {};
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (FORBIDDEN_ENV_NAMES.has(name) || name.startsWith("DYLD_")) {
      throw new InstalledSkillExecutionError(`Manifest 禁止绑定危险环境变量：${name}`);
    }
    result[name] = resolveTemplate(value, inputs);
  }
  return { values: { ...result, ...resolveSourceContextEnv(inputs) } };
}

/**
 * Source-trigger metadata is app context, not a user Secret or a free-form
 * environment override. Manual/source callers may supply these bounded
 * values, and the installed process receives them through the same minimal
 * Broker environment as every other input.
 */
function resolveSourceContextEnv(inputs: Record<string, unknown>): Record<string, string> {
  const mappings: Record<string, string> = {
    sourceId: "CCTOOLS_SOURCE_ID",
    sourceUrl: "CCTOOLS_SOURCE_URL",
    sourceName: "CCTOOLS_SOURCE_NAME"
  };
  const result: Record<string, string> = {};
  for (const [inputKey, envName] of Object.entries(mappings)) {
    const value = inputs[inputKey];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length > 4096) {
      throw new InstalledSkillExecutionError(`Skill 输入无效：${inputKey}`);
    }
    result[envName] = value;
  }
  return result;
}

export function cliOnlyAgentError(skillId: string): InstalledSkillExecutionError {
  return new InstalledSkillExecutionError(
    `Agent Skill 仅支持通过 AI 控制台使用 Claude Code CLI 或 Codex CLI 运行。请选择一个可用的 CLI Provider，并在会话中输入 /${skillId} …`
  );
}

function resolveTemplate(
  value: string,
  inputs: Record<string, unknown>,
  exports: Record<string, ExternalBinding> = {}
): string {
  const withExports = value.replace(/\{\{\s*exports\.([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, bindingId: string) => {
    const binding = exports[bindingId];
    if (!binding) throw new InstalledSkillExecutionError(`模板引用的 Export Location Binding 未绑定：${bindingId}`);
    return binding.canonicalPath;
  });
  return withExports.replace(/\{\{\s*inputs\.([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const resolved = inputs[key];
    if (resolved === undefined || resolved === null) throw new InstalledSkillExecutionError(`模板引用的输入不存在：${key}`);
    if (typeof resolved === "object") throw new InstalledSkillExecutionError(`模板输入不能是 object：${key}`);
    return String(resolved);
  });
}

function canonicalDirectory(candidate: string): string {
  try {
    const canonical = fs.realpathSync(path.resolve(candidate));
    if (!fs.statSync(canonical).isDirectory()) throw new Error("not directory");
    return canonical;
  } catch {
    throw new InstalledSkillExecutionError(`目录不可访问：${candidate}`);
  }
}

function listReferenceFiles(root: string): string[] {
  const referencesRoot = path.join(root, "references");
  if (!fs.existsSync(referencesRoot)) return [];
  const result: string[] = [];
  const walk = (directory: string, prefix: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const canonical = fs.realpathSync(candidate);
        const relativeToRoot = path.relative(root, canonical);
        if (!relativeToRoot || relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
          throw new InstalledSkillExecutionError(`Agent Skill reference 越出已安装包：${relative}`);
        }
        if (fs.statSync(canonical).isFile()) result.push(relative);
        else if (fs.statSync(canonical).isDirectory()) walk(canonical, relative);
        continue;
      }
      if (entry.isDirectory()) walk(candidate, relative);
      else if (entry.isFile()) result.push(relative);
    }
  };
  walk(referencesRoot, "references");
  return result.sort();
}

function resolvePackageFile(root: string, relativePath: string): string {
  const candidate = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(candidate)) {
    throw new InstalledSkillExecutionError(`Entrypoint 越出 Skill 包或不存在：${relativePath}`);
  }
  const canonical = fs.realpathSync(candidate);
  const canonicalRoot = fs.realpathSync(root);
  if (!canonical.startsWith(`${canonicalRoot}${path.sep}`) || !fs.statSync(canonical).isFile()) {
    throw new InstalledSkillExecutionError(`Entrypoint 不是包内普通文件：${relativePath}`);
  }
  return canonical;
}

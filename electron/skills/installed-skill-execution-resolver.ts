import fs from "node:fs";
import path from "node:path";
import type { SkillRunRequest } from "../../shared/execution-contracts";
import type { AiSessionSkillSnapshotEntry, SkillDefinition } from "../../shared/contracts";
import { matchesSemverRange, type ProcessManifest, type SkillManifest } from "../../shared/skill-manifest-schema";
import { SkillPackageService } from "./skill-package-service";
import type { InstalledSkillRecord } from "./installed-skill-repository";
import { RuntimeManager } from "../runtime/runtime-manager";
import type { ExecutionPlan } from "../execution/execution-broker";
import type { ExternalBinding } from "../execution/artifact-collector";
import type { ProviderSkillBridge } from "../ai/providers/skill-bridge";
import { readDefaultProviderEnv } from "../config/providers-yaml";
import type { WorkflowAdmission } from "../execution/workflow-engine";

const FORBIDDEN_ENV_NAMES = new Set(["PATH", "HOME", "NODE_OPTIONS", "PYTHONPATH", "LD_PRELOAD"]);

export type SkillExportBindingResolver = (bindingId: string) => ExternalBinding | undefined;

export class InstalledSkillExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstalledSkillExecutionError";
  }
}

/**
 * Converts one installed, integrity-checked package into a Broker plan. This
 * resolver performs package/input checks; RuntimeManager owns execution-time
 * preparation, and Broker owns process lifecycle. The AI provider comes from
 * the single plaintext `config/providers.yaml` source of truth (injected as
 * `OPENMIND_PROVIDER_*` env), shared with the crontab-driven Python path.
 */
export class InstalledSkillExecutionResolver {
  constructor(
    private readonly packages: SkillPackageService,
    private readonly runtimes: RuntimeManager,
    private readonly openmindRoot: string,
    private readonly rootGeneration: number,
    private readonly resolveExportBinding?: SkillExportBindingResolver
  ) {}

  installed(skillId: string): InstalledSkillRecord | undefined {
    return this.packages.getInstalledById(skillId);
  }

  /** Resolve the current user-enabled package at a new execution boundary. */
  enabledInstalled(skillId: string): InstalledSkillRecord | undefined {
    const record = this.installed(skillId);
    if (!record) return undefined;
    this.assertEnabled(record);
    return record;
  }

  /**
   * Admit a new Broker request and return the exact package identity that must
   * be persisted with it. Callers use the returned version/digest to prevent a
   * queued wildcard request from silently switching to a later installation.
   */
  assertBrokerRunnable(request: Pick<SkillRunRequest, "skillId" | "version" | "digest">): InstalledSkillRecord {
    const record = this.enabledInstalled(request.skillId);
    if (!record) throw new InstalledSkillExecutionError(`没有已安装的 Skill：${request.skillId}`);
    if (request.version && !matchesSemverRange(record.version, request.version)) {
      throw new InstalledSkillExecutionError("请求的 Skill version 与已安装版本不匹配。 ");
    }
    if (request.digest && request.digest.toLowerCase() !== record.digest.toLowerCase()) {
      throw new InstalledSkillExecutionError("请求的 Skill digest 与已安装版本不一致。 ");
    }
    const inspection = this.packages.inspectInstalledCopy(record);
    if (!inspection.manifest) throw new InstalledSkillExecutionError("Installed Skill Manifest 校验失败。 ");
    if (inspection.manifest.kind === "agent") throw cliOnlyAgentError(request.skillId);
    if (inspection.manifest.kind !== "process"
      || inspection.manifest.id !== record.id
      || inspection.manifest.version !== record.version) {
      throw new InstalledSkillExecutionError(`只有完整的 Process Skill 可由 Broker 执行：${request.skillId}`);
    }
    return record;
  }

  /**
   * Re-validates an exact Process package pinned by a Workflow admission. This
   * intentionally ignores the current enabled preference: toggling a Skill
   * must not mutate a Workflow that was already admitted, while replacement or
   * package tampering must still fail closed before every child submission.
   */
  assertAdmittedBrokerRunnable(request: Pick<SkillRunRequest, "skillId" | "version" | "digest">): void {
    if (!request.version || !request.digest) {
      throw new InstalledSkillExecutionError("已准入的 Workflow Step 缺少精确 version 或 digest。 ");
    }
    const record = this.installed(request.skillId);
    if (!record) throw new InstalledSkillExecutionError(`已准入的 Workflow Step 已被删除：${request.skillId}`);
    if (record.version !== request.version || record.digest.toLowerCase() !== request.digest.toLowerCase()) {
      throw new InstalledSkillExecutionError(`已准入的 Workflow Step package identity 已变化：${request.skillId}`);
    }
    const inspection = this.packages.inspectInstalledCopy(record);
    if (!inspection.manifest
      || inspection.manifest.kind !== "process"
      || inspection.manifest.id !== request.skillId
      || inspection.manifest.version !== request.version) {
      throw new InstalledSkillExecutionError(`已准入的 Workflow Step 不再是匹配的 Process Skill：${request.skillId}`);
    }
  }

  /**
   * Resolves an integrity-checked Agent package for the external Codex/Claude bridge.
   * The returned physical paths never cross the Renderer boundary; adapters
   * re-check the package boundary before reading or handing them to a host.
   */
  providerSkillBridge(snapshot: AiSessionSkillSnapshotEntry): ProviderSkillBridge | null {
    if (!snapshot.installed) {
      throw new InstalledSkillExecutionError(`会话 Skill 缺少 Installed provenance：${snapshot.definition.id}`);
    }
    const reference = snapshot.installed;
    const record = this.packages.getInstalled(reference.key, reference.digest);
    if (!record
      || record.id !== snapshot.definition.id
      || record.version !== reference.version
      || record.digest.toLowerCase() !== reference.digest.toLowerCase()) {
      throw new InstalledSkillExecutionError(`会话绑定的 Installed Skill 已被替换或删除：${snapshot.definition.id}`);
    }
    // Deliberately do not read the current enabled preference here. Existing
    // sessions retain their capability set, while package bytes and identity
    // are still re-inspected on every bridge resolution.
    const inspection = this.packages.inspectInstalledCopy(record);
    if (!inspection.manifest) throw new InstalledSkillExecutionError("Installed Agent Skill Manifest 校验失败。 ");
    if (inspection.manifest.kind !== "agent") {
      // Never let an Installed Process/Workflow snapshot fall through to the
      // providers' legacy workspace Skill lookup. That would cross the exact
      // package identity frozen with the conversation.
      throw new InstalledSkillExecutionError(`会话 Skill 不是 Agent 类型，不能交给 Provider Bridge：${snapshot.definition.id}`);
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
      openmindRoot: canonicalDirectory(this.openmindRoot),
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
    return this.captureSessionSnapshot().map((entry) => entry.definition);
  }

  /**
   * Capture renderer-safe Agent metadata plus exact installed provenance. New
   * sessions use enabled Agent packages only; legacy backfill opts into every
   * usable Agent package to preserve the old all-installed behavior. Process
   * and Workflow packages stay on their Broker/Automation boundaries.
   */
  captureSessionSnapshot(includeDisabled = false): AiSessionSkillSnapshotEntry[] {
    let records = this.packages.listInstalled();
    if (!includeDisabled) {
      try {
        records = records.filter((record) => this.packages.isEnabled(record));
      } catch {
        // A corrupt preference file must not make bootstrap fatal. Treat the
        // entire current catalog as unavailable until the user repairs it.
        return [];
      }
    }
    const entries = records.flatMap((record) => {
      try {
        const entry = this.snapshotEntry(record);
        return entry ? [entry] : [];
      } catch {
        return [];
      }
    });
    // Slash commands are keyed by manifest id. Ambiguous ids fail closed
    // instead of making a session snapshot invalid or selecting a publisher
    // by incidental registry order.
    const idCounts = new Map<string, number>();
    for (const entry of entries) idCounts.set(entry.definition.id, (idCounts.get(entry.definition.id) || 0) + 1);
    return entries.filter((entry) => idCounts.get(entry.definition.id) === 1);
  }

  workflowManifest(skillId: string, version?: string): Extract<SkillManifest, { kind: "workflow" }> {
    const record = this.enabledInstalled(skillId);
    if (!record) throw new InstalledSkillExecutionError(`Workflow Skill 不存在：${skillId}`);
    if (version && record.version !== version) throw new InstalledSkillExecutionError("请求的 Workflow version 与已安装版本不一致。 ");
    const inspection = this.packages.inspectInstalledCopy(record);
    if (!inspection.manifest || inspection.manifest.kind !== "workflow") {
      throw new InstalledSkillExecutionError("Installed Workflow Manifest 校验失败。 ");
    }
    return inspection.manifest;
  }

  /** Admit the Workflow body and every referenced Process Step as one unit. */
  admitWorkflow(skillId: string, version?: string): WorkflowAdmission {
    const manifest = this.workflowManifest(skillId, version);
    const steps = manifest.workflow.steps.map((step) => {
      const record = this.enabledInstalled(step.skill);
      if (!record) throw new InstalledSkillExecutionError(`Workflow Step Skill 不存在：${step.skill}`);
      if (!matchesSemverRange(record.version, step.version)) {
        throw new InstalledSkillExecutionError(`Workflow Step ${step.id} 的 version 与已安装版本不匹配。 `);
      }
      const inspection = this.packages.inspectInstalledCopy(record);
      if (!inspection.manifest
        || inspection.manifest.kind !== "process"
        || inspection.manifest.id !== step.skill
        || inspection.manifest.version !== record.version) {
        throw new InstalledSkillExecutionError(`Workflow Step ${step.id} 不是可用的 Process Skill。 `);
      }
      return {
        stepId: step.id,
        skillId: record.id,
        version: record.version,
        digest: record.digest.toLowerCase()
      };
    });
    return { manifest, steps };
  }

  async resolve(request: SkillRunRequest, runId: string): Promise<ExecutionPlan> {
    const record = this.installed(request.skillId);
    if (!record) throw new InstalledSkillExecutionError(`没有已安装的 Skill：${request.skillId}`);
    if (request.version && !matchesSemverRange(record.version, request.version)) throw new InstalledSkillExecutionError("请求的 Skill version 与已安装版本不匹配。 ");
    if (request.digest && request.digest.toLowerCase() !== record.digest.toLowerCase()) throw new InstalledSkillExecutionError("请求的 Skill digest 与已安装版本不一致。 ");

    const inspection = this.packages.inspectInstalledCopy(record);
    if (!inspection.manifest) throw new InstalledSkillExecutionError("Installed Skill Manifest 校验失败。 ");
    const manifest = inspection.manifest;
    const inputs = applyInputDefaults(manifest, request.inputs);
    validateInputs(manifest, inputs);
    if (request.rootGeneration !== this.rootGeneration) throw new InstalledSkillExecutionError("Run root generation 已过期。 ");
    if (manifest.kind === "agent") throw cliOnlyAgentError(manifest.id);
    const packageRoot = canonicalDirectory(record.packagePath);
    const openmindRoot = canonicalDirectory(this.openmindRoot);
    // Resolve provider state against the same frozen root snapshot as content;
    // never let a later workspace/settings change redirect an admitted run.
    const provider = readDefaultProviderEnv(openmindRoot);
    // Managed runs receive only the selected Provider fields. The full YAML
    // path is reserved for trusted cron/direct runs so a Skill cannot open
    // unrelated credentials from the private provider file.
    const providerEnvironment = provider.env;
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
      openmindRoot,
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
        env: { ...runtime.env, ...manifestEnv.values, ...providerEnvironment },
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
      credentialIds: [],
      knownSecrets: provider.apiKey ? [provider.apiKey] : [],
      prepareRuntime: async () => {
        await runtime.prepare();
        // Refresh the process spec with the prepared absolute interpreter.
        plan.process.executable = runtime.executable;
        plan.process.env = { ...plan.process.env, ...runtime.env, ...manifestEnv.values, ...providerEnvironment };
      }
    };
    return plan;
  }

  private assertEnabled(record: InstalledSkillRecord): void {
    if (!this.packages.isEnabled(record)) {
      throw new InstalledSkillExecutionError(`Skill 已停用；重新启用后仅对新执行或新会话生效：${record.id}`);
    }
  }

  private snapshotEntry(record: InstalledSkillRecord): AiSessionSkillSnapshotEntry | null {
    const inspection = this.packages.inspectInstalledCopy(record);
    if (!inspection.manifest) throw new InstalledSkillExecutionError("Installed Skill Manifest 校验失败。 ");
    const manifest = inspection.manifest;
    // AI conversation snapshots are provider-native Agent catalogs. Process
    // and Workflow packages stay available through their Broker/Automation
    // entry points and must never be reinterpreted as workspace Agent Skills.
    if (manifest.kind !== "agent") return null;
    return {
      definition: {
        id: manifest.id,
        title: manifest.display.name,
        description: manifest.display.description,
        // Logical metadata only. Physical paths remain Main-only and are
        // recovered from exact installed provenance at execution time.
        cwd: `installed/${record.publisherId}/${record.id}/${record.version}`,
        command: "managed-runtime",
        runner: "managed-runtime",
        args: [],
        envFile: null,
        group: manifest.display.group,
        permission: manifest.capabilities.openmind.write.length ? "edit" : "read-only",
        outputArtifacts: manifest.artifacts.map((artifact) => artifact.path
          ? `openmind/${artifact.path}`
          : `external:${artifact.externalExportId}`),
        timeoutMs: manifest.execution.timeoutSeconds * 1000
      },
      installed: {
        key: record.key,
        version: record.version,
        digest: record.digest.toLowerCase()
      }
    };
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
    sourceId: "OPENMIND_SOURCE_ID",
    sourceUrl: "OPENMIND_SOURCE_URL",
    sourceName: "OPENMIND_SOURCE_NAME"
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

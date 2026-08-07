/**
 * Skill Manifest v1 — Zod schema source of truth.
 *
 * Frozen by ADR-003. A `cctools.skill.yaml` is validated strictly by
 * {@link SkillManifestSchema}. A skill is NOT runnable without a valid
 * manifest. Legacy `SKILL.md`-only skills go through a separate legacy
 * adapter and remain inspect-only.
 *
 * Invariants enforced here (and re-checked at install/run):
 *  - `apiVersion` is exactly `cctools.dev/skill/v1`.
 *  - `id` is lowercase, dotted/dashed, unique per publisher.
 *  - `version` is semver.
 *  - `kind` is process | workflow | agent.
 *  - process/workflow require entrypoint or workflow; agent forbids entrypoint.
 *  - No secret values; secrets are referenced by name only.
 *  - No absolute paths; all package paths are relative + forward-slash.
 *  - `capabilities.mymind.write` top-level dirs ⊆ mymind-layout-v1
 *    {@link MYMIND_ALLOWED_TOP_LEVEL_DIRS} (cross-checked at install).
 *
 * NOTE: the mymind-layout subset check is performed by the installer/resolver
 * (which imports from `./mymind-layout-v1`), not inside this pure schema, so
 * this module stays free of fs/platform concerns and remains unit-testable in
 * isolation.
 */

import { z } from "zod";

export const SKILL_MANIFEST_API_VERSION = "cctools.dev/skill/v1" as const;

// --- primitives -------------------------------------------------------------

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
/** Range token accepted by manifests. The matcher below intentionally stays
 * small and deterministic, but supports the forms needed by Runtime and
 * Workflow bindings: exact/partial versions, x wildcards, caret/tilde,
 * comparators and `||` alternatives. */
const SEMVER_RANGE_TOKEN_RE = /^(?:[~^]|>=|<=|>|<|=)?(?:\*|(?:0|[1-9]\d*)(?:\.(?:\*|x|X|(?:0|[1-9]\d*)))?(?:\.(?:\*|x|X|(?:0|[1-9]\d*)))?(?:-[0-9a-zA-Z.\-]+)?(?:\+[0-9a-zA-Z.\-]+)?)$/;

function isSemverRangeExpression(value: string): boolean {
  const branches = value.split("||").map((branch) => branch.trim()).filter(Boolean);
  return branches.length > 0 && branches.every((branch) => {
    const tokens = branch.split(/[ ,]+/).filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => SEMVER_RANGE_TOKEN_RE.test(token));
  });
}

/** Skill id: lowercase, digits, `-`, `.`, must start with a letter. */
const SkillIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9-._]*$/, "id must be lowercase, start with a letter, only [a-z0-9-._]");

/** A path that is relative, forward-slash, has no `..` or empty segments, and no drive/UNC prefix. */
const RelativePackagePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.startsWith("/"), "absolute paths are forbidden")
  .refine((p) => !/^[a-zA-Z]:[\\/]/.test(p), "drive-relative paths are forbidden")
  .refine((p) => !p.startsWith("\\\\"), "UNC paths are forbidden")
  .refine((p) => p.split("/").every((seg) => seg.length > 0 && seg !== "." && seg !== ".."), "empty / '.' / '..' segments forbidden");

/** Logical mymind pattern: forward-slash, no leading '/', top-level must be a known content dir.
 *  Allows a single trailing `/**` or `/*`. */
const MymindPatternSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((p) => !p.startsWith("/"), "pattern must be relative")
  .refine((p) => !p.includes("\\"), "pattern must use forward slashes")
  .refine((p) => !p.split("/").includes(".."), "'..' forbidden in pattern");

/** Hostname or empty; very permissive but no userinfo allowed. */
const NetworkHostSchema = z
  .string()
  .min(1)
  .max(253)
  .refine((h) => !h.includes("@"), "host must not contain userinfo");

/** Environment variable name; dangerous names are rejected at binding time. */
const EnvNameSchema = z
  .string()
  .min(1)
  .max(250)
  .regex(/^[A-Z_][A-Z0-9_]*$/i, "invalid env name");

// --- sub-schemas ------------------------------------------------------------

export const SkillKindSchema = z.enum(["process", "workflow", "agent"]);
export type SkillKind = z.infer<typeof SkillKindSchema>;

export const RuntimeKindSchema = z.enum(["python", "node", "shell", "binary"]);
export type RuntimeKind = z.infer<typeof RuntimeKindSchema>;

export const PlatformTargetSchema = z.enum([
  "windows-x64",
  "windows-arm64",
  "macos-arm64",
  "macos-x64",
  "linux-x64",
  "linux-arm64",
  "wsl-linux-x64"
]);
export type PlatformTarget = z.infer<typeof PlatformTargetSchema>;

export const ArtifactTypeSchema = z.enum([
  "markdown", "json", "image", "video", "audio", "directory", "other"
]);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const PublisherSchema = z.object({
  id: SkillIdSchema,
  displayName: z.string().min(1).max(200)
});
export type Publisher = z.infer<typeof PublisherSchema>;

export const SkillDisplaySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  group: z.string().max(80).default("general"),
  icon: z.string().max(200).optional()
});
export type SkillDisplay = z.infer<typeof SkillDisplaySchema>;

export const EntrypointSchema = z.object({
  runtime: RuntimeKindSchema,
  script: RelativePackagePathSchema,
  args: z.array(z.string().max(4000)).default([]),
  /** Templated values resolved by Broker at prepare time. */
  env: z.record(EnvNameSchema, z.string().max(4000)).optional()
});
export type SkillEntrypoint = z.infer<typeof EntrypointSchema>;

export const RuntimeSpecSchema = z.object({
  version: z.string().max(80).refine((v) => SEMVER_RE.test(v) || isSemverRangeExpression(v), "invalid version/range"),
  dependencyFile: RelativePackagePathSchema,
  lockFile: RelativePackagePathSchema.optional(),
  packs: z.array(z.string().min(1).max(80)).default([])
});
export type RuntimeSpec = z.infer<typeof RuntimeSpecSchema>;

/** JSON-Schema-like input descriptor (subset used to render run forms). */
export const JsonSchemaFragmentSchema = z.object({
  type: z.string().max(40),
  required: z.array(z.string().max(120)).optional(),
  properties: z.record(z.string().max(120), z.unknown()).optional(),
  format: z.string().max(80).optional(),
  description: z.string().max(1000).optional(),
  default: z.unknown().optional(),
  enum: z.array(z.unknown()).optional()
}).passthrough();
export type JsonSchemaFragment = z.infer<typeof JsonSchemaFragmentSchema>;

export const ConfigFieldSchema = z.object({
  type: z.enum(["string", "number", "boolean", "provider-profile", "secret-ref", "enum", "path-mymind", "path-export"]),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  description: z.string().max(1000).optional(),
  enum: z.array(z.string().max(200)).optional(),
  secretRef: z.string().max(120).optional()
}).passthrough();
export type ConfigField = z.infer<typeof ConfigFieldSchema>;

export const MymindCapabilitiesSchema = z.object({
  read: z.array(MymindPatternSchema).default([]),
  write: z.array(MymindPatternSchema).default([])
});
export type MymindCapabilities = z.infer<typeof MymindCapabilitiesSchema>;

export const NetworkCapabilitiesSchema = z.object({
  required: z.boolean().default(false),
  hosts: z.array(NetworkHostSchema).default([])
});
export type NetworkCapabilities = z.infer<typeof NetworkCapabilitiesSchema>;

export const CapabilitiesSchema = z.object({
  mymind: MymindCapabilitiesSchema.default({ read: [], write: [] }),
  network: NetworkCapabilitiesSchema.default({ required: false, hosts: [] }),
  browser: z.boolean().default(false),
  subprocess: z.object({ allowed: z.boolean().default(false) }).default({ allowed: false }),
  clipboard: z.boolean().default(false),
  notification: z.boolean().default(false)
}).passthrough();
export type SkillCapabilities = z.infer<typeof CapabilitiesSchema>;

export type SkillCapabilityDiff = {
  added: string[];
  removed: string[];
  changed: boolean;
};

/**
 * Produce a human-readable, deterministic diff for the capability section of
 * two manifests. This is an explanation surface only; execution consent is
 * still bound to the complete capability fingerprint in ExecutionBroker.
 */
export function diffSkillCapabilities(previousManifest: unknown, nextManifest: unknown): SkillCapabilityDiff {
  const previous = capabilityEntries(extractCapabilities(previousManifest));
  const next = capabilityEntries(extractCapabilities(nextManifest));
  return {
    added: [...next].filter((entry) => !previous.has(entry)).sort(),
    removed: [...previous].filter((entry) => !next.has(entry)).sort(),
    changed: !setsEqual(previous, next)
  };
}

function extractCapabilities(value: unknown): unknown {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return record.capabilities && typeof record.capabilities === "object" ? record.capabilities : value;
}

function capabilityEntries(value: unknown, prefix = "capabilities"): Set<string> {
  if (value === null || typeof value !== "object") return new Set([`${prefix}=${stableCapabilityValue(value)}`]);
  if (Array.isArray(value)) return new Set(value.map((entry) => `${prefix}[]=${stableCapabilityValue(entry)}`));
  const entries = new Set<string>();
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    for (const entry of capabilityEntries((value as Record<string, unknown>)[key], `${prefix}.${key}`)) entries.add(entry);
  }
  return entries;
}

function stableCapabilityValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCapabilityValue).sort().join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableCapabilityValue((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((entry) => right.has(entry));
}

export const ArtifactSchema = z.object({
  id: z.string().min(1).max(120),
  type: ArtifactTypeSchema,
  /** Logical mymind path (with templates) OR an external-export artifact id. */
  path: z.string().min(1).max(1024).optional(),
  externalExportId: z.string().min(1).max(120).optional()
});
export type SkillArtifact = z.infer<typeof ArtifactSchema>;

export const ExecutionSchema = z.object({
  concurrency: z.object({
    maxInstances: z.number().int().min(1).max(64).default(1),
    mutexes: z.array(z.string().min(1).max(120)).default([])
  }).default({ maxInstances: 1, mutexes: [] }),
  timeoutSeconds: z.number().int().min(1).max(86400).default(1800),
  gracefulStopSeconds: z.number().int().min(0).max(600).default(10),
  retry: z.object({ maxAttempts: z.number().int().min(0).max(10).default(0) }).default({ maxAttempts: 0 })
}).default({
  concurrency: { maxInstances: 1, mutexes: [] },
  timeoutSeconds: 1800,
  gracefulStopSeconds: 10,
  retry: { maxAttempts: 0 }
});
export type SkillExecution = z.infer<typeof ExecutionSchema>;

export const CompatibilitySchema = z.object({
  minAppVersion: z.string().max(80).refine((v) => SEMVER_RE.test(v), "minAppVersion must be semver"),
  minRuntimeVersion: z.string().max(80).optional()
});
export type SkillCompatibility = z.infer<typeof CompatibilitySchema>;

export const WorkflowStepSchema = z.object({
  id: z.string().min(1).max(120),
  skill: SkillIdSchema,
  version: z.string().max(80).refine((v) => isSemverRangeExpression(v) || SEMVER_RE.test(v), "invalid version range"),
  needs: z.array(z.string().min(1).max(120)).default([]),
  /** Values may reference {{ inputs.<key> }} and dependency Artifact metadata. */
  with: z.record(z.string().max(120), z.unknown()).default({}),
  retry: z.object({
    /** Number of child Run retries after the first attempt. */
    maxAttempts: z.number().int().min(0).max(10).default(0),
    backoffMs: z.number().int().min(0).max(3_600_000).default(0)
  }).default({ maxAttempts: 0, backoffMs: 0 })
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowSpecSchema = z.object({
  steps: z.array(WorkflowStepSchema).min(1)
});
export type WorkflowSpec = z.infer<typeof WorkflowSpecSchema>;

// --- top-level manifest -----------------------------------------------------

const BaseManifestSchema = z.object({
  apiVersion: z.literal(SKILL_MANIFEST_API_VERSION),
  id: SkillIdSchema,
  version: z.string().max(80).refine((v) => SEMVER_RE.test(v), "version must be semver"),
  publisher: PublisherSchema,
  display: SkillDisplaySchema,
  inputs: JsonSchemaFragmentSchema.optional(),
  config: z.record(z.string().max(120), ConfigFieldSchema).default({}),
  capabilities: CapabilitiesSchema,
  artifacts: z.array(ArtifactSchema).default([]),
  execution: ExecutionSchema,
  platforms: z.array(PlatformTargetSchema).min(1),
  compatibility: CompatibilitySchema
});

/**
 * Process/agent manifest. Agent kind forbids `entrypoint` (its entrypoint is
 * the SKILL.md itself, executed by an agent host).
 */
export const ProcessManifestSchema = BaseManifestSchema.extend({
  kind: z.literal("process"),
  entrypoint: EntrypointSchema,
  runtime: RuntimeSpecSchema
});
export type ProcessManifest = z.infer<typeof ProcessManifestSchema>;

const AgentManifestObjectSchema = BaseManifestSchema.extend({
  kind: z.literal("agent"),
  provider: z.object({
    required: z.boolean().default(true),
    fallbackOk: z.boolean().default(false)
  }).default({ required: true, fallbackOk: false })
});
export type AgentManifest = z.infer<typeof AgentManifestObjectSchema>;

const WorkflowManifestObjectSchema = BaseManifestSchema.extend({
  kind: z.literal("workflow"),
  workflow: WorkflowSpecSchema
});
export type WorkflowManifest = z.infer<typeof WorkflowManifestObjectSchema>;

/**
 * Discriminated manifest union. Parse with `SkillManifestSchema.parse(...)`.
 * The discriminator is `kind`.
 */
export const SkillManifestSchema = z.discriminatedUnion("kind", [
  ProcessManifestSchema,
  AgentManifestObjectSchema,
  WorkflowManifestObjectSchema
]);

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

/** Matches the semver ranges supported by Manifest Skill/Workflow references. */
export function matchesSemverRange(version: string, range: string): boolean {
  const actual = parseComparableVersion(version);
  const requested = range.trim();
  if (!actual || !requested) return false;
  return requested.split("||").some((branch) => matchesSemverBranch(actual, branch.trim()));
}

function matchesSemverBranch(actual: [number, number, number], branch: string): boolean {
  const tokens = branch.split(/[ ,]+/).filter(Boolean);
  if (!tokens.length) return false;
  return tokens.every((token) => {
    if (token === "*") return true;
    if (token.startsWith("^")) {
      const minimum = parseComparableVersion(token.slice(1));
      if (!minimum || compareComparableVersions(actual, minimum) < 0) return false;
      const upper: [number, number, number] = minimum[0] > 0
        ? [minimum[0] + 1, 0, 0]
        : minimum[1] > 0
          ? [0, minimum[1] + 1, 0]
          : [0, 0, minimum[2] + 1];
      return compareComparableVersions(actual, upper) < 0;
    }
    if (token.startsWith("~")) {
      const minimum = parseComparableVersion(token.slice(1));
      if (!minimum || compareComparableVersions(actual, minimum) < 0) return false;
      return actual[0] === minimum[0] && actual[1] === minimum[1];
    }
    const wildcard = token.match(/^(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?$/);
    if (wildcard) {
      if (actual[0] !== Number(wildcard[1])) return false;
      if (!wildcard[2] || /^[xX*]$/.test(wildcard[2])) return true;
      if (actual[1] !== Number(wildcard[2])) return false;
      return !wildcard[3] || /^[xX*]$/.test(wildcard[3]) || actual[2] === Number(wildcard[3]);
    }
    const match = token.match(/^(>=|<=|>|<|=)?(\d+)\.(\d+)(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?$/);
    if (!match) return false;
    const expected: [number, number, number] = [Number(match[2]), Number(match[3]), Number(match[4] ?? 0)];
    const comparison = compareComparableVersions(actual, expected);
    switch (match[1] || "=") {
      case ">=": return comparison >= 0;
      case "<=": return comparison <= 0;
      case ">": return comparison > 0;
      case "<": return comparison < 0;
      default: return comparison === 0;
    }
  });
}

function parseComparableVersion(value: string): [number, number, number] | null {
  const match = value.match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}

function compareComparableVersions(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * Validate a manifest, returning a structured result so callers can surface
 * precise error paths to the install wizard.
 */
export function validateManifest(input: unknown):
  | { ok: true; manifest: SkillManifest }
    | { ok: false; error: z.ZodError } {
  const parsed = SkillManifestSchema.safeParse(input);
  return parsed.success
    ? { ok: true, manifest: parsed.data }
    : { ok: false, error: parsed.error };
}

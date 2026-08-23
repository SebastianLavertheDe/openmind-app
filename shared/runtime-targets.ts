import { z } from "zod";

/** Frozen by ADR-005. Windows and WSL intentionally have separate targets. */
export const RuntimeTargetSchema = z.enum([
  "windows-x64",
  "windows-arm64",
  "macos-arm64",
  "macos-x64",
  "linux-x64",
  "linux-arm64",
  "wsl-linux-x64"
]);
export type RuntimeTarget = z.infer<typeof RuntimeTargetSchema>;


export const RuntimePackIdSchema = z.enum([
  "python-core",
  "node-22",
  "media-core",
  "browser-playwright",
  "browser-agent",
  "speech-whisper",
  "cjk-subtitle-fonts",
  "network-cli",
  "minigit",
  "wsl-runtime-bridge"
]);
export type RuntimePackId = z.infer<typeof RuntimePackIdSchema>;

export const RuntimeSbomSchema = z.object({
  format: z.enum(["cyclonedx", "spdx"]),
  digest: z.string().regex(/^[a-f0-9]{64}$/)
});

export const RuntimePackMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  packId: RuntimePackIdSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  target: RuntimeTargetSchema,
  filename: z.string().min(1).max(240).refine((value) => !value.includes("/") && !value.includes("\\") && value !== "." && value !== ".."),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  publisherKeyId: z.string().min(1).max(120),
  signatureAlgorithm: z.literal("ed25519"),
  signature: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  originUrl: z.string().url().optional(),
  license: z.string().min(1).max(240),
  sbom: RuntimeSbomSchema,
  /** Optional signed install footprint for UI confirmation before download. */
  installSize: z.number().int().nonnegative().optional(),
  /** Optional signed user-visible requirements (for example OS packages). */
  conditions: z.array(z.string().trim().min(1).max(240)).max(20).optional()
});
export type RuntimePackMetadata = z.infer<typeof RuntimePackMetadataSchema>;

export const RuntimePackIntegritySchema = z.enum(["verified", "missing", "tampered", "invalid"]);

/** Renderer-safe Runtime Pack state; package paths are intentionally omitted. */
export const RuntimePackReadinessSchema = z.object({
  packId: RuntimePackIdSchema,
  target: RuntimeTargetSchema,
  version: z.string().max(80),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["candidate", "active", "previous"]),
  verifiedAt: z.string().datetime(),
  license: z.string().max(240),
  originUrl: z.string().url().optional(),
  sbom: RuntimeSbomSchema,
  integrity: RuntimePackIntegritySchema,
  inUse: z.boolean(),
  ready: z.boolean(),
  reason: z.string().max(240)
}).strict();
export type RuntimePackReadiness = z.infer<typeof RuntimePackReadinessSchema>;

export const RuntimeTargetDescriptorSchema = z.object({
  target: RuntimeTargetSchema,
  os: z.enum(["windows", "macos", "linux", "wsl"]),
  arch: z.enum(["x64", "arm64"]),
  firstClass: z.boolean(),
  packs: z.array(RuntimePackIdSchema).min(1)
});
export type RuntimeTargetDescriptor = z.infer<typeof RuntimeTargetDescriptorSchema>;

export const RUNTIME_TARGETS: readonly RuntimeTargetDescriptor[] = [
  { target: "windows-x64", os: "windows", arch: "x64", firstClass: true, packs: ["python-core", "node-22", "media-core", "browser-playwright", "browser-agent", "cjk-subtitle-fonts", "network-cli", "minigit", "wsl-runtime-bridge"] },
  { target: "windows-arm64", os: "windows", arch: "arm64", firstClass: false, packs: ["python-core", "node-22", "media-core", "browser-playwright", "browser-agent", "cjk-subtitle-fonts", "network-cli", "minigit", "wsl-runtime-bridge"] },
  { target: "macos-arm64", os: "macos", arch: "arm64", firstClass: true, packs: ["python-core", "node-22", "media-core", "browser-playwright", "browser-agent", "cjk-subtitle-fonts", "network-cli", "minigit"] },
  { target: "macos-x64", os: "macos", arch: "x64", firstClass: false, packs: ["python-core", "node-22", "media-core", "browser-playwright", "browser-agent", "cjk-subtitle-fonts", "network-cli", "minigit"] },
  { target: "linux-x64", os: "linux", arch: "x64", firstClass: false, packs: ["python-core", "node-22", "media-core", "browser-playwright", "browser-agent", "cjk-subtitle-fonts", "network-cli", "minigit"] },
  { target: "linux-arm64", os: "linux", arch: "arm64", firstClass: false, packs: ["python-core", "node-22", "media-core", "browser-playwright", "browser-agent", "cjk-subtitle-fonts", "network-cli", "minigit"] },
  { target: "wsl-linux-x64", os: "wsl", arch: "x64", firstClass: true, packs: ["python-core", "node-22", "media-core", "browser-playwright", "browser-agent", "cjk-subtitle-fonts", "network-cli", "minigit", "wsl-runtime-bridge"] }
];

export function getRuntimeTargetDescriptor(target: RuntimeTarget): RuntimeTargetDescriptor {
  const descriptor = RUNTIME_TARGETS.find((item) => item.target === target);
  if (!descriptor) throw new Error(`未知 Runtime target：${target}`);
  return descriptor;
}

export function detectRuntimeTarget(input: {
  platform: NodeJS.Platform;
  arch: string;
  isWsl?: boolean;
}): RuntimeTarget | null {
  if (input.isWsl && input.platform === "win32") return input.arch === "x64" ? "wsl-linux-x64" : null;
  if (input.platform === "win32") return input.arch === "x64" ? "windows-x64" : input.arch === "arm64" ? "windows-arm64" : null;
  if (input.platform === "darwin") return input.arch === "arm64" ? "macos-arm64" : input.arch === "x64" ? "macos-x64" : null;
  if (input.platform === "linux") return input.arch === "x64" ? "linux-x64" : input.arch === "arm64" ? "linux-arm64" : null;
  return null;
}

import crypto from "node:crypto";
import { RuntimePackMetadataSchema, type RuntimePackMetadata } from "../../shared/runtime-targets";

export type RuntimeTrustRoots = Readonly<Record<string, string>>;

export type RuntimeVerificationResult = {
  metadata: RuntimePackMetadata;
  sha256: string;
  verifiedAt: string;
};

export type RuntimeVerificationErrorCode =
  | "trusted-root-missing"
  | "metadata-invalid"
  | "size-mismatch"
  | "hash-mismatch"
  | "signature-invalid"
  | "metadata-expired"
  | "downgrade-rejected";

export class RuntimePackVerificationError extends Error {
  constructor(readonly code: RuntimeVerificationErrorCode, message: string) {
    super(message);
    this.name = "RuntimePackVerificationError";
  }
}

/**
 * Verifies a complete local pack before any bytes are moved into runtimes.
 * There is intentionally no downloader or PATH fallback in this class.
 */
export class RuntimePackVerifier {
  constructor(private readonly trustRoots: RuntimeTrustRoots) {}

  verify(input: {
    metadata: unknown;
    bytes: Uint8Array;
    previousVersion?: string;
    now?: Date;
  }): RuntimeVerificationResult {
    const metadata = parseMetadata(input.metadata);
    const publicKeyPem = this.trustRoots[metadata.publisherKeyId];
    if (!publicKeyPem) {
      throw new RuntimePackVerificationError("trusted-root-missing", `未找到 Runtime publisher key：${metadata.publisherKeyId}`);
    }
    const now = input.now ?? new Date();
    if (new Date(metadata.expiresAt).getTime() <= now.getTime()) {
      throw new RuntimePackVerificationError("metadata-expired", `Runtime pack metadata 已过期：${metadata.packId}@${metadata.version}`);
    }
    if (metadata.size !== input.bytes.byteLength) {
      throw new RuntimePackVerificationError("size-mismatch", "Runtime pack 大小与签名 metadata 不一致。");
    }
    const sha256 = crypto.createHash("sha256").update(input.bytes).digest("hex");
    if (sha256 !== metadata.sha256) {
      throw new RuntimePackVerificationError("hash-mismatch", "Runtime pack SHA-256 校验失败。");
    }
    if (input.previousVersion && compareRuntimeVersions(metadata.version, input.previousVersion) < 0) {
      throw new RuntimePackVerificationError("downgrade-rejected", `拒绝 Runtime pack 降级：${input.previousVersion} → ${metadata.version}`);
    }
    let signatureValid = false;
    try {
      signatureValid = crypto.verify(
        null,
        Buffer.from(canonicalRuntimePackPayload(metadata), "utf8"),
        { key: publicKeyPem, format: "pem", type: "spki" },
        Buffer.from(metadata.signature, "base64")
      );
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      throw new RuntimePackVerificationError("signature-invalid", "Runtime pack 签名校验失败。");
    }
    return { metadata, sha256, verifiedAt: now.toISOString() };
  }
}

export function canonicalRuntimePackPayload(metadata: RuntimePackMetadata): string {
  const { signature: _signature, ...unsigned } = metadata;
  return JSON.stringify(unsigned);
}

export function compareRuntimeVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  const leftParts = a.pre.split(".");
  const rightParts = b.pre.split(".");
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    if (leftParts[index] === undefined) return -1;
    if (rightParts[index] === undefined) return 1;
    const leftNumber = /^\d+$/.test(leftParts[index]);
    const rightNumber = /^\d+$/.test(rightParts[index]);
    if (leftNumber && rightNumber) {
      const difference = Number(leftParts[index]) - Number(rightParts[index]);
      if (difference) return difference;
    } else if (leftNumber !== rightNumber) {
      return leftNumber ? -1 : 1;
    } else if (leftParts[index] !== rightParts[index]) {
      return leftParts[index].localeCompare(rightParts[index]);
    }
  }
  return 0;
}

function parseMetadata(value: unknown): RuntimePackMetadata {
  const result = RuntimePackMetadataSchema.safeParse(value);
  if (!result.success) throw new RuntimePackVerificationError("metadata-invalid", result.error.message);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(result.data.signature)) {
    throw new RuntimePackVerificationError("metadata-invalid", "Runtime pack signature 不是合法 Base64。");
  }
  return result.data;
}

function parseVersion(value: string): { core: [number, number, number]; pre: string | null } {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) throw new Error(`invalid runtime version: ${value}`);
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null };
}

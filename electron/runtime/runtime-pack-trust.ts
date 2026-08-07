import crypto from "node:crypto";
import fs from "node:fs";
import { z } from "zod";
import type { RuntimeTrustRoots } from "./runtime-pack-verifier";

const RuntimeTrustRootsFileSchema = z.object({
  schemaVersion: z.literal(1),
  roots: z.record(z.string().min(1).max(120), z.string().min(1).max(32_000))
});

export class RuntimeTrustRootsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeTrustRootsError";
  }
}

/**
 * Loads only the public keys shipped by the packaged application. Missing
 * development resources deliberately return an empty map; RuntimePackVerifier
 * then rejects every import with trusted-root-missing instead of accepting a
 * development or user-provided key implicitly.
 */
export function loadRuntimeTrustRoots(filePath: string): RuntimeTrustRoots {
  if (!fs.existsSync(filePath)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new RuntimeTrustRootsError(`Runtime trust roots 文件无法读取：${error instanceof Error ? error.message : String(error)}`);
  }
  const result = RuntimeTrustRootsFileSchema.safeParse(parsed);
  if (!result.success) throw new RuntimeTrustRootsError(`Runtime trust roots schema 无效：${result.error.message}`);
  const roots: Record<string, string> = {};
  for (const [keyId, pem] of Object.entries(result.data.roots)) {
    let key: crypto.KeyObject;
    try {
      key = crypto.createPublicKey(pem);
    } catch (error) {
      throw new RuntimeTrustRootsError(`Runtime trust root ${keyId} 不是有效公钥：${error instanceof Error ? error.message : String(error)}`);
    }
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
      throw new RuntimeTrustRootsError(`Runtime trust root ${keyId} 必须是 Ed25519 公钥。`);
    }
    roots[keyId] = pem;
  }
  return roots;
}

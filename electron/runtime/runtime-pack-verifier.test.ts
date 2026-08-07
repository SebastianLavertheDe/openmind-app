import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalRuntimePackPayload, compareRuntimeVersions, RuntimePackVerificationError, RuntimePackVerifier } from "./runtime-pack-verifier";
import { RuntimePackMetadataSchema } from "../../shared/runtime-targets";

describe("RuntimePackVerifier", () => {
  const keys = crypto.generateKeyPairSync("ed25519");
  const bytes = Buffer.from("managed-runtime-pack");

  it("verifies hash, Ed25519 signature, expiry and trust root", () => {
    const unsigned = metadata(bytes);
    const signature = crypto.sign(null, Buffer.from(canonicalRuntimePackPayload(unsigned)), keys.privateKey).toString("base64");
    const verified = new RuntimePackVerifier({ runtimeRoot: keys.publicKey.export({ type: "spki", format: "pem" }).toString() }).verify({
      metadata: { ...unsigned, signature },
      bytes,
      now: new Date("2026-08-05T00:00:00.000Z")
    });
    expect(verified.sha256).toBe(unsigned.sha256);
  });

  it.each([
    ["trusted-root-missing", (value: ReturnType<typeof metadata>) => value],
    ["hash-mismatch", (value: ReturnType<typeof metadata>) => ({ ...value, sha256: "f".repeat(64) })],
    ["size-mismatch", (value: ReturnType<typeof metadata>) => ({ ...value, size: value.size + 1 })],
    ["signature-invalid", (value: ReturnType<typeof metadata>) => ({ ...value, signature: Buffer.from("bad").toString("base64") })],
    ["metadata-expired", (value: ReturnType<typeof metadata>) => ({ ...value, expiresAt: "2026-01-01T00:00:00.000Z" })]
  ])("fails closed for %s", (code, mutate) => {
    const unsigned = mutate(metadata(bytes));
    const signed = code === "signature-invalid" || code === "trusted-root-missing" || code === "hash-mismatch" || code === "size-mismatch" || code === "metadata-expired"
      ? { ...unsigned, signature: "invalid" }
      : unsigned;
    const verifier = new RuntimePackVerifier(code === "trusted-root-missing" ? {} : { runtimeRoot: keys.publicKey.export({ type: "spki", format: "pem" }).toString() });
    try {
      verifier.verify({ metadata: signed, bytes, now: new Date("2026-08-05T00:00:00.000Z") });
      throw new Error("expected verification to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimePackVerificationError);
      expect((error as RuntimePackVerificationError).code).toBe(code);
    }
  });

  it("rejects downgrade and compares prerelease versions", () => {
    const unsigned = metadata(bytes);
    const signature = crypto.sign(null, Buffer.from(canonicalRuntimePackPayload(unsigned)), keys.privateKey).toString("base64");
    expect(() => new RuntimePackVerifier({ runtimeRoot: keys.publicKey.export({ type: "spki", format: "pem" }).toString() }).verify({
      metadata: { ...unsigned, signature }, bytes, previousVersion: "3.12.2", now: new Date("2026-08-05T00:00:00.000Z")
    })).toThrowError(/降级/);
    expect(compareRuntimeVersions("1.0.0", "1.0.0-alpha")).toBeGreaterThan(0);
    expect(compareRuntimeVersions("1.0.0-alpha.2", "1.0.0-alpha.10")).toBeLessThan(0);
  });
});

function metadata(bytes: Uint8Array) {
  return RuntimePackMetadataSchema.parse({
    schemaVersion: 1,
    packId: "python-core",
    version: "3.12.1",
    target: "linux-x64",
    filename: "python-core.tar.zst",
    size: bytes.byteLength,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    publisherKeyId: "runtimeRoot",
    signatureAlgorithm: "ed25519",
    signature: "placeholder",
    expiresAt: "2027-01-01T00:00:00.000Z",
    license: "PSF-2.0",
    sbom: { format: "spdx", digest: "b".repeat(64) }
  });
}

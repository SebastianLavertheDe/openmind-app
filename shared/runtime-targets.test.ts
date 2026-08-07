import { describe, expect, it } from "vitest";
import { detectRuntimeTarget, getRuntimeTargetDescriptor, RUNTIME_TARGETS, RuntimePackMetadataSchema } from "./runtime-targets";

describe("runtime targets", () => {
  it("keeps Windows and WSL as independent runtime targets", () => {
    expect(detectRuntimeTarget({ platform: "win32", arch: "x64" })).toBe("windows-x64");
    expect(detectRuntimeTarget({ platform: "win32", arch: "x64", isWsl: true })).toBe("wsl-linux-x64");
    expect(getRuntimeTargetDescriptor("windows-x64").packs).not.toEqual(getRuntimeTargetDescriptor("wsl-linux-x64").packs.filter((pack) => pack !== "wsl-runtime-bridge"));
  });

  it("declares every target and rejects path-bearing pack filenames", () => {
    expect(RUNTIME_TARGETS).toHaveLength(7);
    expect(() => RuntimePackMetadataSchema.parse({
      schemaVersion: 1,
      packId: "python-core",
      version: "3.12.1",
      target: "linux-x64",
      filename: "../runtime.tar.zst",
      size: 1,
      sha256: "a".repeat(64),
      publisherKeyId: "runtime-root-1",
      signatureAlgorithm: "ed25519",
      signature: "sig",
      expiresAt: "2027-01-01T00:00:00.000Z",
      license: "PSF-2.0",
      sbom: { format: "spdx", digest: "b".repeat(64) }
    })).toThrow();
  });
});

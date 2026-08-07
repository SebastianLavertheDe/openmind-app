import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAppPaths, ensureAppPaths, type AppPaths } from "../paths/app-paths-service";
import { CredentialVault, type CredentialCodec } from "./credential-vault";

class FakeCodec implements CredentialCodec {
  constructor(public available = true) {}
  isEncryptionAvailable(): boolean { return this.available; }
  encryptString(value: string): Buffer { return Buffer.from(`encrypted:${Buffer.from(value, "utf8").toString("base64")}`, "utf8"); }
  decryptString(value: Buffer): string {
    const decoded = value.toString("utf8");
    if (!decoded.startsWith("encrypted:")) throw new Error("invalid ciphertext");
    return Buffer.from(decoded.slice("encrypted:".length), "base64").toString("utf8");
  }
}

describe("CredentialVault", () => {
  let tempRoot = "";
  let paths: AppPaths;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-credentials-"));
    paths = buildAppPaths(path.join(tempRoot, "user-data"));
    ensureAppPaths(paths);
  });

  afterEach(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  it("stores ciphertext and returns metadata without exposing the secret", async () => {
    const vault = new CredentialVault(paths, new FakeCodec());
    const metadata = vault.set({
      id: "credential-one",
      label: "Example API",
      kind: "api-key",
      secret: "super-secret-value",
      scope: { publisherId: "cctools", skillId: "demo", version: "1.0.0", digest: "a".repeat(64) }
    });
    const ciphertext = fs.readFileSync(path.join(paths.credentials, "credential-one.bin"), "utf8");

    expect(metadata).not.toHaveProperty("secret");
    expect(ciphertext).not.toContain("super-secret-value");
    expect(vault.status()).toEqual(expect.objectContaining({ available: true, backend: "safeStorage" }));
    expect(fs.statSync(path.join(paths.credentials, "credential-one.bin")).mode & 0o777).toBe(0o600);
    await expect(vault.withSecret(metadata.id, metadata.scope, (secret) => secret)).resolves.toBe("super-secret-value");
  });

  it("enforces exact scope matching and supports replace, test and revoke", async () => {
    const codec = new FakeCodec();
    const vault = new CredentialVault(paths, codec);
    const scope = { publisherId: "cctools", skillId: "demo", version: "1.0.0", digest: "b".repeat(64) };
    const metadata = vault.set({ id: "credential-two", label: "Token", kind: "token", secret: "first", scope });

    await expect(vault.withSecret(metadata.id, { ...scope, digest: "c".repeat(64) }, () => true)).rejects.toThrow("scope");
    expect(vault.test(metadata.id)).toEqual(expect.objectContaining({ ok: true, status: "available" }));
    expect(vault.replace(metadata.id, { label: "Token 2", kind: "token", secret: "second", scope })).toEqual(expect.objectContaining({ label: "Token 2" }));
    expect(vault.test(metadata.id).ok).toBe(true);
    expect(vault.revoke(metadata.id).status).toBe("revoked");
    expect(fs.existsSync(path.join(paths.credentials, "credential-two.bin"))).toBe(false);
    expect(vault.test(metadata.id)).toEqual(expect.objectContaining({ ok: false, status: "revoked" }));
    expect(vault.delete(metadata.id)).toBe(true);
    expect(vault.test(metadata.id)).toEqual(expect.objectContaining({ ok: false, status: "missing" }));
    expect(vault.delete(metadata.id)).toBe(false);
  });

  it("fails closed when safeStorage is unavailable or the registry is corrupt", () => {
    const unavailable = new CredentialVault(paths, new FakeCodec(false));
    expect(unavailable.status()).toEqual(expect.objectContaining({ available: false, backend: "unavailable" }));
    expect(() => unavailable.set({ label: "Nope", kind: "password", secret: "plain" })).toThrow("不可用");

    fs.writeFileSync(path.join(paths.credentials, "registry.json"), "{\"schemaVersion\":999,\"records\":[]}");
    expect(() => new CredentialVault(paths, new FakeCodec()).list()).toThrow("拒绝覆盖");
  });

  it("reports corrupt ciphertext without returning it", () => {
    const vault = new CredentialVault(paths, new FakeCodec());
    const metadata = vault.set({ id: "credential-corrupt", label: "Broken", kind: "token", secret: "secret" });
    fs.writeFileSync(path.join(paths.credentials, `${metadata.id}.bin`), "not-encrypted");
    expect(vault.test(metadata.id)).toEqual(expect.objectContaining({ ok: false, status: "corrupt" }));
  });
});

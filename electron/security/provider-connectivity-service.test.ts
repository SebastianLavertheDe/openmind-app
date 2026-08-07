import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAppPaths, ensureAppPaths, type AppPaths } from "../paths/app-paths-service";
import { CredentialVault, type CredentialCodec } from "./credential-vault";
import { ProviderConnectivityService, type ProviderConnectivityRequest } from "./provider-connectivity-service";
import { ProviderProfileRepository } from "./provider-profile-repository";

class FakeCodec implements CredentialCodec {
  isEncryptionAvailable(): boolean { return true; }
  encryptString(value: string): Buffer { return Buffer.from(`cipher:${value}`, "utf8"); }
  decryptString(value: Buffer): string { return value.toString("utf8").replace(/^cipher:/, ""); }
}

const PROFILE = {
  id: "local-provider",
  name: "Local Provider",
  protocol: "openai-chat" as const,
  credentialId: "provider-key",
  baseUrl: "http://127.0.0.1:43123/v1",
  model: "test-model",
  timeoutMs: 2_000,
  maxRetries: 2,
  proxyPolicy: "disabled" as const,
  tlsPolicy: "verify" as const,
  fallbackProfileId: null
};

describe("ProviderConnectivityService", () => {
  let tempRoot = "";
  let paths: AppPaths;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-provider-test-"));
    paths = buildAppPaths(path.join(tempRoot, "user-data"));
    ensureAppPaths(paths);
  });

  afterEach(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  it("tests the declared protocol with a scoped Main-side Secret and persists only status", async () => {
    const profiles = new ProviderProfileRepository(paths);
    const vault = new CredentialVault(paths, new FakeCodec());
    vault.set({ id: "provider-key", label: "Provider key", kind: "api-key", secret: "do-not-log" });
    profiles.save(PROFILE);
    const requests: ProviderConnectivityRequest[] = [];
    const service = new ProviderConnectivityService(profiles, vault, async (request) => {
      requests.push(request);
      return { statusCode: 200 };
    }, () => new Date("2026-08-05T12:00:00.000Z"));

    const result = await service.test("local-provider");

    expect(result.test).toEqual({ status: "success", testedAt: "2026-08-05T12:00:00.000Z", diagnostic: "连接成功（HTTP 200）。" });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("http://127.0.0.1:43123/v1/chat/completions");
    expect(requests[0].headers.Authorization).toBe("Bearer do-not-log");
    expect(requests[0].body).toContain("test-model");
    const registry = fs.readFileSync(path.join(paths.settings, "provider-profiles.json"), "utf8");
    expect(registry).not.toContain("do-not-log");
    expect(registry).toContain("连接成功");
  });

  it("retries transient statuses, does not read response bodies, and redacts failure detail", async () => {
    const profiles = new ProviderProfileRepository(paths);
    const vault = new CredentialVault(paths, new FakeCodec());
    profiles.save({ ...PROFILE, credentialId: null, maxRetries: 2 });
    let attempts = 0;
    const service = new ProviderConnectivityService(profiles, vault, async () => {
      attempts += 1;
      return { statusCode: attempts < 3 ? 503 : 401 };
    });

    const result = await service.test("local-provider");

    expect(attempts).toBe(3);
    expect(result.test.status).toBe("failed");
    expect(result.test.diagnostic).toBe("Provider 返回 HTTP 401。");
    expect(result.test.diagnostic).not.toContain("response");
  });

  it("fails without a network request when explicit proxy configuration is incomplete", async () => {
    const profiles = new ProviderProfileRepository(paths);
    const vault = new CredentialVault(paths, new FakeCodec());
    profiles.save({ ...PROFILE, credentialId: null, proxyPolicy: "explicit" });
    let called = false;
    const service = new ProviderConnectivityService(profiles, vault, async () => {
      called = true;
      return { statusCode: 200 };
    });

    const result = await service.test("local-provider");

    expect(called).toBe(false);
    expect(result.test.status).toBe("failed");
    expect(result.test.diagnostic).toContain("显式代理");
  });

  it("passes only the configured proxy endpoint to the Main-side requester", async () => {
    const profiles = new ProviderProfileRepository(paths);
    const vault = new CredentialVault(paths, new FakeCodec());
    profiles.save({ ...PROFILE, credentialId: null, proxyPolicy: "explicit", proxyUrl: "http://127.0.0.1:7890/" });
    let request: ProviderConnectivityRequest | undefined;
    const service = new ProviderConnectivityService(profiles, vault, async (spec) => {
      request = spec;
      return { statusCode: 200 };
    });

    const result = await service.test("local-provider");

    expect(result.test.status).toBe("success");
    expect(request?.proxyUrl).toBe("http://127.0.0.1:7890");
  });
});

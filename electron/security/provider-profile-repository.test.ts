import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAppPaths, ensureAppPaths, type AppPaths } from "../paths/app-paths-service";
import { ProviderProfileRepository } from "./provider-profile-repository";

const INPUT = {
  id: "openai",
  name: "OpenAI",
  protocol: "openai-responses" as const,
  credentialId: "credential-one",
  baseUrl: "https://api.example.com/v1///",
  model: "gpt-5",
  timeoutMs: 120_000,
  maxRetries: 2,
  proxyPolicy: "system" as const,
  tlsPolicy: "verify" as const,
  fallbackProfileId: null
};

describe("ProviderProfileRepository", () => {
  let tempRoot = "";
  let paths: AppPaths;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-provider-profiles-"));
    paths = buildAppPaths(path.join(tempRoot, "user-data"));
    ensureAppPaths(paths);
  });

  afterEach(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  it("normalizes and persists secret-free profiles", () => {
    const repository = new ProviderProfileRepository(paths);
    const profile = repository.save(INPUT);

    expect(profile.baseUrl).toBe("https://api.example.com/v1");
    expect(repository.list()).toEqual([profile]);
    const stored = fs.readFileSync(path.join(paths.settings, "provider-profiles.json"), "utf8");
    expect(stored).toContain("credential-one");
    expect(stored).not.toContain("secret");
    expect(fs.statSync(path.join(paths.settings, "provider-profiles.json")).mode & 0o777).toBe(0o600);
  });

  it("rejects self fallback and fails closed on corrupt state", () => {
    const repository = new ProviderProfileRepository(paths);
    expect(() => repository.save({ ...INPUT, fallbackProfileId: "openai" })).toThrow("fallback");
    fs.writeFileSync(path.join(paths.settings, "provider-profiles.json"), "not-json");
    expect(() => repository.list()).toThrow("拒绝覆盖");
  });

  it("removes profiles without touching credential files", () => {
    const repository = new ProviderProfileRepository(paths);
    repository.save(INPUT);
    expect(repository.remove("openai")).toBe(true);
    expect(repository.remove("openai")).toBe(false);
    expect(repository.list()).toEqual([]);
  });
});

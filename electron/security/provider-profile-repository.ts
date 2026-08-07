import fs from "node:fs";
import path from "node:path";
import type { AppPaths } from "../paths/app-paths-service";
import { writeJsonAtomic } from "../lib/fs-utils";
import {
  PROVIDER_PROFILE_SCHEMA_VERSION,
  ProviderProfileInputSchema,
  ProviderProfileSchema,
  normalizeBaseUrl,
  normalizeProxyUrl,
  type ProviderProfile,
  type ProviderProfileInput,
  type ProviderTestState
} from "../../shared/provider-profiles";

const REGISTRY_SCHEMA_VERSION = 1 as const;

type ProviderProfileRegistry = {
  schemaVersion: typeof REGISTRY_SCHEMA_VERSION;
  profiles: ProviderProfile[];
};

/** App-private, secret-free Provider Profile storage. */
export class ProviderProfileRepository {
  private readonly filePath: string;

  constructor(private readonly paths: AppPaths) {
    this.filePath = path.join(paths.settings, "provider-profiles.json");
  }

  list(): ProviderProfile[] {
    return this.readRegistry().profiles.map((profile) => ({
      ...profile,
      test: profile.test ? { ...profile.test } : profile.test
    }));
  }

  get(id: string): ProviderProfile | null {
    return this.readRegistry().profiles.find((profile) => profile.id === id) || null;
  }

  save(rawInput: ProviderProfileInput): ProviderProfile {
    const input = ProviderProfileInputSchema.parse(rawInput);
    if (input.fallbackProfileId === input.id) throw new Error("Provider Profile 不能将自己作为 fallback。");
    const normalizedBaseUrl = normalizeBaseUrl(input.baseUrl);
    const normalizedProxyUrl = normalizeProxyUrl(input.proxyUrl || "");
    const current = this.readRegistry();
    const existing = current.profiles.find((profile) => profile.id === input.id);
    const profile = ProviderProfileSchema.parse({
      ...input,
      schemaVersion: PROVIDER_PROFILE_SCHEMA_VERSION,
      baseUrl: normalizedBaseUrl,
      proxyUrl: normalizedProxyUrl,
      // Test results are controlled by the Main process. Saving any config
      // invalidates a previous connectivity result rather than accepting a
      // renderer-supplied success state.
      test: { status: "never", testedAt: null, diagnostic: null }
    });
    const profiles = existing
      ? current.profiles.map((item) => item.id === profile.id ? profile : item)
      : [...current.profiles, profile];
    this.writeRegistry({ schemaVersion: REGISTRY_SCHEMA_VERSION, profiles });
    return profile;
  }

  remove(id: string): boolean {
    const current = this.readRegistry();
    const next = current.profiles.filter((profile) => profile.id !== id);
    if (next.length === current.profiles.length) return false;
    this.writeRegistry({ schemaVersion: REGISTRY_SCHEMA_VERSION, profiles: next });
    return true;
  }

  recordTest(id: string, rawTest: ProviderTestState): ProviderProfile {
    const test = ProviderProfileSchema.shape.test.parse(rawTest);
    const current = this.readRegistry();
    const profile = current.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Provider Profile 不存在。");
    const updated = ProviderProfileSchema.parse({ ...profile, test });
    this.writeRegistry({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      profiles: current.profiles.map((item) => item.id === id ? updated : item)
    });
    return updated;
  }

  private readRegistry(): ProviderProfileRegistry {
    if (!fs.existsSync(this.filePath)) return { schemaVersion: REGISTRY_SCHEMA_VERSION, profiles: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<ProviderProfileRegistry>;
      if (parsed.schemaVersion !== REGISTRY_SCHEMA_VERSION || !Array.isArray(parsed.profiles)) {
        throw new Error("Provider Profile registry schema mismatch");
      }
      return {
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        profiles: parsed.profiles.map((profile) => ProviderProfileSchema.parse(profile))
      };
    } catch (error) {
      throw new Error(`Provider Profile registry 无法读取，拒绝覆盖现有状态：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private writeRegistry(registry: ProviderProfileRegistry): void {
    fs.mkdirSync(this.paths.settings, { recursive: true });
    writeJsonAtomic(this.filePath, registry);
    try { fs.chmodSync(this.filePath, 0o600); } catch { /* Windows may not expose POSIX modes. */ }
  }
}

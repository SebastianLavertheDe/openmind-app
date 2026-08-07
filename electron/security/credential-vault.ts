import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  CredentialMetadata,
  CredentialScope,
  CredentialSetInput,
  CredentialTestResult,
  CredentialVaultStatus
} from "../../shared/provider-profiles";
import {
  CREDENTIAL_SCHEMA_VERSION,
  CredentialMetadataSchema,
  CredentialSetInputSchema,
  CredentialTestResultSchema,
  CredentialVaultStatusSchema
} from "../../shared/provider-profiles";
import type { AppPaths } from "../paths/app-paths-service";
import { writeJsonAtomic } from "../lib/fs-utils";

export interface CredentialCodec {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

type CredentialRegistry = {
  schemaVersion: typeof CREDENTIAL_SCHEMA_VERSION;
  records: CredentialMetadata[];
};

type CredentialSecretInput = Omit<CredentialSetInput, "id">;

/**
 * Main-process-only credential storage. Renderer IPC can mutate metadata and
 * ciphertext, but this class intentionally has no plaintext-returning API.
 * Execution code can use withSecret() inside Main/Worker boundaries later.
 */
export class CredentialVault {
  private readonly registryFile: string;
  private readonly now: () => Date;

  constructor(
    private readonly paths: AppPaths,
    private readonly codec: CredentialCodec,
    now: () => Date = () => new Date()
  ) {
    this.registryFile = path.join(paths.credentials, "registry.json");
    this.now = now;
  }

  status(): CredentialVaultStatus {
    const value = {
      available: this.codec.isEncryptionAvailable(),
      backend: this.codec.isEncryptionAvailable() ? "safeStorage" : "unavailable",
      credentials: this.list()
    } as CredentialVaultStatus;
    return CredentialVaultStatusSchema.parse(value);
  }

  list(): CredentialMetadata[] {
    return this.readRegistry().records.map((record) => ({ ...record, scope: record.scope ? { ...record.scope } : null }));
  }

  set(rawInput: CredentialSetInput): CredentialMetadata {
    const input = CredentialSetInputSchema.parse(rawInput);
    const id = input.id || `credential-${crypto.randomUUID()}`;
    if (this.readRegistry().records.some((record) => record.id === id)) throw new Error("Credential 已存在，请使用 replace。");
    if (!this.codec.isEncryptionAvailable()) throw new Error("当前系统安全存储不可用，拒绝保存明文 Credential。");
    const timestamp = this.now().toISOString();
    const metadata = CredentialMetadataSchema.parse({
      schemaVersion: CREDENTIAL_SCHEMA_VERSION,
      id,
      label: input.label,
      kind: input.kind,
      scope: input.scope || null,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    this.writeCiphertext(id, input.secret);
    const registry = this.readRegistry();
    registry.records.push(metadata);
    this.writeRegistry(registry);
    return metadata;
  }

  replace(id: string, rawInput: CredentialSecretInput): CredentialMetadata {
    const record = this.find(id);
    if (!record || record.status !== "active") throw new Error("Credential 不存在或已撤销。");
    const input = CredentialSetInputSchema.omit({ id: true }).parse(rawInput);
    if (!this.codec.isEncryptionAvailable()) throw new Error("当前系统安全存储不可用，拒绝保存明文 Credential。");
    this.writeCiphertext(id, input.secret);
    const updated = CredentialMetadataSchema.parse({
      ...record,
      label: input.label,
      kind: input.kind,
      scope: input.scope || null,
      updatedAt: this.now().toISOString()
    });
    const registry = this.readRegistry();
    registry.records = registry.records.map((item) => item.id === id ? updated : item);
    this.writeRegistry(registry);
    return updated;
  }

  revoke(id: string): CredentialMetadata {
    const record = this.find(id);
    if (!record) throw new Error("Credential 不存在。");
    const secretFile = this.secretFile(id);
    if (fs.existsSync(secretFile)) fs.rmSync(secretFile, { force: false });
    const updated = CredentialMetadataSchema.parse({ ...record, status: "revoked", updatedAt: this.now().toISOString() });
    const registry = this.readRegistry();
    registry.records = registry.records.map((item) => item.id === id ? updated : item);
    this.writeRegistry(registry);
    return updated;
  }

  delete(id: string): boolean {
    const record = this.find(id);
    if (!record) return false;
    const secretFile = this.secretFile(id);
    if (fs.existsSync(secretFile)) fs.rmSync(secretFile, { force: false });
    const registry = this.readRegistry();
    registry.records = registry.records.filter((item) => item.id !== id);
    this.writeRegistry(registry);
    return true;
  }

  test(id: string): CredentialTestResult {
    const record = this.find(id);
    if (!record) return CredentialTestResultSchema.parse({ id, ok: false, status: "missing", diagnostic: "Credential 不存在。" });
    if (record.status !== "active") return CredentialTestResultSchema.parse({ id, ok: false, status: "revoked", diagnostic: "Credential 已撤销。" });
    if (!this.codec.isEncryptionAvailable()) return CredentialTestResultSchema.parse({ id, ok: false, status: "unavailable", diagnostic: "系统安全存储不可用。" });
    try {
      const secret = this.readSecret(record);
      return CredentialTestResultSchema.parse({ id, ok: Boolean(secret), status: secret ? "available" : "corrupt", diagnostic: secret ? "Credential 可由安全存储解密。" : "Credential 内容为空。" });
    } catch {
      return CredentialTestResultSchema.parse({ id, ok: false, status: "corrupt", diagnostic: "Credential 密文无法解密。" });
    }
  }

  /** Internal execution hook; never expose its return value through IPC. */
  async withSecret<T>(id: string, expectedScope: CredentialScope | null, callback: (secret: string) => Promise<T> | T): Promise<T> {
    const record = this.find(id);
    if (!record || record.status !== "active") throw new Error("Credential 不存在或已撤销。");
    assertScope(record.scope, expectedScope);
    const secret = this.readSecret(record);
    return callback(secret);
  }

  private find(id: string): CredentialMetadata | undefined {
    return this.readRegistry().records.find((record) => record.id === id);
  }

  private readSecret(record: CredentialMetadata): string {
    const secret = this.codec.decryptString(fs.readFileSync(this.secretFile(record.id)));
    if (!secret) throw new Error("Credential 解密结果为空。");
    return secret;
  }

  private secretFile(id: string): string {
    return path.join(this.paths.credentials, `${id}.bin`);
  }

  private writeCiphertext(id: string, secret: string): void {
    fs.mkdirSync(this.paths.credentials, { recursive: true });
    const temporary = `${this.secretFile(id)}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
      fs.writeFileSync(temporary, this.codec.encryptString(secret), { mode: 0o600 });
      fs.renameSync(temporary, this.secretFile(id));
      fs.chmodSync(this.secretFile(id), 0o600);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
  }

  private readRegistry(): CredentialRegistry {
    if (!fs.existsSync(this.registryFile)) return { schemaVersion: CREDENTIAL_SCHEMA_VERSION, records: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryFile, "utf8")) as Partial<CredentialRegistry>;
      if (parsed.schemaVersion !== CREDENTIAL_SCHEMA_VERSION || !Array.isArray(parsed.records)) throw new Error("Credential registry schema mismatch");
      return { schemaVersion: CREDENTIAL_SCHEMA_VERSION, records: parsed.records.map((item) => CredentialMetadataSchema.parse(item)) };
    } catch (error) {
      throw new Error(`Credential registry 无法读取，拒绝覆盖现有状态：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private writeRegistry(registry: CredentialRegistry): void {
    writeJsonAtomic(this.registryFile, registry);
  }
}

function assertScope(actual: CredentialScope | null, expected: CredentialScope | null): void {
  if (!actual && !expected) return;
  if (!actual || !expected || actual.publisherId !== expected.publisherId || actual.skillId !== expected.skillId || actual.version !== expected.version || actual.digest.toLowerCase() !== expected.digest.toLowerCase()) {
    throw new Error("Credential scope 不匹配，拒绝注入。");
  }
}

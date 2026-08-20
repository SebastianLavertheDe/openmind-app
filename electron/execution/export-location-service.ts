import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ExportLocationBindingSchema, EXECUTION_SCHEMA_VERSION, type ExportLocationBinding } from "../../shared/execution-contracts";
import { writeJsonAtomic } from "../lib/fs-utils";

type Registry = { schemaVersion: typeof EXECUTION_SCHEMA_VERSION; records: ExportLocationBinding[] };

/** Persists explicit user-selected export directories outside the openmind contract. */
export class ExportLocationService {
  constructor(
    private readonly registryFile: string,
    private readonly forbiddenRoots: () => string[] = () => [],
    private readonly now: () => Date = () => new Date()
  ) {}

  list(): ExportLocationBinding[] {
    return this.read().records.map((record) => ({ ...record, availability: this.availability(record) }));
  }

  create(label: string, selectedPath: string, requestedId?: string): ExportLocationBinding {
    const canonicalPath = this.canonicalDirectory(selectedPath);
    this.assertAllowed(canonicalPath);
    const registry = this.read();
    const id = requestedId ? this.normalizeId(requestedId) : `export-${crypto.randomUUID()}`;
    if (registry.records.some((record) => record.id === id)) throw new Error(`Export Location Binding 已存在：${id}`);
    const now = this.now().toISOString();
    const record = ExportLocationBindingSchema.parse({
      schemaVersion: EXECUTION_SCHEMA_VERSION,
      id,
      label: label.trim(),
      canonicalPath,
      createdAt: now,
      updatedAt: now,
      revoked: false,
      availability: "available"
    });
    registry.records.push(record);
    this.write(registry);
    return record;
  }

  /** Rebinds an existing manifest binding while preserving its stable ID and audit timestamps. */
  relink(id: string, selectedPath: string): ExportLocationBinding {
    const registry = this.read();
    const current = registry.records.find((record) => record.id === id);
    if (!current) throw new Error(`Export Location Binding 不存在，无法 Relink：${id}`);
    const canonicalPath = this.canonicalDirectory(selectedPath);
    this.assertAllowed(canonicalPath);
    const updated = ExportLocationBindingSchema.parse({
      ...current,
      canonicalPath,
      revoked: false,
      updatedAt: this.now().toISOString(),
      availability: "available"
    });
    registry.records = registry.records.map((record) => record.id === id ? updated : record);
    this.write(registry);
    return { ...updated };
  }

  get(id: string): ExportLocationBinding | undefined {
    const record = this.read().records.find((item) => item.id === id);
    return record ? { ...record } : undefined;
  }

  resolve(id: string): ExportLocationBinding {
    const record = this.get(id);
    if (!record || record.revoked) throw new Error(`Export Location Binding 不存在或已撤销：${id}`);
    let canonicalPath: string;
    try {
      canonicalPath = this.canonicalDirectory(record.canonicalPath);
      this.assertAllowed(canonicalPath);
    } catch (error) {
      if (error instanceof Error && error.message.includes("不能位于")) throw error;
      throw new Error(`Export Location Binding 路径不可用，需要 Relink：${id}`);
    }
    if (canonicalPath !== record.canonicalPath) throw new Error(`Export Location Binding 路径发生变化，需要 Relink：${id}`);
    return { ...record, availability: "available" };
  }

  revoke(id: string): boolean {
    const registry = this.read();
    const current = registry.records.find((item) => item.id === id);
    if (!current || current.revoked) return false;
    const updated = ExportLocationBindingSchema.parse({ ...current, revoked: true, availability: "revoked", updatedAt: this.now().toISOString() });
    registry.records = registry.records.map((item) => item.id === id ? updated : item);
    this.write(registry);
    return true;
  }

  private canonicalDirectory(selectedPath: string): string {
    if (!path.isAbsolute(selectedPath)) throw new Error("Export Location 必须是绝对路径。 ");
    try {
      const canonical = fs.realpathSync(selectedPath);
      if (!fs.statSync(canonical).isDirectory()) throw new Error("not directory");
      return canonical;
    } catch {
      throw new Error(`Export Location 目录不可访问：${selectedPath}`);
    }
  }

  private assertAllowed(candidate: string): void {
    for (const root of this.forbiddenRoots()) {
      const canonicalRoot = path.resolve(root);
      if (candidate === canonicalRoot || candidate.startsWith(`${canonicalRoot}${path.sep}`)) {
        throw new Error("Export Location 不能位于 App 私有目录或当前 openmindRoot 内。 ");
      }
    }
  }

  private normalizeId(id: string): string {
    const normalized = id.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(normalized)) {
      throw new Error("Export Location Binding ID 只能包含字母、数字、点、下划线和短横线。 ");
    }
    return normalized;
  }

  private availability(record: ExportLocationBinding): ExportLocationBinding["availability"] {
    if (record.revoked) return "revoked";
    try {
      const canonicalPath = this.canonicalDirectory(record.canonicalPath);
      this.assertAllowed(canonicalPath);
      return canonicalPath === record.canonicalPath ? "available" : "needs-relink";
    } catch {
      return "needs-relink";
    }
  }

  private read(): Registry {
    if (!fs.existsSync(this.registryFile)) return { schemaVersion: EXECUTION_SCHEMA_VERSION, records: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryFile, "utf8")) as Registry;
      if (parsed.schemaVersion !== EXECUTION_SCHEMA_VERSION || !Array.isArray(parsed.records)) throw new Error("Export binding registry schema mismatch");
      return { schemaVersion: EXECUTION_SCHEMA_VERSION, records: parsed.records.map((item) => ExportLocationBindingSchema.parse(item)) };
    } catch (error) {
      throw new Error(`Export Location registry 无法读取，拒绝覆盖：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private write(registry: Registry): void {
    fs.mkdirSync(path.dirname(this.registryFile), { recursive: true });
    writeJsonAtomic(this.registryFile, registry);
  }
}

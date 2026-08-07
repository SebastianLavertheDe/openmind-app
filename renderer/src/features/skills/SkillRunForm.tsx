import { useEffect, useMemo, useState } from "react";
import type { ExportLocationBinding, InstalledSkillView, MymindRootStatus, ProviderProfile } from "@shared/contracts";
import type { ConfigField, JsonSchemaFragment, SkillManifest } from "@shared/skill-manifest-schema";

type SchemaField = {
  type?: string;
  title?: string;
  description?: string;
  format?: string;
  default?: unknown;
  enum?: unknown[];
};

type Props = {
  record: InstalledSkillView;
  manifest: SkillManifest;
  onCancel: () => void;
  onStarted: (runId: string) => void;
};

export function SkillRunForm({ record, manifest, onCancel, onStarted }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(manifest.inputs));
  const [providerBindings, setProviderBindings] = useState<Record<string, string>>(() => initialProviderBindings(manifest.config));
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [exportLocations, setExportLocations] = useState<ExportLocationBinding[]>([]);
  const [root, setRoot] = useState<MymindRootStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [exportActionId, setExportActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inputFields = useMemo(() => inputEntries(manifest.inputs), [manifest.inputs]);
  const providerFields = useMemo(() => Object.entries(manifest.config).filter(([, field]) => field.type === "provider-profile"), [manifest.config]);
  const exportIds = useMemo(() => [...new Set(manifest.artifacts.map((artifact) => artifact.externalExportId).filter((id): id is string => Boolean(id)))], [manifest.artifacts]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      typeof window.cctools.listProviderProfiles === "function" ? window.cctools.listProviderProfiles() : Promise.resolve([]),
      typeof window.cctools.listExportLocations === "function" ? window.cctools.listExportLocations() : Promise.resolve([]),
      typeof window.cctools.getMymindRoot === "function" ? window.cctools.getMymindRoot() : Promise.resolve(null)
    ]).then(([nextProfiles, nextExports, nextRoot]) => {
      if (cancelled) return;
      setProfiles(nextProfiles);
      setExportLocations(nextExports);
      setRoot(nextRoot);
      setLoading(false);
    }).catch((cause) => {
      if (cancelled) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [record.key, record.digest]);

  const updateValue = (name: string, value: unknown) => {
    setValues((current) => ({ ...current, [name]: value }));
    setError(null);
  };

  const updateProvider = (name: string, value: string) => {
    setProviderBindings((current) => ({ ...current, [name]: value }));
    setError(null);
  };

  const replaceExportLocation = (binding: ExportLocationBinding) => {
    setExportLocations((current) => [...current.filter((item) => item.id !== binding.id), binding]);
  };

  const relinkExportLocation = async (id: string) => {
    if (typeof window.cctools.selectExportLocation !== "function") {
      setError("当前环境不支持 Export Location 选择。 ");
      return;
    }
    setExportActionId(id);
    setError(null);
    try {
      const current = exportLocations.find((item) => item.id === id);
      const binding = await window.cctools.selectExportLocation(current?.label || id, id);
      if (binding) replaceExportLocation(binding);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExportActionId(null);
    }
  };

  const revokeExportLocation = async (id: string) => {
    if (typeof window.cctools.revokeExportLocation !== "function") {
      setError("当前环境不支持 Export Location 撤销。 ");
      return;
    }
    if (typeof window.confirm === "function" && !window.confirm("撤销后，新 Run 将不能使用这个 Export Location Binding。继续吗？")) return;
    setExportActionId(id);
    setError(null);
    try {
      const revoked = await window.cctools.revokeExportLocation(id);
      if (revoked) setExportLocations((current) => current.map((item) => item.id === id ? { ...item, revoked: true, availability: "revoked" } : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExportActionId(null);
    }
  };

  const submit = async () => {
    setError(null);
    const inputResult = normalizeInputs(manifest.inputs, values);
    if (!inputResult.ok) {
      setError(inputResult.error);
      return;
    }
    const providerResult = normalizeProviderBindings(providerFields, providerBindings, manifest.kind === "agent" && manifest.provider.required);
    if (!providerResult.ok) {
      setError(providerResult.error);
      return;
    }
    const currentRoot = root;
    const rootGeneration = currentRoot?.snapshot?.rootGeneration;
    if (rootGeneration == null) {
      setError("当前 mymind 没有可用的 root snapshot，不能启动 Run。 ");
      return;
    }
    if (!currentRoot || !currentRoot.health.configured || !currentRoot.health.accessible || !currentRoot.health.readable || !currentRoot.health.writable) {
      setError("当前 mymind 根目录不可读写，不能启动 Run。 ");
      return;
    }
    const exportResult = normalizeExportBindings(exportIds, exportLocations);
    if (!exportResult.ok) {
      setError(exportResult.error);
      return;
    }
    setSubmitting(true);
    try {
      const result = manifest.kind === "workflow"
        ? await window.cctools.startWorkflowRun({
          skillId: record.id,
          version: record.version,
          inputs: inputResult.inputs,
          providerBindings: providerResult.bindings,
          rootGeneration
        })
        : await window.cctools.startSkillRun({
          skillId: record.id,
          version: record.version,
          digest: record.digest,
          inputs: inputResult.inputs,
          providerBindings: providerResult.bindings,
          trigger: { type: "manual" },
          externalExportBindingIds: exportResult.bindingIds,
          rootGeneration
        });
      onStarted(result.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="skills-run-form" aria-label="Skill Run 表单">
      <header className="skills-run-form-header">
        <div><span className="eyebrow">RUN INPUTS</span><h3>运行 {manifest.display.name}</h3><p>输入只在本次 Run 中使用，不会写入运行历史；Credential 只通过 Provider Profile 引用。</p></div>
        <span className="skills-run-version">{record.version} · {record.digest.slice(0, 12)}…</span>
      </header>
      {error ? <p className="skills-run-error" role="alert">{error}</p> : null}
      {loading ? <p className="skills-run-muted">正在读取 Provider、Export Location 和 mymind snapshot…</p> : null}
      {!loading ? <>
        <div className="skills-run-fields">
          {inputFields.length ? inputFields.map(([name, field]) => <SchemaInput key={name} name={name} field={field} value={values[name]} required={Boolean(manifest.inputs?.required?.includes(name))} onChange={(value) => updateValue(name, value)} />) : <p className="skills-run-muted">该 Skill 没有声明本次运行输入。</p>}
        </div>
        {providerFields.length ? <section className="skills-run-section"><h4>Provider Profile</h4>{providerFields.map(([name, field]) => <ProviderInput key={name} name={name} field={field} profiles={profiles} value={providerBindings[name] || ""} onChange={(value) => updateProvider(name, value)} />)}</section> : null}
        {exportIds.length ? <section className="skills-run-section"><h4>导出绑定</h4>{exportIds.map((id) => <ExportBindingRow key={id} id={id} locations={exportLocations} busy={exportActionId === id} onRelink={relinkExportLocation} onRevoke={revokeExportLocation} />)}</section> : null}
        <section className="skills-run-snapshot"><strong>mymind snapshot</strong><span>{root?.snapshot ? `root generation ${root.snapshot.rootGeneration}` : "不可用"}</span></section>
      </> : null}
      <div className="skills-run-actions">
        <button type="button" className="settings-subtle-action" data-motion="action" onClick={onCancel} disabled={submitting}>取消</button>
        <button type="button" className="primary-button" data-motion="action" onClick={() => void submit()} disabled={loading || submitting}>{submitting ? "启动中…" : "启动 Run"}</button>
      </div>
    </section>
  );
}

function SchemaInput({ name, field, value, required, onChange }: { name: string; field: SchemaField; value: unknown; required: boolean; onChange: (value: unknown) => void }) {
  const label = field.title || name;
  const type = field.type || "string";
  const enumValues = field.enum || [];
  if (enumValues.length) {
    return <label className="skills-run-field"><span>{label}{required ? " *" : ""}</span>{field.description ? <small>{field.description}</small> : null}<select aria-label={label} value={value == null ? "" : String(value)} onChange={(event) => onChange(event.target.value)}><option value="">请选择…</option>{enumValues.map((item) => <option key={String(item)} value={String(item)}>{String(item)}</option>)}</select></label>;
  }
  if (type === "boolean") {
    return <label className="skills-run-checkbox"><input type="checkbox" aria-label={label} checked={value === true} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}{required ? " *" : ""}</strong>{field.description ? <small>{field.description}</small> : null}</span></label>;
  }
  if (type === "array" || type === "object") {
    const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2);
    return <label className="skills-run-field"><span>{label}{required ? " *" : ""}</span>{field.description ? <small>{field.description}</small> : null}<textarea aria-label={label} value={text} onChange={(event) => onChange(event.target.value)} placeholder={type === "array" ? "[ ]" : "{ }"} spellCheck={false} /></label>;
  }
  return <label className="skills-run-field"><span>{label}{required ? " *" : ""}</span>{field.description ? <small>{field.description}</small> : null}<input aria-label={label} type={type === "number" || type === "integer" ? "number" : "text"} inputMode={type === "number" || type === "integer" ? "decimal" : undefined} value={value == null ? "" : String(value)} onChange={(event) => onChange(event.target.value)} placeholder={field.format === "compact-date" ? "YYYYMMDD" : undefined} /></label>;
}

function ProviderInput({ name, field, profiles, value, onChange }: { name: string; field: ConfigField; profiles: ProviderProfile[]; value: string; onChange: (value: string) => void }) {
  return <label className="skills-run-field"><span>{name}{field.required ? " *" : ""}</span>{field.description ? <small>{field.description}</small> : null}<select aria-label={`Provider Profile ${name}`} value={value} onChange={(event) => onChange(event.target.value)}><option value="">请选择 Provider Profile…</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} ({profile.id})</option>)}</select>{!profiles.length ? <small>尚未配置 Provider Profile，请先到设置完成配置。</small> : null}</label>;
}

function ExportBindingRow({ id, locations, busy, onRelink, onRevoke }: { id: string; locations: ExportLocationBinding[]; busy: boolean; onRelink: (id: string) => void; onRevoke: (id: string) => void }) {
  const binding = locations.find((item) => item.id === id);
  const needsRelink = binding?.availability === "needs-relink";
  return <div className={`skills-run-binding ${binding && !binding.revoked && !needsRelink ? "ready" : "missing"}`}>
    <div><span>{id}</span><small>{binding ? binding.revoked ? `已撤销 · ${binding.label} · 可重新绑定` : needsRelink ? `需要 Relink · ${binding.label} · 原目录不可用` : `${binding.label} · ${binding.canonicalPath}` : "未绑定；选择目录后会创建固定的 Manifest binding ID"}</small></div>
    <div className="skills-run-binding-actions">
      <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => onRelink(id)} disabled={busy} aria-label={`${binding ? "重新绑定" : "选择目录"} ${id}`}>{busy ? "处理中…" : binding ? "Relink" : "选择目录"}</button>
      {binding && !binding.revoked ? <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => onRevoke(id)} disabled={busy} aria-label={`撤销 ${id}`}>撤销</button> : null}
    </div>
  </div>;
}

function inputEntries(schema: JsonSchemaFragment | undefined): Array<[string, SchemaField]> {
  if (!schema?.properties) return [];
  return Object.entries(schema.properties).map(([name, value]) => [name, normalizeField(value)]);
}

function normalizeField(value: unknown): SchemaField {
  if (!value || typeof value !== "object") return { type: "string" };
  const item = value as Record<string, unknown>;
  return {
    type: typeof item.type === "string" ? item.type : "string",
    title: typeof item.title === "string" ? item.title : undefined,
    description: typeof item.description === "string" ? item.description : undefined,
    format: typeof item.format === "string" ? item.format : undefined,
    default: item.default,
    enum: Array.isArray(item.enum) ? item.enum : undefined
  };
}

function initialValues(schema: JsonSchemaFragment | undefined): Record<string, unknown> {
  return Object.fromEntries(inputEntries(schema).map(([name, field]) => [name, field.default !== undefined ? field.default : field.type === "boolean" ? false : field.type === "array" ? "" : field.type === "object" ? "" : ""]));
}

function initialProviderBindings(config: Record<string, ConfigField>): Record<string, string> {
  return Object.fromEntries(Object.entries(config).filter(([, field]) => field.type === "provider-profile" && typeof field.default === "string").map(([name, field]) => [name, field.default as string]));
}

function normalizeInputs(schema: JsonSchemaFragment | undefined, values: Record<string, unknown>): { ok: true; inputs: Record<string, unknown> } | { ok: false; error: string } {
  const result: Record<string, unknown> = {};
  for (const [name, field] of inputEntries(schema)) {
    const raw = values[name];
    const empty = raw === undefined || raw === null || raw === "";
    if (schema?.required?.includes(name) && empty) return { ok: false, error: `缺少必填输入：${name}` };
    if (empty) continue;
    if (field.format === "compact-date" && (typeof raw !== "string" || !/^\d{8}$/.test(raw))) return { ok: false, error: `输入 ${name} 必须是 YYYYMMDD。` };
    if (field.type === "number" || field.type === "integer") {
      const number = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(number) || (field.type === "integer" && !Number.isInteger(number))) return { ok: false, error: `输入 ${name} 必须是${field.type === "integer" ? "整数" : "数字"}。` };
      result[name] = number;
    } else if (field.type === "boolean") {
      if (typeof raw !== "boolean") return { ok: false, error: `输入 ${name} 必须是 boolean。` };
      result[name] = raw;
    } else if (field.type === "array" || field.type === "object") {
      try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (field.type === "array" && !Array.isArray(parsed)) throw new Error("array");
        if (field.type === "object" && (!parsed || typeof parsed !== "object" || Array.isArray(parsed))) throw new Error("object");
        result[name] = parsed;
      } catch {
        return { ok: false, error: `输入 ${name} 必须是有效的 JSON ${field.type}。` };
      }
    } else {
      result[name] = String(raw);
    }
    if (field.enum?.length && !field.enum.some((item) => Object.is(item, result[name]) || String(item) === String(result[name]))) return { ok: false, error: `输入 ${name} 不在允许的选项中。` };
  }
  return { ok: true, inputs: result };
}

function normalizeProviderBindings(fields: Array<[string, ConfigField]>, values: Record<string, string>, agentRequired: boolean): { ok: true; bindings: Record<string, string> } | { ok: false; error: string } {
  if (agentRequired && !fields.length) return { ok: false, error: "Agent Manifest 未声明 Provider Profile binding。" };
  const bindings: Record<string, string> = {};
  for (const [name, field] of fields) {
    if (field.required && !values[name]) return { ok: false, error: `缺少 Provider Profile 绑定：${name}` };
    if (values[name]) bindings[name] = values[name];
  }
  return { ok: true, bindings };
}

function normalizeExportBindings(ids: string[], locations: ExportLocationBinding[]): { ok: true; bindingIds: string[] } | { ok: false; error: string } {
  for (const id of ids) {
    const binding = locations.find((item) => item.id === id);
    if (!binding) return { ok: false, error: `缺少 Artifact Export Location Binding：${id}` };
    if (binding.revoked) return { ok: false, error: `Export Location Binding 已撤销：${id}` };
    if (binding.availability === "needs-relink") return { ok: false, error: `Export Location Binding 需要 Relink：${id}` };
  }
  return { ok: true, bindingIds: ids };
}

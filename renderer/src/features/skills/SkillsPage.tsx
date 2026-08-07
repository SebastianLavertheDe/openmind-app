import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSearch, FolderOpen, GitBranch, Package, PackagePlus, RefreshCw, RotateCcw, Search, ShieldCheck, ShieldOff, Trash2, Upload, X } from "lucide-react";
import type { InstalledSkillView, SkillDefinition, SkillPackageInspectionView } from "@shared/contracts";
import { messages } from "@shared/messages";
import type { SkillPackageSourceInput } from "@shared/skill-package-sources";
import type { Navigate } from "../../app/routes";
import { diffSkillCapabilities, type SkillManifest } from "@shared/skill-manifest-schema";
import { StatusBadge } from "../../design-system/components";
import { useAi } from "../../ai-context";
import { SkillRunForm } from "./SkillRunForm";

const m = messages.skillCenter;

type Filter = "all" | "installed" | "workspace" | "attention";
type BusyAction = "scan" | "migrate" | "install" | "update" | "rollback" | "uninstall" | "trust" | "revoke" | "source-inspect" | "source-install" | null;

type SkillItem =
  | { kind: "installed"; id: string; record: InstalledSkillView; inspection?: SkillPackageInspectionView }
  | { kind: "workspace"; id: string; inspection: SkillPackageInspectionView; record?: InstalledSkillView };

type ManifestSummary = {
  id: string;
  title: string;
  description: string;
  publisher: string;
  version: string;
  kind: string;
  configCount: number;
  capabilities: string[];
};

export function SkillsPage({ skills, initialSkillId, go }: { skills: SkillDefinition[]; initialSkillId?: string; go: Navigate }) {
  const ai = useAi();
  const [inspections, setInspections] = useState<SkillPackageInspectionView[]>([]);
  const [installed, setInstalled] = useState<InstalledSkillView[]>([]);
  const [installedInspections, setInstalledInspections] = useState<Record<string, SkillPackageInspectionView>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState<BusyAction>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [gitLocator, setGitLocator] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [sourceCandidate, setSourceCandidate] = useState<{ source: SkillPackageSourceInput; inspection: SkillPackageInspectionView } | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const [nextInspections, nextInstalled] = await Promise.all([
        window.cctools.inspectSkillWorkspace(),
        window.cctools.listInstalledSkills()
      ]);
      const inspectedInstalled = window.cctools.inspectInstalledSkill
        ? await Promise.all(nextInstalled.map(async (record) => {
          try {
            const inspection = await window.cctools.inspectInstalledSkill(record.key, record.digest);
            return inspection ? [installedInspectionKey(record), inspection] as const : null;
          } catch {
            return null;
          }
        }))
        : [];
      const nextInstalledInspections: Record<string, SkillPackageInspectionView> = {};
      for (const entry of inspectedInstalled) {
        if (entry) nextInstalledInspections[entry[0]] = entry[1];
      }
      setInspections(nextInspections);
      setInstalled(nextInstalled);
      setInstalledInspections(nextInstalledInspections);
      setError(null);
      setSelectedId((current) => {
        const nextItems = buildItems(nextInspections, nextInstalled, nextInstalledInspections);
        if (nextItems.some((item) => item.id === current)) return current;
        const requested = nextItems.find((item) => item.kind === "installed" && item.record.id === initialSkillId);
        return requested?.id || nextItems[0]?.id || "";
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [initialSkillId]);

  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => buildItems(inspections, installed, installedInspections), [inspections, installed, installedInspections]);
  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (filter === "installed" && item.kind !== "installed") return false;
      if (filter === "workspace" && item.kind !== "workspace") return false;
      if (filter === "attention" && !needsAttention(item)) return false;
      const summary = item.kind === "installed" ? manifestSummary(item.inspection?.manifest, item.record) : manifestSummary(item.inspection.manifest);
      const sourcePath = item.kind === "installed" ? item.record.sourcePath : item.inspection.sourcePath;
      const text = `${summary.title} ${summary.id} ${summary.publisher} ${summary.version} ${summary.kind} ${item.kind} ${sourcePath}`.toLocaleLowerCase();
      return !needle || text.includes(needle);
    });
  }, [filter, items, query]);

  useEffect(() => {
    if (filteredItems.some((item) => item.id === selectedId)) return;
    setSelectedId(filteredItems[0]?.id || "");
  }, [filteredItems, selectedId]);

  const selected = items.find((item) => item.id === selectedId);
  const selectedSummary = selected
    ? selected.kind === "installed" ? manifestSummary(selected.inspection?.manifest, selected.record) : manifestSummary(selected.inspection.manifest)
    : null;
  const selectedActiveRecord = selected?.kind === "installed"
    ? installed.find((record) => record.key === selected.record.key && record.status === "active")
    : undefined;
  const selectedCapabilityDiff = selected?.kind === "installed" && selectedActiveRecord && selectedActiveRecord.digest !== selected.record.digest
    ? diffSkillCapabilities(
      installedInspections[installedInspectionKey(selectedActiveRecord)]?.manifest,
      selected.inspection?.manifest
    )
    : null;
  const [runOpen, setRunOpen] = useState(false);

  useEffect(() => { setRunOpen(false); }, [selectedId]);

  const runAction = async (action: Exclude<BusyAction, "scan" | "migrate" | null>, callback: () => Promise<unknown>, success = m.actionComplete) => {
    setBusy(action);
    try {
      await callback();
      ai.notify(success, "success");
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      ai.notify(m.actionFailed, "error");
    } finally {
      setBusy(null);
    }
  };

  const scan = async () => {
    setBusy("scan");
    await load();
    setBusy(null);
  };

  const migrate = async () => {
    if (!inspections.some((item) => item.valid)) return;
    setBusy("migrate");
    try {
      const report = await window.cctools.migrateSkillWorkspace();
      ai.notify(m.migrationSummary(report.installed.length, report.skipped.length), "success");
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      ai.notify(m.actionFailed, "error");
    } finally {
      setBusy(null);
    }
  };

  const install = async (item: Extract<SkillItem, { kind: "workspace" }>) => {
    if (!item.inspection.valid || !window.cctools.installSkillPackage) return;
    await runAction("install", () => window.cctools.installSkillPackage!(item.inspection.sourcePath));
  };

  const inspectSource = async (source: SkillPackageSourceInput) => {
    if (!window.cctools.inspectSkillSource) {
      setError(m.sourcePicker.noApi);
      return;
    }
    setBusy("source-inspect");
    setError(null);
    setSourceCandidate(null);
    try {
      const inspection = await window.cctools.inspectSkillSource(source);
      setSourceCandidate({ source, inspection });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const selectLocalSource = async () => {
    if (!window.cctools.selectSkillPackageSource) {
      setError(m.sourcePicker.noApi);
      return;
    }
    try {
      const source = await window.cctools.selectSkillPackageSource();
      if (source) await inspectSource(source);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const inspectGitSource = async () => {
    const locator = gitLocator.trim();
    if (!locator) {
      setError("请输入 Git HTTPS 地址。 ");
      return;
    }
    await inspectSource({ type: "git", locator, ...(gitRef.trim() ? { ref: gitRef.trim() } : {}) });
  };

  const installSource = async () => {
    if (!sourceCandidate || !window.cctools.installSkillSource) {
      setError(m.sourcePicker.noCandidate);
      return;
    }
    setBusy("source-install");
    setError(null);
    try {
      await window.cctools.installSkillSource(sourceCandidate.source);
      ai.notify(m.actionComplete, "success");
      setSourceCandidate(null);
      setSourcePickerOpen(false);
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      ai.notify(m.actionFailed, "error");
    } finally {
      setBusy(null);
    }
  };

  const update = async (item: Extract<SkillItem, { kind: "installed" }>) => {
    if (!item.inspection?.valid) return;
    if (item.record.sourceType === "git" && item.record.sourceLocator && window.cctools.updateSkillSource) {
      await runAction("update", () => window.cctools.updateSkillSource!({ type: "git", locator: item.record.sourceLocator!, ...(item.record.sourceRef ? { ref: item.record.sourceRef } : {}) }));
      return;
    }
    if (!window.cctools.updateSkillPackage) return;
    await runAction("update", () => window.cctools.updateSkillPackage!(item.inspection!.sourcePath));
  };

  const approve = async (record: InstalledSkillView, manifest?: unknown) => {
    if (record.status !== "active" || record.readiness !== "ready") return;
    const confirmed = await ai.confirm({ title: "信任并运行 Skill", body: hostTrustBody(record, manifest), confirmText: "信任并运行", danger: true });
    if (!confirmed) return;
    await runAction("trust", () => window.cctools.approveInstalledSkillHost(record.key, record.digest));
  };

  const revoke = async (record: InstalledSkillView) => {
    const confirmed = await ai.confirm({ title: "撤销宿主机信任", body: m.revokeBody, confirmText: "撤销信任", danger: true });
    if (!confirmed) return;
    await runAction("revoke", () => window.cctools.revokeInstalledSkillHost(record.key, record.digest));
  };

  const rollback = async (record: InstalledSkillView) => {
    if (record.status !== "active" || !window.cctools.rollbackSkillPackage) return;
    await runAction("rollback", () => window.cctools.rollbackSkillPackage!(record.key));
  };

  const uninstall = async (record: InstalledSkillView) => {
    if (record.status === "active" || !window.cctools.uninstallSkillPackage) return;
    const confirmed = await ai.confirm({ title: "卸载 Skill 候选版本", body: "只会移除 App 私有的非 active 安装包，不会删除 workspace 来源或 mymind 内容。", confirmText: "卸载", danger: true });
    if (!confirmed) return;
    await runAction("uninstall", () => window.cctools.uninstallSkillPackage!(record.key, record.digest));
  };

  if (loading && !items.length) {
    return <div className="feature-page skills-page"><section className="workspace-card skills-empty"><p>{m.loading}</p></section></div>;
  }

  return (
    <div className="feature-page skills-page">
      <header className="skills-page-header">
        <div><span className="eyebrow">{m.eyebrow}</span><h1>{m.title}</h1><p>{m.description}</p></div>
        <div className="ui-page-actions">
          <button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null} onClick={() => void scan()}><RefreshCw size={14} className={busy === "scan" ? "spin" : ""} />{busy === "scan" ? m.refreshing : m.refresh}</button>
          <button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null} onClick={() => { setSourcePickerOpen((current) => !current); setSourceCandidate(null); }}><PackagePlus size={14} />{sourcePickerOpen ? m.sourcePicker.close : m.sourcePicker.open}</button>
          <button type="button" className="primary-button" data-motion="action" disabled={busy !== null || !inspections.some((item) => item.valid)} onClick={() => void migrate()}><Upload size={14} />{busy === "migrate" ? m.migrating : m.migrate}</button>
        </div>
      </header>

      {error ? <p className="skills-error" role="alert">{error}</p> : null}
      {sourcePickerOpen ? <section className="workspace-card skills-source-picker">
        <header className="skills-source-picker-header"><div><span className="eyebrow">SOURCE ADAPTER</span><h2>{m.sourcePicker.title}</h2><p>{m.sourcePicker.description}</p></div><button type="button" className="icon-button" aria-label={m.sourcePicker.close} onClick={() => setSourcePickerOpen(false)}><X size={16} /></button></header>
        <div className="skills-source-picker-grid">
          <div className="skills-source-local"><button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null} onClick={() => void selectLocalSource()}><FolderOpen size={14} />{m.sourcePicker.local}</button><p>目录和 ZIP 都会进入同一套 Manifest、digest、排除和 quarantine 检查。</p></div>
          <div className="skills-source-git">
            <label className="skills-source-input"><span>{m.sourcePicker.git}</span><input value={gitLocator} onChange={(event) => setGitLocator(event.target.value)} placeholder={m.sourcePicker.gitPlaceholder} inputMode="url" /></label>
            <label className="skills-source-input"><span>Ref</span><input value={gitRef} onChange={(event) => setGitRef(event.target.value)} placeholder={m.sourcePicker.refPlaceholder} /></label>
            <button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null || !gitLocator.trim()} onClick={() => void inspectGitSource()}><GitBranch size={14} />{busy === "source-inspect" ? m.sourcePicker.inspecting : m.sourcePicker.inspect}</button>
          </div>
        </div>
        {sourceCandidate ? <div className={`skills-source-candidate ${sourceCandidate.inspection.valid ? "valid" : "invalid"}`}>
          <div><strong>{sourceCandidate.inspection.valid ? m.sourcePicker.valid : m.sourcePicker.invalid}</strong><span>{sourceCandidate.source.type === "git" ? sourceCandidate.source.locator : sourceCandidate.inspection.sourcePath}</span></div>
          <div className="skills-source-candidate-actions"><StatusBadge tone={sourceCandidate.inspection.valid ? "success" : "danger"}>{sourceCandidate.inspection.valid ? "quarantine 可导入" : "需要修复"}</StatusBadge><button type="button" className="primary-button" data-motion="action" disabled={busy !== null || !sourceCandidate.inspection.valid || !window.cctools.installSkillSource} onClick={() => void installSource()}><Package size={14} />{busy === "source-install" ? m.sourcePicker.importing : m.sourcePicker.import}</button></div>
          {sourceCandidate.inspection.issues.length ? <IssueList inspection={sourceCandidate.inspection} /> : null}
        </div> : null}
      </section> : null}
      <section className="skills-layout">
        <aside className="workspace-card skills-catalog">
          <header className="skills-catalog-header">
            <label className="skills-search"><Search size={14} aria-hidden /><input type="search" aria-label={m.searchAria} placeholder={m.searchPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <div className="skills-filter" role="tablist" aria-label={m.filterAria}>
              {(Object.keys(m.filters) as Filter[]).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} data-motion="selection" onClick={() => setFilter(value)}>{m.filters[value]}</button>)}
            </div>
          </header>
          <div className="skills-catalog-list" aria-label={m.listAria}>
            {!filteredItems.length ? <div className="skills-empty"><Package size={20} aria-hidden /><strong>{items.length ? m.noMatch : m.emptyTitle}</strong><span>{items.length ? m.noMatch : m.emptyDescription}</span></div> : null}
            {filteredItems.map((item) => <SkillListItem key={item.id} item={item} active={item.id === selectedId} onSelect={() => setSelectedId(item.id)} />)}
          </div>
        </aside>

        <main className="workspace-card skills-detail">
          {!selected || !selectedSummary ? <div className="skills-detail-empty"><Package size={24} aria-hidden /><p>{m.detailEmpty}</p></div> : <>
            <header className="skills-detail-header">
              <div><span className="eyebrow">{selectedSummary.kind.toUpperCase()}</span><h2>{selectedSummary.title}</h2><p>{selectedSummary.description || selectedSummary.id}</p></div>
              <StatusBadge tone={selected.kind === "installed" ? statusTone(selected.record) : selected.inspection.valid ? "warning" : "danger"}>{selected.kind === "installed" ? installedStatus(selected.record) : selected.inspection.valid ? m.workspace : m.staticInvalid}</StatusBadge>
            </header>
            <div className="skills-status-grid">
              <StatusCell label={m.publisher} value={selectedSummary.publisher} />
              <StatusCell label={m.version} value={selectedSummary.version} />
              <StatusCell label={m.kind} value={selectedSummary.kind} />
              <StatusCell label="配置字段" value={String(selectedSummary.configCount)} />
              <StatusCell label="sourceType" value={selected.kind === "installed" ? selected.record.sourceType || selected.inspection?.sourceKind || "unknown" : selected.inspection.sourceKind} />
              {selected.kind === "installed" ? <>
                <StatusCell label={m.readiness} value={readinessLabel(selected.record.readiness)} />
                <StatusCell label={m.trust} value={selected.record.executionTrust} />
                <StatusCell label={m.signature} value={selected.record.signatureStatus} />
                <StatusCell label={m.review} value={selected.record.reviewStatus} />
              </> : null}
            </div>
            <section className="skills-detail-section">
              <h3>包与来源</h3>
              <dl className="skills-meta-list">
              <StatusCell label={m.source} value={selected.kind === "installed" ? selected.record.sourceLocator || selected.record.sourcePath : selected.inspection.sourcePath} />
                <StatusCell label={m.digest} value={(selected.kind === "installed" ? selected.record.digest : selected.inspection.digest).slice(0, 24) + "…"} code />
                <StatusCell label={m.size} value={formatBytes(selected.kind === "installed" ? selected.inspection?.totalBytes || 0 : selected.inspection.totalBytes)} />
                <StatusCell label={m.files} value={String(selected.kind === "installed" ? selected.inspection?.files.length || 0 : selected.inspection.files.length)} />
              </dl>
              {selected.kind === "installed" ? <div className="skills-trust-note"><ShieldCheck size={15} aria-hidden /><span>{m.signature}：{selected.record.signatureStatus} · {m.review}：{selected.record.reviewStatus} · 更新策略：{selected.record.skillUpdatePolicy}</span></div> : null}
            </section>
            {selected.kind === "workspace" && selected.inspection.issues.length ? <IssueList inspection={selected.inspection} /> : null}
            {selected.kind === "installed" && selected.inspection?.warnings.length ? <IssueList inspection={selected.inspection} warningsOnly /> : null}
            {selectedCapabilityDiff ? <CapabilityDiffNotice diff={selectedCapabilityDiff} /> : null}
            {runOpen && selected.kind === "installed" && selected.inspection?.manifest ? <SkillRunForm record={selected.record} manifest={selected.inspection.manifest as SkillManifest} onCancel={() => setRunOpen(false)} onStarted={(runId) => go("runs", { runId })} /> : null}
            <div className="skills-detail-actions">
              <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void openSkillSource(selected)}><FolderOpen size={14} />{m.actions.openSource}</button>
              {selected.kind === "workspace" ? <>
                <button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null || !selected.inspection.valid || !window.cctools.installSkillPackage} onClick={() => void install(selected)}><Package size={14} />{busy === "install" ? "导入中…" : "导入到 quarantine"}</button>
                <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => ai.notify(selected.inspection.issues.length ? selected.inspection.issues.map((issue) => issue.message).join("；") : m.staticInvalid, selected.inspection.valid ? "info" : "error")}><FileSearch size={14} />{m.actions.inspect}</button>
              </> : <InstalledActions record={selected.record} hasPrevious={installed.some((item) => item.key === selected.record.key && item.status === "previous" && item.readiness === "ready")} hasSource={Boolean(selected.inspection?.valid)} busy={busy} runOpen={runOpen} onApprove={() => void approve(selected.record, selected.inspection?.manifest)} onRevoke={() => void revoke(selected.record)} onRollback={() => void rollback(selected.record)} onUninstall={() => void uninstall(selected.record)} onUpdate={() => void update(selected)} onRun={() => setRunOpen((current) => !current)} />}
            </div>
          </>}
        </main>
      </section>
      <p className="skills-footer-note">{m.scanSummary(inspections.length, installed.length)} · {skills.length} 个 workspace 能力仍由旧 SKILL.md/发现链提供，不会因扫描自动获得执行信任。</p>
    </div>
  );
}

function SkillListItem({ item, active, onSelect }: { item: SkillItem; active: boolean; onSelect(): void }) {
  const summary = item.kind === "installed" ? manifestSummary(item.inspection?.manifest, item.record) : manifestSummary(item.inspection.manifest);
  const attention = needsAttention(item);
  return <button type="button" className={`skills-list-item${active ? " active" : ""}`} data-motion="selection" aria-current={active ? "page" : undefined} onClick={onSelect}>
    <span className={`skills-list-icon ${attention ? "attention" : ""}`} aria-hidden><Package size={16} /></span>
    <span className="skills-list-copy"><strong>{summary.title}</strong><small>{summary.publisher}/{summary.id} · v{summary.version}</small></span>
    <span className="skills-list-status">{item.kind === "installed" ? installedStatus(item.record) : item.inspection.valid ? m.workspace : m.staticInvalid}</span>
  </button>;
}

function openSkillSource(item: SkillItem): void {
  const sourceType = item.kind === "installed" ? item.record.sourceType : item.inspection.sourceKind;
  const source = item.kind === "installed" ? item.record.sourceLocator || item.record.sourcePath : item.inspection.sourcePath;
  if (sourceType === "git") void window.cctools.openExternal(source);
  else void window.cctools.openPath(source);
}

function InstalledActions({ record, hasPrevious, hasSource, busy, runOpen, onApprove, onRevoke, onRollback, onUninstall, onUpdate, onRun }: { record: InstalledSkillView; hasPrevious: boolean; hasSource: boolean; busy: BusyAction; runOpen: boolean; onApprove(): void; onRevoke(): void; onRollback(): void; onUninstall(): void; onUpdate(): void; onRun(): void }) {
  return <>
    {record.status === "active" && record.readiness === "ready" && record.executionTrust !== "approved-host" ? <button type="button" className="danger-button" data-motion="action" disabled={busy !== null} onClick={onApprove}><ShieldCheck size={14} />{m.actions.approve}</button> : null}
    {record.executionTrust === "approved-host" ? <button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null} onClick={onRevoke}><ShieldOff size={14} />{m.actions.revoke}</button> : null}
    {record.executionTrust === "approved-host" && record.status === "active" && record.readiness === "ready" ? <button type="button" className="settings-subtle-action" data-motion="action" onClick={onRun}>{runOpen ? "收起运行表单" : "打开运行表单"}</button> : null}
    {hasSource ? <button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null} onClick={onUpdate}>{m.actions.update}</button> : null}
    {record.status === "active" && hasPrevious ? <button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null} onClick={onRollback}><RotateCcw size={14} />{m.actions.rollback}</button> : null}
    {record.status !== "active" ? <button type="button" className="danger-button" data-motion="action" disabled={busy !== null} onClick={onUninstall}><Trash2 size={14} />{m.actions.uninstall}</button> : null}
  </>;
}

function StatusCell({ label, value, code = false }: { label: string; value: string; code?: boolean }) {
  return <div><dt>{label}</dt><dd className={code ? "is-code" : undefined} title={value}>{value || "—"}</dd></div>;
}

function IssueList({ inspection, warningsOnly = false }: { inspection: SkillPackageInspectionView; warningsOnly?: boolean }) {
  const messages = warningsOnly ? inspection.warnings : inspection.issues.map((issue) => issue.message);
  if (!messages.length) return null;
  return <section className="skills-detail-section skills-issue-section"><h3>{warningsOnly ? "检查提醒" : "检查问题"}</h3><ul>{messages.slice(0, 8).map((message) => <li key={message}>{message}</li>)}</ul></section>;
}

function CapabilityDiffNotice({ diff }: { diff: ReturnType<typeof diffSkillCapabilities> }) {
  if (!diff.changed) {
    return <section className="skills-detail-section skills-capability-diff" role="status"><h3>更新权限 diff</h3><p>声明能力未变化，但新 digest 仍必须重新获得 approved-host 和本次 Run 授权。</p></section>;
  }
  return <section className="skills-detail-section skills-capability-diff" role="status">
    <h3>更新权限 diff</h3>
    <p>该候选版本声明能力发生变化；切换后不会继承原版本的宿主机授权。</p>
    {diff.added.length ? <p><strong>新增：</strong>{diff.added.join("、")}</p> : null}
    {diff.removed.length ? <p><strong>移除：</strong>{diff.removed.join("、")}</p> : null}
  </section>;
}

function buildItems(inspections: SkillPackageInspectionView[], installed: InstalledSkillView[], installedInspectionMap: Record<string, SkillPackageInspectionView> = {}): SkillItem[] {
  const inspectionBySource = new Map(inspections.map((inspection) => [`${inspection.sourcePath}:${inspection.digest}`, inspection]));
  const items: SkillItem[] = installed.map((record) => ({ kind: "installed", id: `installed:${record.key}:${record.digest}`, record, inspection: installedInspectionMap[installedInspectionKey(record)] || inspectionBySource.get(`${record.sourcePath}:${record.digest}`) }));
  for (const inspection of inspections) {
    if (!installed.some((record) => record.sourcePath === inspection.sourcePath && record.digest === inspection.digest)) {
      items.push({ kind: "workspace", id: `workspace:${inspection.sourcePath}:${inspection.digest}`, inspection });
    }
  }
  return items.sort((left, right) => itemTitle(left).localeCompare(itemTitle(right), "zh-CN"));
}

function installedInspectionKey(record: InstalledSkillView): string {
  return `${record.key}:${record.digest}`;
}

function itemTitle(item: SkillItem): string {
  return manifestSummary(item.kind === "installed" ? item.inspection?.manifest : item.inspection.manifest, item.kind === "installed" ? item.record : undefined).title;
}

function manifestSummary(input: unknown, record?: InstalledSkillView): ManifestSummary {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const display = value.display && typeof value.display === "object" ? value.display as Record<string, unknown> : {};
  const publisher = value.publisher && typeof value.publisher === "object" ? value.publisher as Record<string, unknown> : {};
  const capabilities = value.capabilities && typeof value.capabilities === "object" ? value.capabilities as Record<string, unknown> : {};
  const mymind = capabilities.mymind && typeof capabilities.mymind === "object" ? capabilities.mymind as Record<string, unknown> : {};
  const network = capabilities.network && typeof capabilities.network === "object" ? capabilities.network as Record<string, unknown> : {};
  const access = [
    Array.isArray(mymind.read) && mymind.read.length ? `mymind read ${mymind.read.length}` : "",
    Array.isArray(mymind.write) && mymind.write.length ? `mymind write ${mymind.write.length}` : "",
    network.required ? `network ${Array.isArray(network.hosts) ? network.hosts.length : 0}` : "",
    capabilities.browser === true ? "browser" : "",
    capabilities.subprocess && typeof capabilities.subprocess === "object" && (capabilities.subprocess as Record<string, unknown>).allowed === true ? "subprocess" : ""
  ].filter(Boolean);
  return {
    id: stringValue(value.id, record?.id || "unknown-skill"),
    title: stringValue(display.name, record?.id || "未命名 Skill"),
    description: stringValue(display.description, ""),
    publisher: stringValue(publisher.displayName, stringValue(publisher.id, record?.publisherId || "local")),
    version: stringValue(value.version, record?.version || "—"),
    kind: stringValue(value.kind, "unknown"),
    configCount: value.config && typeof value.config === "object" ? Object.keys(value.config).length : 0,
    capabilities: access
  };
}

function hostTrustBody(record: InstalledSkillView, manifest: unknown): string {
  const value = manifest && typeof manifest === "object" ? manifest as Record<string, unknown> : {};
  const entrypoint = value.entrypoint && typeof value.entrypoint === "object" ? value.entrypoint as Record<string, unknown> : null;
  const entrypointLabel = entrypoint
    ? `${stringValue(entrypoint.runtime, "unknown")} ${stringValue(entrypoint.script, "<unknown>")}`
    : value.kind === "agent" ? "Internal Agent host（无包内 executable）" : "Manifest 未声明 entrypoint（当前不会执行）";
  const capabilities = manifestSummary(manifest, record).capabilities;
  const secretBindings = collectSecretBindings(value);
  return [
    m.trustBody,
    `Skill：${record.publisherId}/${record.id} v${record.version} · digest ${record.digest}`,
    `真实 entrypoint：${entrypointLabel}`,
    `声明能力：${capabilities.length ? capabilities.join("、") : "无"}`,
    `Secret binding：${secretBindings.length ? secretBindings.join("、") : "无"}`
  ].join("\n");
}

function collectSecretBindings(manifest: Record<string, unknown>): string[] {
  const bindings = new Set<string>();
  const config = manifest.config && typeof manifest.config === "object" ? manifest.config as Record<string, unknown> : {};
  for (const [key, raw] of Object.entries(config)) {
    if (!raw || typeof raw !== "object") continue;
    const field = raw as Record<string, unknown>;
    if (field.type === "secret-ref") bindings.add(String(field.secretRef || key));
  }
  const entrypoint = manifest.entrypoint && typeof manifest.entrypoint === "object" ? manifest.entrypoint as Record<string, unknown> : {};
  const env = entrypoint.env && typeof entrypoint.env === "object" ? entrypoint.env as Record<string, unknown> : {};
  for (const raw of Object.values(env)) {
    if (typeof raw !== "string") continue;
    for (const match of raw.matchAll(/\{\{\s*secrets\.([A-Za-z0-9_.-]+)\s*\}\}/g)) bindings.add(match[1]);
  }
  return [...bindings].sort();
}

function stringValue(value: unknown, fallback: string): string { return typeof value === "string" && value.trim() ? value : fallback; }
function needsAttention(item: SkillItem): boolean {
  if (item.kind === "workspace") return !item.inspection.valid || item.inspection.sourceKind === "legacy-claude";
  return item.record.status !== "active" || item.record.readiness !== "ready" || item.record.executionTrust !== "approved-host";
}
function installedStatus(record: InstalledSkillView): string { return `${record.status} · ${record.readiness}`; }
function readinessLabel(value: InstalledSkillView["readiness"]): string { return value === "ready" ? m.ready : value === "blocked" ? m.blocked : value === "stale" ? m.stale : m.notReady; }
function statusTone(record: InstalledSkillView): "success" | "warning" | "danger" { return record.status === "active" && record.readiness === "ready" && record.executionTrust === "approved-host" ? "success" : record.readiness === "blocked" || record.readiness === "stale" ? "danger" : "warning"; }
function formatBytes(value: number): string { return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${Math.round(value / 102.4) / 10} KB` : `${Math.round(value / 104857.6) / 10} MB`; }

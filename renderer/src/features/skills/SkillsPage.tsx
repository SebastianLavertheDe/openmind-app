import { useCallback, useEffect, useMemo, useState } from "react";
import { Package, Search } from "lucide-react";
import type { BrokerRunRecord, InstalledSkillView, SkillDefinition, SkillPackageInspectionView } from "@shared/contracts";
import { messages } from "@shared/messages";
import { StatusBadge } from "../../design-system/components";

const m = messages.skillCenter;

type Filter = "all" | "installed" | "workspace" | "attention";

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
};

export function SkillsPage({ initialSkillId, embedded = false }: { skills: SkillDefinition[]; initialSkillId?: string; embedded?: boolean }) {
  const [inspections, setInspections] = useState<SkillPackageInspectionView[]>([]);
  const [installed, setInstalled] = useState<InstalledSkillView[]>([]);
  const [installedInspections, setInstalledInspections] = useState<Record<string, SkillPackageInspectionView>>({});
  const [runs, setRuns] = useState<BrokerRunRecord[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const [nextInspections, nextInstalled, nextRuns] = await Promise.all([
        window.cctools.inspectSkillWorkspace(),
        window.cctools.listInstalledSkills(),
        window.cctools.listSkillRuns()
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
      setRuns(nextRuns);
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
  const selectedRuns = useMemo(() => selectedSummary
    ? runs
      .filter((run) => run.request.skillId === selectedSummary.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    : [], [runs, selectedSummary]);

  if (loading && !items.length) {
    return <div className="feature-page skills-page"><section className="workspace-card skills-empty"><p>{m.loading}</p></section></div>;
  }

  return (
    <div className={`feature-page skills-page${embedded ? " skills-page--embedded" : ""}`}>
      {!embedded ? <header className="skills-page-header">
        <div><span className="eyebrow">{m.eyebrow}</span><h1>{m.title}</h1><p>{m.description}</p></div>
      </header> : null}

      {error ? <p className="skills-error" role="alert">{error}</p> : null}
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
            <SkillRunHistory runs={selectedRuns} />
          </>}
        </main>
      </section>
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

function SkillRunHistory({ runs }: { runs: BrokerRunRecord[] }) {
  return <section className="skills-detail-section skills-run-history" aria-label="运行记录">
    <header><h3>运行记录</h3><span>{runs.length} 条</span></header>
    {!runs.length ? <p className="skills-run-empty">这个 Skill 还没有运行记录。</p> : (
      <div className="skills-run-list">
        {runs.map((run) => <article className="skills-run-row" key={run.id}>
          <span className={`skills-run-state ${runStateTone(run.state)}`} aria-hidden />
          <div><strong>{runStateLabel(run.state)}</strong><small>{run.request.trigger.type} · {run.id}</small></div>
          <time dateTime={run.createdAt}>{formatRunTime(run.createdAt)}</time>
        </article>)}
      </div>
    )}
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
  return {
    id: stringValue(value.id, record?.id || "unknown-skill"),
    title: stringValue(display.name, record?.id || "未命名 Skill"),
    description: stringValue(display.description, ""),
    publisher: stringValue(publisher.displayName, stringValue(publisher.id, record?.publisherId || "local")),
    version: stringValue(value.version, record?.version || "—"),
    kind: stringValue(value.kind, "unknown")
  };
}

function stringValue(value: unknown, fallback: string): string { return typeof value === "string" && value.trim() ? value : fallback; }
function needsAttention(item: SkillItem): boolean {
  if (item.kind === "workspace") return !item.inspection.valid || item.inspection.sourceKind === "legacy-claude";
  return item.record.status !== "active" || item.record.readiness !== "ready" || item.record.executionTrust !== "approved-host";
}
function installedStatus(record: InstalledSkillView): string { return `${record.status} · ${record.readiness}`; }
function statusTone(record: InstalledSkillView): "success" | "warning" | "danger" { return record.status === "active" && record.readiness === "ready" && record.executionTrust === "approved-host" ? "success" : record.readiness === "blocked" || record.readiness === "stale" ? "danger" : "warning"; }
function runStateTone(state: string): string { return state === "succeeded" ? "success" : state === "failed" || state === "timed_out" ? "danger" : state === "cancelled" ? "muted" : "running"; }
function runStateLabel(state: string): string { return ({ succeeded: "成功", failed: "失败", timed_out: "超时", cancelled: "已取消", queued: "排队中", inspecting: "检查中", waiting_execution_consent: "等待授权", preparing_runtime: "准备运行环境", running: "运行中", cancelling: "取消中" } as Record<string, string>)[state] || state; }
function formatRunTime(value: string): string { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }

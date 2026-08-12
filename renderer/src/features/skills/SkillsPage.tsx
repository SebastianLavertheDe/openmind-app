import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock3, Package, Search, X } from "lucide-react";
import type { BrokerRunRecord, InstalledSkillView, SkillDefinition, SkillPackageInspectionView } from "@shared/contracts";
import { messages } from "@shared/messages";
import { StatusBadge } from "../../design-system/components";

const m = messages.skillCenter;

type SkillItem =
  | { kind: "installed"; id: string; record: InstalledSkillView; inspection?: SkillPackageInspectionView; workspaceInspections: SkillPackageInspectionView[] }
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
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const catalogRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);

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
      const summary = itemSummary(item);
      const sourcePath = item.kind === "installed" ? item.record.sourcePath : item.inspection.sourcePath;
      const text = `${summary.title} ${summary.id} ${summary.publisher} ${summary.version} ${summary.kind} ${item.kind} ${sourcePath}`.toLocaleLowerCase();
      return !needle || text.includes(needle);
    });
  }, [items, query]);

  useEffect(() => {
    if (filteredItems.some((item) => item.id === selectedId)) return;
    if (!filteredItems.length && items.some((item) => item.id === selectedId)) return;
    setSelectedId(filteredItems[0]?.id || "");
  }, [filteredItems, items, selectedId]);

  const selected = items.find((item) => item.id === selectedId);
  const selectedSummary = selected ? itemSummary(selected) : null;
  const selectedRuns = useMemo(() => selectedSummary
    ? runs
      .filter((run) => run.request.skillId === selectedSummary.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    : [], [runs, selectedSummary]);

  const focusItem = useCallback((index: number) => {
    const nextIndex = Math.max(0, Math.min(filteredItems.length - 1, index));
    const next = filteredItems[nextIndex];
    if (!next) return;
    setSelectedId(next.id);
    requestAnimationFrame(() => catalogRef.current?.querySelector<HTMLButtonElement>(`[data-skill-index="${nextIndex}"]`)?.focus());
  }, [filteredItems]);

  const selectItem = useCallback((id: string, revealDetail = false) => {
    setSelectedId(id);
    if (!revealDetail || typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 1100px)").matches) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    requestAnimationFrame(() => detailRef.current?.scrollIntoView?.({ behavior, block: "start" }));
  }, []);

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
            <label className="skills-search">
              <Search size={15} aria-hidden />
              <input
                type="search"
                aria-label={m.searchAria}
                placeholder={m.searchPlaceholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }}
              />
              {query ? <button type="button" className="skills-search-clear" aria-label={m.clearSearch} onClick={() => setQuery("")}><X size={14} aria-hidden /></button> : null}
            </label>
            <span className="skills-catalog-count" role="status" aria-live="polite">
              {query ? m.resultCount(filteredItems.length, items.length) : m.skillCount(items.length)}
            </span>
          </header>
          <div ref={catalogRef} className="skills-catalog-list" aria-label={m.listAria}>
            {!filteredItems.length ? <div className="skills-empty"><Package size={20} aria-hidden /><strong>{items.length ? m.noMatch : m.emptyTitle}</strong><span>{items.length ? m.noMatchDescription : m.emptyDescription}</span></div> : null}
            {filteredItems.map((item, index) => <SkillListItem
              key={item.id}
              item={item}
              index={index}
              total={filteredItems.length}
              active={item.id === selectedId}
              onSelect={() => selectItem(item.id, true)}
              onNavigate={focusItem}
            />)}
          </div>
        </aside>

        <main ref={detailRef} className="workspace-card skills-detail">
          {!selected || !selectedSummary ? <div className="skills-detail-empty"><Package size={24} aria-hidden /><p>{m.detailEmpty}</p></div> : <>
            <header className="skills-detail-header">
              <div className="skills-detail-title">
                <span className="skills-detail-icon" aria-hidden><Package size={19} /></span>
                <div><span className="eyebrow">{kindLabel(selectedSummary.kind)}</span><h2>{selectedSummary.title}</h2><p>{selectedSummary.description || selectedSummary.id}</p></div>
              </div>
              <StatusBadge tone={skillState(selected).tone}>{skillState(selected).label}</StatusBadge>
            </header>
            <SkillOverview item={selected} summary={selectedSummary} />
            <SkillRunHistory runs={selectedRuns} />
          </>}
        </main>
      </section>
    </div>
  );
}

function SkillListItem({ item, index, total, active, onSelect, onNavigate }: { item: SkillItem; index: number; total: number; active: boolean; onSelect(): void; onNavigate(index: number): void }) {
  const summary = itemSummary(item);
  const attention = needsAttention(item);
  const state = skillState(item);
  return <button
    type="button"
    className={`skills-list-item${active ? " active" : ""}`}
    data-motion="selection"
    data-skill-index={index}
    aria-current={active ? "page" : undefined}
    onClick={onSelect}
    onKeyDown={(event) => {
      const nextIndex = event.key === "ArrowDown" ? Math.min(total - 1, index + 1)
        : event.key === "ArrowUp" ? Math.max(0, index - 1)
        : event.key === "Home" ? 0
        : event.key === "End" ? total - 1
        : null;
      if (nextIndex === null) return;
      event.preventDefault();
      onNavigate(nextIndex);
    }}
  >
    <span className={`skills-list-icon ${attention ? "attention" : ""}`} aria-hidden><Package size={16} /></span>
    <span className="skills-list-copy"><strong>{summary.title}</strong><small>{summary.publisher}/{summary.id} · v{summary.version}</small></span>
    {attention ? <span className={`skills-list-status ${state.tone}`}><i aria-hidden />{state.label}</span> : null}
  </button>;
}

function SkillOverview({ item, summary }: { item: SkillItem; summary: ManifestSummary }) {
  const sourcePath = item.kind === "installed"
    ? item.workspaceInspections[0]?.sourcePath || item.record.sourcePath
    : item.inspection.sourcePath;
  const source = item.kind === "installed"
    ? item.workspaceInspections.length ? m.installedAndWorkspace : m.installed
    : m.workspace;
  return <section className="skills-overview" aria-label={m.overviewAria}>
    <dl className="skills-overview-grid">
      <div><dt>{m.publisher}</dt><dd>{summary.publisher}</dd></div>
      <div><dt>{m.version}</dt><dd>v{summary.version}</dd></div>
      <div><dt>{m.kind}</dt><dd>{kindLabel(summary.kind)}</dd></div>
      <div><dt>{m.source}</dt><dd>{source}</dd></div>
    </dl>
    <div className="skills-source-path"><span>{m.sourcePath}</span><code title={sourcePath}>{sourcePath}</code></div>
  </section>;
}

function SkillRunHistory({ runs }: { runs: BrokerRunRecord[] }) {
  return <section className="skills-detail-section skills-run-history" aria-label="运行记录">
    <header><h3>运行记录</h3><span>{runs.length} 条</span></header>
    {!runs.length ? <div className="skills-run-empty"><Clock3 size={16} aria-hidden /><span>这个 Skill 还没有运行记录。</span></div> : (
      <div className="skills-run-list">
        {runs.map((run) => <article className="skills-run-row" key={run.id}>
          <span className={`skills-run-state ${runStateTone(run.state)}`} aria-hidden>{run.state === "succeeded" ? <CheckCircle2 size={14} /> : null}</span>
          <div><strong>{runStateLabel(run.state)}</strong><small>{run.request.trigger.type} · {run.id}</small></div>
          <time dateTime={run.createdAt}>{formatRunTime(run.createdAt)}</time>
        </article>)}
      </div>
    )}
  </section>;
}

function buildItems(inspections: SkillPackageInspectionView[], installed: InstalledSkillView[], installedInspectionMap: Record<string, SkillPackageInspectionView> = {}): SkillItem[] {
  const inspectionBySource = new Map(inspections.map((inspection) => [`${inspection.sourcePath}:${inspection.digest}`, inspection]));
  const installedItems: Extract<SkillItem, { kind: "installed" }>[] = installed.map((record) => ({
    kind: "installed",
    id: `installed:${record.key}:${record.digest}`,
    record,
    inspection: installedInspectionMap[installedInspectionKey(record)] || inspectionBySource.get(`${record.sourcePath}:${record.digest}`),
    workspaceInspections: []
  }));
  const installedByIdentity = new Map(installedItems.map((item) => [manifestIdentity(item.inspection?.manifest, item.record), item]));
  const items: SkillItem[] = [...installedItems];
  for (const inspection of inspections) {
    const exact = installedItems.find((item) => item.record.sourcePath === inspection.sourcePath && item.record.digest === inspection.digest);
    if (exact) {
      exact.workspaceInspections.push(inspection);
      continue;
    }
    const matchingInstalled = installedByIdentity.get(manifestIdentity(inspection.manifest));
    if (matchingInstalled) {
      matchingInstalled.workspaceInspections.push(inspection);
      continue;
    }
    items.push({ kind: "workspace", id: `workspace:${inspection.sourcePath}:${inspection.digest}`, inspection });
  }
  return items.sort((left, right) => itemTitle(left).localeCompare(itemTitle(right), "zh-CN"));
}

function installedInspectionKey(record: InstalledSkillView): string {
  return `${record.key}:${record.digest}`;
}

function itemTitle(item: SkillItem): string {
  return itemSummary(item).title;
}

function itemSummary(item: SkillItem): ManifestSummary {
  return item.kind === "installed"
    ? manifestSummary(item.inspection?.manifest || item.workspaceInspections[0]?.manifest, item.record)
    : manifestSummary(item.inspection.manifest);
}

function manifestIdentity(input: unknown, record?: InstalledSkillView): string {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const publisher = value.publisher && typeof value.publisher === "object" ? value.publisher as Record<string, unknown> : {};
  const publisherId = stringValue(publisher.id, record?.publisherId || "local");
  const id = stringValue(value.id, record?.id || "unknown-skill");
  return `${publisherId}/${id}`.toLocaleLowerCase();
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
function skillState(item: SkillItem): { label: string; tone: "success" | "warning" | "danger" | "info" } {
  if (item.kind === "workspace") {
    if (!item.inspection.valid) return { label: m.staticInvalid, tone: "danger" };
    if (item.inspection.sourceKind === "legacy-claude") return { label: m.legacyFormat, tone: "warning" };
    return { label: m.workspace, tone: "info" };
  }
  if (item.record.readiness === "blocked") return { label: m.blockedLabel, tone: "danger" };
  if (item.record.readiness === "stale") return { label: m.staleLabel, tone: "danger" };
  if (item.record.status !== "active" || item.record.readiness !== "ready") return { label: m.notReady, tone: "warning" };
  if (item.record.executionTrust !== "approved-host") return { label: m.pendingTrust, tone: "warning" };
  return { label: m.available, tone: "success" };
}
function kindLabel(kind: string): string { return ({ process: "进程 Skill", agent: "Agent", prompt: "提示词", workflow: "工作流" } as Record<string, string>)[kind.toLocaleLowerCase()] || kind; }
function runStateTone(state: string): string { return state === "succeeded" ? "success" : state === "failed" || state === "timed_out" ? "danger" : state === "cancelled" ? "muted" : "running"; }
function runStateLabel(state: string): string { return ({ succeeded: "成功", failed: "失败", timed_out: "超时", cancelled: "已取消", queued: "排队中", inspecting: "检查中", waiting_execution_consent: "等待授权", preparing_runtime: "准备运行环境", running: "运行中", cancelling: "取消中" } as Record<string, string>)[state] || state; }
function formatRunTime(value: string): string { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }

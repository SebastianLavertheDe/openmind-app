import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ChevronDown, Clock3, Download, FolderOpen, GitBranch, Package, Search, X } from "lucide-react";
import type { BrokerRunRecord, InstalledSkillView, SkillDefinition, SkillPackageInspectionView, SkillSourceInspectionView } from "@shared/contracts";
import type { SkillPackageSourceInput } from "@shared/skill-package-sources";
import { messages } from "@shared/messages";
import { notifyInstalledSkillCatalogChanged } from "../../installed-skill-events";
import { AnimatedDisclosure } from "../../design-system/animated-disclosure";
import { StatusBadge } from "../../design-system/components";
import { ToggleSwitch } from "../../design-system/controls";

const m = messages.skillCenter;

type SkillItem =
  | { kind: "installed"; id: string; record: InstalledSkillView; inspection?: SkillPackageInspectionView };

type ManifestSummary = {
  id: string;
  title: string;
  description: string;
  publisher: string;
  version: string;
  kind: string;
};

type SkillCatalogGroup = {
  key: string;
  title: string;
  locator?: string;
  items: SkillItem[];
};

type SkillToggleFeedback = {
  tone: "success" | "error";
  message: string;
};

export function SkillsPage({ initialSkillId, embedded = false, initialSourcePickerOpen = false, onInstallationChange, onAvailabilityChange }: { skills: SkillDefinition[]; initialSkillId?: string; embedded?: boolean; initialSourcePickerOpen?: boolean; onInstallationChange?(): Promise<unknown> | unknown; onAvailabilityChange?(): Promise<unknown> | unknown }) {
  const [installed, setInstalled] = useState<InstalledSkillView[]>([]);
  const [installedInspections, setInstalledInspections] = useState<Record<string, SkillPackageInspectionView>>({});
  const [runs, setRuns] = useState<BrokerRunRecord[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const [toggleBusyKeys, setToggleBusyKeys] = useState<Set<string>>(() => new Set());
  const [toggleFeedback, setToggleFeedback] = useState<Record<string, SkillToggleFeedback>>({});
  const toggleBusyKeysRef = useRef(new Set<string>());
  const catalogRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const [nextInstalled, nextRuns] = await Promise.all([
        window.openmind.listInstalledSkills(),
        window.openmind.listSkillRuns()
      ]);
      const inspectedInstalled = window.openmind.inspectInstalledSkill
        ? await Promise.all(nextInstalled.map(async (record) => {
          try {
            const inspection = await window.openmind.inspectInstalledSkill(record.key, record.digest);
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
      setInstalled(nextInstalled);
      setInstalledInspections(nextInstalledInspections);
      setRuns(nextRuns);
      setError(null);
      setSelectedId((current) => {
        const nextItems = buildItems(nextInstalled, nextInstalledInspections);
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

  const sourcePickerApiAvailable = Boolean(window.openmind.inspectSkillSource && window.openmind.installSkillSource);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(initialSourcePickerOpen);
  const onSourceInstalled = useCallback(async () => {
    setSourcePickerOpen(false);
    await load();
    notifyInstalledSkillCatalogChanged();
    await onInstallationChange?.();
    await onAvailabilityChange?.();
  }, [load, onAvailabilityChange, onInstallationChange]);

  const items = useMemo(() => buildItems(installed, installedInspections), [installed, installedInspections]);
  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const summary = itemSummary(item);
      const text = `${summary.title} ${summary.id} ${summary.publisher} ${summary.version} ${summary.kind} ${item.kind} ${item.record.sourcePath}`.toLocaleLowerCase();
      return !needle || text.includes(needle);
    });
  }, [items, query]);
  const catalogGroups = useMemo(() => groupCatalogItems(filteredItems), [filteredItems]);
  const filteredIndexById = useMemo(() => new Map(filteredItems.map((item, index) => [item.id, index])), [filteredItems]);

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

  const setSkillEnabled = useCallback(async (record: InstalledSkillView, enabled: boolean) => {
    if (toggleBusyKeysRef.current.has(record.key)) return;
    toggleBusyKeysRef.current.add(record.key);
    setToggleBusyKeys((current) => new Set(current).add(record.key));
    setToggleFeedback((current) => {
      const next = { ...current };
      delete next[record.key];
      return next;
    });
    try {
      const updated = await window.openmind.setInstalledSkillEnabled(record.key, record.digest, enabled);
      setInstalled((current) => current.map((candidate) => (
        candidate.key === record.key && candidate.digest === record.digest ? updated : candidate
      )));
      notifyInstalledSkillCatalogChanged();
      // Keep the switch busy until the blank-draft catalog has caught up. A
      // refresh failure does not roll back the preference that Main already
      // committed, and existing conversations still render their snapshot.
      try { await onAvailabilityChange?.(); } catch { /* best-effort catalog refresh */ }
      setToggleFeedback((current) => ({
        ...current,
        [record.key]: {
          tone: "success",
          message: enabled ? m.availability.enabledConfirmation : m.availability.disabledConfirmation
        }
      }));
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setToggleFeedback((current) => ({
        ...current,
        [record.key]: { tone: "error", message: m.availability.updateFailed(detail) }
      }));
    } finally {
      toggleBusyKeysRef.current.delete(record.key);
      setToggleBusyKeys((current) => {
        const next = new Set(current);
        next.delete(record.key);
        return next;
      });
    }
  }, [onAvailabilityChange]);

  if (loading && !items.length) {
    return <div className="feature-page skills-page"><section className="workspace-card skills-empty"><p>{m.loading}</p></section></div>;
  }

  return (
    <div className={`feature-page skills-page${embedded ? " skills-page--embedded" : ""}`}>
      {!embedded ? <header className="skills-page-header">
        <div><span className="eyebrow">{m.eyebrow}</span><h1>{m.title}</h1><p>{m.description}</p></div>
      </header> : null}

      {error ? <p className="skills-error" role="alert">{error}</p> : null}
      {sourcePickerApiAvailable ? <SkillSourcePicker open={sourcePickerOpen} onToggle={() => setSourcePickerOpen((open) => !open)} onInstalled={onSourceInstalled} /> : null}
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
            {catalogGroups.map((group) => <SkillCatalogGroupView
              key={group.key}
              group={group}
              open={groupOpen[group.key] ?? true}
              onOpenChange={(next) => setGroupOpen((current) => ({ ...current, [group.key]: next }))}
              selectedId={selectedId}
              total={filteredItems.length}
              indexById={filteredIndexById}
              onSelect={selectItem}
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
            {selected.kind === "installed" ? <SkillAvailability
              record={selected.record}
              summary={selectedSummary}
              busy={toggleBusyKeys.has(selected.record.key)}
              feedback={toggleFeedback[selected.record.key]}
              onChange={(enabled) => void setSkillEnabled(selected.record, enabled)}
            /> : null}
            <SkillRunHistory runs={selectedRuns} />
          </>}
        </main>
      </section>
    </div>
  );
}

/** Import panel for directory / ZIP / public HTTPS Git sources. Inspection
 * always precedes installation; nothing here executes package code. */
function SkillSourcePicker({ open, onToggle, onInstalled }: { open: boolean; onToggle(): void; onInstalled(): Promise<void> }) {
  const picker = m.sourcePicker;
  const [gitUrl, setGitUrl] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [candidate, setCandidate] = useState<SkillPackageSourceInput | null>(null);
  const [inspection, setInspection] = useState<SkillSourceInspectionView | null>(null);
  const [selectedPackageRefs, setSelectedPackageRefs] = useState<string[]>([]);
  const [busy, setBusy] = useState<"inspect" | "install" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const inspectRequestId = useRef<string | null>(null);

  const inspectSource = useCallback(async (source: SkillPackageSourceInput) => {
    const requestId = `skill-source-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    inspectRequestId.current = requestId;
    setFailure(null);
    setInspection(null);
    setSelectedPackageRefs([]);
    setBusy("inspect");
    try {
      const result = await window.openmind.inspectSkillSource!(source, requestId);
      if (inspectRequestId.current === requestId) {
        setInspection(result);
        setSelectedPackageRefs(result.packages.map(inspectionPackageRef));
      }
    } catch (cause) {
      if (!isSourceCancelled(cause)) {
        setCandidate(null);
        setInspection(null);
        setSelectedPackageRefs([]);
        setFailure(sourceErrorMessage(cause));
      }
    } finally {
      if (inspectRequestId.current === requestId) inspectRequestId.current = null;
      setBusy(null);
    }
  }, []);

  const selectLocal = useCallback(async () => {
    setFailure(null);
    setInspection(null);
    setSelectedPackageRefs([]);
    try {
      const source = await window.openmind.selectSkillPackageSource?.() ?? null;
      if (!source) return;
      setCandidate(source);
      void inspectSource(source);
    } catch (cause) {
      setCandidate(null);
      setFailure(cause instanceof Error ? cause.message : String(cause));
    }
  }, [inspectSource]);

  const inspectGit = useCallback(async () => {
    const locator = gitUrl.trim();
    if (!locator) { setFailure(picker.noCandidate); return; }
    if (!isPublicHttpsGitLocator(locator)) { setFailure(picker.sourceErrors.invalid); return; }
    const source: SkillPackageSourceInput = { type: "git", locator, ...(gitRef.trim() ? { ref: gitRef.trim() } : {}) };
    setCandidate(source);
    void inspectSource(source);
  }, [gitUrl, gitRef, inspectSource, picker.sourceErrors.invalid, picker.noCandidate]);

  const cancelInspect = useCallback(async () => {
    const requestId = inspectRequestId.current;
    if (requestId) await window.openmind.cancelSkillSourceInspection?.(requestId);
    inspectRequestId.current = null;
    setCandidate(null);
    setInspection(null);
    setSelectedPackageRefs([]);
    setFailure(null);
    setBusy(null);
  }, []);

  const install = useCallback(async () => {
    if (!candidate) { setFailure(picker.noCandidate); return; }
    const selectedPackages = inspection?.packages.filter((item) => selectedPackageRefs.includes(inspectionPackageRef(item))) ?? [];
    if (!inspection || !selectedPackages.length || selectedPackages.some((item) => !item.valid)) { setFailure(picker.notInspected); return; }
    setFailure(null);
    setBusy("install");
    try {
      if (candidate.type === "git") await window.openmind.installSkillSource!(candidate, selectedPackageRefs);
      else await window.openmind.installSkillSource!(candidate);
      setCandidate(null);
      setInspection(null);
      setSelectedPackageRefs([]);
      setGitUrl("");
      setGitRef("");
      await onInstalled();
    } catch (cause) {
      setFailure(sourceErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }, [candidate, inspection, onInstalled, picker.noCandidate, picker.notInspected, selectedPackageRefs]);

  const togglePackage = useCallback((packageRef: string) => {
    setSelectedPackageRefs((current) => current.includes(packageRef)
      ? current.filter((item) => item !== packageRef)
      : [...current, packageRef]);
  }, []);

  const selectedPackages = inspection?.packages.filter((item) => selectedPackageRefs.includes(inspectionPackageRef(item))) ?? [];
  const installationReady = selectedPackages.length > 0 && selectedPackages.every((item) => item.valid);

  return <>
    <button type="button" className="skills-source-picker-toggle" aria-expanded={open} onClick={onToggle}>
      <Download size={15} aria-hidden />
      <span>{open ? picker.close : picker.open}</span>
    </button>
    {open && typeof document !== "undefined" ? createPortal(
      <div className="modal-scrim skills-source-dialog-scrim ui-overlay" onMouseDown={onToggle}>
        <section className="skills-source-dialog" role="dialog" aria-modal="true" aria-labelledby="skills-source-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
          <header className="skills-source-dialog-header">
            <div><span className="eyebrow">SKILL CENTER</span><h2 id="skills-source-dialog-title">{picker.title}</h2><p>{picker.description}</p></div>
            <button type="button" className="skills-source-dialog-close" aria-label="关闭添加 Skill 来源" onClick={onToggle}><X size={17} aria-hidden /></button>
          </header>
          <div className="skills-source-picker-body">
            <div className="skills-source-picker-row">
              <button type="button" className="skills-source-picker-local" disabled={busy !== null} onClick={() => void selectLocal()}>
                <FolderOpen size={15} aria-hidden />
                <span>{picker.local}</span>
              </button>
            </div>
            <div className="skills-source-picker-row">
              <label className="skills-source-picker-git">
                <span>{picker.git}</span>
                <input
                  type="url"
                  inputMode="url"
                  placeholder={picker.gitPlaceholder}
                  value={gitUrl}
                  onChange={(event) => { setGitUrl(event.target.value); setCandidate(null); setInspection(null); setSelectedPackageRefs([]); setFailure(null); }}
                  onKeyDown={(event) => { if (event.key === "Enter") void inspectGit(); }}
                />
                <input
                  type="text"
                  placeholder={picker.refPlaceholder}
                  value={gitRef}
                  onChange={(event) => { setGitRef(event.target.value); setCandidate(null); setInspection(null); setSelectedPackageRefs([]); setFailure(null); }}
                />
                <button type="button" disabled={busy !== null} onClick={() => void inspectGit()}>
                  {busy === "inspect" ? picker.inspecting : picker.inspect}
                </button>
                {busy === "inspect" ? <button type="button" className="skills-source-picker-cancel" onClick={() => void cancelInspect()}>{picker.cancel}</button> : null}
              </label>
            </div>
            {candidate ? <div className="skills-source-picker-candidate">
              <code title={candidate.locator}>{candidate.locator}{candidate.type === "git" && candidate.ref ? ` @${candidate.ref}` : ""}</code>
              {inspection ? <div className="skills-source-package-summary">
                <strong>{inspection.packages.length} 个 Skill 包</strong>
                <span>已选择 {selectedPackageRefs.length} 个</span>
              </div> : null}
              {inspection ? <div className="skills-source-package-list">
                {inspection.packages.map((item) => {
                  const packageRef = inspectionPackageRef(item);
                  return <label className={`skills-source-package${item.valid ? "" : " invalid"}`} key={packageRef}>
                    {candidate.type === "git" ? <input
                      type="checkbox"
                      checked={selectedPackageRefs.includes(packageRef)}
                      disabled={busy !== null}
                      aria-label={`选择 ${inspectionName(item)}`}
                      onChange={() => togglePackage(packageRef)}
                    /> : null}
                    <span className="skills-source-package-copy">
                      <strong>{inspectionName(item)}</strong>
                      <small>{inspectionPublisher(item)} · v{inspectionVersion(item)}{candidate.type === "git" ? ` · ${packageRef}` : ""}</small>
                    </span>
                    <StatusBadge tone={item.valid ? "success" : "danger"}>{item.valid ? picker.valid : picker.invalid}</StatusBadge>
                  </label>;
                })}
              </div> : null}
              {selectedPackages.flatMap((item) => item.warnings).length ? <ul className="skills-source-picker-warnings">
                {selectedPackages.flatMap((item) => item.warnings).slice(0, 5).map((warning, index) => <li key={index}>{warning}</li>)}
              </ul> : null}
              {selectedPackages.flatMap((item) => item.issues).length ? <ul className="skills-source-picker-issues">
                {selectedPackages.flatMap((item) => item.issues).slice(0, 5).map((issue, index) => <li key={index}>{issue.message}</li>)}
              </ul> : null}
              <button type="button" className="skills-source-picker-install" disabled={busy !== null || !installationReady} onClick={() => void install()}>
                {busy === "install" ? picker.importing : selectedPackageRefs.length > 1 ? `${picker.import} ${selectedPackageRefs.length} 个` : picker.import}
              </button>
            </div> : null}
            {failure ? <p className="skills-error" role="alert">{failure}</p> : null}
          </div>
        </section>
      </div>,
      document.body
    ) : null}
  </>;
}

function sourceErrorMessage(cause: unknown): string {
  const errors = m.sourcePicker.sourceErrors;
  if (cause && typeof cause === "object") {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string" && errors[code]) return errors[code];
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return /HTTPS|Git 地址|Git 来源/.test(message) ? errors.invalid : `${errors.unknown}${message ? `（${message}）` : ""}`;
}

function isPublicHttpsGitLocator(locator: string): boolean {
  try {
    const url = new URL(locator);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function isSourceCancelled(cause: unknown): boolean {
  return Boolean(cause && typeof cause === "object" && (cause as { code?: unknown }).code === "git-cancelled");
}

function inspectionPackageRef(inspection: SkillPackageInspectionView): string {
  return inspection.packageRef || ".";
}

function inspectionManifest(inspection: SkillPackageInspectionView): Record<string, unknown> {
  return inspection.manifest && typeof inspection.manifest === "object" ? inspection.manifest as Record<string, unknown> : {};
}

function inspectionName(inspection: SkillPackageInspectionView): string {
  const display = inspectionManifest(inspection).display;
  return display && typeof display === "object" && typeof (display as { name?: unknown }).name === "string"
    ? (display as { name: string }).name
    : "未命名 Skill";
}

function inspectionPublisher(inspection: SkillPackageInspectionView): string {
  const publisher = inspectionManifest(inspection).publisher;
  if (!publisher || typeof publisher !== "object") return "未声明";
  const value = publisher as { displayName?: unknown; id?: unknown };
  return typeof value.displayName === "string" ? value.displayName : typeof value.id === "string" ? value.id : "未声明";
}

function inspectionVersion(inspection: SkillPackageInspectionView): string {
  const value = inspectionManifest(inspection).version;
  return typeof value === "string" ? value : "未声明";
}

function SkillCatalogGroupView({ group, open, onOpenChange, selectedId, total, indexById, onSelect, onNavigate }: {
  group: SkillCatalogGroup;
  open: boolean;
  onOpenChange(next: boolean): void;
  selectedId: string;
  total: number;
  indexById: Map<string, number>;
  onSelect(id: string, revealDetail?: boolean): void;
  onNavigate(index: number): void;
}) {
  const remote = Boolean(group.locator);
  return <AnimatedDisclosure
    open={open}
    onOpenChange={onOpenChange}
    className="skills-source-group"
    triggerClassName="skills-source-group-trigger"
    contentClassName="skills-source-group-content"
    triggerAriaLabel={`${open ? "收起" : "展开"} ${group.title}`}
    summary={<>
      <span className="skills-source-group-icon" aria-hidden>{remote ? <GitBranch size={15} /> : <FolderOpen size={15} />}</span>
      <span className="skills-source-group-copy">
        <strong>{group.title}</strong>
        <small title={group.locator}>{group.locator || "目录、ZIP 与历史安装"}</small>
      </span>
      <span className="skills-source-group-count">{group.items.length}</span>
      <ChevronDown className="skills-source-group-chevron" size={15} aria-hidden />
    </>}
  >
    {group.items.map((item) => {
      const index = indexById.get(item.id) ?? 0;
      return <SkillListItem
        key={item.id}
        item={item}
        index={index}
        total={total}
        active={item.id === selectedId}
        onSelect={() => onSelect(item.id, true)}
        onNavigate={onNavigate}
      />;
    })}
  </AnimatedDisclosure>;
}

function SkillListItem({ item, index, total, active, onSelect, onNavigate }: { item: SkillItem; index: number; total: number; active: boolean; onSelect(): void; onNavigate(index: number): void }) {
  const summary = itemSummary(item);
  const attention = needsAttention(item);
  const disabled = item.kind === "installed" && !item.record.enabled;
  const state = skillListState(item);
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
    {attention || disabled ? <span className={`skills-list-status ${state.tone}`}><i aria-hidden />{state.label}</span> : null}
  </button>;
}

function SkillOverview({ item, summary }: { item: SkillItem; summary: ManifestSummary }) {
  return <section className="skills-overview" aria-label={m.overviewAria}>
    <dl className="skills-overview-grid">
      <div><dt>{m.publisher}</dt><dd>{summary.publisher}</dd></div>
      <div><dt>{m.version}</dt><dd>v{summary.version}</dd></div>
      <div><dt>{m.kind}</dt><dd>{kindLabel(summary.kind)}</dd></div>
      <div><dt>{m.source}</dt><dd>{m.installed}</dd></div>
    </dl>
    <div className="skills-source-path"><span>{m.sourcePath}</span><code title={item.record.sourcePath}>{item.record.sourcePath}</code></div>
  </section>;
}

function SkillAvailability({ record, summary, busy, feedback, onChange }: {
  record: InstalledSkillView;
  summary: ManifestSummary;
  busy: boolean;
  feedback?: SkillToggleFeedback;
  onChange(enabled: boolean): void;
}) {
  return <section className="skills-availability" aria-label={m.availability.title} aria-busy={busy || undefined}>
    <div className="skills-availability-copy">
      <h3>{m.availability.title}</h3>
      <p>{m.availability.description}</p>
      <small>{m.availability.newSessionsOnly}</small>
    </div>
    <div className="skills-availability-control">
      <span role="status" aria-live="polite">{busy ? m.availability.updating : record.enabled ? m.availability.enabled : m.availability.disabled}</span>
      <ToggleSwitch
        checked={record.enabled}
        disabled={busy}
        label={m.availability.toggleAria(summary.title)}
        onChange={onChange}
      />
    </div>
    {feedback ? <p
      className={`skills-availability-feedback ${feedback.tone}`}
      role={feedback.tone === "error" ? "alert" : "status"}
    >{feedback.message}</p> : null}
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

function buildItems(installed: InstalledSkillView[], installedInspectionMap: Record<string, SkillPackageInspectionView> = {}): SkillItem[] {
  return installed
    .map((record): SkillItem => ({
      kind: "installed",
      id: `installed:${record.key}:${record.digest}`,
      record,
      inspection: installedInspectionMap[installedInspectionKey(record)]
    }))
    .sort((left, right) => itemTitle(left).localeCompare(itemTitle(right), "zh-CN"));
}

function groupCatalogItems(items: SkillItem[]): SkillCatalogGroup[] {
  const groups = new Map<string, SkillCatalogGroup>();
  for (const item of items) {
    const locator = item.record.sourceType === "git" ? item.record.sourceLocator || item.record.sourcePath : undefined;
    const key = locator ? `git:${locator}` : "local";
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(key, {
      key,
      title: locator ? repositoryName(locator) : "本地来源",
      ...(locator ? { locator } : {}),
      items: [item]
    });
  }
  return [...groups.values()].sort((left, right) => {
    if (left.key === "local") return 1;
    if (right.key === "local") return -1;
    return left.title.localeCompare(right.title, "zh-CN");
  });
}

function repositoryName(locator: string): string {
  try {
    const pathname = new URL(locator).pathname.replace(/\/+$/, "");
    return decodeURIComponent(pathname.split("/").pop() || locator).replace(/\.git$/i, "") || locator;
  } catch {
    return locator.replace(/[\\/]+$/, "").split(/[\\/]/).pop()?.replace(/\.git$/i, "") || locator;
  }
}

function installedInspectionKey(record: InstalledSkillView): string {
  return `${record.key}:${record.digest}`;
}

function itemTitle(item: SkillItem): string {
  return itemSummary(item).title;
}

function itemSummary(item: SkillItem): ManifestSummary {
  return manifestSummary(item.inspection?.manifest, item.record);
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
  return !item.record.usable;
}
type SkillState = { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" };
function skillState(item: SkillItem): SkillState {
  if (!item.record.usable) return { label: m.unusable, tone: "danger" };
  return { label: m.available, tone: "success" };
}
function skillListState(item: SkillItem): SkillState {
  const packageState = skillState(item);
  if (item.kind === "installed" && item.record.usable && !item.record.enabled) {
    return { label: m.availability.disabled, tone: "neutral" };
  }
  return packageState;
}
function kindLabel(kind: string): string { return ({ process: "进程 Skill", agent: "Agent", prompt: "提示词", workflow: "工作流" } as Record<string, string>)[kind.toLocaleLowerCase()] || kind; }
function runStateTone(state: string): string { return state === "succeeded" ? "success" : state === "failed" || state === "timed_out" ? "danger" : state === "cancelled" ? "muted" : "running"; }
function runStateLabel(state: string): string { return ({ succeeded: "成功", failed: "失败", timed_out: "超时", cancelled: "已取消", queued: "排队中", inspecting: "检查中", waiting_execution_consent: "准备运行环境", preparing_runtime: "准备运行环境", running: "运行中", cancelling: "取消中" } as Record<string, string>)[state] || state; }
function formatRunTime(value: string): string { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }

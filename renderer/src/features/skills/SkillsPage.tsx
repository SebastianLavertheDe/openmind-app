import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ChevronDown, Clock3, FolderOpen, GitBranch, Package, Pencil, Plus, RefreshCw, Search, Upload, X } from "lucide-react";
import type { BrokerRunRecord, InstalledSkillView, SkillDefinition, SkillPackageInspectionView, SkillSourceInspectionView, SourceDefinition } from "@shared/contracts";
import type { SkillPackageSourceInput } from "@shared/skill-package-sources";
import { messages } from "@shared/messages";
import { notifyInstalledSkillCatalogChanged } from "../../installed-skill-events";
import { AnimatedDisclosure } from "../../design-system/animated-disclosure";
import { StatusBadge, useModalFocusScope } from "../../design-system/components";
import { ToggleSwitch } from "../../design-system/controls";
import { useExitPresence } from "../../design-system/use-exit-presence";
import { useContainerLayoutMode } from "../../design-system/use-container-layout-mode";

const m = messages.skillCenter;
const RUN_HISTORY_WINDOW_DAYS = 5;
const RUN_HISTORY_WINDOW_MS = RUN_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const SOURCE_CONFIG_SKILL_IDS = new Set(["rss-article-saver", "reddit-fetcher", "x-following-fetcher"]);
const X_CURL_PATH = ".claude/skills/x-following-fetcher/curl.txt";
export const SKILLS_SPLIT_MIN_INLINE_SIZE = 860;

type SkillDetailTab = "overview" | "sources" | "runs";

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
  ref?: string;
  items: SkillItem[];
};

type SkillToggleFeedback = {
  tone: "success" | "error";
  message: string;
};

type SkillSourceUpdateState = {
  phase: "checking" | "available" | "updating" | "current" | "error";
  message: string;
};

export function SkillsPage({ initialSkillId, embedded = false, initialSourcePickerOpen = false, onInstallationChange, onAvailabilityChange }: { skills: SkillDefinition[]; initialSkillId?: string; embedded?: boolean; initialSourcePickerOpen?: boolean; onInstallationChange?(): Promise<unknown> | unknown; onAvailabilityChange?(): Promise<unknown> | unknown }) {
  const [installed, setInstalled] = useState<InstalledSkillView[]>([]);
  const [installedInspections, setInstalledInspections] = useState<Record<string, SkillPackageInspectionView>>({});
  const [runs, setRuns] = useState<BrokerRunRecord[]>([]);
  const [runHistoryUnavailable, setRunHistoryUnavailable] = useState(false);
  const [sources, setSources] = useState<SourceDefinition[]>([]);
  const [detailTab, setDetailTab] = useState<SkillDetailTab>("overview");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const [toggleBusyKeys, setToggleBusyKeys] = useState<Set<string>>(() => new Set());
  const [toggleFeedback, setToggleFeedback] = useState<Record<string, SkillToggleFeedback>>({});
  const [sourceUpdates, setSourceUpdates] = useState<Record<string, SkillSourceUpdateState>>({});
  const toggleBusyKeysRef = useRef(new Set<string>());
  const catalogRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const skillsLayout = useContainerLayoutMode({ splitMinInlineSize: SKILLS_SPLIT_MIN_INLINE_SIZE });

  const load = useCallback(async (showLoading = true, preferredSkillId?: string) => {
    if (showLoading) setLoading(true);
    try {
      const [nextInstalled, runHistoryResult, nextSources] = await Promise.all([
        window.openmind.listInstalledSkills(),
        window.openmind.listSkillRuns()
          .then((nextRuns) => ({ nextRuns, unavailable: false }))
          .catch(() => ({ nextRuns: [] as BrokerRunRecord[], unavailable: true })),
        window.openmind.listSources().catch(() => [])
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
      setRuns(runHistoryResult.nextRuns);
      setRunHistoryUnavailable(runHistoryResult.unavailable);
      setSources(nextSources);
      setError(null);
      setSelectedId((current) => {
        const nextItems = buildItems(nextInstalled, nextInstalledInspections);
        if (nextItems.some((item) => item.id === current)) return current;
        const requested = nextItems.find((item) => item.kind === "installed" && item.record.id === (preferredSkillId || initialSkillId));
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
  const sourceGroups = useMemo(() => groupCatalogItems(items), [items]);
  const catalogGroups = useMemo(() => groupCatalogItems(filteredItems), [filteredItems]);
  const filteredIndexById = useMemo(() => new Map(filteredItems.map((item, index) => [item.id, index])), [filteredItems]);

  useEffect(() => {
    if (filteredItems.some((item) => item.id === selectedId)) return;
    if (!filteredItems.length && items.some((item) => item.id === selectedId)) return;
    setSelectedId(filteredItems[0]?.id || "");
  }, [filteredItems, items, selectedId]);

  const selected = items.find((item) => item.id === selectedId);
  const selectedSummary = selected ? itemSummary(selected) : null;
  const selectedSources = useMemo(() => selectedSummary
    ? sources.filter((source) => source.skillId === selectedSummary.id)
    : [], [selectedSummary, sources]);
  const selectedRuns = useMemo(() => {
    if (!selectedSummary) return [];
    const cutoff = Date.now() - RUN_HISTORY_WINDOW_MS;
    return runs
      .filter((run) => run.request.skillId === selectedSummary.id && Date.parse(run.createdAt) >= cutoff)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [runs, selectedSummary]);

  useEffect(() => { setDetailTab("overview"); }, [selectedId]);

  const reloadSources = useCallback(async () => {
    const nextSources = await window.openmind.listSources();
    setSources(nextSources);
  }, []);

  const checkSourceUpdate = useCallback(async (group: SkillCatalogGroup) => {
    const source = sourceInputForGroup(group);
    if (!source || !window.openmind.inspectSkillSource) return;
    setSourceUpdates((current) => ({
      ...current,
      [group.key]: { phase: "checking", message: m.sourceUpdate.checking }
    }));
    try {
      const requestId = `skill-update-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const inspection = await window.openmind.inspectSkillSource(source, requestId);
      if (inspection.packages.some((item) => !item.valid)) throw new Error(m.sourceUpdate.invalid);
      const summary = summarizeSourceUpdate(group.items, inspection.packages);
      const available = summary.changed + summary.added > 0;
      setSourceUpdates((current) => ({
        ...current,
        [group.key]: {
          phase: available ? "available" : "current",
          message: available ? m.sourceUpdate.available : m.sourceUpdate.current
        }
      }));
    } catch (cause) {
      const detail = sourceUpdateErrorMessage(cause);
      setSourceUpdates((current) => ({
        ...current,
        [group.key]: { phase: "error", message: m.sourceUpdate.failed(detail) }
      }));
    }
  }, []);

  const updateSource = useCallback(async (group: SkillCatalogGroup, preferredSkillId: string) => {
    const source = sourceInputForGroup(group);
    if (!source || !window.openmind.installSkillSource) return;
    setSourceUpdates((current) => ({
      ...current,
      [group.key]: { phase: "updating", message: m.sourceUpdate.updating }
    }));
    try {
      // Updating is source-wide on purpose: a Git receipt represents one
      // coherent checkout, so partially replacing one package would leave the
      // installed source snapshot inconsistent.
      await window.openmind.installSkillSource(source);
      await load(false, preferredSkillId);
      notifyInstalledSkillCatalogChanged();
      try { await onInstallationChange?.(); } catch { /* best-effort shell refresh */ }
      try { await onAvailabilityChange?.(); } catch { /* best-effort draft refresh */ }
      setSourceUpdates((current) => ({
        ...current,
        [group.key]: { phase: "current", message: m.sourceUpdate.updated }
      }));
    } catch (cause) {
      const detail = sourceUpdateErrorMessage(cause);
      setSourceUpdates((current) => ({
        ...current,
        [group.key]: { phase: "error", message: m.sourceUpdate.failed(detail) }
      }));
    }
  }, [load, onAvailabilityChange, onInstallationChange]);

  const focusItem = useCallback((index: number) => {
    const nextIndex = Math.max(0, Math.min(filteredItems.length - 1, index));
    const next = filteredItems[nextIndex];
    if (!next) return;
    setSelectedId(next.id);
    requestAnimationFrame(() => catalogRef.current?.querySelector<HTMLButtonElement>(`[data-skill-index="${nextIndex}"]`)?.focus());
  }, [filteredItems]);

  const selectItem = useCallback((id: string, revealDetail = false) => {
    setSelectedId(id);
    if (!revealDetail || skillsLayout.mode !== "stacked") return;
    const behavior = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    requestAnimationFrame(() => detailRef.current?.scrollIntoView?.({ behavior, block: "start" }));
  }, [skillsLayout.mode]);

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
      <section ref={skillsLayout.ref} className="skills-layout" data-layout={skillsLayout.mode}>
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
              {query ? <button type="button" className="skills-search-clear" data-motion="icon" aria-label={m.clearSearch} onClick={() => setQuery("")}><X size={14} aria-hidden /></button> : null}
            </label>
            <span className="skills-catalog-count" role="status" aria-live="polite">
              {query ? m.resultCount(filteredItems.length, items.length) : m.skillCount(items.length)}
            </span>
          </header>
          <div ref={catalogRef} className="skills-catalog-list" aria-label={m.listAria}>
            {!filteredItems.length ? <div className="skills-empty"><Package size={20} aria-hidden /><strong>{items.length ? m.noMatch : m.emptyTitle}</strong><span>{items.length ? m.noMatchDescription : m.emptyDescription}</span></div> : null}
            {catalogGroups.map((group) => {
              const sourceGroup = sourceGroups.find((candidate) => candidate.key === group.key) || group;
              const selectedSourceItem = sourceGroup.items.find((item) => item.id === selectedId);
              return <SkillCatalogGroupView
                key={group.key}
                group={group}
                open={groupOpen[group.key] ?? true}
                onOpenChange={(next) => setGroupOpen((current) => ({ ...current, [group.key]: next }))}
                selectedId={selectedId}
                total={filteredItems.length}
                indexById={filteredIndexById}
                updateState={sourceUpdates[group.key]}
                canUpdateSource={sourcePickerApiAvailable}
                onCheckSourceUpdate={() => void checkSourceUpdate(sourceGroup)}
                onUpdateSource={() => void updateSource(sourceGroup, selectedSourceItem?.record.id || sourceGroup.items[0]?.record.id || "")}
                onSelect={selectItem}
                onNavigate={focusItem}
              />;
            })}
          </div>
        </aside>

        <section ref={detailRef} className="workspace-card skills-detail">
          {!selected || !selectedSummary ? <div className="skills-detail-empty"><Package size={24} aria-hidden /><p>{m.detailEmpty}</p></div> : <div key={selected.id} className="skills-detail-content" data-skill-detail-id={selected.id}>
            <header className="skills-detail-header">
              <div className="skills-detail-title">
                <div><span className="eyebrow">{kindLabel(selectedSummary.kind)}</span><h2>{selectedSummary.title}</h2><p>{selectedSummary.description || selectedSummary.id}</p></div>
              </div>
              <StatusBadge tone={skillState(selected).tone}>{skillState(selected).label}</StatusBadge>
            </header>
            <SkillOverview item={selected} summary={selectedSummary} />
            {SOURCE_CONFIG_SKILL_IDS.has(selectedSummary.id) ? <>
              <SkillDetailTabs
                active={detailTab}
                sourceLabel={skillSourceTabLabel(selectedSummary.id, selectedSources.length)}
                runCount={selectedRuns.length}
                onChange={setDetailTab}
              />
              <div key={detailTab} id={`skill-panel-${detailTab}`} role="tabpanel" aria-labelledby={`skill-tab-${detailTab}`} className="skills-detail-tab-panel">
                {detailTab === "overview" ? <SkillAvailability
                  record={selected.record}
                  summary={selectedSummary}
                  busy={toggleBusyKeys.has(selected.record.key)}
                  feedback={toggleFeedback[selected.record.key]}
                  onChange={(enabled) => void setSkillEnabled(selected.record, enabled)}
                /> : null}
                {detailTab === "sources" ? <SkillSourcesPanel
                  summary={selectedSummary}
                  sources={selectedSources}
                  onSourceUpdated={(updated) => setSources((current) => current.map((source) => source.id === updated.id ? updated : source))}
                  onReloadSources={reloadSources}
                /> : null}
                {detailTab === "runs" ? <SkillRunHistory runs={selectedRuns} unavailable={runHistoryUnavailable} /> : null}
              </div>
            </> : <>
              <SkillAvailability
                record={selected.record}
                summary={selectedSummary}
                busy={toggleBusyKeys.has(selected.record.key)}
                feedback={toggleFeedback[selected.record.key]}
                onChange={(enabled) => void setSkillEnabled(selected.record, enabled)}
              />
              <SkillRunHistory runs={selectedRuns} unavailable={runHistoryUnavailable} />
            </>}
          </div>}
        </section>
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dialogPresence = useExitPresence(open, 160);

  useModalFocusScope({ open: open && dialogPresence.visible, containerRef: dialogRef, onDismiss: onToggle, layer: "global" });

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
    <button type="button" className="skills-source-picker-toggle" data-motion="action" aria-expanded={open} onClick={onToggle}>
      <Plus size={15} aria-hidden />
      <span>{open ? picker.close : picker.open}</span>
    </button>
    {dialogPresence.visible && typeof document !== "undefined" ? createPortal(
      <div
        ref={dialogRef}
        className="modal-scrim settings-provider-dialog-scrim skills-source-dialog-scrim ui-overlay"
        data-focus-scope-backdrop
        data-leaving={dialogPresence.leaving || undefined}
        aria-hidden={dialogPresence.leaving || undefined}
        inert={dialogPresence.leaving || undefined}
        onMouseDown={onToggle}
      >
        <section className="settings-provider-dialog skills-source-dialog" role="dialog" aria-modal="true" aria-labelledby="skills-source-dialog-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div><span>SKILL CENTER</span><h2 id="skills-source-dialog-title">{picker.title}</h2><p>{picker.description}</p></div>
            <button type="button" className="settings-subtle-action" data-motion="icon" aria-label={picker.closeAria} onClick={onToggle}><X size={16} aria-hidden /></button>
          </header>
          <div className="settings-provider-dialog-body skills-source-picker-body">
            <div className="skills-source-picker-local-option">
              <div className="skills-source-picker-local-copy"><strong>{picker.localTitle}</strong><small>{picker.localDescription}</small></div>
              <button type="button" className="settings-subtle-action skills-source-picker-local" data-motion="action" disabled={busy !== null} onClick={() => void selectLocal()}>
                <FolderOpen size={15} aria-hidden />{picker.local}
              </button>
            </div>
            <div className="settings-grid-2 skills-source-picker-git">
              <label className="settings-field settings-field--wide">
                <span>{picker.git}</span>
                <input
                  className="settings-browser-path-input"
                  type="url"
                  inputMode="url"
                  placeholder={picker.gitPlaceholder}
                  value={gitUrl}
                  onChange={(event) => { setGitUrl(event.target.value); setCandidate(null); setInspection(null); setSelectedPackageRefs([]); setFailure(null); }}
                  onKeyDown={(event) => { if (event.key === "Enter") void inspectGit(); }}
                />
              </label>
              <label className="settings-field">
                <span>{picker.refLabel}</span>
                <input
                  className="settings-browser-path-input"
                  type="text"
                  placeholder={picker.refPlaceholder}
                  value={gitRef}
                  onChange={(event) => { setGitRef(event.target.value); setCandidate(null); setInspection(null); setSelectedPackageRefs([]); setFailure(null); }}
                />
              </label>
            </div>
            {candidate ? <div className="skills-source-picker-candidate">
              <code title={candidate.locator}>{candidate.locator}{candidate.type === "git" && candidate.ref ? ` @${candidate.ref}` : ""}</code>
              {inspection ? <div className="skills-source-package-summary">
                <strong>{picker.packageCount(inspection.packages.length)}</strong>
                <span>{picker.selectedCount(selectedPackageRefs.length)}</span>
              </div> : null}
              {inspection ? <div className="skills-source-package-list">
                {inspection.packages.map((item) => {
                  const packageRef = inspectionPackageRef(item);
                  return <label className={`skills-source-package${item.valid ? "" : " invalid"}`} key={packageRef}>
                    {candidate.type === "git" ? <input
                      type="checkbox"
                      checked={selectedPackageRefs.includes(packageRef)}
                      disabled={busy !== null}
                      aria-label={picker.selectPackage(inspectionName(item))}
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
            </div> : null}
            {failure ? <p className="skills-error" role="alert">{failure}</p> : null}
          </div>
          <footer>
            <button type="button" className="settings-subtle-action" data-motion="action" onClick={onToggle}>{m.common.cancel}</button>
            {busy === "inspect" ? <button type="button" className="settings-subtle-action" data-motion="action" onClick={() => void cancelInspect()}>{picker.cancel}</button>
              : candidate && inspection ? <button type="button" className="primary-button skills-source-picker-install" data-motion="action" disabled={busy !== null || !installationReady} onClick={() => void install()}>
                {busy === "install" ? picker.importing : selectedPackageRefs.length > 1 ? picker.importSelected(selectedPackageRefs.length) : picker.import}
              </button>
                : <button type="button" className="primary-button" data-motion="action" disabled={busy !== null} onClick={() => void inspectGit()}>{picker.inspect}</button>}
          </footer>
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
  const rawMessage = cause instanceof Error ? cause.message : String(cause);
  const message = rawMessage
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^(?:Error|SkillSourceError):\s*/i, "")
    .trim();
  if (/Git 地址(?:必须是有效的 HTTPS URL|不能包含控制字符|不能包含凭据、查询参数或片段)|Git 来源只允许 HTTPS/.test(message)) {
    return errors.invalid;
  }
  if (/Git 仓库需要登录|当前账号无权访问/.test(message)) return errors["git-auth-required"];
  if (/当前环境未找到 Git/.test(message)) return errors["git-unavailable"];
  if (/Git 来源下载超时|Git 来源检查超时/.test(message)) return errors["git-timeout"];
  if (/已取消 Git 来源检查/.test(message)) return errors["git-cancelled"];
  if (/没有找到任何 Skill 包/.test(message)) return errors["git-package-missing"];
  if (/^Git 来源(?:下载|检查)失败/.test(message)) return message;
  return `${errors.unknown}${message ? `（${message}）` : ""}`;
}

function sourceUpdateErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message === m.sourceUpdate.invalid) return cause.message;
  return sourceErrorMessage(cause);
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

function sourceInputForGroup(group: SkillCatalogGroup): SkillPackageSourceInput | null {
  if (!group.locator) return null;
  return { type: "git", locator: group.locator, ...(group.ref ? { ref: group.ref } : {}) };
}

function summarizeSourceUpdate(items: SkillItem[], packages: SkillPackageInspectionView[]): { changed: number; added: number } {
  const installedByRef = new Map<string, SkillItem>();
  const installedByKey = new Map<string, SkillItem>();
  const installedById = new Map<string, SkillItem>();
  for (const item of items) {
    if (item.record.sourcePackageRef) installedByRef.set(item.record.sourcePackageRef, item);
    installedByKey.set(item.record.key, item);
    installedById.set(item.record.id, item);
  }

  let changed = 0;
  let added = 0;
  for (const inspection of packages) {
    const identity = inspectionIdentity(inspection);
    const current = installedByRef.get(inspectionPackageRef(inspection))
      || (identity.key ? installedByKey.get(identity.key) : undefined)
      || (identity.id ? installedById.get(identity.id) : undefined);
    if (!current) added += 1;
    else if (current.record.digest.toLowerCase() !== inspection.digest.toLowerCase()) changed += 1;
  }
  return { changed, added };
}

function inspectionIdentity(inspection: SkillPackageInspectionView): { key?: string; id?: string } {
  const manifest = inspectionManifest(inspection);
  const id = typeof manifest.id === "string" ? manifest.id : undefined;
  const publisher = manifest.publisher && typeof manifest.publisher === "object"
    ? manifest.publisher as { id?: unknown }
    : undefined;
  const publisherId = typeof publisher?.id === "string" ? publisher.id : undefined;
  return {
    ...(id ? { id } : {}),
    ...(id && publisherId ? { key: `${publisherId}/${id}` } : {})
  };
}

function inspectionManifest(inspection: SkillPackageInspectionView): Record<string, unknown> {
  return inspection.manifest && typeof inspection.manifest === "object" ? inspection.manifest as Record<string, unknown> : {};
}

function inspectionName(inspection: SkillPackageInspectionView): string {
  const display = inspectionManifest(inspection).display;
  return display && typeof display === "object" && typeof (display as { name?: unknown }).name === "string"
    ? (display as { name: string }).name
    : m.fallback.untitled;
}

function inspectionPublisher(inspection: SkillPackageInspectionView): string {
  const publisher = inspectionManifest(inspection).publisher;
  if (!publisher || typeof publisher !== "object") return m.fallback.undeclared;
  const value = publisher as { displayName?: unknown; id?: unknown };
  return typeof value.displayName === "string" ? value.displayName : typeof value.id === "string" ? value.id : m.fallback.undeclared;
}

function inspectionVersion(inspection: SkillPackageInspectionView): string {
  const value = inspectionManifest(inspection).version;
  return typeof value === "string" ? value : m.fallback.undeclared;
}

function SkillCatalogGroupView({ group, open, onOpenChange, selectedId, total, indexById, updateState, canUpdateSource, onCheckSourceUpdate, onUpdateSource, onSelect, onNavigate }: {
  group: SkillCatalogGroup;
  open: boolean;
  onOpenChange(next: boolean): void;
  selectedId: string;
  total: number;
  indexById: Map<string, number>;
  updateState?: SkillSourceUpdateState;
  canUpdateSource: boolean;
  onCheckSourceUpdate(): void;
  onUpdateSource(): void;
  onSelect(id: string, revealDetail?: boolean): void;
  onNavigate(index: number): void;
}) {
  const remote = Boolean(group.locator);
  const checking = updateState?.phase === "checking";
  const updating = updateState?.phase === "updating";
  const updateBusy = checking || updating;
  const updateAvailable = updateState?.phase === "available";
  const sourceDescription = updateState?.message
    || (group.locator ? `${group.locator}${group.ref ? ` @ ${group.ref}` : ""}` : m.fallback.localHistory);
  return <div className={`skills-source-group${remote && canUpdateSource ? " has-update-actions" : ""}${updateState ? ` update-${updateState.phase}` : ""}`}>
    <AnimatedDisclosure
      open={open}
      onOpenChange={onOpenChange}
      className="skills-source-group-disclosure"
      triggerClassName="skills-source-group-trigger"
      contentClassName="skills-source-group-content"
      triggerAriaLabel={m.groupToggle(open, group.title)}
      summary={<>
        <span className="skills-source-group-icon" aria-hidden>{remote ? <GitBranch size={15} /> : <FolderOpen size={15} />}</span>
        <span className="skills-source-group-copy">
          <strong>{group.title}</strong>
          <small title={sourceDescription}>{sourceDescription}</small>
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
    </AnimatedDisclosure>
    {remote && canUpdateSource ? <div className="skills-source-group-actions">
      <button type="button" data-motion="action" disabled={updateBusy} onClick={onCheckSourceUpdate}>
        <RefreshCw className={checking ? "spin" : undefined} size={12} aria-hidden />
        <span>{checking ? m.sourceUpdate.checking : m.sourceUpdate.check}</span>
      </button>
      <button type="button" className={updateAvailable ? "available" : undefined} data-motion="action" disabled={!updateAvailable || updateBusy} onClick={onUpdateSource}>
        <RefreshCw className={updating ? "spin" : undefined} size={12} aria-hidden />
        <span>{updating ? m.sourceUpdate.updating : m.sourceUpdate.apply}</span>
      </button>
    </div> : null}
  </div>;
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
    <div className="skills-source-path">
      <span>{m.sourcePath}</span>
      <code title={item.record.sourcePath}>{item.record.sourcePath}</code>
    </div>
  </section>;
}

function SkillDetailTabs({ active, sourceLabel, runCount, onChange }: {
  active: SkillDetailTab;
  sourceLabel: string;
  runCount: number;
  onChange(tab: SkillDetailTab): void;
}) {
  const tabs: Array<{ id: SkillDetailTab; label: string }> = [
    { id: "overview", label: m.detailTabs.overview },
    { id: "sources", label: sourceLabel },
    { id: "runs", label: m.detailTabs.runs(runCount) }
  ];
  return <div className="skills-detail-tabs" role="tablist" aria-label={m.detailTabs.aria}>
    {tabs.map((tab, index) => <button
      key={tab.id}
      type="button"
      role="tab"
      id={`skill-tab-${tab.id}`}
      aria-selected={active === tab.id}
      aria-controls={`skill-panel-${tab.id}`}
      tabIndex={active === tab.id ? 0 : -1}
      className={active === tab.id ? "active" : undefined}
      data-motion="selection"
      onClick={() => onChange(tab.id)}
      onKeyDown={(event) => {
        const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!direction) return;
        event.preventDefault();
        const next = tabs[(index + direction + tabs.length) % tabs.length];
        onChange(next.id);
        requestAnimationFrame(() => document.getElementById(`skill-tab-${next.id}`)?.focus());
      }}
    >{tab.label}</button>)}
  </div>;
}

type SourceEditorState = { mode: "add" } | { mode: "edit"; source: SourceDefinition };

function SkillSourcesPanel({ summary, sources, onSourceUpdated, onReloadSources }: {
  summary: ManifestSummary;
  sources: SourceDefinition[];
  onSourceUpdated(source: SourceDefinition): void;
  onReloadSources(): Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<SourceEditorState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<SkillToggleFeedback | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const editorPresence = useExitPresence(Boolean(editor), 160);
  const lastEditor = useRef<SourceEditorState | null>(editor);
  if (editor) lastEditor.current = editor;
  const renderedEditor = editor ?? lastEditor.current;
  const isRss = summary.id === "rss-article-saver";
  const isReddit = summary.id === "reddit-fetcher";
  const canEditSources = isRss || isReddit;
  const copy = skillSourceCopy(summary, sources.length);
  const visibleSources = sources.filter((source) => {
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${source.name} ${source.url || ""} ${source.tags.join(" ")}`.toLocaleLowerCase().includes(needle);
  });

  const toggleSource = async (source: SourceDefinition) => {
    setBusyId(source.id);
    setFeedback(null);
    try {
      const updated = await window.openmind.updateSource(source.id, { enabled: !source.enabled });
      onSourceUpdated(updated);
    } catch (cause) {
      setFeedback({ tone: "error", message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setBusyId(null);
    }
  };

  const importOpml = async () => {
    setImporting(true);
    setFeedback(null);
    try {
      const count = await window.openmind.importOpml();
      await onReloadSources();
      setFeedback({ tone: "success", message: m.ownedSources.importSuccess(count) });
    } catch (cause) {
      setFeedback({ tone: "error", message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setImporting(false);
    }
  };

  if (summary.id === "x-following-fetcher") return <SkillXCurlPanel
    summary={summary}
    source={sources[0]}
    busy={Boolean(sources[0] && busyId === sources[0].id)}
    feedback={feedback}
    onToggle={sources[0] ? () => void toggleSource(sources[0]) : undefined}
  />;

  return <section className="skills-owned-sources">
    <header className="skills-owned-sources-header">
      <div><h3>{copy.title}</h3><p>{copy.description}</p></div>
      <div className="skills-owned-sources-toolbar">
        {canEditSources ? <div className="skills-owned-sources-actions">
          <button type="button" data-motion="action" onClick={() => setEditor({ mode: "add" })}><Plus size={14} aria-hidden />{isRss ? m.ownedSources.addRss : m.ownedSources.addReddit}</button>
          {isRss ? <button type="button" data-motion="action" disabled={importing} aria-busy={importing || undefined} onClick={() => void importOpml()}><Upload size={14} className={importing ? "spin" : ""} aria-hidden />{m.ownedSources.importOpml}</button> : null}
        </div> : null}
        <label className="skills-source-search">
          <Search size={15} aria-hidden />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} aria-label={copy.searchPlaceholder} />
        </label>
      </div>
    </header>

    {feedback ? <p className={`skills-source-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.message}</p> : null}

    {!visibleSources.length ? <div className="skills-source-empty">
      <span>{query ? m.ownedSources.noMatch : copy.empty}</span>
      {!query && canEditSources ? <button type="button" data-motion="action" onClick={() => setEditor({ mode: "add" })}>{m.ownedSources.addFirst(isReddit)}</button> : null}
    </div> : <div className="skills-source-list" role="list">
      <div className="skills-source-list-head" aria-hidden><span /><span>{m.ownedSources.nameAndAddress(isReddit)}</span><span>{m.ownedSources.statusAndLastRun}</span><span>{m.ownedSources.operation}</span></div>
      {visibleSources.map((source) => <article key={source.id} className="skills-source-row" role="listitem">
        <span className={`skills-source-state ${sourceStatusTone(source)}`} aria-hidden />
        <div className="skills-source-main">
          <strong>{source.name}</strong>
          <small title={source.url || undefined}>{source.url || source.frequency}</small>
        </div>
        <div className="skills-source-meta"><span>{sourceStatusLabel(source)}</span><small>{sourceLastRun(source)}</small></div>
        <div className="skills-source-row-actions">
          {source.kind === "rss" || source.kind === "reddit" ? <button type="button" className="skills-source-edit" data-motion="icon" aria-label={m.ownedSources.edit(source.name)} onClick={() => setEditor({ mode: "edit", source })}><Pencil size={14} aria-hidden /></button> : null}
          <ToggleSwitch
            checked={source.enabled}
            disabled={busyId === source.id}
            label={m.ownedSources.toggle(source.enabled, source.name)}
            onChange={() => void toggleSource(source)}
          />
        </div>
      </article>)}
    </div>}

    {isRss ? <div className="skills-source-rules">
      <div><strong>{m.ownedSources.rssRules.title}</strong><span>{m.ownedSources.rssRules.summary}</span></div>
      <button type="button" data-motion="action" aria-expanded={rulesOpen} onClick={() => setRulesOpen((current) => !current)}>{rulesOpen ? m.ownedSources.hideRules : m.ownedSources.showRules}</button>
      {rulesOpen ? <p>{m.ownedSources.rssRules.detail}</p> : null}
    </div> : null}

    {isReddit ? <div className="skills-source-rules">
      <div><strong>{m.ownedSources.redditRules.title}</strong><span>{m.ownedSources.redditRules.summary}</span></div>
      <button type="button" data-motion="action" aria-expanded={rulesOpen} onClick={() => setRulesOpen((current) => !current)}>{rulesOpen ? m.ownedSources.hideRules : m.ownedSources.showRules}</button>
      {rulesOpen ? <p>{m.ownedSources.redditRules.detail}</p> : null}
    </div> : null}

    {editorPresence.visible && renderedEditor ? <SkillSourceEditor
      key={renderedEditor.mode === "edit" ? `edit:${renderedEditor.source.id}` : "add"}
      state={renderedEditor}
      kind={isReddit ? "reddit" : "rss"}
      active={Boolean(editor)}
      leaving={editorPresence.leaving}
      onClose={() => setEditor(null)}
      onSaved={async () => {
        setEditor(null);
        await onReloadSources();
        setFeedback({ tone: "success", message: m.ownedSources.saved(isReddit, renderedEditor.mode === "add") });
      }}
    /> : null}
  </section>;
}

function SkillXCurlPanel({ summary, source, busy, feedback, onToggle }: {
  summary: ManifestSummary;
  source?: SourceDefinition;
  busy: boolean;
  feedback: SkillToggleFeedback | null;
  onToggle?: () => void;
}) {
  const [curl, setCurl] = useState("");
  const [curlState, setCurlState] = useState<"loading" | "configured" | "missing">("loading");
  const [editorOpen, setEditorOpen] = useState(false);
  const editorPresence = useExitPresence(editorOpen, 160);
  const copy = skillSourceCopy(summary, source ? 1 : 0);

  const loadCurl = useCallback(async () => {
    setCurlState("loading");
    try {
      const record = await window.openmind.readContent(X_CURL_PATH);
      const next = String(record.content || "").trim();
      setCurl(next);
      setCurlState(/^curl(?:\s|')/i.test(next) ? "configured" : "missing");
    } catch {
      setCurl("");
      setCurlState("missing");
    }
  }, []);

  useEffect(() => { void loadCurl(); }, [loadCurl]);

  return <section className="skills-owned-sources skills-x-curl-panel">
    <header className="skills-owned-sources-header">
      <div><h3>{copy.title}</h3><p>{copy.description}</p></div>
    </header>

    <article className="skills-x-curl-card">
      <span className={`skills-source-state ${curlState === "configured" ? "success" : "idle"}`} aria-hidden />
      <div className="skills-x-curl-copy">
        <strong>{m.xCurl.title}</strong>
        <span>{curlState === "loading" ? m.xCurl.loading : curlState === "configured" ? m.xCurl.configured : m.xCurl.missing}</span>
        <small>{m.xCurl.securitySummary}</small>
      </div>
      <div className="skills-x-curl-actions">
        <button type="button" data-motion="action" disabled={curlState === "loading"} onClick={() => setEditorOpen(true)}><Pencil size={14} aria-hidden />{curlState === "configured" ? m.xCurl.edit : m.xCurl.fill}</button>
        {source && onToggle ? <ToggleSwitch
          checked={source.enabled}
          disabled={busy}
          label={m.ownedSources.toggle(source.enabled, summary.title)}
          onChange={onToggle}
        /> : null}
      </div>
    </article>

    {feedback ? <p className={`skills-source-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.message}</p> : null}

    <div className="skills-x-curl-help">
      <strong>{m.xCurl.helpTitle}</strong>
      <ol>{m.xCurl.helpSteps.map((step) => <li key={step}>{step}</li>)}</ol>
    </div>

    {editorPresence.visible ? <SkillXCurlEditor
      initialCurl={curl}
      active={editorOpen}
      leaving={editorPresence.leaving}
      onClose={() => setEditorOpen(false)}
      onSaved={async (next) => {
        setCurl(next);
        setCurlState("configured");
        setEditorOpen(false);
      }}
    /> : null}
  </section>;
}

function SkillXCurlEditor({ initialCurl, active, leaving, onClose, onSaved }: { initialCurl: string; active: boolean; leaving: boolean; onClose(): void; onSaved(curl: string): Promise<void> }) {
  const [draft, setDraft] = useState(initialCurl);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!active) return;
    textareaRef.current?.focus();
  }, [active]);
  useModalFocusScope({ open: active, containerRef: dialogRef, onDismiss: onClose, layer: "global" });

  const save = async () => {
    const next = draft.trim();
    if (!/^curl(?:\s|')/i.test(next)) {
      setFailure(m.xCurl.invalid);
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      await window.openmind.writeContent(X_CURL_PATH, `${next}\n`);
      await onSaved(next);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(<div className="skills-source-editor-scrim" role="presentation" data-leaving={leaving || undefined} aria-hidden={leaving || undefined} inert={leaving || undefined} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="skills-source-editor skills-x-curl-editor" role="dialog" aria-modal="true" aria-labelledby="skills-x-curl-editor-title" tabIndex={-1}>
      <header><div><h3 id="skills-x-curl-editor-title">{m.xCurl.editorTitle}</h3><p>{m.xCurl.editorDescription}</p></div><button type="button" data-motion="icon" aria-label={m.common.close} onClick={onClose}><X size={16} /></button></header>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>{m.xCurl.fullCurl}<textarea ref={textareaRef} value={draft} onChange={(event) => { setDraft(event.target.value); setFailure(null); }} spellCheck={false} placeholder={"curl 'https://x.com/i/api/graphql/…' \\\n  -H 'authorization: …'"} /></label>
        <p className="skills-x-curl-security">{m.xCurl.securityDetail}</p>
        {failure ? <p className="skills-source-editor-error" role="alert">{failure}</p> : null}
        <footer><button type="button" data-motion="action" onClick={onClose}>{m.common.cancel}</button><button type="submit" className="primary-button" data-motion="action" disabled={saving || !draft.trim()} aria-busy={saving || undefined}>{saving ? m.common.saving : m.xCurl.overwrite}</button></footer>
      </form>
    </section>
  </div>, document.body);
}

function SkillSourceEditor({ state, kind, active, leaving, onClose, onSaved }: { state: SourceEditorState; kind: "rss" | "reddit"; active: boolean; leaving: boolean; onClose(): void; onSaved(): Promise<void> }) {
  const editing = state.mode === "edit" ? state.source : null;
  const isReddit = kind === "reddit";
  const [name, setName] = useState(editing?.name || "");
  const [url, setUrl] = useState(editing?.url || "");
  const [tags, setTags] = useState(editing?.tags.join(", ") || "");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!active) return;
    inputRef.current?.focus();
  }, [active]);
  useModalFocusScope({ open: active, containerRef: dialogRef, onDismiss: onClose, layer: "global" });

  const save = async () => {
    setSaving(true);
    setFailure(null);
    const nextTags = tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
    try {
      if (editing) await window.openmind.updateSource(editing.id, { name: name.trim(), url: url.trim(), tags: nextTags });
      else await window.openmind.addRssSource({ name: name.trim(), url: url.trim(), kind, frequency: m.ownedSources.frequency, tags: nextTags });
      await onSaved();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(<div className="skills-source-editor-scrim" role="presentation" data-leaving={leaving || undefined} aria-hidden={leaving || undefined} inert={leaving || undefined} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="skills-source-editor" role="dialog" aria-modal="true" aria-labelledby="skill-source-editor-title" tabIndex={-1}>
      <header><div><h3 id="skill-source-editor-title">{m.sourceEditor.title(Boolean(editing), isReddit)}</h3><p>{m.sourceEditor.description(isReddit)}</p></div><button type="button" data-motion="icon" aria-label={m.common.close} onClick={onClose}><X size={16} /></button></header>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>{m.sourceEditor.name(isReddit)}<input ref={inputRef} value={name} onChange={(event) => setName(event.target.value)} placeholder={m.sourceEditor.namePlaceholder(isReddit)} /></label>
        <label>{m.sourceEditor.url(isReddit)}<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder={isReddit ? "https://www.reddit.com/r/LocalLLaMA/hot.json" : "https://example.com/feed.xml"} /></label>
        <label>{m.sourceEditor.tags}<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder={m.sourceEditor.tagsPlaceholder(isReddit)} /></label>
        {failure ? <p className="skills-source-editor-error" role="alert">{failure}</p> : null}
        <footer><button type="button" data-motion="action" onClick={onClose}>{m.common.cancel}</button><button type="submit" className="primary-button" data-motion="action" disabled={saving || !name.trim() || !url.trim()} aria-busy={saving || undefined}>{saving ? m.common.saving : editing ? m.sourceEditor.saveChanges : m.sourceEditor.add(isReddit)}</button></footer>
      </form>
    </section>
  </div>, document.body);
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
        className="skills-availability-toggle"
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

function SkillRunHistory({ runs, unavailable = false }: { runs: BrokerRunRecord[]; unavailable?: boolean }) {
  return <section className="skills-detail-section skills-run-history" aria-label={m.runHistory.title}>
    <header><h3>{m.runHistory.title}</h3><span>{m.runHistory.summary(RUN_HISTORY_WINDOW_DAYS, runs.length)}</span></header>
    {unavailable ? <div className="skills-run-empty" role="status"><Clock3 size={16} aria-hidden /><span>{m.runHistory.unavailable}</span></div> : !runs.length ? <div className="skills-run-empty"><Clock3 size={16} aria-hidden /><span>{m.runHistory.empty(RUN_HISTORY_WINDOW_DAYS)}</span></div> : (
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

function skillSourceTabLabel(skillId: string, count: number): string {
  if (skillId === "rss-article-saver") return m.sourceTab.rss(count);
  if (skillId === "reddit-fetcher") return m.sourceTab.reddit(count);
  if (skillId === "x-following-fetcher") return m.sourceTab.x;
  return m.sourceTab.other(count);
}

function skillSourceCopy(summary: ManifestSummary, count: number): { title: string; description: string; searchPlaceholder: string; empty: string } {
  if (summary.id === "rss-article-saver") return {
    title: m.sourceCopy.rss.title(summary.title),
    description: m.sourceCopy.rss.description(count),
    searchPlaceholder: m.sourceCopy.rss.search,
    empty: m.sourceCopy.rss.empty
  };
  if (summary.id === "reddit-fetcher") return {
    title: m.sourceCopy.reddit.title(summary.title),
    description: m.sourceCopy.reddit.description(count),
    searchPlaceholder: m.sourceCopy.reddit.search,
    empty: m.sourceCopy.reddit.empty
  };
  return {
    title: m.sourceCopy.x.title(summary.title),
    description: m.sourceCopy.x.description,
    searchPlaceholder: m.sourceCopy.x.search,
    empty: m.sourceCopy.x.empty
  };
}

function sourceStatusLabel(source: SourceDefinition): string {
  if (!source.enabled || source.status === "disabled") return m.sourceStatus.disabled;
  return ({ idle: m.sourceStatus.idle, running: m.sourceStatus.running, success: m.sourceStatus.success, warning: m.sourceStatus.warning, failed: m.sourceStatus.failed, disabled: m.sourceStatus.disabled } as const)[source.status];
}

function sourceStatusTone(source: SourceDefinition): string {
  if (!source.enabled || source.status === "disabled") return "idle";
  if (source.status === "failed") return "danger";
  if (source.status === "warning") return "warning";
  if (source.status === "running") return "running";
  return source.status === "success" ? "success" : "idle";
}

function sourceLastRun(source: SourceDefinition): string {
  if (!source.lastRunAt) return m.sourceStatus.never;
  const parsed = new Date(source.lastRunAt);
  if (Number.isNaN(parsed.getTime())) return source.lastRunAt;
  return m.sourceStatus.last(parsed.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }));
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
    const ref = locator ? item.record.sourceRef : undefined;
    const key = locator ? `git:${locator}${ref ? `#${ref}` : ""}` : "local";
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(key, {
      key,
      title: locator ? repositoryName(locator) : m.fallback.localSource,
      ...(locator ? { locator } : {}),
      ...(ref ? { ref } : {}),
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
    title: stringValue(display.name, record?.id || m.fallback.untitled),
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
function kindLabel(kind: string): string { return ({ process: m.kindLabel.process, agent: m.kindLabel.agent, prompt: m.kindLabel.prompt, workflow: m.kindLabel.workflow } as Record<string, string>)[kind.toLocaleLowerCase()] || kind; }
function runStateTone(state: string): string { return state === "succeeded" ? "success" : state === "failed" || state === "timed_out" ? "danger" : state === "cancelled" ? "muted" : "running"; }
function runStateLabel(state: string): string { return ({ succeeded: m.runState.succeeded, failed: m.runState.failed, timed_out: m.runState.timedOut, cancelled: m.runState.cancelled, queued: m.runState.queued, inspecting: m.runState.inspecting, waiting_execution_consent: m.runState.preparing, preparing_runtime: m.runState.preparing, running: m.runState.running, cancelling: m.runState.cancelling } as Record<string, string>)[state] || state; }
function formatRunTime(value: string): string { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }

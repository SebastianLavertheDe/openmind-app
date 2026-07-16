import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Database,
  Code2,
  Folder,
  Layers3,
  Lightbulb,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Save,
  Square,
  Trash2,
  TrendingUp,
  Upload,
  X
} from "lucide-react";
import type { SourceDefinition, SourceKind } from "@shared/contracts";
import { messages } from "@shared/messages";
import { useAi } from "../../ai-context";
import { EmptyState, ErrorState, PageHeader, Select, Skeleton, StatusBadge } from "../../design-system/components";
import { useExitPresence } from "../../design-system/use-exit-presence";

const m = messages;
const X_CURL_PATH = ".claude/skills/x-following-fetcher/curl.txt";

const SOURCE_KIND_COLORS: Record<SourceKind, string> = {
  rss: "#2f7fe6",
  web: "#f59e0b",
  x: "#16181d",
  reddit: "#f05a28",
  manual: "#8b5cf6",
  api: "#6366f1"
};

const TABS: Array<{ id: "all" | SourceKind; label: string }> = [
  { id: "all", label: m.contentKind.all },
  { id: "rss", label: m.sources.tabs.rss },
  { id: "web", label: m.sources.tabs.web },
  { id: "x", label: m.sources.tabs.x },
  { id: "reddit", label: m.sources.tabs.reddit },
  { id: "manual", label: m.sources.tabs.manual },
  { id: "api", label: m.sources.tabs.api }
];

const FREQUENCY_OPTIONS = [
  m.sources.add.frequencyOptions.m15,
  m.sources.add.frequencyOptions.hourly,
  m.sources.add.frequencyOptions.daily,
  m.sources.add.frequencyOptions.pipeline
] as const;

export function SourcesPage({ initialSourceId }: { initialSourceId?: string }) {
  const ai = useAi();
  const [sources, setSources] = useState<SourceDefinition[]>([]);
  const [selectedId, setSelectedId] = useState(initialSourceId || "");
  const [tab, setTab] = useState<"all" | SourceKind>("all");
  const [search, setSearch] = useState("");
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addKind, setAddKind] = useState<Extract<SourceKind, "rss" | "web" | "api">>("rss");
  const [addUrl, setAddUrl] = useState("");
  const [addTags, setAddTags] = useState("");
  const [addFrequency, setAddFrequency] = useState<string>(m.sources.add.frequencyOptions.daily);
  const [saving, setSaving] = useState(false);
  const [xCurl, setXCurl] = useState("");
  const [xCurlLoading, setXCurlLoading] = useState(false);
  const [xCurlSaving, setXCurlSaving] = useState(false);
  const [xCurlDirty, setXCurlDirty] = useState(false);
  const [xCurlError, setXCurlError] = useState("");
  const [editingId, setEditingId] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(() => new Set());
  const [importing, setImporting] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const addPanelPresence = useExitPresence(showAdd, 160);
  const bulkBarPresence = useExitPresence(bulkMode, 160);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await window.cctools.listSources();
      setSources(next);
      setSelectedId((current) => next.some((source) => source.id === current)
        ? current
        : initialSourceId && next.some((source) => source.id === initialSourceId)
          ? initialSourceId
          : next[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [initialSourceId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => window.cctools.onSkillEvent((event) => {
    const key = String(event.sourceId || event.skillId || "");
    if (!key) return;
    if (event.state) {
      setRunning((current) => ({ ...current, [key]: event.state === "running" }));
      if (event.state !== "running") {
        void load();
      }
    }
  }), [load]);

  const filtered = useMemo(() => sources.filter((source) => {
    if (tab !== "all" && source.kind !== tab) return false;
    const query = search.trim().toLocaleLowerCase();
    return !query || [source.name, source.url, source.kind, source.skillId, ...source.tags].filter(Boolean).join(" ").toLocaleLowerCase().includes(query);
  }), [search, sources, tab]);
  const selectedSource = useMemo(() => sources.find((source) => source.id === selectedId) || null, [selectedId, sources]);

  const availableTabs = useMemo(() => TABS.filter((item) => item.id !== "manual" || sources.some((source) => source.kind === "manual")), [sources]);

  const tabCounts = useMemo(() => {
    const counts = new Map<"all" | SourceKind, number>([["all", sources.length]]);
    for (const source of sources) counts.set(source.kind, (counts.get(source.kind) || 0) + 1);
    return counts;
  }, [sources]);

  useEffect(() => {
    if (tab === "all" || availableTabs.some((item) => item.id === tab)) return;
    setTab("all");
  }, [availableTabs, tab]);

  const loadXCurl = useCallback(async () => {
    setXCurlLoading(true);
    setXCurlError("");
    try {
      const record = await window.cctools.readContent(X_CURL_PATH);
      setXCurl(record.content || "");
      setXCurlDirty(false);
    } catch (cause) {
      setXCurlError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setXCurlLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "x" || selectedSource?.kind === "x") void loadXCurl();
  }, [loadXCurl, selectedSource?.kind, tab]);

  const activeCount = sources.filter((source) => source.enabled).length;
  const failed = sources.filter((source) => source.status === "failed" || source.status === "warning").length;
  const healthy = sources.filter((source) => source.enabled && source.status !== "failed" && source.status !== "warning").length;
  const todayItemCount = sources
    .filter((source) => isToday(source.lastSuccessAt || source.lastRunAt))
    .reduce((sum, source) => sum + source.itemCount, 0);
  const latestRunAt = sources.reduce<string | null>((latest, source) => {
    if (!source.lastRunAt) return latest;
    return !latest || new Date(source.lastRunAt) > new Date(latest) ? source.lastRunAt : latest;
  }, null);
  const averageSuccessRate = sources.length
    ? Math.round(sources.reduce((sum, source) => sum + (source.successRate ?? 0), 0) / sources.length)
    : 0;
  const kindDistribution = useMemo(() => {
    const counts = new Map<SourceKind, number>();
    for (const source of sources) counts.set(source.kind, (counts.get(source.kind) || 0) + 1);
    return [...counts.entries()]
      .map(([kind, count]) => ({ kind, count, percentage: sources.length ? count / sources.length * 100 : 0 }))
      .sort((left, right) => right.count - left.count);
  }, [sources]);
  const chartBackground = useMemo(() => {
    if (!sources.length) return "conic-gradient(var(--border) 0 100%)";
    let cursor = 0;
    const stops = kindDistribution.map(({ kind, percentage }) => {
      const start = cursor;
      cursor += percentage;
      return `${SOURCE_KIND_COLORS[kind]} ${start}% ${cursor}%`;
    });
    return `conic-gradient(${stops.join(", ")})`;
  }, [kindDistribution, sources.length]);

  const toggle = async (source: SourceDefinition) => {
    try {
      const updated = await window.cctools.updateSource(source.id, { enabled: !source.enabled });
      setSources((current) => current.map((item) => item.id === source.id ? updated : item));
      ai.notify(updated.enabled ? m.sources.notify.enabled : m.sources.notify.disabled, "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    }
  };

  const remove = async (source: SourceDefinition) => {
    const confirmed = await ai.confirm({ title: "删除数据源", body: `确定删除“${source.name}”吗？RSS 链接会同时从订阅文件中移除。`, confirmText: "删除", danger: true });
    if (!confirmed) return;
    try {
      await window.cctools.deleteSource(source.id);
      setSources((current) => current.filter((item) => item.id !== source.id));
      setSelectedId((current) => current === source.id ? "" : current);
      ai.notify("数据源已删除", "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    }
  };

  const openNewSource = () => {
    setEditingId("");
    setAddName("");
    setAddKind("rss");
    setAddUrl("");
    setAddTags("");
    setAddFrequency(m.sources.add.frequencyOptions.daily);
    setShowAdd(true);
  };

  const editSource = (source: SourceDefinition) => {
    if (source.kind !== "rss" && source.kind !== "web" && source.kind !== "api") return;
    setEditingId(source.id);
    setAddName(source.name);
    setAddKind(source.kind);
    setAddUrl(source.url || "");
    setAddTags(source.tags.join(", "));
    setAddFrequency(source.frequency);
    setShowAdd(true);
  };

  const saveXCurl = async () => {
    if (!xCurlDirty || xCurlSaving) return;
    if (!/^\s*curl\s+/i.test(xCurl)) {
      setXCurlError("请粘贴以 curl 开头的完整请求");
      return;
    }
    setXCurlSaving(true);
    setXCurlError("");
    try {
      await window.cctools.writeContent(X_CURL_PATH, xCurl.trimEnd() + "\n");
      setXCurlDirty(false);
      ai.notify("X curl 已覆盖保存", "success");
    } catch (cause) {
      setXCurlError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setXCurlSaving(false);
    }
  };

  const run = async (source: SourceDefinition) => {
    const isRunning = running[source.id] || source.status === "running";
    try {
      if (isRunning) await window.cctools.stopSource(source.id);
      else await window.cctools.runSource(source.id, todayCompact());
      setRunning((current) => ({ ...current, [source.id]: !isRunning }));
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    }
  };

  const runAll = async () => {
    const runnable = sources.filter((source) => source.enabled && source.skillId && source.status !== "running");
    if (!runnable.length) {
      ai.notify(m.sources.notify.noRunnable, "info");
      return;
    }
    setRunningAll(true);
    try {
      for (const source of runnable) {
        setRunning((current) => ({ ...current, [source.id]: true }));
        await window.cctools.runSource(source.id, todayCompact());
      }
      ai.notify(m.sources.notify.runAllSubmitted(runnable.length), "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setRunningAll(false);
    }
  };

  const addSource = async () => {
    if (!addName.trim() || !addUrl.trim()) return;
    setSaving(true);
    try {
      const source = editingId
        ? await window.cctools.updateSource(editingId, {
            name: addName.trim(),
            url: addUrl.trim(),
            frequency: addFrequency,
            tags: splitSourceTags(addTags)
          })
        : await window.cctools.addRssSource({
            name: addName.trim(),
            kind: addKind,
            url: addUrl.trim(),
            frequency: addFrequency,
            tags: splitSourceTags(addTags)
          });
      await load();
      setSelectedId(source.id);
      setAddName("");
      setAddUrl("");
      setAddTags("");
      setAddFrequency(m.sources.add.frequencyOptions.daily);
      setAddKind("rss");
      setEditingId("");
      setShowAdd(false);
      ai.notify(editingId ? "数据源已更新" : m.sources.notify.added(sourceKindLabel(source.kind)), "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setSaving(false);
    }
  };

  const importOpml = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const count = await window.cctools.importOpml();
      if (count) await load();
      ai.notify(m.sources.notify.opmlImported(count), count ? "success" : "info");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setImporting(false);
    }
  };

  const toggleBulk = () => {
    setBulkMode((value) => !value);
    setBulkSelected(new Set());
  };

  const toggleBulkSelection = (sourceId: string) => {
    setBulkSelected((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };

  const setSelectedEnabled = async (enabled: boolean) => {
    const selected = sources.filter((source) => bulkSelected.has(source.id));
    if (!selected.length) return;
    try {
      const updated = await Promise.all(selected.map((source) => window.cctools.updateSource(source.id, { enabled })));
      const byId = new Map(updated.map((source) => [source.id, source]));
      setSources((current) => current.map((source) => byId.get(source.id) || source));
      ai.notify(`已${enabled ? "启用" : "停用"} ${updated.length} 个数据源`, "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    }
  };

  const removeSelected = async () => {
    const selected = sources.filter((source) => bulkSelected.has(source.id));
    if (!selected.length) return;
    const confirmed = await ai.confirm({ title: "批量删除数据源", body: `确定删除选中的 ${selected.length} 个数据源吗？`, confirmText: "删除", danger: true });
    if (!confirmed) return;
    try {
      await Promise.all(selected.map((source) => window.cctools.deleteSource(source.id)));
      setSources((current) => current.filter((source) => !bulkSelected.has(source.id)));
      setBulkSelected(new Set());
      ai.notify(`已删除 ${selected.length} 个数据源`, "success");
    } catch (cause) {
      ai.notify(cause instanceof Error ? cause.message : String(cause), "error");
    }
  };

  return (
    <div className="feature-page sources-page">
      <PageHeader
        eyebrow={m.nav.sources}
        title={m.sources.page.title}
        description={m.sources.page.description}
        actions={<><button data-motion="action" aria-busy={runningAll || undefined} disabled={runningAll} onClick={() => void runAll()}><RefreshCw size={15} className={runningAll ? "spin" : ""} />{m.sources.actions.runAll}</button><button className="primary-button" data-motion="action" onClick={openNewSource}><Plus size={15} />{m.sources.actions.add}</button></>}
      />
      <section className="source-metrics">
        <SourceMetricCard icon={<Database size={25} />} label={m.sources.metrics.total} value={sources.length} detail={m.sources.metrics.active(activeCount)} tone="info" />
        <SourceMetricCard icon={<CheckCircle2 size={25} />} label="正常" value={healthy} detail="运行正常" tone="success" />
        <SourceMetricCard icon={<CircleAlert size={25} />} label={m.sources.metrics.anomaly} value={failed} detail={failed ? m.sources.metrics.needsAttention : m.sources.metrics.noAnomaly} tone={failed ? "warning" : "danger"} />
        <SourceMetricCard icon={<TrendingUp size={25} />} label="今日新增" value={todayItemCount.toLocaleString("zh-CN")} detail="今日新增资料" tone="violet" />
      </section>
      {addPanelPresence.visible ? <section className="workspace-card source-add-panel" data-leaving={addPanelPresence.leaving || undefined}>
        <header><div><strong>{editingId ? "编辑数据源" : m.sources.add.expand}</strong><span>{editingId ? "更新名称、地址、标签和抓取频率" : "添加 RSS、文件夹或 API 资料来源"}</span></div><button data-motion="icon" aria-label="关闭添加源面板" onClick={() => { setShowAdd(false); setEditingId(""); }}><X size={16} /></button></header>
        <div className="source-add-grid">
          <label>{m.sources.add.name}<input value={addName} onChange={(event) => setAddName(event.target.value)} placeholder={m.sources.add.placeholderName} /></label>
          <label>{m.sources.add.type}<Select
            size="rect"
            value={addKind}
            disabled={Boolean(editingId)}
            onChange={(value) => setAddKind(value as typeof addKind)}
            options={[
              { value: "rss", label: m.sources.tabs.rss },
              { value: "web", label: m.sources.tabs.web },
              { value: "api", label: m.sources.tabs.api }
            ]}
          /></label>
          <label className="wide">{m.sources.add.url}<input value={addUrl} onChange={(event) => setAddUrl(event.target.value)} placeholder={addKind === "web" ? "~/cctools/notes" : "https://..."} /></label>
          <label>{m.sources.add.tags}<input value={addTags} onChange={(event) => setAddTags(event.target.value)} placeholder={m.sources.add.placeholderTags} /></label>
          <label>{m.sources.add.frequency}<Select
            size="rect"
            value={addFrequency}
            onChange={setAddFrequency}
            options={FREQUENCY_OPTIONS.map((option) => ({ value: option, label: option }))}
          /></label>
        </div>
        <div className="source-add-actions">
          <button className="primary-button" data-motion="action" aria-busy={saving || undefined} disabled={saving || !addName.trim() || !addUrl.trim()} onClick={() => void addSource()}>{saving ? m.sources.add.saving : editingId ? "保存修改" : m.sources.add.submit}</button>
          <button data-motion="action" aria-busy={importing || undefined} disabled={importing} onClick={() => void importOpml()}><Upload size={14} className={importing ? "spin" : ""} />{m.sources.add.importOpml}</button>
        </div>
      </section> : null}
      <section className="source-layout">
        <div className="source-main-stack">
        <article className="workspace-card source-main-card">
        <header className="source-toolbar">
          <div className="tab-row" aria-label={m.sources.toolbar.tabsAria}>
            {availableTabs.map((item) => (
              <button
                key={item.id}
                data-motion="selection"
                aria-pressed={tab === item.id}
                aria-label={item.label}
                className={tab === item.id ? "active" : ""}
                onClick={() => setTab(item.id)}
              >
                {item.label}<span aria-hidden="true">{tabCounts.get(item.id) || 0}</span>
              </button>
            ))}
          </div>
          <label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={m.sources.toolbar.searchPlaceholder} /></label>
        </header>
        {bulkBarPresence.visible ? <div className="source-bulk-bar" data-leaving={bulkBarPresence.leaving || undefined}>
          <label><input type="checkbox" checked={filtered.length > 0 && filtered.every((source) => bulkSelected.has(source.id))} onChange={(event) => setBulkSelected(event.target.checked ? new Set(filtered.map((source) => source.id)) : new Set())} />选择当前列表</label>
          <span>已选 {bulkSelected.size} 个</span>
          <div><button data-motion="action" disabled={!bulkSelected.size} onClick={() => void setSelectedEnabled(true)}>启用</button><button data-motion="action" disabled={!bulkSelected.size} onClick={() => void setSelectedEnabled(false)}>停用</button><button className="source-delete" data-motion="action" disabled={!bulkSelected.size} onClick={() => void removeSelected()}><Trash2 size={13} />删除</button><button data-motion="action" onClick={toggleBulk}>完成</button></div>
        </div> : null}
        <div className="source-list-head"><span>来源名称</span><span>操作</span></div>
        {loading ? (
          <div className="source-list" aria-label={m.sources.loading} aria-busy="true">
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} variant="row" lines={2} label={m.sources.loading} />)}
          </div>
        ) : error ? <ErrorState message={error} retry={() => void load()} /> : filtered.length ? (
          <div className="source-list entrance-stagger" role="list" aria-label={m.sources.page.title}>
                  {filtered.map((source) => (
                    <article
                      className={`source-item${selectedId === source.id ? " selected" : ""}`}
                      data-entrance-item
                      role="button"
                      tabIndex={0}
                      aria-label={source.name}
                      data-motion="selection"
                      key={source.id}
                      onClick={() => setSelectedId(source.id)}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(source.id); } }}
                    >
                      {bulkMode ? <input className="source-row-checkbox" aria-label={`选择 ${source.name}`} type="checkbox" checked={bulkSelected.has(source.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleBulkSelection(source.id)} /> : null}
                      <span className={`source-kind-icon ${source.kind}`} aria-hidden="true">{sourceIcon(source.kind)}</span>
                      <div className="source-item-main">
                        <div className="source-item-head">
                          <strong>{source.name}</strong>
                          <StatusBadge tone={statusTone(source.status)}>{statusLabel(source.status)}</StatusBadge>
                        </div>
                        <small className="source-item-url">{source.url || source.skillId || source.kind}</small>
                      </div>
                      <div className="source-actions">
                        <button data-motion="icon" title={source.enabled ? m.sources.actions.disable : m.sources.actions.enable} aria-label={source.enabled ? `${m.sources.actions.disable} ${source.name}` : `${m.sources.actions.enable} ${source.name}`} onClick={(event) => { event.stopPropagation(); void toggle(source); }}>{source.enabled ? <Pause size={14} /> : <Play size={14} />}</button>
                        {source.kind === "rss" || source.kind === "web" || source.kind === "api" ? <button data-motion="icon" title="编辑" aria-label={`编辑 ${source.name}`} onClick={(event) => { event.stopPropagation(); editSource(source); }}><Pencil size={14} /></button> : null}
                        {source.kind === "rss" || !source.skillId ? <button className="source-delete" data-motion="icon" title="删除" aria-label={`删除 ${source.name}`} onClick={(event) => { event.stopPropagation(); void remove(source); }}><Trash2 size={14} /></button> : null}
                        {source.skillId ? (() => { const isRunning = running[source.id] || source.status === "running"; return <button
                          className={isRunning ? "danger-button" : "primary-button"}
                          data-motion="action"
                          aria-busy={isRunning || undefined}
                          disabled={!source.enabled}
                          onClick={(event) => { event.stopPropagation(); void run(source); }}
                        >{isRunning ? <><Square size={13} />{m.sources.actions.stop}</> : <><RefreshCw size={13} className="source-fetch-icon" />{m.sources.actions.fetch}</>}</button>; })() : <button data-motion="icon" title={m.sources.actions.more} aria-label={`${source.name} ${m.sources.actions.more}`}><MoreHorizontal size={14} /></button>}
                      </div>
                    </article>
                  ))}
          </div>
        ) : <EmptyState title={m.sources.empty.title} description={m.sources.empty.description} icon={<Database size={24} />} action={<button className="primary-button" onClick={openNewSource}>{m.sources.empty.action}</button>} />}
        </article>
        {tab === "x" || selectedSource?.kind === "x" ? (
          <section className="x-curl-panel">
            <header><div><Code2 size={18} /><span><strong>X 请求配置</strong><small>{X_CURL_PATH}</small></span></div><button data-motion="icon" onClick={() => void loadXCurl()}><RefreshCw size={14} />重新读取</button></header>
            <p>将浏览器开发者工具复制出的完整 curl 粘贴到下方，保存后会覆盖当前 X 抓取请求。</p>
            {xCurlError ? <div className="x-curl-error" role="alert">{xCurlError}</div> : null}
            <textarea aria-label="X curl 配置" value={xCurl} disabled={xCurlLoading} spellCheck={false} placeholder={xCurlLoading ? "正在读取 curl…" : "curl 'https://x.com/…' \\\n  -H 'authorization: …'"} onChange={(event) => { setXCurl(event.target.value); setXCurlDirty(true); setXCurlError(""); }} />
            <footer><span>{xCurlDirty ? "有未保存的修改" : "当前配置已保存"}</span><button className="primary-button" data-motion="action" aria-busy={xCurlSaving || undefined} disabled={!xCurlDirty || xCurlSaving || xCurlLoading} onClick={() => void saveXCurl()}><Save size={14} />{xCurlSaving ? "保存中" : "覆盖保存"}</button></footer>
          </section>
        ) : null}
        </div>
        <aside className="source-side-panel" aria-label="资料来源概览">
          <section className="workspace-card source-side-card source-distribution-card">
            <header><strong>来源分布</strong></header>
            <div className="source-distribution-body">
              <div className="source-donut" role="img" aria-label={`共 ${sources.length} 个资料来源`} style={{ background: chartBackground }}><span>{sources.length}<small>总数</small></span></div>
              <div className="source-distribution-list">
                {kindDistribution.length ? kindDistribution.map(({ kind, count, percentage }) => <div key={kind}><i style={{ background: SOURCE_KIND_COLORS[kind] }} /><span>{sourceKindLabel(kind)}</span><strong>{count}</strong><small>{percentage.toFixed(1)}%</small></div>) : <span className="source-side-empty">暂无来源</span>}
              </div>
            </div>
          </section>
          <section className="workspace-card source-side-card source-status-card">
            <header><strong>抓取状态</strong></header>
            <dl>
              <div><dt>最近一次抓取</dt><dd>{failed ? `${failed} 个需处理` : "全部成功"}<CheckCircle2 size={14} /></dd></div>
              <div><dt>最后抓取时间</dt><dd>{latestRunAt ? formatFullDateTime(latestRunAt) : "尚未运行"}</dd></div>
              <div><dt>活跃来源</dt><dd>{activeCount} / {sources.length}</dd></div>
              <div><dt>平均成功率</dt><dd>{averageSuccessRate}%</dd></div>
            </dl>
          </section>
          <section className="workspace-card source-side-card source-quick-card">
            <header><strong>快捷操作</strong></header>
            <div>
              <button data-motion="action" onClick={toggleBulk}><span><Layers3 size={17} /><span><strong>批量管理</strong><small>批量启用、停用或删除来源</small></span></span><ChevronRight size={15} /></button>
              <button data-motion="action" aria-busy={importing || undefined} disabled={importing} onClick={() => void importOpml()}><span><Upload size={17} className={importing ? "spin" : ""} /><span><strong>{m.sources.add.importOpml}</strong><small>从 OPML 文件导入</small></span></span><ChevronRight size={15} /></button>
            </div>
          </section>
          <section className="workspace-card source-tip-card"><Lightbulb size={18} /><div><strong>小贴士</strong><p>建议定期检查异常来源，确保内容抓取稳定。</p></div></section>
        </aside>
      </section>
    </div>
  );
}

function SourceMetricCard({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: number | string; detail: string; tone: "info" | "success" | "warning" | "danger" | "violet" }) {
  return <article className={`source-metric-card ${tone}`}><span className="source-metric-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function sourceIcon(kind: SourceKind) {
  if (kind === "rss") return <Rss size={16} />;
  if (kind === "web" || kind === "manual") return <Folder size={16} />;
  return <Database size={16} />;
}

function sourceKindLabel(kind: SourceKind): string {
  return m.sources.kind[kind];
}

function splitSourceTags(value: string): string[] {
  return [...new Set(value.split(/[，,\n]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 8);
}

function formatFullDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function isToday(value: string | null | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function todayCompact(): string {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function statusLabel(value: SourceDefinition["status"]): string {
  return ({
    idle: m.sources.status.pending,
    running: m.sources.status.running,
    success: m.sources.status.ok,
    warning: m.sources.status.attention,
    failed: m.sources.status.failed,
    disabled: m.sources.status.disabled
  } as const)[value];
}

function statusTone(value: SourceDefinition["status"]): "neutral" | "success" | "warning" | "danger" | "info" {
  if (value === "success") return "success";
  if (value === "warning") return "warning";
  if (value === "failed") return "danger";
  if (value === "running") return "info";
  return "neutral";
}

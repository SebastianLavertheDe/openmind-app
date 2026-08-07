import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Clipboard, Database, Download, FolderCog, Package, RefreshCw, Upload, Wrench } from "lucide-react";
import type { AppBootstrap, AppStateBackupReport, BrokerRunRecord, EnvironmentDiagnostic, InstalledSkillView, MymindRelocationPreview, MymindRootStatus, RuntimePackReadiness } from "@shared/contracts";
import type { Navigate } from "../../app/routes";
import { StatusBadge } from "../../design-system/components";
import { useAi } from "../../ai-context";
import { mymindRootPreviewBody, mymindRootPreviewError } from "../../mymind-root-selection";

type Props = { bootstrap: AppBootstrap; go: Navigate };
type Tone = "success" | "warning" | "danger" | "muted";

export function DiagnosticsPage({ bootstrap, go }: Props) {
  const ai = useAi();
  const [root, setRoot] = useState<MymindRootStatus | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentDiagnostic[]>([]);
  const [skills, setSkills] = useState<InstalledSkillView[]>([]);
  const [packs, setPacks] = useState<RuntimePackReadiness[]>([]);
  const [runs, setRuns] = useState<BrokerRunRecord[]>([]);
  const [indexReport, setIndexReport] = useState<string | null>(null);
  const [backupReport, setBackupReport] = useState<AppStateBackupReport | null>(null);
  const [relocationPreview, setRelocationPreview] = useState<MymindRelocationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"refresh" | "root" | "index" | "copy" | "relocation" | "backup-export" | "backup-import" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const [nextRoot, nextEnvironment, nextSkills, nextPacks, nextRuns] = await Promise.all([
        window.cctools.getMymindRoot(),
        window.cctools.getEnvironmentDiagnostics(),
        window.cctools.listInstalledSkills(),
        window.cctools.listRuntimePacks(),
        window.cctools.listSkillRuns()
      ]);
      setRoot(nextRoot);
      setEnvironment(nextEnvironment);
      setSkills(nextSkills);
      setPacks(nextPacks);
      setRuns(nextRuns.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 8));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const healthTone: Exclude<Tone, "muted"> = root ? rootHealthTone(root) : "danger";
  const skillSummary = useMemo(() => ({
    total: skills.length,
    active: skills.filter((item) => item.status === "active").length,
    ready: skills.filter((item) => item.readiness === "ready").length,
    attention: skills.filter((item) => item.status !== "active" || item.readiness !== "ready" || item.executionTrust !== "approved-host").length
  }), [skills]);
  const runtimeSummary = useMemo(() => ({ active: packs.filter((item) => item.status === "active" && item.ready).length, attention: packs.filter((item) => !item.ready || item.integrity !== "verified").length }), [packs]);

  const chooseRoot = async () => {
    setBusy("root");
    try {
      const selected = await window.cctools.selectMymindRoot();
      if (selected) {
        const preview = await window.cctools.previewMymindRoot(selected);
        if (!preview.canBind) throw new Error(mymindRootPreviewError(preview));
        if (!await ai.confirm({ title: "确认绑定 mymind 根目录", body: mymindRootPreviewBody(preview), confirmText: "确认绑定" })) return;
        await window.cctools.setMymindRoot(selected);
        await load(false);
        ai.notify("mymind 内容根已更新，新的 Run 会使用新的 root snapshot。", "success");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const rebuildIndex = async () => {
    if (!root?.health.writable) {
      setError("当前 mymind 根目录不可写，不能重建索引。 ");
      return;
    }
    setBusy("index");
    try {
      const report = await window.cctools.rebuildContentIndex();
      setIndexReport(`${report.itemCount} 条内容，覆盖 ${report.indexedDates.length} 个日期（${formatTime(report.rebuiltAt)}）`);
      ai.notify("mymind 内容索引已重建", "success");
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const relocateRoot = async () => {
    setBusy("relocation");
    try {
      const selected = await window.cctools.selectMymindRelocationTarget();
      if (!selected) return;
      const preview = await window.cctools.previewMymindRelocation(selected);
      setRelocationPreview(preview);
      if (!preview.canCommit) {
        setError(preview.blockingReasons.join("；") || "搬迁预检未通过。");
        return;
      }
      const confirmed = await ai.confirm({ title: "确认搬迁 mymind 内容", body: mymindRelocationPreviewBody(preview), confirmText: "复制并切换根目录" });
      if (!confirmed) return;
      const report = await window.cctools.relocateMymind(selected);
      setRelocationPreview(null);
      ai.notify(`已校验并搬迁 ${report.copiedFileCount} 个文件，原目录保留不动。`, "success");
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const copySummary = async () => {
    setBusy("copy");
    try {
      const summary = buildSafeSummary(bootstrap, root, environment, skills, packs, runs);
      await navigator.clipboard?.writeText(summary);
      ai.notify("已复制脱敏诊断摘要", "success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "当前环境不允许复制诊断摘要。 ");
    } finally {
      setBusy(null);
    }
  };

  const backupState = async (operation: "export" | "import") => {
    setBusy(operation === "export" ? "backup-export" : "backup-import");
    try {
      const report = operation === "export"
        ? await window.cctools.exportAppStateBackup()
        : await window.cctools.importAppStateBackup();
      if (report) {
        setBackupReport(report);
        ai.notify(operation === "export" ? "应用状态备份已导出" : "应用状态已恢复，AI Worker 将重新载入状态", "success");
        if (operation === "import") await load(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !root) return <div className="feature-page diagnostics-page"><section className="workspace-card diagnostics-loading" role="status">正在读取根目录、环境和运行状态…</section></div>;

  return (
    <div className="feature-page diagnostics-page">
      <header className="diagnostics-page-header">
        <div><span className="eyebrow">HEALTH & SUPPORT</span><h1>诊断</h1><p>查看 mymind 根目录、Skill Registry、Runtime 和本机环境状态。这里的诊断不会读取 Secret 或 mymind 正文。</p></div>
        <div className="ui-page-actions"><button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null} onClick={() => { setBusy("refresh"); void load().finally(() => setBusy(null)); }}><RefreshCw size={14} className={busy === "refresh" ? "spin" : ""} />刷新</button><button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null} onClick={() => void copySummary()}><Clipboard size={14} />复制摘要</button></div>
      </header>
      {error ? <p className="diagnostics-error" role="alert">{error}</p> : null}
      <section className="diagnostics-grid">
        <section className="workspace-card diagnostics-card diagnostics-root-card">
          <header className="diagnostics-card-header"><div><span className="eyebrow">MYMIND ROOT</span><h2>内容根目录</h2></div><StatusBadge tone={healthTone}>{root ? rootHealthLabel(root) : "未读取"}</StatusBadge></header>
          <dl className="diagnostics-facts"><Fact label="当前根" value={root?.mymindRoot || "未选择"} code /><Fact label="Workspace" value={root?.workspaceRoot || "未配置"} code /><Fact label="Root Generation" value={root?.snapshot ? String(root.snapshot.rootGeneration) : "—"} /><Fact label="运行中任务" value={String(root?.health.activeRunCount ?? 0)} /><Fact label="旧状态迁移" value={migrationLabel(root?.migration?.state)} /></dl>
          {root ? <div className="diagnostics-check-list"><CheckRow label="已配置" ok={root.health.configured} /><CheckRow label="可访问" ok={root.health.accessible} /><CheckRow label="可读" ok={root.health.readable} /><CheckRow label="可写" ok={root.health.writable} /></div> : null}
          {root?.health.missingInitializeEntries.length ? <Notice title="缺少约定目录" body={`${root.health.missingInitializeEntries.length} 项 initialize-required 结构缺失；绑定不会自动创建或重组内容。`} tone="warning" /> : null}
          {root?.health.unknownPreservedEntries.length ? <Notice title="未知内容已保留" body={`${root.health.unknownPreservedEntries.length} 项未识别目录/文件被保留，App 不会删除或移动。`} tone="success" /> : null}
          {root?.health.symlinkWarnings.length ? <Notice title="Symlink 检查提醒" body={root.health.symlinkWarnings.slice(0, 2).join("；")} tone="warning" /> : null}
          {root?.migration?.state === "pending" ? <Notice title="旧状态待迁移" body="检测到旧工作区的 .cctools 状态。首次进入需要旧状态的功能时会复制到 App 私有 state，源状态保留不动。" tone="warning" /> : null}
          {root?.migration?.state === "invalid" ? <Notice title="迁移 marker 需要重试" body="旧状态迁移记录无法读取；重新打开需要旧状态的功能会重新执行可重试迁移。" tone="warning" /> : null}
          <div className="diagnostics-card-actions"><button type="button" className="primary-button" data-motion="action" disabled={busy !== null} onClick={() => void chooseRoot()}><FolderCog size={14} />{root?.health.configured ? "重新选择根目录" : "选择 mymind 根目录"}</button><button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null || !root?.health.writable} onClick={() => void relocateRoot()}><ArrowRightLeft size={14} />{busy === "relocation" ? "搬迁预检中…" : "搬迁内容到新目录"}</button><button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null || !root?.health.writable} onClick={() => void rebuildIndex()}><Database size={14} />{busy === "index" ? "重建中…" : "重建内容索引"}</button><button type="button" className="settings-subtle-action" data-motion="action" onClick={() => go("settings")}>打开设置</button></div>
          {relocationPreview ? <p className="diagnostics-result" role="status">{mymindRelocationPreviewSummary(relocationPreview)}</p> : null}
          {indexReport ? <p className="diagnostics-result" role="status">{indexReport}</p> : null}
        </section>

        <section className="workspace-card diagnostics-card">
          <header className="diagnostics-card-header"><div><span className="eyebrow">APP STATE</span><h2>应用状态备份</h2></div><StatusBadge tone="neutral">不含 Secret</StatusBadge></header>
          <p className="diagnostics-card-copy">备份设置、私有状态、Automation 和 Run 元数据。凭据、浏览器令牌、Skill/Runtime 包、缓存日志、临时工作目录和 mymind 内容不会进入备份。</p>
          <div className="diagnostics-card-actions"><button type="button" className="primary-button" data-motion="action" disabled={busy !== null} onClick={() => void backupState("export")}><Download size={14} />{busy === "backup-export" ? "备份中…" : "备份应用状态"}</button><button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null} onClick={() => void backupState("import")}><Upload size={14} />{busy === "backup-import" ? "恢复中…" : "恢复应用状态"}</button></div>
          {backupReport ? <p className="diagnostics-result" role="status">{backupReport.operation === "export" ? "已导出" : "已恢复"} {backupReport.fileCount} 个文件（{formatBytes(backupReport.byteCount)}）。凭据和平台资源未覆盖。</p> : null}
        </section>

        <section className="workspace-card diagnostics-card">
          <header className="diagnostics-card-header"><div><span className="eyebrow">ENVIRONMENT</span><h2>环境诊断</h2></div><StatusBadge tone={environment.some((item) => item.status === "error") ? "danger" : environment.some((item) => item.status === "warning") ? "warning" : "success"}>{environment.some((item) => item.status === "warning") ? "需注意" : "正常"}</StatusBadge></header>
          <div className="diagnostics-list">{environment.map((item) => <div className="diagnostics-row" key={item.id}><span className={`diagnostics-dot ${item.status}`} /><div><strong>{item.label}</strong><small>{item.value}</small>{item.detail ? <small className="diagnostics-detail">{item.detail}</small> : null}</div></div>)}</div>
        </section>

        <section className="workspace-card diagnostics-card">
          <header className="diagnostics-card-header"><div><span className="eyebrow">SKILL REGISTRY</span><h2>Skill 状态</h2></div><StatusBadge tone={skillSummary.attention ? "warning" : "success"}>{skillSummary.attention ? `${skillSummary.attention} 项需处理` : "就绪"}</StatusBadge></header>
          <div className="diagnostics-stat-grid"><Stat label="已安装" value={skillSummary.total} /><Stat label="Active" value={skillSummary.active} /><Stat label="Ready" value={skillSummary.ready} /><Stat label="需处理" value={skillSummary.attention} /></div>
          {skills.length ? <div className="diagnostics-list">{skills.slice(0, 8).map((skill) => <div className="diagnostics-row" key={`${skill.key}:${skill.digest}`}><Package size={15} aria-hidden /><div><strong>{skill.key}</strong><small>{skill.version} · {skill.status} · {skill.readiness} · {skill.executionTrust}</small></div></div>)}</div> : <EmptyState text="暂无 Installed Skill；可以从 Skill Center 扫描或导入。" onClick={() => go("skills")} action="打开 Skill Center" />}
          <div className="diagnostics-card-actions"><button type="button" className="settings-subtle-action" data-motion="action" onClick={() => go("skills")}>打开 Skill Center</button></div>
        </section>

        <section className="workspace-card diagnostics-card">
          <header className="diagnostics-card-header"><div><span className="eyebrow">RUNTIME</span><h2>Runtime Pack 状态</h2></div><StatusBadge tone={runtimeSummary.attention ? "warning" : "success"}>{runtimeSummary.attention ? `${runtimeSummary.attention} 项需处理` : "正常"}</StatusBadge></header>
          <div className="diagnostics-stat-grid"><Stat label="已激活" value={runtimeSummary.active} /><Stat label="总版本" value={packs.length} /><Stat label="需处理" value={runtimeSummary.attention} /></div>
          {packs.length ? <div className="diagnostics-list">{packs.slice(0, 8).map((pack) => <div className="diagnostics-row" key={`${pack.packId}:${pack.target}:${pack.digest}`}><Wrench size={15} aria-hidden /><div><strong>{pack.packId} · {pack.target}</strong><small>{pack.version} · {pack.status} · {pack.integrity} · {pack.ready ? "ready" : pack.reason}</small></div></div>)}</div> : <EmptyState text="当前没有可用 Runtime Pack。" onClick={() => go("settings")} action="打开 Runtime 设置" />}
          <div className="diagnostics-card-actions"><button type="button" className="settings-subtle-action" data-motion="action" onClick={() => go("settings")}>打开 Runtime 设置</button></div>
        </section>

        <section className="workspace-card diagnostics-card diagnostics-runs-card">
          <header className="diagnostics-card-header"><div><span className="eyebrow">RECENT RUNS</span><h2>最近运行</h2></div><StatusBadge tone={runs.some((run) => run.state === "failed") ? "warning" : "success"}>{runs.length ? `${runs.length} 条` : "暂无"}</StatusBadge></header>
          {runs.length ? <div className="diagnostics-list">{runs.map((run) => <div className="diagnostics-row" key={run.id}><span className={`diagnostics-run-state ${runTone(run.state)}`} /><div><strong>{run.request.skillId}</strong><small>{run.state} · {formatTime(run.createdAt)} · root {run.rootGeneration}</small>{run.error ? <small className="diagnostics-detail">{run.error}</small> : null}</div></div>)}</div> : <EmptyState text="尚未产生 Broker Run。" onClick={() => go("skills")} action="选择一个 Skill" />}
          <div className="diagnostics-card-actions"><button type="button" className="settings-subtle-action" data-motion="action" onClick={() => go("runs")}>打开运行记录</button></div>
        </section>
      </section>
    </div>
  );
}

function Fact({ label, value, code = false }: { label: string; value: string; code?: boolean }) { return <div><dt>{label}</dt><dd className={code ? "is-code" : undefined} title={value}>{value}</dd></div>; }
function Stat({ label, value }: { label: string; value: number }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function CheckRow({ label, ok }: { label: string; ok: boolean }) { return <span className={`diagnostics-check ${ok ? "ok" : "bad"}`}><span aria-hidden>{ok ? "✓" : "!"}</span>{label}</span>; }
function Notice({ title, body, tone }: { title: string; body: string; tone: Tone }) { return <div className={`diagnostics-notice ${tone}`}><strong>{title}</strong><span>{body}</span></div>; }
function EmptyState({ text, action, onClick }: { text: string; action: string; onClick(): void }) { return <div className="diagnostics-empty"><p>{text}</p><button type="button" className="settings-subtle-action" data-motion="action" onClick={onClick}>{action}</button></div>; }
function rootHealthTone(root: MymindRootStatus): Exclude<Tone, "muted"> { return root.health.configured && root.health.accessible && root.health.readable && root.health.writable ? root.health.warnings.length ? "warning" : "success" : "danger"; }
function rootHealthLabel(root: MymindRootStatus): string { const tone = rootHealthTone(root); return tone === "success" ? "可用" : tone === "warning" ? "可用但需注意" : "不可用"; }
function runTone(state: string): Tone { return state === "succeeded" ? "success" : state === "failed" || state === "timed_out" ? "danger" : state === "cancelled" ? "muted" : "warning"; }
function formatTime(value: string): string { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
function formatBytes(value: number): string { return value < 1024 * 1024 ? `${Math.round(value / 1024)} KiB` : `${(value / 1024 / 1024).toFixed(1)} MiB`; }
function mymindRelocationPreviewBody(preview: MymindRelocationPreview): string {
  return [`源目录：${preview.sourceDirectory}`, `目标目录：${preview.targetDirectory}`, `预计复制：${preview.sourceFileCount} 个文件、${preview.sourceDirectoryCount} 个目录、${formatBytes(preview.sourceBytes)}`, "目标必须为空；源目录保留不动。", ...preview.blockingReasons.map((reason) => `阻止原因：${reason}`)].join("\n");
}
function mymindRelocationPreviewSummary(preview: MymindRelocationPreview): string {
  return preview.canCommit ? `搬迁预检通过：${preview.sourceFileCount} 个文件、${formatBytes(preview.sourceBytes)}；确认后复制到空目录并切换根绑定。` : `搬迁预检未通过：${preview.blockingReasons.join("；") || "请重新选择目标目录。"}`;
}
function migrationLabel(state: NonNullable<MymindRootStatus["migration"]>["state"] | undefined): string {
  return state === "committed" ? "已完成" : state === "skipped" ? "无需复制" : state === "pending" ? "待处理" : state === "invalid" ? "记录异常" : "无需迁移";
}
function buildSafeSummary(bootstrap: AppBootstrap, root: MymindRootStatus | null, environment: EnvironmentDiagnostic[], skills: InstalledSkillView[], packs: RuntimePackReadiness[], runs: BrokerRunRecord[]): string {
  return JSON.stringify({ schemaVersion: 1, app: { platform: bootstrap.environment.platform, mode: bootstrap.environment.mode, runtime: bootstrap.runtime }, root: root ? { configured: root.health.configured, accessible: root.health.accessible, readable: root.health.readable, writable: root.health.writable, rootGeneration: root.snapshot?.rootGeneration ?? null, activeRunCount: root.health.activeRunCount, warnings: root.health.warnings, migration: root.migration ? { state: root.migration.state, legacyStatePresent: root.migration.legacyStatePresent, markerPresent: root.migration.markerPresent, copiedFileCount: root.migration.copiedFileCount, sourcePreserved: root.migration.sourcePreserved } : null } : null, environment: environment.map((item) => ({ id: item.id, label: item.label, status: item.status, value: item.id === "node" ? item.value : item.status })), skills: skills.map((item) => ({ key: item.key, version: item.version, digest: item.digest, status: item.status, readiness: item.readiness, executionTrust: item.executionTrust })), runtime: packs.map((item) => ({ packId: item.packId, target: item.target, version: item.version, digest: item.digest, status: item.status, integrity: item.integrity, ready: item.ready })), runs: runs.map((run) => ({ id: run.id, skillId: run.request.skillId, state: run.state, rootGeneration: run.rootGeneration, error: run.error })), }, null, 2);
}

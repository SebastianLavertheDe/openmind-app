import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Download, FolderCog, Settings, ShieldCheck } from "lucide-react";
import type { AppBootstrap, MymindRootStatus, OnboardingState } from "@shared/contracts";
import { messages } from "@shared/messages";
import type { Navigate } from "../../app/routes";
import { StatusBadge } from "../../design-system/components";
import { useAi } from "../../ai-context";
import { mymindRootPreviewBody, mymindRootPreviewError } from "../../mymind-root-selection";

const m = messages.onboarding;
const DEFAULT_ONBOARDING: OnboardingState = { completed: false, skill: "pending", provider: "pending" };

type Props = {
  bootstrap: AppBootstrap;
  go: Navigate;
  onRefresh(): void;
};

export function OnboardingPage({ bootstrap, go, onRefresh }: Props) {
  const ai = useAi();
  const [root, setRoot] = useState<MymindRootStatus | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingState>(DEFAULT_ONBOARDING);
  const [installedSkillCount, setInstalledSkillCount] = useState(0);
  const [configuredProvider, setConfiguredProvider] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"root" | "state" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextRoot, nextState, installed, providers] = await Promise.all([
        window.cctools.getMymindRoot(),
        window.cctools.getOnboardingState?.() || Promise.resolve(DEFAULT_ONBOARDING),
        window.cctools.listInstalledSkills?.() || Promise.resolve([]),
        window.cctools.getProviders?.() || Promise.resolve(null)
      ]);
      setRoot(nextRoot);
      setOnboarding(nextState);
      setInstalledSkillCount(installed.length);
      setConfiguredProvider(Boolean(providers?.providers.some((provider) => provider.enabled && provider.apiKeySet)));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const chooseRoot = async () => {
    setBusy("root");
    setError(null);
    try {
      const selected = await window.cctools.selectMymindRoot();
      if (!selected) return;
      const preview = await window.cctools.previewMymindRoot(selected);
      if (!preview.canBind) throw new Error(mymindRootPreviewError(preview));
      if (!await ai.confirm({ title: "确认绑定 mymind 根目录", body: mymindRootPreviewBody(preview), confirmText: "确认绑定" })) return;
      await window.cctools.setMymindRoot(selected);
      await refresh();
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "根目录选择失败，请返回设置检查目录配置。");
    } finally {
      setBusy(null);
    }
  };

  const updateStep = async (patch: Partial<OnboardingState>): Promise<boolean> => {
    setBusy("state");
    setError(null);
    try {
      const next = await window.cctools.updateOnboardingState?.(patch) || { ...onboarding, ...patch } as OnboardingState;
      setOnboarding(next);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const rootReady = Boolean(root?.health.configured && root.health.accessible && root.health.readable && root.health.writable);
  const providerReady = Boolean(configuredProvider || ai.snapshot.providers.some((provider) => provider.available));
  const skillReady = installedSkillCount > 0;
  const skillStatus = skillReady ? "complete" : onboarding.skill;
  const providerStatus = providerReady ? "complete" : onboarding.provider;
  const canFinish = rootReady && skillStatus !== "pending" && providerStatus !== "pending";

  const statusLabel = (status: "pending" | "complete" | "skipped") => status === "complete" ? m.completed : status === "skipped" ? "已跳过" : m.pending;

  const finish = async () => {
    if (!canFinish) return;
    if (!await updateStep({ completed: true })) return;
    onRefresh();
    go("ai");
  };

  return (
    <div className="feature-page onboarding-page">
      <header className="onboarding-header">
        <div><span className="eyebrow">{m.eyebrow}</span><h1>{m.title}</h1><p>{m.description}</p></div>
        <StatusBadge tone={rootReady ? "success" : "warning"}>{rootReady ? "Ready" : "Needs Configuration"}</StatusBadge>
      </header>

      <section className="onboarding-risk" role="note">
        <AlertTriangle size={18} aria-hidden /><div><strong>{m.riskTitle}</strong><p>{m.riskBody}</p></div>
      </section>
      {error ? <p className="onboarding-error" role="alert">{error}</p> : null}

      <section className="onboarding-grid onboarding-three-step-grid">
        <section className="workspace-card onboarding-card">
          <header className="onboarding-card-header"><div><span className="eyebrow">MYMIND ROOT</span><h2>{m.rootTitle}</h2></div><StepMark status={rootReady ? "complete" : "pending"} number="1" /></header>
          <p>{m.rootBody}</p>
          <div className="onboarding-path">{loading ? "正在检查根目录…" : root?.mymindRoot || m.rootMissing}</div>
          <div className="onboarding-card-actions"><button type="button" className="primary-button" data-motion="action" disabled={busy !== null} onClick={() => void chooseRoot()}><FolderCog size={14} />{busy === "root" ? m.selecting : rootReady ? m.chooseAgain : m.chooseRoot}</button>{rootReady ? <span className="onboarding-inline-status"><Check size={13} />{m.rootSelected}</span> : null}</div>
        </section>

        <section className="workspace-card onboarding-card">
          <header className="onboarding-card-header"><div><span className="eyebrow">SKILL CENTER</span><h2>{m.skillTitle}</h2></div><StepMark status={skillStatus} number="2" /></header>
          <p>{m.skillBody}</p>
          <div className="onboarding-path">{skillStatus === "complete" ? m.skillReady : skillStatus === "skipped" ? m.skillSkipped : m.pending}</div>
          <div className="onboarding-card-actions"><button type="button" className="primary-button" data-motion="action" disabled={busy !== null} onClick={() => go("skills", { openSkillImport: true })}><Download size={14} />{m.importSkill}<ArrowRight size={14} /></button>{skillStatus === "pending" ? <button type="button" className="onboarding-text-action" disabled={busy !== null} onClick={() => void updateStep({ skill: "skipped" })}>{m.skipSkill}</button> : null}</div>
        </section>

        <section className="workspace-card onboarding-card">
          <header className="onboarding-card-header"><div><span className="eyebrow">AI PROVIDER</span><h2>{m.providerTitle}</h2></div><StepMark status={providerStatus} number="3" /></header>
          <p>{m.providerBody}</p>
          <div className="onboarding-provider-status"><StatusBadge tone={providerStatus === "complete" ? "success" : providerStatus === "skipped" ? "neutral" : "warning"}>{statusLabel(providerStatus)}</StatusBadge>{providerReady ? <small>{m.providerReady}</small> : null}</div>
          <div className="onboarding-card-actions"><button type="button" className="primary-button" data-motion="action" disabled={busy !== null} onClick={() => go("settings", { settingsSection: "providers" })}><Settings size={14} />{m.installProvider}<ArrowRight size={14} /></button>{providerStatus === "pending" ? <button type="button" className="onboarding-text-action" disabled={busy !== null} onClick={() => void updateStep({ provider: "skipped" })}>{m.skipProvider}</button> : null}</div>
        </section>
      </section>

      <section className="workspace-card onboarding-next-card onboarding-finish-card">
        <header className="onboarding-card-header"><div><span className="eyebrow">READY</span><h2>{m.finishTitle}</h2></div><ShieldCheck size={20} aria-hidden /></header>
        <p>{m.finishBody}</p>
        {!rootReady ? <p className="onboarding-finish-hint">请先完成第 1 步；Skill 和 Provider 可以跳过。</p> : null}
        <div className="onboarding-next-actions"><button type="button" className="primary-button" data-motion="action" disabled={!canFinish || busy !== null} onClick={() => void finish()}>{busy === "state" ? "正在保存…" : m.finish}<ArrowRight size={14} /></button></div>
      </section>
    </div>
  );
}

function StepMark({ status, number }: { status: "pending" | "complete" | "skipped"; number: string }) {
  return <span className={`onboarding-check ${status === "complete" ? "ready" : status === "skipped" ? "skipped" : "pending"}`}>{status === "complete" ? <Check size={14} /> : number}</span>;
}

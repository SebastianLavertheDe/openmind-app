import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Check, FolderCog, Settings, ShieldCheck, Wrench } from "lucide-react";
import type { AppBootstrap, MymindRootStatus } from "@shared/contracts";
import { messages } from "@shared/messages";
import type { Navigate } from "../../app/routes";
import { StatusBadge } from "../../design-system/components";
import { useAi } from "../../ai-context";
import { mymindRootPreviewBody, mymindRootPreviewError } from "../../mymind-root-selection";

const m = messages.onboarding;

type Props = {
  bootstrap: AppBootstrap;
  go: Navigate;
  onRefresh(): void;
};

export function OnboardingPage({ bootstrap, go, onRefresh }: Props) {
  const ai = useAi();
  const [root, setRoot] = useState<MymindRootStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"root" | "workspace" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.cctools.getMymindRoot().then((value) => {
      if (!cancelled) setRoot(value);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

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
      const next = await window.cctools.getMymindRoot();
      setRoot(next);
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m.selectFailed);
    } finally {
      setBusy(null);
    }
  };

  const chooseWorkspace = async () => {
    if (!window.cctools.selectWorkspaceRoot) return;
    setBusy("workspace");
    setError(null);
    try {
      const selected = await window.cctools.selectWorkspaceRoot();
      if (!selected) return;
      const next = await window.cctools.getMymindRoot();
      setRoot(next);
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工作区选择失败");
    } finally {
      setBusy(null);
    }
  };

  const rootReady = Boolean(root?.health.configured && root.health.accessible && root.health.readable && root.health.writable);
  const workspaceReady = Boolean(root?.workspaceRoot || bootstrap.workspaceRoot);

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

      <section className="onboarding-grid">
        <section className="workspace-card onboarding-card onboarding-root-card">
          <header className="onboarding-card-header"><div><span className="eyebrow">MYMIND ROOT</span><h2>{m.rootTitle}</h2></div><span className={`onboarding-check ${rootReady ? "ready" : "pending"}`}>{rootReady ? <Check size={14} /> : "1"}</span></header>
          <p>{m.rootBody}</p>
          <div className="onboarding-path">{loading ? "正在检查根目录…" : root?.mymindRoot || m.rootMissing}</div>
          <div className="onboarding-card-actions"><button type="button" className="primary-button" data-motion="action" disabled={busy !== null} onClick={() => void chooseRoot()}><FolderCog size={14} />{busy === "root" ? m.selecting : rootReady ? m.chooseAgain : m.chooseRoot}</button>{rootReady ? <span className="onboarding-inline-status"><Check size={13} />{m.rootSelected}</span> : null}</div>
        </section>

        <section className="workspace-card onboarding-card">
          <header className="onboarding-card-header"><div><span className="eyebrow">OPTIONAL WORKSPACE</span><h2>{m.workspaceTitle}</h2></div><span className={`onboarding-check ${workspaceReady ? "ready" : "pending"}`}>{workspaceReady ? <Check size={14} /> : "2"}</span></header>
          <p>{m.workspaceBody}</p>
          <div className="onboarding-path">{workspaceReady ? (root?.workspaceRoot || bootstrap.workspaceRoot) : m.workspaceSkipped}</div>
          <div className="onboarding-card-actions"><button type="button" className="settings-subtle-action" data-motion="action" disabled={busy !== null || !window.cctools.selectWorkspaceRoot} onClick={() => void chooseWorkspace()}><FolderCog size={14} />{busy === "workspace" ? m.selecting : m.chooseWorkspace}</button></div>
        </section>

        <section className="workspace-card onboarding-card onboarding-next-card">
          <header className="onboarding-card-header"><div><span className="eyebrow">NEXT STEPS</span><h2>{m.nextTitle}</h2></div><span className="onboarding-check pending">3</span></header>
          <p>{m.nextBody}</p>
          <div className="onboarding-next-actions"><button type="button" className="primary-button" data-motion="action" onClick={() => go("skills")}><ShieldCheck size={14} />{m.openSkills}<ArrowRight size={14} /></button><button type="button" className="settings-subtle-action" data-motion="action" onClick={() => go("diagnostics")}><Wrench size={14} />{m.openDiagnostics}</button><button type="button" className="settings-subtle-action" data-motion="action" onClick={() => go("settings")}><Settings size={14} />{m.openSettings}</button><button type="button" className="onboarding-text-action" data-motion="action" onClick={() => go("ai")} disabled={!rootReady}>{m.continueApp}</button></div>
        </section>
      </section>
    </div>
  );
}

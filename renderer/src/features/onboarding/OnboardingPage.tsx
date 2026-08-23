import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, Folder, FolderCog, LockKeyhole, PackageCheck, Settings } from "lucide-react";
import type { AppBootstrap, OpenmindRootStatus, OnboardingState } from "@shared/contracts";
import { messages } from "@shared/messages";
import { OPENMIND_SKILLS_REPO_URL } from "@shared/skill-package-sources";
import type { Navigate } from "../../app/routes";
import { useAi } from "../../ai-context";
import { openmindRootPreviewBody, openmindRootPreviewError } from "../../openmind-root-selection";

const m = messages.onboarding;
const DEFAULT_ONBOARDING: OnboardingState = { completed: false, skill: "pending", provider: "pending" };

type Props = {
  bootstrap: AppBootstrap;
  go: Navigate;
  onRefresh(): Promise<AppBootstrap>;
};

export function OnboardingPage({ bootstrap, go, onRefresh }: Props) {
  const ai = useAi();
  const [root, setRoot] = useState<OpenmindRootStatus | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingState>(DEFAULT_ONBOARDING);
  const [skillsRepoReady, setSkillsRepoReady] = useState(bootstrap.skillsInstalled);
  const [configuredProvider, setConfiguredProvider] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"root" | "state" | "skills" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextRoot, nextState, providers, nextBootstrap] = await Promise.all([
        window.openmind.getOpenmindRoot(),
        window.openmind.getOnboardingState?.() || Promise.resolve(DEFAULT_ONBOARDING),
        window.openmind.getProviders?.() || Promise.resolve(null),
        onRefresh()
      ]);
      setRoot(nextRoot);
      setOnboarding(nextState);
      setSkillsRepoReady(nextBootstrap.validRepo && nextBootstrap.skillsInstalled);
      setConfiguredProvider(Boolean(providers?.providers.some((provider) => provider.enabled && provider.apiKeySet)));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [onRefresh]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    setSkillsRepoReady(bootstrap.validRepo && bootstrap.skillsInstalled);
  }, [bootstrap.validRepo, bootstrap.skillsInstalled]);

  const chooseRoot = async () => {
    setBusy("root");
    setError(null);
    try {
      const selected = await window.openmind.selectOpenmindRoot();
      if (!selected) return;
      const preview = await window.openmind.previewOpenmindRoot(selected);
      if (!preview.canBind) throw new Error(openmindRootPreviewError(preview));
      if (!await ai.confirm({ title: "确认绑定 OpenMind 私人数据仓库", body: openmindRootPreviewBody(preview), confirmText: "确认绑定" })) return;
      await window.openmind.setOpenmindRoot(selected);
      await refresh();
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
      const next = await window.openmind.updateOnboardingState?.(patch) || { ...onboarding, ...patch } as OnboardingState;
      setOnboarding(next);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const installSkillsRepo = async () => {
    setBusy("skills");
    setError(null);
    try {
      if (!window.openmind.installSkillSource) throw new Error("当前构建不支持在线安装 RSS 采集组件。");
      await window.openmind.installSkillSource({ type: "git", locator: OPENMIND_SKILLS_REPO_URL });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "RSS 采集组件安装失败，请检查网络后重试。");
    } finally {
      setBusy(null);
    }
  };

  const rootReady = Boolean(bootstrap.validRepo || (root?.health.configured && root.health.accessible && root.health.readable && root.health.writable));
  const providerReady = Boolean(configuredProvider || ai.snapshot.providers.some((provider) => provider.available));
  const providerStatus = providerReady ? "complete" : onboarding.provider;
  const canFinish = rootReady && skillsRepoReady && providerStatus !== "pending";
  const availableStep: 1 | 2 | 3 | 4 = !rootReady ? 1 : !skillsRepoReady ? 2 : providerStatus === "pending" ? 3 : 4;
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(availableStep);
  const previousAvailableStep = useRef(availableStep);
  const mountedStep = useRef(currentStep).current;
  const rootPath = loading ? "正在检查数据仓库…" : rootReady ? bootstrap.repoRoot : m.rootMissing;
  const providerState = providerReady ? m.providerReady : m.providerPending;
  const currentTitle = [m.rootTitle, m.skillTitle, m.providerTitle, m.finishTitle][currentStep - 1];

  useEffect(() => {
    const previous = previousAvailableStep.current;
    setCurrentStep((step) => {
      if (availableStep < step) return availableStep;
      if (availableStep > previous && step === previous) return availableStep;
      return step;
    });
    previousAvailableStep.current = availableStep;
  }, [availableStep]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`onboarding-step-${currentStep}-title`)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentStep]);

  const finish = async () => {
    if (!canFinish) return;
    if (!await updateStep({ completed: true })) return;
    await onRefresh();
    go("ai");
  };

  return (
    <div className="feature-page onboarding-page" data-onboarding-current-step={currentStep} data-onboarding-mounted-step={mountedStep}>
      <header className="onboarding-topbar">
        <div className="onboarding-topbar-start">
          <strong className="onboarding-brand">openmind</strong>
          {currentStep > 1 ? (
            <button type="button" className="onboarding-step-navigation" data-motion="action" disabled={busy !== null} onClick={() => setCurrentStep((currentStep - 1) as 1 | 2 | 3)}>
              <ArrowLeft size={15} aria-hidden />{m.previousStep}
            </button>
          ) : null}
        </div>
        {currentStep < availableStep ? (
          <button type="button" className="onboarding-step-navigation onboarding-step-navigation-next" data-motion="action" disabled={busy !== null} onClick={() => setCurrentStep((currentStep + 1) as 2 | 3 | 4)}>
            {m.nextStep}<ArrowRight size={15} aria-hidden />
          </button>
        ) : null}
        <span className="onboarding-step-count" aria-label={m.progress(currentStep, 4)}>{currentStep} / 4</span>
      </header>

      <div className="onboarding-body">
        {error ? <p className="onboarding-error" role="alert">{error}</p> : null}
        <p className="ui-visually-hidden" aria-live="polite">{m.progress(currentStep, 4)}：{currentTitle}</p>

        <section className="onboarding-step-viewport" aria-label={m.progressLabel}>
          <div className="onboarding-step-track" data-current-step={currentStep}>
            <OnboardingPanel active={currentStep === 1} number="01" step="1" title={m.rootTitle}>
              <p className="onboarding-step-description">{m.rootBody}</p>
              <output className="onboarding-path" aria-label={m.rootPathLabel}>
                <span title={rootPath}>{rootPath}</span>
                <Folder size={20} aria-hidden />
              </output>
              <div className="onboarding-actions">
                <button type="button" className="primary-button onboarding-primary-action" data-motion="action" disabled={busy !== null} onClick={() => void chooseRoot()}>
                  <FolderCog size={16} aria-hidden />
                  {busy === "root" ? m.selecting : rootReady ? m.chooseAgain : m.chooseRoot}
                </button>
              </div>
              <p className="onboarding-safety"><LockKeyhole size={14} aria-hidden />{m.rootSafety}</p>
            </OnboardingPanel>

            <OnboardingPanel active={currentStep === 2} number="02" step="2" title={m.skillTitle}>
              <p className="onboarding-step-description">{m.skillBody}</p>
              <output className="onboarding-path" aria-label={m.skillSourceLabel}>
                <span title={OPENMIND_SKILLS_REPO_URL}>{loading ? "正在检查 RSS 采集组件…" : OPENMIND_SKILLS_REPO_URL}</span>
                <PackageCheck size={20} aria-hidden />
              </output>
              <div className="onboarding-actions">
                {skillsRepoReady
                  ? <span className="onboarding-inline-status"><Check size={14} aria-hidden />{m.skillReady}</span>
                  : <button type="button" className="primary-button onboarding-primary-action" data-motion="action" disabled={busy !== null || !rootReady} onClick={() => void installSkillsRepo()}>
                      <Download size={16} aria-hidden />
                      {busy === "skills" ? m.installingSkillsRepo : m.installSkillsRepo}
                    </button>}
              </div>
              <p className="onboarding-safety"><LockKeyhole size={14} aria-hidden />{m.skillSafety}</p>
            </OnboardingPanel>

            <OnboardingPanel active={currentStep === 3} number="03" step="3" title={m.providerTitle}>
              <p className="onboarding-step-description">{m.providerBody}</p>
              <output className="onboarding-path" aria-label={m.providerStatusLabel}>
                <span title={providerState}>{providerState}</span>
                <Settings size={20} aria-hidden />
              </output>
              <div className="onboarding-actions">
                <button type="button" className="primary-button onboarding-primary-action" data-motion="action" disabled={busy !== null} onClick={() => go("settings", { settingsSection: "providers" })}>
                  <Settings size={16} aria-hidden />{m.installProvider}<ArrowRight size={14} aria-hidden />
                </button>
                {providerStatus === "pending" ? <button type="button" className="onboarding-text-action" data-motion="action" disabled={busy !== null} onClick={() => void updateStep({ provider: "skipped" })}>{m.skipProvider}</button> : null}
              </div>
              <p className="onboarding-safety"><LockKeyhole size={14} aria-hidden />{m.providerSafety}</p>
            </OnboardingPanel>

            <OnboardingPanel active={currentStep === 4} number="04" step="4" title={m.finishTitle}>
              <p className="onboarding-step-description">{m.finishBody}</p>
              <div className="onboarding-ready-summary" aria-label={m.finishSummaryLabel}>
                <span><Check size={15} aria-hidden />{m.rootSelected}</span>
                <span><Check size={15} aria-hidden />{m.skillReady}</span>
                <span className={providerStatus === "skipped" ? "optional" : undefined}>{providerStatus === "skipped" ? m.providerSkipped : m.providerReady}</span>
              </div>
              <div className="onboarding-actions">
                <button type="button" className="primary-button onboarding-primary-action" data-motion="action" disabled={!canFinish || busy !== null} onClick={() => void finish()}>
                  {busy === "state" ? "正在保存…" : m.finish}<ArrowRight size={15} aria-hidden />
                </button>
              </div>
              <p className="onboarding-safety"><LockKeyhole size={14} aria-hidden />{m.finishSafety}</p>
            </OnboardingPanel>
          </div>
        </section>

        <div className="onboarding-segments" role="progressbar" aria-label={m.progressLabel} aria-valuemin={1} aria-valuemax={4} aria-valuenow={currentStep} aria-valuetext={m.progress(currentStep, 4)}>
          {[1, 2, 3, 4].map((step) => <span key={step} className={step <= currentStep ? "active" : undefined} />)}
        </div>
      </div>
    </div>
  );
}

function OnboardingPanel({ active, number, step, title, children }: { active: boolean; number: string; step: string; title: string; children: React.ReactNode }) {
  const headingId = `onboarding-step-${step}-title`;
  return (
    <div className="onboarding-step-panel" data-onboarding-step={step} aria-hidden={!active} inert={!active} aria-labelledby={headingId}>
      <div className="onboarding-step-inner">
        <span className="onboarding-step-number" aria-hidden>{number}</span>
        <section className="onboarding-step-content">
          <h2 id={headingId} tabIndex={-1}>{title}</h2>
          {children}
        </section>
      </div>
    </div>
  );
}

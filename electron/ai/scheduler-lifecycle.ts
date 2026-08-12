import type { AiSession } from "../../shared/contracts";
import type { ProviderKind } from "../../shared/model-catalog";
import type { ProviderAdapter } from "./providers/types";
import type { ProviderRegistry } from "./provider-registry";
import { resolveCwd } from "./scheduler-paths";
import type { SessionStore } from "./session-store";
import type { BrowserAutomationConfig } from "./browser-evidence";
import { resolveCliProvider } from "../config/providers-yaml";

export async function prewarmProviderSession(input: {
  projectRoot: string;
  store: SessionStore;
  registry: ProviderRegistry;
  adapter: ProviderAdapter;
  provider: ProviderKind;
  resolveProviderModel(kind: ProviderKind): string;
  browserAutomation: BrowserAutomationConfig;
}, sessionId?: string): Promise<boolean> {
  if (!input.adapter?.prewarm) return false;
  let session: AiSession | null = null;
  let providerId: string | null = null;
  let cwd = input.projectRoot;
  let permissionProfile: AiSession["permissionProfile"] = "edit";
  let interactionMode: AiSession["interactionMode"] = "default";
  let providerSessionId: string | null = null;
  if (sessionId) {
    session = input.store.getSession(sessionId);
    if (session.provider !== input.provider) return false;
    if (input.store.listRuns(session.id).some((run) => ["queued", "running", "waiting-approval", "applying"].includes(run.status))) return false;
    providerId = session.providerId;
    cwd = resolveCwd(input.projectRoot, session.cwd);
    permissionProfile = session.permissionProfile;
    interactionMode = session.interactionMode;
    providerSessionId = session.providerSessionId;
  }
  const pinnedManagedProvider = session?.serviceProviderId
    ? resolveCliProvider(session.provider, session.serviceProviderId, session.serviceProviderRevision ?? null)
    : null;
  const provider = input.registry.detect().find((item) => (
    item.provider === input.provider
    && (item.available || Boolean(pinnedManagedProvider && item.version))
    && (!providerId || item.id === providerId)
  ));
  if (!provider) return false;
  return input.adapter.prewarm({
    session,
    provider,
    cwd,
    permissionProfile,
    interactionMode,
    providerSessionId,
    providerModel: input.resolveProviderModel(input.provider),
    browserAutomation: input.browserAutomation,
    images: []
  });
}

export function updateSessionStatus(store: SessionStore, sessionId: string): void {
  const runs = store.listRuns(sessionId);
  const status = runs.some((run) => run.status === "waiting-approval")
    ? "waiting-approval"
    : runs.some((run) => run.status === "queued" || run.status === "running" || run.status === "applying")
      ? "running"
      : runs[0]?.status === "failed" ? "failed" : "idle";
  store.updateSession(sessionId, { status });
}

export function recoverInterruptedRuns(store: SessionStore): void {
  for (const run of store.listRuns()) {
    if (!["queued", "running", "waiting-approval", "applying"].includes(run.status)) continue;
    const interrupted = store.updateRun(run.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: "应用在运行期间退出；该运行已标记为中断。"
    });
    void store.abortTurn(interrupted, interrupted.error);
    store.updateSession(run.sessionId, { status: "failed" });
  }
}

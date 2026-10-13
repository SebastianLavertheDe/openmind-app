import { Profiler, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import type { AiSession, AiSnapshot, DesktopApi } from "@shared/contracts";
import { AiProvider, useAiUi } from "../../../renderer/src/ai-context";
import { FeedbackHost } from "../../../renderer/src/components/FeedbackHost";
import { SidebarRecent } from "../../../renderer/src/app/SidebarRecent";
import "../../../renderer/src/styles/index.css";

const snapshot: AiSnapshot = {
  projectRoot: "/fixtures/motion", providers: [], runs: [], pendingApprovals: [],
  sessions: Array.from({ length: 40 }, (_, i): AiSession => ({
    schemaVersion: 1, id: `session-${i}`, projectId: "fixture", scope: { type: "workspace" },
    projectRoot: "/fixtures/motion", provider: "codex", providerId: "fixture", providerSessionId: null,
    cwd: "/fixtures/motion", title: `合成任务 ${i}`, permissionProfile: "edit", status: "idle",
    pinned: false, archived: false, createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z", lastRunId: null
  }))
};
window.openmind = { onAiEvent: () => () => {} } as unknown as DesktopApi;
const probe = { commits: [] as Array<{ scene: string; time: number; duration: number }> };
let sequence = 0;
function Fixture() {
  const ui = useAiUi();
  useLayoutEffect(() => {
    Object.assign(window, { feedbackMotion: {
      probe, add: (count: number) => {
        for (let i = 0; i < count; i++) ui.notify(`合成通知 ${++sequence}`, "info", { durationMs: 60000 });
      },
      clear: () => ui.toasts.forEach(toast => ui.dismissToast(toast.id)),
      dismiss: (index: number) => ui.dismissToast(ui.toasts[index].id)
    } });
  }, [ui]);
  return <div data-fixture-shell style={{ padding: 24 }}>
    <Profiler id="feedback" onRender={(id, _phase, duration) => probe.commits.push({ scene: id, time: performance.now(), duration })}>
      <div className="app-nav" style={{ position: "relative", width: 240, height: "auto" }}><nav>
        <SidebarRecent activeSessionId={null} onOpen={() => {}} />
        <button data-fixture-neighbour>下方操作</button>
      </nav></div>
      <FeedbackHost />
    </Profiler>
  </div>;
}
createRoot(document.getElementById("root")!).render(<AiProvider initial={snapshot}><Fixture /></AiProvider>);

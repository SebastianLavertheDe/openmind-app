import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, AppBootstrap } from "@shared/contracts";
import { renderActiveRoute, type RouteRenderProps } from "./route-registry";

const snapshot: AiSnapshot = { projectRoot: "", providers: [], sessions: [], runs: [], pendingApprovals: [] };
const baseBootstrap: AppBootstrap = { repoRoot: "", mymindRoot: "/m/mymind", workspaceRoot: "", validRepo: true, skillsInstalled: true, runtime: "test", environment: { mode: "desktop", platform: "linux" }, overview: {} as AppBootstrap["overview"], skills: [], ai: snapshot };

function props(bootstrap: AppBootstrap): RouteRenderProps {
  return {
    route: { page: "ai", state: {}, nonce: 0 },
    bootstrap,
    navigate: vi.fn(),
    providers: [],
    aiFilePreviewPath: null,
    onAiFilePreviewPathChange: () => undefined,
    onRepo: () => undefined,
    onExitSettings: () => undefined
  };
}

afterEach(() => cleanup());

describe("renderActiveRoute repo gate", () => {
  it("renders the route when validRepo and skillsInstalled are both true", () => {
    const container = render(<>{renderActiveRoute(props(baseBootstrap))}</>).container;
    expect(container.querySelector(".route-loading")).toBeNull();
  });

  it("redirects to onboarding when the mymind root is not bound", async () => {
    const p = props({ ...baseBootstrap, validRepo: false });
    render(<>{renderActiveRoute(p)}</>);
    expect(screen.getByRole("status")).toBeTruthy();
    await waitFor(() => expect(p.navigate).toHaveBeenCalledWith("onboarding"));
  });

  it("redirects to onboarding when the official skills repo is not installed", async () => {
    const p = props({ ...baseBootstrap, skillsInstalled: false });
    render(<>{renderActiveRoute(p)}</>);
    await waitFor(() => expect(p.navigate).toHaveBeenCalledWith("onboarding"));
  });
});

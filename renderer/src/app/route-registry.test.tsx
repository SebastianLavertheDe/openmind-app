import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, AppBootstrap } from "@shared/contracts";
import { renderActiveRoute, ROUTE_DEFINITIONS, type RouteRenderProps } from "./route-registry";

const snapshot: AiSnapshot = { projectRoot: "", providers: [], sessions: [], runs: [], pendingApprovals: [] };
const baseBootstrap: AppBootstrap = { repoRoot: "", openmindRoot: "/m/openmind", workspaceRoot: "", validRepo: true, skillsInstalled: true, runtime: "test", environment: { mode: "desktop", platform: "linux" }, overview: {} as AppBootstrap["overview"], skills: [], ai: snapshot };

function props(bootstrap: AppBootstrap): RouteRenderProps {
  return {
    route: { page: "ai", state: {}, nonce: 0 },
    bootstrap,
    navigate: vi.fn(),
    providers: [],
    aiFilePreviewPath: null,
    onAiFilePreviewPathChange: () => undefined,
    onRepo: async () => bootstrap,
    onExitSettings: () => undefined
  };
}

afterEach(() => cleanup());

describe("renderActiveRoute repo gate", () => {
  it("renders the route when validRepo and skillsInstalled are both true", () => {
    const container = render(<>{renderActiveRoute(props(baseBootstrap))}</>).container;
    expect(container.querySelector(".route-loading")).toBeNull();
  });

  it("redirects to onboarding when the openmind root is not bound", async () => {
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

  it("does not forward the AI conversation catalog into the Automation route", () => {
    const p = props({
      ...baseBootstrap,
      skills: [{ id: "conversation-agent" } as AppBootstrap["skills"][number]]
    });
    p.route = { page: "automation", state: { skillId: "daily-summary" }, nonce: 3 };
    const automationRoute = ROUTE_DEFINITIONS.find((entry) => entry.page === "automation");

    const element = automationRoute?.render(p) as ReactElement<Record<string, unknown>>;

    expect(element.props).not.toHaveProperty("skills");
    expect(element.props).toMatchObject({ initialSkillId: "daily-summary", go: p.navigate });
  });
});

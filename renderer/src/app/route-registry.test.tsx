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
    embeddedFilePreviewPath: null,
    onCloseEmbeddedFilePreview: () => undefined,
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

  it("renders without redirecting when the official skills repo is not installed", () => {
    const p = props({ ...baseBootstrap, skillsInstalled: false });
    render(<>{renderActiveRoute(p)}</>);
    expect(p.navigate).not.toHaveBeenCalled();
    expect(document.querySelector(".route-loading")).toBeNull();
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
    expect(element.props).toMatchObject({ initialSkillId: "daily-summary" });
    expect(element.props).not.toHaveProperty("go");
  });

  it("routes projects to the independent Project workspace with deep-link state", () => {
    const p = props(baseBootstrap);
    p.route = { page: "projects", state: { projectName: "AI 安全", projectSection: "materials", projectItem: "materials/web/a.web.md" }, nonce: 4 };
    const projectsRoute = ROUTE_DEFINITIONS.find((entry) => entry.page === "projects");
    const element = projectsRoute?.render(p) as ReactElement<Record<string, unknown>>;

    expect(projectsRoute?.nav?.label).toBe("项目");
    expect(element.props).toMatchObject({ initialProjectName: "AI 安全", initialSection: "materials", initialItem: "materials/web/a.web.md" });
    expect(element.props).not.toHaveProperty("initialProjectDir");
  });
});

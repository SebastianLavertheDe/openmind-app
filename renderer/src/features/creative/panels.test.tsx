import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, CreativeTopic, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { TopicWorkspace } from "./panels";

const snapshot: AiSnapshot = { projectRoot: "/r", providers: [], sessions: [], runs: [], pendingApprovals: [] };

function installApi(overrides: Partial<DesktopApi> = {}) {
  window.openmind = {
    aiRefresh: async () => snapshot,
    aiGetEvents: async () => [],
    aiCancelRun: async () => true,
    aiResolveApproval: async () => true,
    runSkill: vi.fn(async () => true),
    selectFiles: async () => [],
    selectOpenmindFiles: async () => [],
    searchOpenmindFiles: async () => ({ items: [], indexedCount: 0, truncated: false }),
    openPath: vi.fn(async (p: string) => p),
    revealPath: async () => true,
    onAiEvent: () => () => {},
    ...overrides
  } as unknown as DesktopApi;
}

beforeEach(() => installApi());
afterEach(() => window.localStorage.clear());

const topic: CreativeTopic = {
  id: "t1", title: "AI 工作台设计", platform: "公众号", section: "today_pick", score: 9,
  body: "# 推荐理由\n\n这是一个好选题。", starred: false, ignored: false, projectDir: null
} as CreativeTopic;


describe("TopicWorkspace", () => {
  it("renders the topic title, score, and body markdown", () => {
    render(<AiProvider initial={snapshot}><TopicWorkspace topic={topic} date="20260616" createProject={vi.fn()} addContext={vi.fn()} /></AiProvider>);
    expect(screen.getByText("AI 工作台设计")).toBeTruthy();
    expect(screen.getAllByText(/推荐理由/).length).toBeGreaterThan(0);
  });

  it("reveals the platform picker and calls createProject on selection", async () => {
    const user = userEvent.setup();
    const createProject = vi.fn();
    render(<AiProvider initial={snapshot}><TopicWorkspace topic={topic} date="20260616" createProject={createProject} addContext={vi.fn()} /></AiProvider>);
    await user.click(screen.getByRole("button", { name: /起草|创建草稿/i }));
    // platform grid now visible — pick the generic draft
    await user.click(screen.getByRole("button", { name: /通用草稿|generic/i }));
    expect(createProject).toHaveBeenCalled();
  });

  it("shows an existing-draft notice when topic.projectDir is set", () => {
    render(<AiProvider initial={snapshot}><TopicWorkspace topic={{ ...topic, projectDir: "openmind/creative/x" }} date="20260616" createProject={vi.fn()} addContext={vi.fn()} /></AiProvider>);
    expect(screen.getByText(/已有草稿|has draft/i)).toBeTruthy();
  });

  it("renders the selected draft command as busy and disables duplicate choices", async () => {
    const user = userEvent.setup();
    const createProject = vi.fn();
    const addContext = vi.fn();
    const { rerender } = render(<AiProvider initial={snapshot}><TopicWorkspace topic={topic} date="20260616" createProject={createProject} addContext={addContext} /></AiProvider>);
    await user.click(screen.getByRole("button", { name: /创建草稿/ }));
    rerender(<AiProvider initial={snapshot}><TopicWorkspace topic={topic} date="20260616" createProject={createProject} addContext={addContext} creatingKey="generic" /></AiProvider>);

    const busyButton = screen.getByRole("button", { name: /正在创建/ }) as HTMLButtonElement;
    expect(busyButton.disabled).toBe(true);
    expect(busyButton.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: /创建草稿/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

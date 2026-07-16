import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, SkillDefinition, SourceRun } from "@shared/contracts";
import { messages } from "@shared/messages";
import { AutomationPage } from "./AutomationPage";

const skills: SkillDefinition[] = [
  {
    id: "rss-article-saver",
    title: "RSS 文章抓取",
    description: "拉取订阅并保存文章。",
    cwd: ".claude/skills/rss-article-saver",
    command: "uv",
    runner: "uv",
    args: ["run", "--env-file", ".env", "python", "main.py"],
    envFile: ".env",
    group: "采集",
    permission: "edit",
    outputArtifacts: ["mymind/article/${date}/"],
    timeoutMs: 7200000
  },
  {
    id: "daily-article-summarizer",
    title: "每日文章总结",
    description: "总结当天文章。",
    cwd: ".claude/skills/daily-article-summarizer",
    command: "uv",
    runner: "uv",
    args: ["run", "python", "main.py"],
    envFile: null,
    group: "分析",
    permission: "edit",
    outputArtifacts: [],
    timeoutMs: 3600000
  },
  {
    id: "daily-topic-selector",
    title: "每日选题",
    description: "为新增资料归类并生成候选选题。",
    cwd: ".",
    command: "python",
    runner: "python",
    args: [".claude/skills/daily-topic-selector/scripts/generate_daily_topics.py"],
    envFile: null,
    group: "创作",
    permission: "edit",
    outputArtifacts: [],
    timeoutMs: 1800000
  }
];

const runs: SourceRun[] = [
  { schemaVersion: 1, id: "r1", sourceId: "daily", skillId: "daily-article-summarizer", status: "success", startedAt: "2026-06-15T08:00:00.000Z", completedAt: "2026-06-15T08:01:00.000Z", durationMs: 60000, code: 0, error: null, itemCount: 5, logs: [{ timestamp: "2026-06-15T08:01:00.000Z", stream: "stdout", text: "生成完成" }] },
  { schemaVersion: 1, id: "r2", sourceId: "rss", skillId: "rss-article-saver", status: "failed", startedAt: "2026-06-14T08:00:00.000Z", completedAt: "2026-06-14T08:00:30.000Z", durationMs: 30000, code: 1, error: "boom", itemCount: 0, logs: [] }
];

function makeApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    listSourceRuns: async () => runs,
    runSkill: async () => true,
    stopSkill: async () => true,
    onSkillEvent: () => () => undefined,
    ...overrides
  } as unknown as DesktopApi;
}

beforeEach(() => {
  window.cctools = makeApi();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => cleanup());

describe("AutomationPage", () => {
  it("shows the three mockup rules and no removed rules", async () => {
    const { container } = render(<AutomationPage skills={skills} go={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("3 条规则")).toBeTruthy());

    expect(container.querySelector(".automation-page-transition")).toBeTruthy();
    expect(screen.getByRole("button", { name: /每日简报生成/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /新资料自动归类/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /RSS 定时抓取/ })).toBeTruthy();
    expect(screen.queryByText(/失效源告警/)).toBeNull();
    expect(screen.queryByText(/草稿自动备份/)).toBeNull();
    expect(container.querySelectorAll(".rule-item button").length).toBe(0);
  });

  it("toggles a rule with SwitchButton and disables running when off", async () => {
    render(<AutomationPage skills={skills} go={vi.fn()} />);
    const toggle = await screen.findByRole("switch", { name: "启用 每日简报生成" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect((screen.getByRole("button", { name: /立即运行/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("runs the selected automation rule with a compact date", async () => {
    const runSkill = vi.fn().mockResolvedValue(true);
    window.cctools = makeApi({ runSkill });
    render(<AutomationPage skills={skills} go={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /立即运行/ }));
    expect(runSkill).toHaveBeenCalledWith("daily-article-summarizer", expect.stringMatching(/^\d{8}$/));

    fireEvent.click(screen.getByRole("button", { name: /RSS 定时抓取/ }));
    fireEvent.click(screen.getByRole("button", { name: /立即运行/ }));
    expect(runSkill).toHaveBeenCalledWith("rss-article-saver", expect.stringMatching(/^\d{8}$/));
  });

  it("remounts the detail pane so rule changes replay the transition", async () => {
    const { container } = render(<AutomationPage skills={skills} go={vi.fn()} />);
    await screen.findByText("每日简报生成", { selector: ".rule-detail h1" });
    const previousPane = container.querySelector(".automation-detail-transition");

    fireEvent.click(screen.getByRole("button", { name: /RSS 定时抓取/ }));

    expect(await screen.findByText("RSS 定时抓取", { selector: ".rule-detail h1" })).toBeTruthy();
    const nextPane = container.querySelector(".automation-detail-transition");
    expect(nextPane).not.toBe(previousPane);
  });

  it("copies the console output for the active rule", async () => {
    window.cctools = makeApi({
      onSkillEvent: (cb) => {
        cb({ skillId: "daily-article-summarizer", text: "生成完成", state: "running" });
        return () => undefined;
      }
    });
    render(<AutomationPage skills={skills} go={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: messages.common.copy }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("生成完成"));
  });
});

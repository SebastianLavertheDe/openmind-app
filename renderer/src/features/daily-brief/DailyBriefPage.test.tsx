import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { DailyBriefPage } from "./DailyBriefPage";

const snapshot = { projectRoot: "/repo", providers: [], sessions: [], runs: [], pendingApprovals: [] };
const path = "mymind/daily-summary/20260630_daily_summary.md";

function makeApi(writeContent = vi.fn(async (_path: string, content: string) => ({ path, name: "20260630_daily_summary.md", content, truncated: false }))): DesktopApi {
  return {
    listContent: async () => [{ path, name: "20260630_daily_summary.md", size: 1280, modifiedAt: "2026-06-30T22:10:03.000Z" }],
    readContent: async () => ({ path, name: "20260630_daily_summary.md", content: "# 每日简报\n\n值得关注的内容。", truncated: false }),
    writeContent,
    onSkillEvent: () => () => undefined,
    openPath: async () => true,
    aiRefresh: async () => snapshot,
    onAiEvent: () => () => undefined
  } as unknown as DesktopApi;
}

beforeEach(() => { window.cctools = makeApi(); });
afterEach(() => cleanup());

describe("DailyBriefPage", () => {
  it("lists brief files, previews by default, and saves edits", async () => {
    const writeContent = vi.fn(async (_path: string, content: string) => ({ path, name: "20260630_daily_summary.md", content, truncated: false }));
    const api = makeApi(writeContent);
    const listContent = vi.fn(api.listContent);
    window.cctools = { ...api, listContent };
    render(<AiProvider initial={snapshot}><DailyBriefPage go={vi.fn()} initialDate="20260630" /></AiProvider>);

    await waitFor(() => expect(listContent).toHaveBeenCalledWith("summaries", ""));
    expect((await screen.findAllByText("2026-06-30 每日简报")).length).toBeGreaterThan(0);
    expect(await screen.findByRole("heading", { name: "每日简报" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    const editor = screen.getByRole("textbox", { name: "编辑每日简报" });
    fireEvent.change(editor, { target: { value: "# 修改后的简报" } });
    fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));

    await waitFor(() => expect(writeContent).toHaveBeenCalledWith(path, "# 修改后的简报"));
    expect(screen.getByRole("button", { name: /预览/ }).className).toContain("active");
  });
});

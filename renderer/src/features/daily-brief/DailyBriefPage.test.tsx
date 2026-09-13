import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { ChatComposer } from "../ai-console/composer";
import { DailyBriefPage } from "./DailyBriefPage";

const snapshot = { projectRoot: "/repo", providers: [], sessions: [], runs: [], pendingApprovals: [] };
const path = "openmind/daily-summary/20260630_daily_summary.md";

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

beforeEach(() => { window.openmind = makeApi(); });
afterEach(() => cleanup());

describe("DailyBriefPage", () => {
  it("gives the brief search field an explicit accessible name", async () => {
    render(<AiProvider initial={snapshot}><DailyBriefPage /></AiProvider>);

    expect(await screen.findByRole("textbox", { name: "搜索简报文件" })).toBeTruthy();
  });

  it("lists brief files, previews by default, and saves edits", async () => {
    const writeContent = vi.fn(async (_path: string, content: string) => ({ path, name: "20260630_daily_summary.md", content, truncated: false }));
    const api = makeApi(writeContent);
    const listContent = vi.fn(api.listContent);
    window.openmind = { ...api, listContent };
    const { container } = render(<AiProvider initial={snapshot}><DailyBriefPage initialDate="20260630" /></AiProvider>);

    await waitFor(() => expect(listContent).toHaveBeenCalledWith("summaries", ""));
    expect(container.querySelector(".brief-library-container > .brief-library-page")).toBeTruthy();
    expect((await screen.findAllByText("2026-06-30 每日简报")).length).toBeGreaterThan(0);
    expect(await screen.findByRole("heading", { name: "每日简报" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    const editor = screen.getByRole("textbox", { name: "编辑每日简报" });
    fireEvent.change(editor, { target: { value: "# 修改后的简报" } });
    fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));

    await waitFor(() => expect(writeContent).toHaveBeenCalledWith(path, "# 修改后的简报"));
    expect(screen.getByRole("button", { name: /预览/ }).className).toContain("active");
  });

  it("provides a compact master-detail return path and exposes the full file label", async () => {
    const { container } = render(<AiProvider initial={snapshot}><DailyBriefPage initialDate="20260630" /></AiProvider>);

    const file = await screen.findByRole("button", { name: /2026-06-30 每日简报/ });
    const page = container.querySelector<HTMLElement>(".brief-library-page")!;
    await waitFor(() => expect(page.getAttribute("data-detail-open")).toBe("true"));
    expect(file.title).toBe("2026-06-30 每日简报");

    fireEvent.click(screen.getByRole("button", { name: "简报文件" }));
    expect(page.hasAttribute("data-detail-open")).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(file));
  });

  it("quotes the full preview selection into the AI composer and focuses the prompt", async () => {
    render(
      <AiProvider initial={snapshot}>
        <DailyBriefPage initialDate="20260630" />
        <ChatComposer />
      </AiProvider>
    );

    const selectedText = await screen.findByText("值得关注的内容。");
    const textNode = selectedText.firstChild;
    expect(textNode).toBeTruthy();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.pointerUp(selectedText);

    const quote = await screen.findByRole("button", { name: "引用到 AI" });
    fireEvent.pointerDown(quote);
    fireEvent.click(quote);

    const label = "引用 · 2026-06-30 每日简报 · 1 行";
    const labelText = await screen.findByText(label);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "AI 消息" })));
    fireEvent.click(labelText.closest("button")!);
    expect(document.querySelector(".context-selection-preview")?.textContent).toBe("值得关注的内容。");
  });
});

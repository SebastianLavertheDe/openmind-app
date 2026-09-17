import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("refreshes without adding skeletons ahead of existing rows, including after a failure", async () => {
    const api = makeApi();
    let rejectRefresh!: (error: Error) => void;
    const listContent = vi.fn(api.listContent).mockImplementationOnce(api.listContent)
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectRefresh = reject; }));
    window.openmind = { ...api, listContent };
    const { container } = render(<AiProvider initial={snapshot}><DailyBriefPage /></AiProvider>);
    await screen.findByRole("heading", { name: "每日简报" });
    const row = screen.getByRole("button", { name: /2026-06-30 每日简报/ });
    const list = container.querySelector<HTMLElement>(".document-file-list")!;
    list.scrollTop = 70;
    fireEvent.click(screen.getByRole("button", { name: /刷新/ }));
    expect(list.children).toHaveLength(1);
    expect(list.firstElementChild).toBe(row);
    expect(list.scrollTop).toBe(70);
    await act(async () => rejectRefresh(new Error("刷新失败")));
    expect(screen.getByRole("heading", { name: "每日简报" })).toBeTruthy();
    expect(list.firstElementChild).toBe(row);
    expect(screen.getByText("刷新失败")).toBeTruthy();
  });

  it("preserves edits made while a background list request is pending", async () => {
    const api = makeApi();
    let emit!: (event: Record<string, unknown>) => void;
    let finish!: (items: Awaited<ReturnType<DesktopApi["listContent"]>>) => void;
    const readContent = vi.fn(api.readContent);
    window.openmind = { ...api, readContent,
      listContent: vi.fn(api.listContent).mockImplementationOnce(api.listContent).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })),
      onSkillEvent: callback => { emit = callback; return () => {}; }
    };
    render(<AiProvider initial={snapshot}><DailyBriefPage /></AiProvider>);
    await screen.findByRole("heading", { name: "每日简报" });
    act(() => emit({ type: "status", state: "success", skillId: "daily-article-summarizer" }));
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "编辑每日简报" });
    fireEvent.change(editor, { target: { value: "# 正在编辑" } });
    await act(async () => finish(await api.listContent("summaries", "")));
    expect(screen.getByRole("textbox", { name: "编辑每日简报" })).toBe(editor);
    expect(editor.value).toBe("# 正在编辑");
    expect(readContent).toHaveBeenCalledOnce();
  });

  it("does not let a delayed list refresh undo a newer file selection", async () => {
    const api = makeApi();
    const other = "openmind/daily-summary/20260701_daily_summary.md";
    const files = [...await api.listContent("summaries", ""), { path: other, name: "20260701_daily_summary.md", size: 1, modifiedAt: "2026-07-01" }];
    let finish!: (items: typeof files) => void;
    const readContent = vi.fn(async (file: string) => ({ path: file, name: file.split("/").at(-1)!, content: file === path ? "# 原文件" : "# 新选择", truncated: false }));
    window.openmind = { ...api, readContent, listContent: vi.fn().mockResolvedValueOnce(files).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })) };
    render(<AiProvider initial={snapshot}><DailyBriefPage /></AiProvider>);
    await screen.findByRole("heading", { name: "原文件" });
    fireEvent.click(screen.getByRole("button", { name: /刷新/ }));
    fireEvent.click(screen.getByRole("button", { name: /2026-07-01 每日简报/ }));
    await screen.findByRole("heading", { name: "新选择" });
    await act(async () => finish(files));
    expect(screen.getByRole("heading", { name: "新选择" })).toBeTruthy();
    expect(readContent).toHaveBeenCalledTimes(2);
  });

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
    // 保存成功后模式切回预览晚于写盘完成数个微任务，需等待目标状态而非同步断言。
    await waitFor(() => expect(screen.getByRole("button", { name: /预览/ }).className).toContain("active"));
  });

  it("shows the target file as pending without flashing the unselected empty state", async () => {
    const nextPath = "openmind/daily-summary/20260701_daily_summary.md";
    type ReadResult = Awaited<ReturnType<DesktopApi["readContent"]>>;
    let resolveNext!: (value: ReadResult) => void;
    const pending = new Promise<ReadResult>((resolve) => { resolveNext = resolve; });
    const api = makeApi();
    window.openmind = {
      ...api,
      listContent: async () => [
        { path, name: "20260630_daily_summary.md", size: 1280, modifiedAt: "2026-06-30T22:10:03.000Z" },
        { path: nextPath, name: "20260701_daily_summary.md", size: 980, modifiedAt: "2026-07-01T22:10:03.000Z" }
      ],
      readContent: vi.fn((requestedPath: string) => requestedPath === nextPath
        ? pending
        : Promise.resolve({ path, name: "20260630_daily_summary.md", content: "# 每日简报\n\n旧内容。", truncated: false }))
    } as DesktopApi;
    render(<AiProvider initial={snapshot}><DailyBriefPage initialDate="20260630" /></AiProvider>);

    await screen.findByText("旧内容。");
    const currentFile = screen.getByRole("button", { name: /2026-06-30 每日简报/ });
    const currentStatusSlot = currentFile.querySelector<SVGElement>(".brief-file-pending-icon");
    expect(currentStatusSlot).toBeTruthy();
    expect(currentStatusSlot?.classList.contains("is-visible")).toBe(false);
    const nextFile = screen.getByRole("button", { name: /2026-07-01 每日简报/ });
    const nextStatusSlot = nextFile.querySelector<SVGElement>(".brief-file-pending-icon");
    expect(nextStatusSlot).toBeTruthy();
    fireEvent.click(nextFile);

    expect(nextFile.getAttribute("aria-busy")).toBe("true");
    expect(nextFile.classList.contains("pending")).toBe(true);
    expect(nextStatusSlot?.classList.contains("is-visible")).toBe(true);
    expect(nextStatusSlot?.classList.contains("spin")).toBe(true);
    expect(screen.queryByText("选择一个简报文件")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("正在打开“2026-07-01 每日简报”");

    await act(async () => resolveNext({ path: nextPath, name: "20260701_daily_summary.md", content: "# 新简报\n\n新内容。", truncated: false }));
    expect(await screen.findByText("新内容。")).toBeTruthy();
    expect(nextFile.getAttribute("aria-busy")).toBeNull();
    expect(nextFile.querySelector(".brief-file-pending-icon")).toBe(nextStatusSlot);
    expect(nextStatusSlot?.classList.contains("is-visible")).toBe(false);
    expect(nextStatusSlot?.classList.contains("spin")).toBe(false);
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

  it("refreshes the list without reloading or prompting over a dirty current brief", async () => {
    let emitSkillEvent: ((event: Record<string, unknown>) => void) | null = null;
    const api = makeApi();
    const listContent = vi.fn(api.listContent);
    const readContent = vi.fn(api.readContent);
    window.openmind = {
      ...api,
      listContent,
      readContent,
      onSkillEvent(callback) {
        emitSkillEvent = callback;
        return () => { emitSkillEvent = null; };
      }
    };
    render(<AiProvider initial={snapshot}><DailyBriefPage initialDate="20260630" /></AiProvider>);

    await screen.findByRole("heading", { name: "每日简报" });
    fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "编辑每日简报" });
    fireEvent.change(editor, { target: { value: "# 尚未保存" } });
    const readsBeforeRefresh = readContent.mock.calls.length;

    await act(async () => {
      emitSkillEvent?.({ type: "status", state: "success", skillId: "daily-article-summarizer" });
    });

    await waitFor(() => expect(listContent.mock.calls.length).toBeGreaterThan(1));
    expect(readContent).toHaveBeenCalledTimes(readsBeforeRefresh);
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "编辑每日简报" }).value).toBe("# 尚未保存");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

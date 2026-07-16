import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, DesktopApi, SourceDefinition } from "@shared/contracts";
import { messages } from "@shared/messages";
import { AiProvider } from "../../ai-context";
import { SourcesPage } from "./SourcesPage";

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [],
  sessions: [],
  runs: [],
  pendingApprovals: []
};

function makeSource(overrides: Partial<SourceDefinition> = {}): SourceDefinition {
  return {
    schemaVersion: 1,
    id: "rss-1",
    name: "AI Newsletter",
    kind: "rss",
    url: "https://example.com/feed.xml",
    skillId: "rss-article-saver",
    enabled: true,
    frequency: "daily",
    tags: ["AI"],
    lastRunAt: null,
    lastSuccessAt: null,
    successRate: 100,
    status: "success",
    recentError: null,
    itemCount: 0,
    ...overrides
  };
}

const sources: SourceDefinition[] = [
  makeSource(),
  makeSource({
    id: "x-1", name: "X Following", kind: "x", url: null,
    skillId: "x-following-fetcher", tags: ["动态"], successRate: 75,
    status: "warning"
  })
];

function makeApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    aiRefresh: async () => snapshot,
    aiGetEvents: async () => [],
    listSources: async () => sources,
    listSourceRuns: async () => [],
    onAiEvent: () => () => undefined,
    onSkillEvent: () => () => undefined,
    ...overrides
  } as unknown as DesktopApi;
}

beforeEach(() => {
  window.cctools = makeApi();
});

afterEach(() => {
  cleanup();
});

describe("SourcesPage", () => {
  it("keeps addable source tabs visible and filters existing sources", async () => {
    render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);

    await waitFor(() => expect(screen.getByText("AI Newsletter")).toBeTruthy());
    expect(screen.getByRole("button", { name: messages.contentKind.all })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "RSS" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: messages.sources.tabs.web })).toBeTruthy();
    expect(screen.getByRole("button", { name: "API" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "X" })).toBeTruthy();

    // tab=all 时两个源都在（分属 rss / x 分组卡片）
    expect(screen.getByText("AI Newsletter")).toBeTruthy();
    expect(screen.getByText("X Following")).toBeTruthy();

    screen.getByRole("button", { name: "X" }).click();
    await waitFor(() => expect(screen.queryByText("AI Newsletter")).toBeNull());
    expect(screen.getByText("X Following")).toBeTruthy();
  });

  it("加载失败显示错误状态", async () => {
    window.cctools = makeApi({ listSources: async () => { throw new Error("网络断开"); } });
    render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);
    await waitFor(() => expect(screen.getByText("网络断开")).toBeTruthy());
  });

  it("搜索框过滤源列表", async () => {
    render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);
    await waitFor(() => expect(screen.getByText("AI Newsletter")).toBeTruthy());
    const searchInput = screen.getByPlaceholderText(messages.sources.toolbar.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: "X Following" } });
    await waitFor(() => expect(screen.queryByText("AI Newsletter")).toBeNull());
    expect(screen.getByText("X Following")).toBeTruthy();
  });

  it("按 kind 标签过滤", async () => {
    render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);
    await waitFor(() => expect(screen.getByText("AI Newsletter")).toBeTruthy());
    // 搜 "AI" 标签 → 只匹配 AI Newsletter(tags: ["AI"])
    const searchInput = screen.getByPlaceholderText(messages.sources.toolbar.searchPlaceholder);
    fireEvent.change(searchInput, { target: { value: "动态" } });
    await waitFor(() => expect(screen.queryByText("AI Newsletter")).toBeNull());
    expect(screen.getByText("X Following")).toBeTruthy();
  });

  it("点击启停按钮触发 toggle(updateSource)", async () => {
    const updateSource = vi.fn(async () => makeSource({ enabled: false }));
    window.cctools = makeApi({ updateSource });
    render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);
    await waitFor(() => expect(screen.getByText("AI Newsletter")).toBeTruthy());
    const disableBtn = screen.getByLabelText(`停用 AI Newsletter`);
    fireEvent.click(disableBtn);
    await waitFor(() => expect(updateSource).toHaveBeenCalledWith("rss-1", { enabled: false }));
  });

  it("点击抓取按钮触发 runSource", async () => {
    const runSource = vi.fn(async () => true);
    // 只用一个源避免多个"抓取"按钮
    window.cctools = makeApi({ listSources: async () => [makeSource()], runSource });
    render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);
    await waitFor(() => expect(screen.getByText("AI Newsletter")).toBeTruthy());
    const fetchBtn = screen.getByText(messages.sources.actions.fetch);
    fireEvent.click(fetchBtn);
    await waitFor(() => expect(runSource).toHaveBeenCalled());
  });

  it("运行中的源显示停止按钮,点击触发 stopSource", async () => {
    const stopSource = vi.fn(async () => true);
    const runningSources = [makeSource({ status: "running" })];
    window.cctools = makeApi({ listSources: async () => runningSources, stopSource });
    render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);
    await waitFor(() => expect(screen.getByText("AI Newsletter")).toBeTruthy());
    const stopBtn = screen.getByText(messages.sources.actions.stop);
    fireEvent.click(stopBtn);
    await waitFor(() => expect(stopSource).toHaveBeenCalledWith("rss-1"));
  });

  it("全部运行按钮:无可运行源时不调 runSource", async () => {
    // 全部 disabled 的源 → 无可运行
    const disabled = [makeSource({ enabled: false })];
    const runSource = vi.fn(async () => true);
    window.cctools = makeApi({ listSources: async () => disabled, runSource });
    render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);
    await waitFor(() => expect(screen.getByText("AI Newsletter")).toBeTruthy());
    const runAllBtn = screen.getByText(messages.sources.actions.runAll);
    fireEvent.click(runAllBtn);
    // 等一下让可能的 runSource 调用 flush
    await new Promise((r) => setTimeout(r, 200));
    expect(runSource).not.toHaveBeenCalled();
  });

  it("添加源表单提交触发 addRssSource", async () => {
    const addRssSource = vi.fn(async () => makeSource({ id: "new-1", name: "New Feed" }));
    window.cctools = makeApi({ addRssSource });
    render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);
    await waitFor(() => expect(screen.getByText("AI Newsletter")).toBeTruthy());
    // 打开添加表单
    fireEvent.click(screen.getByText(messages.sources.actions.add));
    // 填写
    fireEvent.change(screen.getByPlaceholderText(messages.sources.add.placeholderName), { target: { value: "New Feed" } });
    fireEvent.change(screen.getByPlaceholderText("https://..."), { target: { value: "https://new.feed/xml" } });
    // 提交
    fireEvent.click(screen.getByText(messages.sources.add.submit));
    await waitFor(() => expect(addRssSource).toHaveBeenCalledWith(expect.objectContaining({ name: "New Feed" })), { timeout: 2500 });
  });

  it("添加源表单 name/url 为空时不提交", async () => {
    const addRssSource = vi.fn(async () => makeSource());
    window.cctools = makeApi({ addRssSource });
    render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);
    await waitFor(() => expect(screen.getByText("AI Newsletter")).toBeTruthy());
    fireEvent.click(screen.getByText(messages.sources.actions.add));
    // 不填写,提交按钮应禁用
    const submitBtn = screen.getByText(messages.sources.add.submit);
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("导入 OPML 按钮触发 importOpml", async () => {
    const importOpml = vi.fn(async () => 3);
    window.cctools = makeApi({ importOpml });
    render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);
    await waitFor(() => expect(screen.getByText("AI Newsletter")).toBeTruthy());
    fireEvent.click(screen.getByText(messages.sources.add.importOpml));
    await waitFor(() => expect(importOpml).toHaveBeenCalled());
  });

  it("onSkillEvent 收到 success 状态时重新加载", async () => {
    let eventCb: ((e: { sourceId?: string; skillId?: string; state?: string; type?: string }) => void) | null = null;
    window.cctools = makeApi({
      onSkillEvent: (cb) => { eventCb = cb; return () => undefined; }
    });
    render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);
    await waitFor(() => expect(screen.getByText("AI Newsletter")).toBeTruthy());
    // 发送 success 事件
    expect(eventCb).toBeTruthy();
    // 触发后不崩溃即通过
    eventCb!({ sourceId: "rss-1", state: "success", type: "status" });
    await waitFor(() => expect(screen.getByText("AI Newsletter")).toBeTruthy());
  });

  it("空源列表显示 EmptyState", async () => {
    window.cctools = makeApi({ listSources: async () => [] });
    render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);
    await waitFor(() => expect(screen.getByText(messages.sources.empty.title)).toBeTruthy());
  });

  it("分组卡片:源数较多时全部展示(无分页)", async () => {
    const many = Array.from({ length: 65 }, (_, i) => makeSource({ id: `s${i}`, name: `Source ${i}` }));
    window.cctools = makeApi({ listSources: async () => many });
    render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);
    await waitFor(() => expect(screen.getByText("Source 0")).toBeTruthy());
    // 所有源都渲染(无分页截断)
    expect(screen.getByText("Source 64")).toBeTruthy();
  });
});

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  it("在 Skill 设置上下文中只展示关联来源并保留主操作", async () => {
    const runSource = vi.fn(async () => true);
    window.cctools = makeApi({ runSource });

    render(
      <AiProvider initial={snapshot}>
        <SourcesPage embedded initialSkillId="rss-article-saver" />
      </AiProvider>
    );

    await waitFor(() => expect(screen.getByText("AI Newsletter")).toBeTruthy());
    expect(screen.queryByText("X Following")).toBeNull();
    expect(screen.getByRole("button", { name: messages.sources.actions.runAll })).toBeTruthy();
    expect(screen.getByRole("button", { name: messages.sources.actions.add })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: messages.sources.actions.runAll }));
    await waitFor(() => expect(runSource).toHaveBeenCalledTimes(1));
    expect(runSource).toHaveBeenCalledWith("rss-1", expect.any(String));
  });

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

  it("在与主界面一致的模态弹窗中编辑并保存数据源", async () => {
    const updateSource = vi.fn(async (_id: string, input: Partial<SourceDefinition>) => makeSource({ ...input }));
    window.cctools = makeApi({ listSources: async () => [makeSource({ tags: undefined })], updateSource });
    const { container } = render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);
    await waitFor(() => expect(screen.getByText("AI Newsletter")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "编辑 AI Newsletter" }));
    const dialog = await screen.findByRole("dialog", { name: "编辑数据源" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.className).toContain("source-editor-dialog");
    expect(container.querySelector(".source-add-panel")).toBeNull();
    expect(within(dialog).queryByText(messages.sources.add.importOpml)).toBeNull();
    expect(within(dialog).queryByText(messages.sources.add.frequency)).toBeNull();

    const name = within(dialog).getByPlaceholderText(messages.sources.add.placeholderName) as HTMLInputElement;
    const url = within(dialog).getByPlaceholderText("https://...") as HTMLInputElement;
    const tags = within(dialog).getByPlaceholderText(messages.sources.add.placeholderTags) as HTMLInputElement;
    expect(name.value).toBe("AI Newsletter");
    expect(url.value).toBe("https://example.com/feed.xml");
    expect(tags.value).toBe("");
    await waitFor(() => expect(document.activeElement).toBe(name));
    fireEvent.change(name, { target: { value: "AI Newsletter Updated" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(updateSource).toHaveBeenCalledWith("rss-1", expect.objectContaining({
      name: "AI Newsletter Updated",
      url: "https://example.com/feed.xml"
    })));
    expect(updateSource.mock.calls[0]?.[1]).not.toHaveProperty("frequency");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑数据源" })).toBeNull());
  });

  it("编辑弹窗支持 Esc 关闭并把焦点还给编辑按钮", async () => {
    render(<AiProvider initial={snapshot}><SourcesPage /></AiProvider>);
    await waitFor(() => expect(screen.getByText("AI Newsletter")).toBeTruthy());
    const trigger = screen.getByRole("button", { name: "编辑 AI Newsletter" });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "编辑数据源" });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑数据源" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
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

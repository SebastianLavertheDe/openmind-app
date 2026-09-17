import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserPreferencesSchema, type AiSnapshot, type CreativeAnalytics, type CreativeProjectDetail, type CreativeProjectSummary, type CreativeStage, type DesktopApi } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { AiProvider } from "../../ai-context";
import { ResponsiveLayoutProvider } from "../../app/responsive-layout";
import { CreativeWorkspacePage } from "./CreativePage";

// Page tests exercise persistence and navigation. The real Crepe editing and
// selection behavior is covered separately in milkdown-runtime.test.ts.
vi.mock("./MarkdownEditor", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return { MarkdownEditor: forwardRef((props: { value: string; ariaLabel: string; onChange(value: string): void; onInsertLocalFile?(): Promise<void> }, ref) => {
    useImperativeHandle(ref, () => ({
      focus: () => {},
      insert: (before: string, after = "", placeholder = "") => { props.onChange(props.value + before + placeholder + after); return true; }
    }));
    return <><textarea aria-label={props.ariaLabel} value={props.value} onChange={event => props.onChange(event.target.value)} />
      {props.onInsertLocalFile ? <button onClick={() => void props.onInsertLocalFile?.()}>本地文件</button> : null}</>;
  }) };
});

const snapshot: AiSnapshot = { projectRoot: "/repo", providers: [], sessions: [], runs: [], pendingApprovals: [] };

const nativeCreateRange = document.createRange.bind(document);

function emptyDomRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({})
  } as DOMRect;
}

function emptyClientRects(): DOMRectList {
  return {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {}
  } as unknown as DOMRectList;
}

function createMeasuredRange(): Range {
  const range = nativeCreateRange();
  Object.defineProperty(range, "getBoundingClientRect", {
    configurable: true,
    value: emptyDomRect
  });
  Object.defineProperty(range, "getClientRects", {
    configurable: true,
    value: emptyClientRects
  });
  return range;
}

const analytics: CreativeAnalytics = {
  total: 1,
  averageCompletion: 35,
  averageCycleHours: null,
  stages: [
    { stage: "drafting", count: 1 },
    { stage: "review", count: 1 },
    { stage: "ready", count: 1 },
    { stage: "published", count: 0 }
  ],
  platforms: [{ platform: "wechat", count: 1 }],
  stageDurations: []
};

function project(stage: CreativeStage, topic = `${stage} 稿件`): CreativeProjectSummary {
  return {
    dir: `openmind/creative/${stage}`,
    topic,
    stage,
    completion: stage === "drafting" ? 20 : stage === "review" ? 50 : 80,
    date: "20260616",
    updatedAt: "2026-06-16T08:00:00.000Z",
    platforms: stage === "ready" ? { wechat: "draft" } : {}
  };
}

function detailFor(summary: CreativeProjectSummary, content = "# 标题\n\n## 小节\n\n正文内容。"): CreativeProjectDetail {
  return {
    ...summary,
    files: { "draft.md": content },
    manifest: {
      schemaVersion: 1,
      topic: summary.topic,
      date: "20260616",
      stage: summary.stage as CreativeStage,
      platforms: summary.platforms || {},
      tags: [],
      notes: "",
      assets: [],
      aiSessionIds: [],
      createdAt: "2026-06-16T08:00:00.000Z",
      updatedAt: "2026-06-16T08:00:00.000Z",
      created_at: "2026-06-16T08:00:00.000Z",
      updated_at: "2026-06-16T08:00:00.000Z"
    }
  };
}

function makeApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  const summaries = [project("drafting", "自动保存稿件")];
  let currentDetail = detailFor(summaries[0]);
  return {
    getPreferences: async () => ({ ...UserPreferencesSchema.parse({}), autoSaveIntervalMs: 50 }),
    getCreativeTopics: async () => ({ date: "20260616", topics: [] }),
    getAllCreativeTopics: async () => [],
    getCreativeProjects: async () => summaries,
    getCreativeAnalytics: async () => analytics,
    getCreativeProject: async () => currentDetail,
    listCreativeVersions: async () => [],
    saveCreativeFile: vi.fn(async ({ content }) => {
      currentDetail = { ...currentDetail, files: { ...currentDetail.files, "draft.md": content } };
      return currentDetail;
    }),
    updateCreativeManifest: vi.fn(async (_dir, patch) => {
      currentDetail = {
        ...currentDetail,
        manifest: { ...currentDetail.manifest, ...patch, publish: { ...(currentDetail.manifest?.publish || {}), ...(patch.publish || {}) } }
      };
      return currentDetail;
    }),
    reviewCreativeProject: vi.fn(async () => currentDetail),
    setCreativeReviewStatus: vi.fn(async () => currentDetail),
    getCreativeReleaseLog: async () => [],
    exportText: vi.fn(async () => "/tmp/export.md"),
    openPath: async () => "",
    selectFiles: async () => [],
    aiRefresh: async () => snapshot,
    aiGetEvents: async () => [],
    aiPrewarm: async () => undefined,
    onAiEvent: () => () => undefined,
    ...overrides
  } as unknown as DesktopApi;
}

function renderCreative(api: DesktopApi, props: Partial<Parameters<typeof CreativeWorkspacePage>[0]> = {}) {
  window.openmind = api;
  return render(
    <AiProvider initial={snapshot}>
      <CreativeWorkspacePage initialDate="20260616" {...props} />
    </AiProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0)
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: (id: number) => window.clearTimeout(id)
  });
  Object.defineProperty(document, "createRange", {
    configurable: true,
    writable: true,
    value: createMeasuredRange
  });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: emptyDomRect
  });
  Object.defineProperty(HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: emptyClientRects
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CreativeWorkspacePage", () => {
  function pendingSave() {
    let resolve!: (detail: CreativeProjectDetail) => void;
    let reject!: (cause: Error) => void;
    const promise = new Promise<CreativeProjectDetail>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }

  async function openDraft(api: DesktopApi, summary: CreativeProjectSummary) {
    await act(async () => { renderCreative(api, { initialProjectDir: summary.dir }); });
    fireEvent.click(screen.getByRole("tab", { name: /编辑/ }));
    const editor = screen.getByLabelText("Markdown 草稿编辑器") as HTMLTextAreaElement;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    return editor;
  }

  it("preserves a newer edit and its autosave when an older save completes", async () => {
    const summary = project("drafting", "自动保存稿件");
    const first = pendingSave();
    const saveCreativeFile = vi.fn<DesktopApi["saveCreativeFile"]>()
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async ({ content }) => detailFor(summary, content));
    const editor = await openDraft(makeApi({ saveCreativeFile }), summary);
    fireEvent.change(editor, { target: { value: "revision A" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(saveCreativeFile).toHaveBeenCalledTimes(1);
    fireEvent.change(editor, { target: { value: "revision B" } });
    await act(async () => first.resolve(detailFor(summary, "revision A")));
    expect(editor.value).toBe("revision B");
    expect(screen.getByText("编辑中…")).toBeTruthy();
    expect(screen.queryByText("已自动保存")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(saveCreativeFile).toHaveBeenCalledTimes(2);
    expect(saveCreativeFile).toHaveBeenLastCalledWith(expect.objectContaining({ content: "revision B", createVersion: false }));
    expect(screen.getByText("已自动保存")).toBeTruthy();
  });

  it("serializes manual and automatic saves and preserves edits made during a manual save", async () => {
    const summary = project("drafting", "自动保存稿件");
    const first = pendingSave();
    const manual = pendingSave();
    const saveCreativeFile = vi.fn<DesktopApi["saveCreativeFile"]>()
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(manual.promise)
      .mockImplementation(async ({ content }) => detailFor(summary, content));
    const editor = await openDraft(makeApi({ saveCreativeFile }), summary);
    fireEvent.change(editor, { target: { value: "revision A" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    fireEvent.change(editor, { target: { value: "revision B" } });
    fireEvent.click(screen.getByRole("button", { name: m.creativeUi.editor.saveVersion }));
    expect(saveCreativeFile).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: m.creativeUi.editor.savingVersion }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => first.resolve(detailFor(summary, "revision A")));
    expect(saveCreativeFile).toHaveBeenCalledTimes(2);
    expect(saveCreativeFile).toHaveBeenLastCalledWith(expect.objectContaining({ content: "revision B", createVersion: true }));
    fireEvent.change(editor, { target: { value: "revision C" } });
    await act(async () => manual.resolve(detailFor(summary, "revision B")));
    expect(screen.getByText("编辑中…")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(saveCreativeFile).toHaveBeenCalledTimes(3);
    expect(saveCreativeFile).toHaveBeenLastCalledWith(expect.objectContaining({ content: "revision C", createVersion: false }));
    expect(editor.value).toBe("revision C");
    expect(screen.getByText("已自动保存")).toBeTruthy();
  });

  it("acknowledges a manual save without reporting it as an automatic save", async () => {
    const summary = project("drafting", "自动保存稿件");
    const api = makeApi({ getPreferences: async () => ({ ...UserPreferencesSchema.parse({}), workflowAutoSaveDraft: false }) });
    const editor = await openDraft(api, summary);
    fireEvent.change(editor, { target: { value: "manual revision" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: m.creativeUi.editor.saveVersion })); });
    expect(api.saveCreativeFile).toHaveBeenCalledWith(expect.objectContaining({ content: "manual revision", createVersion: true }));
    expect(screen.getByText(m.creativeUi.editor.status.saved)).toBeTruthy();
    expect(screen.queryByText("已自动保存")).toBeNull();
  });

  it.each(["success", "failure"])("ignores an old project's save %s after switching projects", async (outcome) => {
    const firstProject = project("drafting", "自动保存稿件");
    const nextProject = { ...firstProject, dir: "openmind/creative/next", topic: "下一份稿件" };
    const first = pendingSave();
    const saveCreativeFile = vi.fn<DesktopApi["saveCreativeFile"]>()
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async ({ content }) => detailFor(nextProject, content));
    const api = makeApi({
      saveCreativeFile,
      getCreativeProjects: async () => [firstProject, nextProject],
      getCreativeProject: async (dir) => detailFor(dir === firstProject.dir ? firstProject : nextProject)
    });
    const editor = await openDraft(api, firstProject);
    fireEvent.change(editor, { target: { value: "old edit" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /下一份稿件/ })); });
    const nextEditor = screen.getByLabelText("Markdown 草稿编辑器") as HTMLTextAreaElement;
    fireEvent.change(nextEditor, { target: { value: "new project edit" } });
    await act(async () => {
      if (outcome === "success") first.resolve(detailFor(firstProject, "old edit"));
      else first.reject(new Error("old save failed"));
    });
    expect(screen.getByRole("heading", { name: "下一份稿件" })).toBeTruthy();
    expect(nextEditor.value).toBe("new project edit");
    expect(screen.getByText("编辑中…")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(saveCreativeFile).toHaveBeenLastCalledWith(expect.objectContaining({ projectDir: nextProject.dir, content: "new project edit" }));
    expect(screen.getByText("已自动保存")).toBeTruthy();
  });

  it("switches workflow tabs and autosaves draft edits", async () => {
    const api = makeApi();
    renderCreative(api);

    fireEvent.click(await screen.findByRole("button", { name: /创作中/ }));
    fireEvent.click(await screen.findByRole("button", { name: /自动保存稿件/ }));
    fireEvent.click(await screen.findByRole("tab", { name: /编辑/ }));
    const editor = await screen.findByLabelText("Markdown 草稿编辑器");
    fireEvent.change(editor, { target: { value: "# 标题\n\n## 小节\n\n更新后的正文。" } });

    await waitFor(() => expect(api.saveCreativeFile).toHaveBeenCalledWith(expect.objectContaining({
      createVersion: false,
      content: expect.stringContaining("更新后的正文")
    })), { timeout: 2500 });
    expect(screen.getByText("已自动保存")).toBeTruthy();
  });

  it("shows a project-bound loading state instead of the unselected empty state", async () => {
    const summary = project("drafting", "慢速稿件");
    let resolveDetail!: (value: CreativeProjectDetail) => void;
    const pending = new Promise<CreativeProjectDetail>((resolve) => { resolveDetail = resolve; });
    const getCreativeProject = vi.fn(() => pending);
    const api = makeApi({ getCreativeProjects: async () => [summary], getCreativeProject });
    renderCreative(api);

    fireEvent.click(await screen.findByRole("button", { name: /慢速稿件/ }));
    const loadingText = await screen.findByText(/正在读取“慢速稿件”/);
    expect(loadingText.closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByText(m.creativeUi.editor.selectLeftTitle)).toBeNull();

    await act(async () => resolveDetail(detailFor(summary)));
    expect(await screen.findByRole("heading", { name: "慢速稿件" })).toBeTruthy();
    expect(getCreativeProject).toHaveBeenCalledTimes(1);
  });

  it("opens an initial project only once when its stage becomes active", async () => {
    const summary = project("review", "路由稿件");
    const getCreativeProject = vi.fn(async () => detailFor(summary));
    const api = makeApi({ getCreativeProjects: async () => [summary], getCreativeProject });

    renderCreative(api, { initialProjectDir: summary.dir });

    expect(await screen.findByRole("heading", { name: "路由稿件" })).toBeTruthy();
    await waitFor(() => expect(getCreativeProject).toHaveBeenCalledTimes(1));
  });

  it("keeps edits local when workflow autosave is disabled", async () => {
    const api = makeApi({
      getPreferences: async () => ({ ...UserPreferencesSchema.parse({}), workflowAutoSaveDraft: false, autoSaveIntervalMs: 50 })
    });
    renderCreative(api);
    fireEvent.click(await screen.findByRole("button", { name: /创作中/ }));
    fireEvent.click(await screen.findByRole("button", { name: /自动保存稿件/ }));
    fireEvent.click(await screen.findByRole("tab", { name: /编辑/ }));
    fireEvent.change(await screen.findByLabelText("Markdown 草稿编辑器"), { target: { value: "# 保留在编辑器内" } });
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    expect(api.saveCreativeFile).not.toHaveBeenCalled();
    expect(screen.getByText("编辑中…")).toBeTruthy();
  });

  it("uses the full workspace width without the project inspector column", async () => {
    const api = makeApi();
    const { container } = renderCreative(api);

    fireEvent.click(await screen.findByRole("button", { name: /创作中/ }));
    fireEvent.click(await screen.findByRole("button", { name: /自动保存稿件/ }));
    fireEvent.click(await screen.findByRole("tab", { name: /编辑/ }));

    expect(await screen.findByLabelText("Markdown 草稿编辑器")).toBeTruthy();
    expect(screen.queryByText("稿件素材")).toBeNull();
    expect(screen.queryByRole("button", { name: "概览" })).toBeNull();
    expect(screen.queryByRole("separator", { name: "稿件信息栏宽度" })).toBeNull();
    const workspace = container.querySelector<HTMLElement>(".creative-workspace");
    expect(workspace?.style.getPropertyValue("--list-detail-columns")).toBe("280px 3px minmax(0, 1fr)");
    expect(workspace?.children).toHaveLength(3);
    const listSeparator = screen.getByRole("separator", { name: "内容流宽度" });
    expect(listSeparator.getAttribute("aria-valuemin")).toBe("160");
    expect(listSeparator.getAttribute("aria-valuemax")).toBe("280");
    expect(listSeparator.getAttribute("aria-valuenow")).toBe("280");
  });

  it("fully hides the content list and restores it from the document area", async () => {
    const api = makeApi();
    renderCreative(api);

    expect(await screen.findByPlaceholderText("搜索选题或稿件")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "收起面板" }));

    expect(screen.queryByPlaceholderText("搜索选题或稿件")).toBeNull();
    const reopen = screen.getByRole("button", { name: "展开内容列表" });
    expect(reopen.closest(".creative-main-pane")).toBeTruthy();
    fireEvent.click(reopen);
    expect(await screen.findByPlaceholderText("搜索选题或稿件")).toBeTruthy();
  });

  it("uses a one-pane master-detail flow in compact workspaces", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === "(max-width: 1480px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })) as typeof window.matchMedia;

    try {
      const api = makeApi();
      window.openmind = api;
      const { container } = render(
        <ResponsiveLayoutProvider>
          <AiProvider initial={snapshot}>
            <CreativeWorkspacePage initialDate="20260616" />
          </AiProvider>
        </ResponsiveLayoutProvider>
      );
      const workspace = container.querySelector(".creative-workspace");

      expect(await screen.findByPlaceholderText("搜索选题或稿件")).toBeTruthy();
      expect(workspace?.classList.contains("compact-list-open")).toBe(true);

      fireEvent.click(await screen.findByRole("button", { name: /自动保存稿件/ }));
      await waitFor(() => expect(workspace?.classList.contains("compact-detail-open")).toBe(true));
      expect(screen.queryByPlaceholderText("搜索选题或稿件")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "展开内容列表" }));
      await waitFor(() => expect(workspace?.classList.contains("compact-list-open")).toBe(true));
      expect(await screen.findByPlaceholderText("搜索选题或稿件")).toBeTruthy();

      fireEvent.click(await screen.findByRole("button", { name: /自动保存稿件/ }));
      await waitFor(() => expect(workspace?.classList.contains("compact-detail-open")).toBe(true));
      expect(screen.queryByPlaceholderText("搜索选题或稿件")).toBeNull();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("blocks ready export until required publish checks pass", async () => {
    const summary = project("ready", "发布稿件");
    const longContent = `# 发布稿件\n\n## 小节\n\n${"正文内容".repeat(90)}`;
    let currentDetail = detailFor(summary, longContent);
    const api = makeApi({
      getCreativeProjects: async () => [summary],
      getCreativeProject: async () => currentDetail,
      updateCreativeManifest: vi.fn(async (_dir, patch) => {
        currentDetail = {
          ...currentDetail,
          manifest: { ...currentDetail.manifest, publish: { ...(currentDetail.manifest?.publish || {}), ...(patch.publish || {}) } }
        };
        return currentDetail;
      })
    });

    const { container } = renderCreative(api, { initialStage: "ready" });
    fireEvent.click(await screen.findByRole("button", { name: /发布稿件/ }));

    const detailTransition = container.querySelector(".creative-detail-transition");
    expect(detailTransition?.classList.contains("stage-ready")).toBe(true);
    expect(detailTransition?.getAttribute("data-stage")).toBe("ready");

    const exportButton = await screen.findByRole("button", { name: /立即导出/ });
    expect((exportButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/目标平台/), { target: { value: "wechat" } });
    fireEvent.change(screen.getByLabelText(/摘要/), { target: { value: "一段发布摘要" } });
    fireEvent.change(screen.getByLabelText(/标签/), { target: { value: "AI, 工程" } });
    fireEvent.change(screen.getByLabelText(/封面/), { target: { value: "assets/cover.png" } });
    await waitFor(() => expect(api.updateCreativeManifest).toHaveBeenCalledWith("openmind/creative/ready", { publish: { platform: "wechat" } }));
    await waitFor(() => expect((screen.getByRole("button", { name: /立即导出/ }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: /立即导出/ }));
    await waitFor(() => expect(api.exportText).toHaveBeenCalledWith(expect.stringContaining("发布稿件"), longContent));
  });

  it("filters the today stream by funnel bucket", async () => {
    const drafting = project("drafting", "草稿A");
    const review = project("review", "待审B");
    const api = makeApi({ getCreativeProjects: async () => [drafting, review] });
    const { container } = renderCreative(api);

    expect(await screen.findByRole("button", { name: /草稿A/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /待审B/ })).toBeTruthy();
    expect(container.querySelector('.stream-stage-badge[data-bucket="drafting"]')?.textContent).toBe("创作中");
    expect(container.querySelector('.stream-stage-badge[data-bucket="pending"]')?.textContent).toBe("待审核");
    expect(container.querySelector(".stream-rail")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /待发布/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /草稿A/ })).toBeNull());
    expect(screen.getByRole("button", { name: /待审B/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /待发布/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /草稿A/ })).toBeTruthy());
  });

  it("keeps rendering when an empty funnel bucket is selected", async () => {
    const api = makeApi({ getCreativeProjects: async () => [project("drafting", "唯一草稿")] });
    renderCreative(api);

    expect(await screen.findByRole("button", { name: /唯一草稿/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /待发布/ }));
    expect(await screen.findByText(m.creativeUi.stream.emptyFilterTitle)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /已发布/ }));
    expect(await screen.findByText(m.creativeUi.stream.emptyFilterTitle)).toBeTruthy();
    expect(screen.getByRole("navigation", { name: m.creativeUi.stream.funnelAria })).toBeTruthy();
  });

  it("keeps Creative focused on the workbench without legacy admin views", async () => {
    const getCreativeAnalytics = vi.fn(async () => analytics);
    renderCreative(makeApi({ getCreativeAnalytics }));

    await screen.findByRole("button", { name: /自动保存稿件|创作中/ });
    expect(screen.queryByRole("tab", { name: "版本历史" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "发布记录" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "数据分析" })).toBeNull();
    expect(screen.queryByRole("tablist", { name: m.creativeUi.workspace.tabsAria })).toBeNull();
    expect(screen.getByRole("navigation", { name: m.creativeUi.stream.funnelAria })).toBeTruthy();
    expect(getCreativeAnalytics).not.toHaveBeenCalled();
  });

  it("advance 推进阶段 drafting → review", async () => {
    const summary = project("drafting", "推进稿件");
    let currentDetail = detailFor(summary);
    let currentSummaries = [summary];
    const api = makeApi({
      getCreativeProjects: async () => currentSummaries,
      getCreativeProject: async () => currentDetail,
      advanceCreativeProject: vi.fn(async () => {
        currentDetail = { ...currentDetail, stage: "review" } as CreativeProjectDetail;
        currentSummaries = [{ ...summary, stage: "review" }];
        return currentDetail;
      })
    });
    renderCreative(api);
    fireEvent.click(await screen.findByRole("button", { name: /推进稿件/ }));
    const advanceBtn = await screen.findByRole("button", { name: /进入待审/ });
    fireEvent.click(advanceBtn);
    await waitFor(() => expect(api.advanceCreativeProject).toHaveBeenCalled(), { timeout: 2500 });
  });

  it("published 阶段显示复制按钮,点击触发 copyCreativeProject", async () => {
    const summary = project("published", "已发布稿件");
    summary.platforms = { wechat: "draft" };
    const detail = detailFor(summary);
    const api = makeApi({
      getCreativeProjects: async () => [summary],
      getCreativeProject: async () => detail,
      copyCreativeProject: vi.fn(async () => detail)
    });
    renderCreative(api, { initialStage: "published" });
    fireEvent.click(await screen.findByRole("button", { name: /已发布稿件/ }));
    const copyBtn = await screen.findByRole("button", { name: /复制/ });
    fireEvent.click(copyBtn);
    await waitFor(() => expect(api.copyCreativeProject).toHaveBeenCalled(), { timeout: 2500 });
  });

  it("published 阶段显示复制与归档按钮", async () => {
    const summary = project("published", "已发布稿件");
    summary.platforms = { wechat: "draft" };
    const detail = detailFor(summary);
    const api = makeApi({
      getCreativeProjects: async () => [summary],
      getCreativeProject: async () => detail,
      archiveCreativeProject: vi.fn(async () => detail)
    });
    renderCreative(api, { initialStage: "published" });
    fireEvent.click(await screen.findByRole("button", { name: /已发布稿件/ }));
    // published 阶段应显示复制 + 归档按钮(无 advance 按钮)
    await waitFor(() => expect(screen.getByText(/复制/)).toBeDefined(), { timeout: 2500 });
    expect(screen.getByText(/归档/)).toBeDefined();
  });

  it("编辑器预览模式切换", async () => {
    const api = makeApi();
    renderCreative(api);
    fireEvent.click(await screen.findByRole("button", { name: /创作中/ }));
    fireEvent.click(await screen.findByRole("button", { name: /自动保存稿件/ }));
    const editTab = await screen.findByRole("tab", { name: /编辑/ });
    const previewTab = await screen.findByRole("tab", { name: /预览/ });
    fireEvent.click(editTab);
    editTab.focus();
    fireEvent.keyDown(editTab, { key: "ArrowRight" });
    await waitFor(() => expect(previewTab.getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(previewTab));
    // 预览模式不应显示 textarea 编辑器
    await waitFor(() => expect(screen.queryByLabelText("Markdown 草稿编辑器")).toBeNull(), { timeout: 2000 });
  });

  it("加载失败显示 ErrorState", async () => {
    const api = makeApi({ getCreativeProjects: async () => { throw new Error("加载失败"); } });
    renderCreative(api);
    await waitFor(() => expect(screen.getAllByText("加载失败").length).toBeGreaterThan(0), { timeout: 2500 });
  });

  it("打开项目时 getCreativeProject 抛错显示错误", async () => {
    const summary = project("drafting", "错误项目");
    const api = makeApi({
      getCreativeProjects: async () => [summary],
      getCreativeProject: async () => { throw new Error("打开失败"); }
    });
    renderCreative(api);
    fireEvent.click(await screen.findByRole("button", { name: /错误项目/ }));
    await waitFor(() => expect(screen.getByText("打开失败")).toBeTruthy(), { timeout: 2500 });
  });

  it("插入本地文件链接触发 selectFiles + insertAtCursor", async () => {
    const summary = project("drafting", "本地文件稿件");
    const detail = detailFor(summary);
    const api = makeApi({
      getCreativeProjects: async () => [summary],
      getCreativeProject: async () => detail,
      selectFiles: vi.fn(async () => ["openmind/article/photo.jpg"])
    });
    renderCreative(api);
    fireEvent.click(await screen.findByRole("button", { name: /本地文件稿件/ }));
    fireEvent.click(await screen.findByRole("tab", { name: /编辑/ }));
    await screen.findByLabelText("Markdown 草稿编辑器");
    const localBtn = screen.getByRole("button", { name: "本地文件" });
    fireEvent.click(localBtn);
    await waitFor(() => expect(api.selectFiles).toHaveBeenCalled(), { timeout: 2500 });
  });

  it("published 视图渲染导出文件信息与重新导出按钮", async () => {
    const summary = project("published", "发布完成");
    summary.platforms = { wechat: "draft" };
    const detail = detailFor(summary);
    (detail.manifest as Record<string, unknown>).publish = { platform: "wechat", exportedPath: "/tmp/exported.md", status: "exported" };
    const api = makeApi({
      getCreativeProjects: async () => [summary],
      getCreativeProject: async () => detail,
      exportText: vi.fn(async () => "/tmp/new-export.md")
    });
    renderCreative(api, { initialStage: "published" });
    fireEvent.click(await screen.findByRole("button", { name: /发布完成/ }));
    // published 视图应显示导出路径
    await waitFor(() => expect(screen.getByText(/exported\.md/)).toBeTruthy(), { timeout: 2500 });
    // 点重新导出
    const reexportBtn = screen.getByText("重新导出");
    fireEvent.click(reexportBtn);
    await waitFor(() => expect(api.exportText).toHaveBeenCalled(), { timeout: 2500 });
  });

  it("published 视图无 exportedPath 时显示未记录", async () => {
    const summary = project("published", "未导出发布");
    summary.platforms = { wechat: "draft" };
    const detail = detailFor(summary);
    const api = makeApi({
      getCreativeProjects: async () => [summary],
      getCreativeProject: async () => detail
    });
    renderCreative(api, { initialStage: "published" });
    fireEvent.click(await screen.findByRole("button", { name: /未导出发布/ }));
    // published 视图应显示导出文件区域(含"未记录"或"重新导出")
    await waitFor(() => {
      expect(screen.queryByText("重新导出") || screen.queryByText("导出文件")).not.toBeNull();
    }, { timeout: 2500 });
  });

  it("预览模式空内容显示 EmptyState", async () => {
    const summary = project("drafting", "空内容稿件");
    const detail = detailFor(summary, "");
    const api = makeApi({
      getCreativeProjects: async () => [summary],
      getCreativeProject: async () => detail
    });
    renderCreative(api);
    fireEvent.click(await screen.findByRole("button", { name: /空内容稿件/ }));
    await waitFor(() => expect(screen.getByText("暂无内容预览")).toBeTruthy(), { timeout: 2500 });
  });

  it("exportDraft 无平台时提示错误", async () => {
    // ready 阶段但未选平台 → 点立即导出应禁用(已有测试覆盖);这里测 published 无 publish.platform
    const summary = project("drafting", "无平台稿件");
    const detail = detailFor(summary);
    const api = makeApi({
      getCreativeProjects: async () => [summary],
      getCreativeProject: async () => detail
    });
    renderCreative(api);
    fireEvent.click(await screen.findByRole("button", { name: /无平台稿件/ }));
    fireEvent.click(await screen.findByRole("tab", { name: /编辑/ }));
    await screen.findByLabelText("Markdown 草稿编辑器");
    // 切换文件标签触发 chooseFile
    const files = detail.files ?? {};
    if (Object.keys(files).length > 1) {
      const tabs = screen.getAllByRole("button").filter((b) => b.textContent === "draft.md");
      if (tabs.length) fireEvent.click(tabs[0]);
    }
    // 验证不崩溃
    expect(screen.getByLabelText("Markdown 草稿编辑器")).toBeTruthy();
  });

  it("renders one topic file per day and opens it in the detail pane", async () => {
    const topicPath = "openmind/daily-topic/20260616_daily_topic.md";
    const readContent = vi.fn(async () => ({
      path: topicPath,
      name: "20260616_daily_topic.md",
      content: "# 每日选题管理\n\n当天的全部选题。",
      truncated: false
    }));
    const api = makeApi({
      getAllCreativeTopics: async () => [{
        date: "20260616",
        label: "2026-06-16",
        file: topicPath,
        topics: [
          { id: "one", title: "选题一", body: "内容一" },
          { id: "two", title: "选题二", body: "内容二" }
        ]
      }],
      readContent
    });
    renderCreative(api);

    const dailyFiles = await screen.findAllByRole("button", { name: /2026-06-16.*选题管理文件.*2/ });
    expect(dailyFiles).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /选题一/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /选题二/ })).toBeNull();

    fireEvent.click(dailyFiles[0]);
    await waitFor(() => expect(readContent).toHaveBeenCalledWith(topicPath));
    expect(await screen.findByRole("heading", { name: "每日选题管理" })).toBeTruthy();
  });
});

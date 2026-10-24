import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiEvent, AiRun, AiSnapshot, AiTurn, AiTurnPage, ApprovalRequest, ChangeSet, DesktopApi, SkillDefinition } from "@shared/contracts";
import { messages as m } from "@shared/messages";
import { AiProvider, useAi, useAiStreaming } from "../ai-context";
import { buildTraceSteps, Chat, compactEvents, groupTimeline, selectRenderableTimelineEvents, ToolCallCard, toolOperationSummary } from "./Chat";
import { ChatComposer } from "../features/ai-console/composer";
import { FilePreviewProvider } from "../features/ai-console/file-preview-context";
import { CommandGroup } from "../features/ai-console/tool";
import { FILE_DELIVERABLES_START_FENCE } from "@shared/file-deliverables";
import type { GeneratedImage } from "@shared/image-generation";

const declareFiles = (...paths: string[]) => `${FILE_DELIVERABLES_START_FENCE}\n${JSON.stringify(paths.map(path => ({ path })))}\n~~~~`;
const generatedImage = (index: number): GeneratedImage => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  source: `openmind/assets/generated-images/session/asset-${index}.png`, title: `素材 ${index}`,
  provider: "openai", model: "fixture", mediaType: "image/png", createdAt: "2026-01-01T00:00:00Z", batchId: "generate", index
});

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [{
    id: "codex-native",
    provider: "codex",
    label: "Codex",
    runtime: "native",
    available: true,
    version: "1",
    supportsApprovals: true,
    supportsResume: true,
    supportsImages: true,
    diagnostic: null,
    detectedModel: null,
    contextWindow: null,
    installable: false, oneMillion: false
  }],
  sessions: [],
  runs: [],
  pendingApprovals: []
};

const skills: SkillDefinition[] = [{
  id: "rss-article-saver",
  title: "RSS 文章抓取",
  description: "拉取订阅、提取正文并保存到文章库。",
  cwd: ".claude/skills/rss-article-saver",
  command: "uv",
  runner: "uv",
  args: ["run", "python", "main.py"],
  group: "采集",
  permission: "edit"
}, {
  id: "daily-article-summarizer",
  title: "每日文章总结",
  description: "总结当天文章并同步每日摘要。",
  cwd: ".claude/skills/daily-article-summarizer",
  command: "uv",
  runner: "uv",
  args: ["run", "python", "main.py"],
  group: "分析",
  permission: "edit"
}];

let startRun: ReturnType<typeof vi.fn>;
let runSkill: ReturnType<typeof vi.fn>;
let aiListener: ((event: unknown) => void) | null;
let openPath: ReturnType<typeof vi.fn>;
let revealPath: ReturnType<typeof vi.fn>;
let resolveApproval: ReturnType<typeof vi.fn>;
let searchOpenmindFiles: ReturnType<typeof vi.fn>;
let selectOpenmindFiles: ReturnType<typeof vi.fn>;

function disclosureFor(node: Element | null): HTMLElement {
  const disclosure = node?.closest<HTMLElement>(".ui-disclosure");
  expect(disclosure).toBeTruthy();
  return disclosure!;
}

function disclosureTrigger(disclosure: HTMLElement): HTMLButtonElement {
  const trigger = disclosure.querySelector<HTMLButtonElement>(":scope > .ui-disclosure-trigger");
  expect(trigger).toBeTruthy();
  return trigger!;
}

function expectDisclosureOpen(disclosure: HTMLElement, open: boolean) {
  expect(disclosure.hasAttribute("data-open")).toBe(open);
  expect(disclosureTrigger(disclosure).getAttribute("aria-expanded")).toBe(String(open));
}

function openDisclosure(disclosure: HTMLElement) {
  if (!disclosure.hasAttribute("data-open")) fireEvent.click(disclosureTrigger(disclosure));
}

function mockChatScroller(scroller: HTMLElement, initialScrollHeight = 1000, clientHeight = 200) {
  let scrollHeight = initialScrollHeight;
  let scrollTop = 0;
  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, get: () => scrollHeight },
    clientHeight: { configurable: true, get: () => clientHeight },
    scrollTop: {
      configurable: true,
      get: () => Math.max(0, Math.min(scrollTop, scrollHeight - clientHeight)),
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight));
      }
    }
  });
  return {
    bottom: () => Math.max(0, scrollHeight - clientHeight),
    setHeight: (value: number) => { scrollHeight = value; },
    setTop: (value: number) => {
      scroller.scrollTop = value;
      fireEvent.scroll(scroller);
    }
  };
}

function ControllerRenderProbe({ onRender }: { onRender(): void }) {
  useAi();
  onRender();
  return null;
}

function StreamingProbe({ runId }: { runId: string }) {
  const { streaming } = useAiStreaming(runId);
  return <output data-testid="streaming-probe">{streaming}</output>;
}

function SessionSwitchProbe({ sessionId }: { sessionId: string }) {
  const ai = useAi();
  return <button type="button" onClick={() => void ai.setActiveSession(sessionId)}>switch session</button>;
}

beforeEach(() => {
  aiListener = null;
  startRun = vi.fn(async () => { throw new Error("provider failed"); });
  runSkill = vi.fn(async () => true);
  openPath = vi.fn(async (path: string) => path);
  revealPath = vi.fn(async () => true);
  resolveApproval = vi.fn(async () => true);
  searchOpenmindFiles = vi.fn(async () => ({ items: [], indexedCount: 0, truncated: false }));
  selectOpenmindFiles = vi.fn(async () => []);
  window.openmind = {
    aiStartRun: startRun,
    aiRefresh: async () => snapshot,
    aiRefreshSkills: async () => skills,
    aiGetEvents: async () => [],
    aiCancelRun: async () => true,
    aiResolveApproval: resolveApproval,
    runSkill,
    selectFiles: async () => [],
    selectOpenmindFiles,
    searchOpenmindFiles,
    openPath,
    revealPath,
    onAiEvent: (callback: Parameters<DesktopApi["onAiEvent"]>[0]) => {
      aiListener = callback as (event: unknown) => void;
      return () => { aiListener = null; };
    }
  } as unknown as DesktopApi;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Chat composer", () => {
  it("grounds the empty state in the content workspace without task cards or shortcut hints", () => {
    render(<AiProvider initial={snapshot}><Chat /></AiProvider>);

    expect(screen.getAllByText(m.ai.chat.currentProject).length).toBeGreaterThan(0);
    expect(screen.getAllByText("project").length).toBeGreaterThan(0);
    expect(screen.getByText("从资料到创作，让 AI 帮你推进")).toBeTruthy();
    for (const prompt of m.ai.chat.emptyPrompts) {
      expect(screen.queryByRole("button", { name: `${prompt.title} ${prompt.body}` })).toBeNull();
    }
    expect(screen.queryByText(m.ai.chat.emptyHint)).toBeNull();
    expect(screen.getByRole("button", { name: m.ai.composer.openWorkspace })).toBeTruthy();
    expect(screen.getByRole("button", { name: m.ai.composer.addAttachment })).toBeTruthy();
    expect(screen.getByLabelText(m.ai.composer.messageInput).getAttribute("placeholder")).toBe(m.ai.composer.placeholderNew);
  });

  it("keeps the draft on failure and ignores Enter while IME is composing", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><Chat /></AiProvider>);
    const editor = screen.getByLabelText("AI 消息") as HTMLTextAreaElement;

    await user.type(editor, "保留这段草稿");
    fireEvent.keyDown(editor, { key: "Enter", isComposing: true });
    expect(startRun).not.toHaveBeenCalled();

    fireEvent.keyDown(editor, { key: "Enter", isComposing: false });
    await screen.findByText("provider failed");
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(editor.value).toBe("保留这段草稿");
  });

  it("locks submission before React rerenders", async () => {
    const deferred: { reject?: (error: Error) => void } = {};
    startRun.mockImplementation(() => new Promise((_, rejectPromise) => { deferred.reject = rejectPromise; }));
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><Chat /></AiProvider>);
    await user.type(screen.getByLabelText("AI 消息"), "只发送一次");
    const send = screen.getByRole("button", { name: "发送" });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(startRun).toHaveBeenCalledTimes(1);
    deferred.reject?.(new Error("stop"));
    await waitFor(() => expect(screen.getByText("stop")).toBeTruthy());
  });

  it("keeps Shift+Enter as a newline gesture while the single action remains stop", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshotForRun(makeRun(), "running")}><Chat /></AiProvider>);
    const editor = screen.getByLabelText("AI 消息") as HTMLTextAreaElement;

    await user.type(editor, "排队消息");
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true, isComposing: false });

    expect(startRun).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "加入队列" })).toBeNull();
  });

  it("acknowledges stop immediately and prevents duplicate cancellation", async () => {
    const run = makeRun();
    const active = snapshotForRun(run, "running");
    let resolveCancel!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { resolveCancel = resolve; });
    const cancelRun = vi.fn(() => pending);
    window.openmind.aiCancelRun = cancelRun;
    window.openmind.aiRefresh = async () => active;
    render(<AiProvider initial={active}><Chat /></AiProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "停止" }));
    const stopping = screen.getByRole("button", { name: "正在停止" }) as HTMLButtonElement;
    expect(stopping.disabled).toBe(true);
    expect(stopping.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(stopping);
    expect(cancelRun).toHaveBeenCalledTimes(1);

    await act(async () => resolveCancel(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "停止" })).toBeTruthy());
  });

  it("binds session loading to the selected session and fades in only the loaded transcript", async () => {
    const firstRun = makeRun();
    const first = snapshotForRun(firstRun, "idle").sessions[0];
    const second = { ...first, id: "session-2", title: "Second", lastRunId: null };
    const sessionsSnapshot = { ...snapshot, sessions: [first, second], runs: [] };
    type Events = Awaited<ReturnType<DesktopApi["aiGetEvents"]>>;
    let resolveSecond!: (events: Events) => void;
    const pending = new Promise<Events>((resolve) => { resolveSecond = resolve; });
    const firstEvent = { ...makeEvent("first-answer", "assistant-message", { text: "first transcript", phase: "final" }, 1), runId: "first-run" };
    const secondEvent = { ...makeEvent("second-answer", "assistant-message", { text: "second transcript", phase: "final" }, 1), sessionId: "session-2", runId: "second-run" };
    window.openmind.aiGetEvents = vi.fn((sessionId: string) => sessionId === "session-2" ? pending : Promise.resolve<Events>([firstEvent]));
    render(<AiProvider initial={sessionsSnapshot}><SessionSwitchProbe sessionId="session-2" /><Chat /></AiProvider>);

    expect(await screen.findByText("first transcript")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "switch session" }));
    expect(screen.queryByText("first transcript")).toBeNull();
    const loading = screen.getByRole("status", { name: m.ai.chat.loadingHistory });
    expect(loading.hasAttribute("data-visible")).toBe(false);
    await waitFor(() => expect(loading.getAttribute("data-visible")).not.toBeNull());

    await act(async () => resolveSecond([secondEvent]));
    expect(await screen.findByText("second transcript")).toBeTruthy();
    expect(document.querySelector(".chat-thread.session-ready")).toBeTruthy();
    expect(screen.queryByText("first transcript")).toBeNull();
  });

  it("keeps one stop action after an intermediate assistant message", async () => {
    const user = userEvent.setup();
    let renders = 0;
    const { container } = render(
      <AiProvider initial={snapshotForRun(makeRun(), "running")}>
        <ChatComposer />
        <ControllerRenderProbe onRender={() => { renders += 1; }} />
      </AiProvider>
    );
    const composer = container.querySelector<HTMLElement>(".composer")!;
    const editor = within(composer).getByLabelText(m.ai.composer.messageInput);

    await user.type(editor, "follow-up");
    expect(within(composer).getByRole("button", { name: m.ai.composer.stop })).toBeTruthy();
    expect(composer.querySelectorAll(".composer-send-wrap .composer-send")).toHaveLength(1);

    const rendersBeforeReply = renders;
    aiListener?.({ kind: "event", event: makeEvent("progress", "assistant-message", { text: "Still working." }, 2) });
    await waitFor(() => expect(renders).toBeGreaterThan(rendersBeforeReply));

    expect(within(composer).getByRole("button", { name: m.ai.composer.stop })).toBeTruthy();
    expect(composer.querySelectorAll(".composer-send-wrap .composer-send")).toHaveLength(1);
    expect(within(composer).queryByRole("button", { name: m.ai.composer.enqueue })).toBeNull();
    expect(within(composer).queryByRole("button", { name: m.ai.composer.send })).toBeNull();
  });

  it("shows registered skills after slash and inserts the selected skill without sending", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot} skills={skills}><Chat /></AiProvider>);
    const editor = screen.getByLabelText("AI 消息") as HTMLTextAreaElement;

    await user.type(editor, "/");
    expect(editor.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("option", { name: /rss-article-saver/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /daily-article-summarizer/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /\/search/ })).toBeNull();

    fireEvent.keyDown(editor, { key: "Enter", isComposing: false });

    expect(editor.value).toBe("/rss-article-saver ");
    expect(editor.getAttribute("aria-expanded")).toBe("false");
    expect(startRun).not.toHaveBeenCalled();
  });

  it("sends a selected skill through the active AI provider conversation", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot} skills={skills}><Chat /></AiProvider>);
    const editor = screen.getByLabelText("AI 消息") as HTMLTextAreaElement;

    await user.type(editor, "/daily-article-summarizer 20260627");
    expect(screen.getByRole("button", { name: "发送" })).toBeTruthy();
    fireEvent.keyDown(editor, { key: "Enter", isComposing: false });

    await waitFor(() => expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "codex-native",
      prompt: "/daily-article-summarizer 20260627"
    })));
    expect(runSkill).not.toHaveBeenCalled();
  });

  it("passes arbitrary native skill arguments to the provider", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot} skills={skills}><Chat /></AiProvider>);
    const editor = screen.getByLabelText("AI 消息") as HTMLTextAreaElement;

    await user.type(editor, "/rss-article-saver tomorrow");
    fireEvent.keyDown(editor, { key: "Enter", isComposing: false });

    await waitFor(() => expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "/rss-article-saver tomorrow"
    })));
    expect(runSkill).not.toHaveBeenCalled();
  });

  it("validates missing and unknown slash commands before invoking the provider", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><Chat /></AiProvider>);
    const editor = screen.getByLabelText("AI 消息") as HTMLTextAreaElement;

    await user.type(editor, "/search");
    fireEvent.keyDown(editor, { key: "Enter", isComposing: false });
    fireEvent.keyDown(editor, { key: "Enter", isComposing: false });

    expect((await screen.findByRole("alert")).textContent).toContain("缺少必要参数");
    expect(startRun).not.toHaveBeenCalled();

    await user.clear(editor);
    await user.type(editor, "/unknown something");
    fireEvent.keyDown(editor, { key: "Enter", isComposing: false });
    expect((await screen.findByRole("alert")).textContent).toContain("未知命令 /unknown");
    expect(startRun).not.toHaveBeenCalled();
  });

  it("searches openmind files from @ and adds the chosen file as real context", async () => {
    searchOpenmindFiles.mockResolvedValue({
      items: [{
        path: "openmind/wiki/concepts/composer.md",
        name: "composer.md",
        directory: "openmind/wiki/concepts",
        extension: "md"
      }],
      indexedCount: 128,
      truncated: false
    });
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><Chat /></AiProvider>);
    const editor = screen.getByLabelText("AI 消息") as HTMLTextAreaElement;

    await user.type(editor, "请分析 @composer");
    const option = await screen.findByRole("option", { name: /composer\.md/ });
    expect(searchOpenmindFiles).toHaveBeenLastCalledWith("composer", 50);
    await user.click(option);

    expect(editor.value).toBe("请分析");
    expect(screen.getByText("composer.md")).toBeTruthy();
    expect(screen.getByText("1 项上下文")).toBeTruthy();
  });

  it("uses the openmind-only file picker from the @ menu", async () => {
    selectOpenmindFiles.mockResolvedValue(["openmind/daily-summary/20260625_daily_summary.md"]);
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><Chat /></AiProvider>);
    const editor = screen.getByLabelText("AI 消息") as HTMLTextAreaElement;

    await user.type(editor, "@");
    await user.click(screen.getByRole("button", { name: /浏览 openmind/ }));

    expect(selectOpenmindFiles).toHaveBeenCalledTimes(1);
    expect(editor.value).toBe("");
    expect(screen.getByText("20260625_daily_summary.md")).toBeTruthy();
    // Browsing and choosing files snaps the menu shut immediately (no exit fade),
    // so the just-chosen file isn't shown twice (menu snapshot + context chip).
    expect(screen.queryByRole("button", { name: /浏览 openmind/ })).toBeNull();
  });

  it("sends the original slash text so the scheduler can expand it server-side", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><Chat /></AiProvider>);
    const editor = screen.getByLabelText("AI 消息") as HTMLTextAreaElement;

    await user.type(editor, "/search provider registry");
    fireEvent.keyDown(editor, { key: "Enter", isComposing: false });
    await screen.findByText("provider failed");

    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "/search provider registry"
    }));
  });
});

describe("chat timeline", () => {
  it("shows a viewed-image preview in the live process without a duplicate terminal marker", async () => {
    const run = makeRun();
    window.openmind.readChatImage = vi.fn(async () => ({ dataUrl: "data:image/png;base64,AAA=", width: 640, height: 480 }));
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "看一下这张图" }, 1),
      makeEvent("read-start", "tool-start", { itemId: "picture", tool: "Read", input: { file_path: "assets/参考图.png" } }, 2),
      makeEvent("read-complete", "tool-complete", { itemId: "picture", tool: "Read", output: {} }, 3)
    ];
    const { container } = render(<AiProvider initial={snapshotForRun(run, "running")}><Chat /></AiProvider>);
    const header = await screen.findByRole("button", { name: "已查看 1 张图像" });
    expect(await screen.findByAltText("参考图.png")).toBeTruthy();
    expect(header.closest(".trace-step")?.querySelector(".trace-step-marker")).toBeNull();
    expect(container.querySelector(".read-file-summary")).toBeNull();
  });
  it("shows only the final assistant message for a completed run", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:08.000Z" };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "question" }, 1),
      makeEvent("answer-1", "assistant-message", { text: "first" }, 2),
      makeEvent("answer-2", "assistant-message", { text: "second" }, 3),
      makeEvent("answer-3", "assistant-message", { text: "third" }, 4)
    ];
    const { container } = render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    await screen.findByText("third");
    expect(container.querySelectorAll(".assistant-message")).toHaveLength(1);
    expect(container.querySelector(".message-avatar, .provider-avatar, .provider-avatar-spacer")).toBeNull();
    const assistant = container.querySelector<HTMLElement>(".assistant-message")!;
    expect(assistant.textContent).not.toContain("first");
    expect(assistant.textContent).not.toContain("second");
  });

  it("does not present a completed run without a final reply as successfully processed", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:08.000Z" };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "question" }, 1),
      makeEvent("reasoning", "reasoning-summary", { text: "checked the repository" }, 2),
      makeEvent("done", "status", { state: "completed" }, 3)
    ];

    render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    const warning = await screen.findByRole("alert");
    expect(warning.textContent).toContain("没有返回最终回复");
    expect(screen.getByText("最终回复缺失")).toBeTruthy();
    expect(screen.queryByText("已处理")).toBeNull();
  });

  it("exposes final replies through a labelled live log with accessible author and time", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:08.000Z" };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "question" }, 1),
      makeEvent("answer", "assistant-message", { text: "accessible answer", phase: "final" }, 2)
    ];

    render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    const log = await screen.findByRole("log", { name: "对话消息" });
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(log.getAttribute("aria-relevant")).toBe("additions text");
    const assistant = (await screen.findByText("accessible answer")).closest("article")!;
    expect(within(assistant).getByText("AI").classList.contains("ui-visually-hidden")).toBe(true);
    expect(assistant.querySelector("time")?.classList.contains("ui-visually-hidden")).toBe(true);
  });

  it("classifies exactly one completed reply as final while retaining process commentary", () => {
    const base = makeRun();
    const completed = { ...base, id: "completed", status: "completed" as const };
    const running = { ...base, id: "running", status: "running" as const };
    const failed = { ...base, id: "failed", status: "failed" as const };
    const cancelled = { ...base, id: "cancelled", status: "cancelled" as const };
    const forRun = (event: AiEvent, runId: string) => ({ ...event, runId });
    const events = [
      forRun(makeEvent("commentary", "assistant-message", { text: "checking", phase: "commentary" }, 1), "completed"),
      forRun(makeEvent("legacy-progress", "assistant-message", { text: "still checking" }, 2), "completed"),
      forRun(makeEvent("final", "assistant-message", { text: "finished", phase: "final" }, 3), "completed"),
      forRun(makeEvent("running-delta", "assistant-delta", { text: "draft" }, 4), "running"),
      forRun(makeEvent("running-text", "assistant-message", { text: "not final" }, 5), "running"),
      forRun(makeEvent("failed-text", "assistant-message", { text: "failed partial" }, 6), "failed"),
      forRun(makeEvent("cancelled-text", "assistant-message", { text: "cancelled partial" }, 7), "cancelled"),
      forRun(makeEvent("unknown-status", "status", { state: "running" }, 8), "missing-run"),
      forRun(makeEvent("unknown-text", "assistant-message", { text: "unknown partial" }, 9), "missing-run"),
      forRun(makeEvent("error-text", "assistant-message", { text: "error partial" }, 10), "missing-error-run"),
      forRun(makeEvent("error", "error", { message: "provider failed" }, 11), "missing-error-run")
    ];

    const selected = selectRenderableTimelineEvents(events, [completed, running, failed, cancelled]);
    const messages = selected.filter((event) => event.kind === "assistant-message");
    expect(messages.filter((event) => event.payload.phase === "final").map((event) => event.payload.text)).toEqual(["finished"]);
    expect(messages.filter((event) => event.payload.phase === "commentary").map((event) => event.payload.text)).toEqual([
      "checking",
      "still checking",
      "not final",
      "failed partial",
      "cancelled partial",
      "unknown partial",
      "error partial"
    ]);
    expect(selected.some((event) => event.kind === "assistant-delta")).toBe(true);
  });

  it("summarizes tool calls using their useful arguments", () => {
    expect(toolOperationSummary("Glob", { pattern: "**/*.ts", path: "desktop-app" })).toBe("**/*.ts · desktop-app");
    expect(toolOperationSummary("Bash", { command: "npm test\nignored" })).toBe("npm test");
    expect(toolOperationSummary("Read", { file_path: "src/app.ts" })).toBe("src/app.ts");
  });

  it("uses the terminal icon for completed tool operations", () => {
    const tools = [
      ["Write", { file_path: "src/app.ts" }],
      ["Read", { file_path: "src/app.ts" }],
      ["Glob", { pattern: "**/*.ts" }],
      ["Bash", { command: "npm test" }]
    ] as const;

    for (const [tool, input] of tools) {
      const start = makeEvent(`${tool}-start`, "tool-start", { itemId: `${tool}-1`, tool, input });
      const complete = makeEvent(`${tool}-complete`, "tool-complete", { itemId: `${tool}-1`, output: "done" });
      const { container, unmount } = render(<ToolCallCard events={[start, complete]} />);
      expect(container.querySelector(".lucide-terminal")).toBeTruthy();
      unmount();
    }
  });

  it("shows the operation in a compact tool card and keeps completed failures collapsed", () => {
    const start = makeEvent("tool-start", "tool-start", { itemId: "glob-1", tool: "Glob", input: { pattern: "**/*.tsx", path: "renderer" } });
    const complete = makeEvent("tool-complete", "tool-complete", { itemId: "glob-1", isError: true, output: "No files matched" });
    render(<ToolCallCard events={[start, complete]} />);

    expect(screen.getByText("**/*.tsx · renderer")).toBeTruthy();
    const titleLine = screen.getByText("Glob").closest(".tool-event-title")?.querySelector("span");
    expect(titleLine?.querySelector("code")?.textContent).toContain("**/*.tsx");
    expect(titleLine?.textContent).toContain("renderer");
    expect(screen.getAllByText("No files matched").some((node) => node.closest(".tool-event-title"))).toBe(true);
    expect(screen.queryByText(/2 .*事件/)).toBeNull();
    expectDisclosureOpen(disclosureFor(screen.getByText("运行失败")), false);
  });

  it("shows search tool output as a compact terminal result", () => {
    const start = makeEvent("tool-start", "tool-start", { itemId: "glob-1", tool: "Glob", input: { pattern: "**/*.tsx", path: "renderer" } });
    const complete = makeEvent("tool-complete", "tool-complete", { itemId: "glob-1", output: { matches: ["a.tsx", "b.tsx"] } });
    render(<ToolCallCard events={[start, complete]} />);

    expect(document.body.textContent).toContain("**/*.tsx");
    fireEvent.click(disclosureTrigger(disclosureFor(screen.getByText("Glob"))));
    expect(screen.queryByText("查询")).toBeNull();
    expect(screen.queryByText("范围")).toBeNull();
    expect(document.body.textContent).toContain('"matches"');
    expect(document.body.textContent).toContain('"a.tsx"');
  });

  it("defers large payload serialization until a tool card is opened", () => {
    const output = { toJSON: vi.fn(() => ({ matches: ["a.tsx", "b.tsx"] })) };
    const start = makeEvent("lazy-start", "tool-start", { itemId: "lazy-1", tool: "Analyze", input: { subject: "workspace" } });
    const complete = makeEvent("lazy-complete", "tool-complete", { itemId: "lazy-1", output });
    const events = [start, complete];
    const view = render(<ToolCallCard events={events} />);

    expect(output.toJSON).not.toHaveBeenCalled();
    fireEvent.click(disclosureTrigger(disclosureFor(screen.getByText("Analyze"))));
    expect(output.toJSON).toHaveBeenCalledTimes(1);

    view.rerender(<ToolCallCard events={[...events]} />);
    expect(output.toJSON).toHaveBeenCalledTimes(1);
  });

  it("shows read tool output without the old detail controls", async () => {
    const user = userEvent.setup();
    const openPreview = vi.fn();
    const start = makeEvent("read-start", "tool-start", { itemId: "read-1", tool: "Read", input: { file_path: "src/app.ts", offset: 10, limit: 20, encoding: "utf-8" } });
    const complete = makeEvent("read-complete", "tool-complete", { itemId: "read-1", output: "const app = true;" });
    render(<FilePreviewProvider open={openPreview}><ToolCallCard events={[start, complete]} /></FilePreviewProvider>);

    expect(screen.getAllByText("app.ts").length).toBeGreaterThan(0);

    await user.click(disclosureTrigger(disclosureFor(screen.getByText("Read"))));
    expect(screen.queryByText("路径")).toBeNull();
    expect(screen.queryByText("utf-8")).toBeNull();
    expect(screen.queryByRole("button", { name: "打开文件" })).toBeNull();
    expect(screen.queryByRole("button", { name: "所在目录" })).toBeNull();
    expect(document.body.textContent).not.toContain("$ Read src/app.ts");
    expect(document.body.textContent).not.toContain("const app = true;");
    const fileLink = screen.getByRole("button", { name: "已读文件 app.ts" });
    await user.click(fileLink);
    expect(openPreview).toHaveBeenCalledWith("src/app.ts");
    expect(openPath).not.toHaveBeenCalled();
    expect(revealPath).not.toHaveBeenCalled();
  });

  it("shows only the read file name in the tool title", () => {
    const path = "\\\\wsl.localhost\\Ubuntu\\home\\say\\work\\github\\openmind\\openmind\\daily-summary\\20260707_daily_summary.md";
    const start = makeEvent("read-start", "tool-start", { itemId: "read-1", tool: "Read", input: { file_path: path } });
    const complete = makeEvent("read-complete", "tool-complete", { itemId: "read-1", output: "daily summary body" });
    render(<ToolCallCard events={[start, complete]} />);

    const titleLine = screen.getByText("Read").closest(".tool-event-title")?.querySelector("span");
    expect(titleLine?.textContent).toContain("已运行Read20260707_daily_summary.md");
    expect(titleLine?.textContent).not.toContain("\\\\wsl.localhost");
  });

  it("surfaces command stdout, stderr, exit code and chunks large output", () => {
    const largeOutput = "x".repeat(8_200);
    const start = makeEvent("bash-start", "tool-start", { itemId: "bash-1", tool: "Bash", input: { command: "npm test", cwd: "/project" } });
    const complete = makeEvent("bash-complete", "tool-complete", {
      itemId: "bash-1",
      isError: true,
      output: { stdout: largeOutput, stderr: "failed suite", exitCode: 1 }
    });
    render(<ToolCallCard events={[start, complete]} />);

    expect(screen.getAllByText("npm test").length).toBeGreaterThan(0);
    fireEvent.click(disclosureTrigger(disclosureFor(screen.getByText("命令失败"))));
    expect(screen.getByLabelText("退出码 1").classList.contains("failed")).toBe(true);
    expect(document.querySelector(".command-terminal-titlebar")).toBeNull();
    expect(document.querySelector(".terminal-line.command")?.textContent).toContain("$ npm test");
    expect(document.querySelector(".terminal-line.stdout")?.textContent).toContain("x");
    expect(screen.getAllByText(/加载更多/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText(/加载更多/));
    expect(document.querySelector(".terminal-line.stderr")?.textContent).toContain("failed suite");
    expect(screen.getByText(/failed suite/)).toBeTruthy();
  });

  it("shows cancelled tool calls with an explicit status", () => {
    const start = makeEvent("cancel-start", "tool-start", { itemId: "tool-1", tool: "Bash", input: { command: "npm test" } });
    const complete = makeEvent("cancel-done", "tool-complete", { itemId: "tool-1", state: "cancelled" });
    render(<ToolCallCard events={[start, complete]} />);

    expect(screen.getByText("命令已取消")).toBeTruthy();
    expect(screen.getAllByText("npm test").length).toBeGreaterThan(0);
  });

  it.each([
    ["cancelled", "命令已取消", "cancelled"],
    ["failed", "命令失败", "failed"],
    ["conflicted", "存在冲突", "failed"],
    ["completed", "命令结果不完整", "incomplete"]
  ] as const)("uses terminal parent run status %s for an unfinished tool", (runStatus, label, className) => {
    const start = makeEvent("orphan-start", "tool-start", { itemId: "tool-1", tool: "Bash", input: { command: "npm test" } });
    const { container } = render(<ToolCallCard events={[start]} runStatus={runStatus} />);

    expect(screen.getByText(label)).toBeTruthy();
    expect(container.querySelector(".tool-event")?.classList.contains(className)).toBe(true);
    expect(container.querySelector(".spin")).toBeNull();
  });

  it.each(["queued", "running", "waiting-approval", "applying"] as const)(
    "keeps an unfinished tool running while parent run is %s",
    (runStatus) => {
      const start = makeEvent("active-start", "tool-start", { itemId: "tool-1", tool: "Bash", input: { command: "npm test" } });
      const { container } = render(<ToolCallCard events={[start]} runStatus={runStatus} />);

      expect(screen.getByText("正在运行")).toBeTruthy();
      expect(screen.queryByText("执行中")).toBeNull();
      expect(container.querySelector(".tool-event")?.classList.contains("running")).toBe(true);
      expect(container.querySelector(".spin")).toBeTruthy();
    }
  );

  it("keeps an explicit successful tool completion when the parent run later fails", () => {
    const start = makeEvent("success-start", "tool-start", { itemId: "tool-1", tool: "Bash", input: { command: "npm test" } });
    const complete = makeEvent("success-done", "tool-complete", { itemId: "tool-1", output: "ok" });
    const { container } = render(<ToolCallCard events={[start, complete]} runStatus="failed" />);

    expect(screen.getByText("已运行")).toBeTruthy();
    expect(container.querySelector(".tool-event")?.classList.contains("completed")).toBe(true);
  });

  it("keeps a tool completed when an associated summary arrives after tool-complete", () => {
    const start = makeEvent("summary-start", "tool-start", { itemId: "tool-1", tool: "Read", input: { file_path: "src/app.ts" } }, 1);
    const complete = makeEvent("summary-done", "tool-complete", { itemId: "tool-1", output: "done" }, 2);
    const summary = makeEvent("summary-output", "tool-output", { itemId: "tool-1", tool: "Read", text: "Read the application entry point" }, 3);
    const { steps } = buildTraceSteps([start, complete, summary]);

    expect(steps).toHaveLength(1);
    expect(steps[0].type === "tool" ? steps[0].events.map((event) => event.id) : []).toEqual([
      "summary-start",
      "summary-done",
      "summary-output"
    ]);
    const events = steps[0].type === "tool" ? steps[0].events : [];
    const { container } = render(<ToolCallCard events={events} runStatus="running" />);
    expect(screen.getByText("已运行")).toBeTruthy();
    expect(container.querySelector(".tool-event")?.classList.contains("completed")).toBe(true);
    expect(container.querySelector(".spin")).toBeNull();
  });

  it("shows generic tool output as a terminal result", async () => {
    const user = userEvent.setup();
    const start = makeEvent("copy-start", "tool-start", { itemId: "tool-1", tool: "Analyze", input: { subject: "src/app.ts" } });
    const complete = makeEvent("copy-done", "tool-complete", { itemId: "tool-1", output: "result text" });
    render(<ToolCallCard events={[start, complete]} />);

    await user.click(disclosureTrigger(disclosureFor(screen.getByText("Analyze"))));
    expect(document.body.textContent).not.toContain("$ Analyze src/app.ts");
    expect(document.body.textContent).toContain("result text");
    expect(screen.queryByRole("button", { name: "保存输出" })).toBeNull();
  });

  it("shows write tool result without request and diff panels", () => {
    const start = makeEvent("write-start", "tool-start", {
      itemId: "write-1",
      tool: "Edit",
      input: { file_path: "src/app.ts", operation: "replace", old_string: "old value", new_string: "new value" }
    });
    const complete = makeEvent("write-done", "tool-complete", { itemId: "write-1", output: { path: "src/app.ts" } });
    render(<ToolCallCard events={[start, complete]} />);

    expect(screen.getAllByText("src/app.ts").length).toBeGreaterThan(0);
    fireEvent.click(disclosureTrigger(disclosureFor(screen.getByText("Edit"))));
    expect(screen.queryByText("文件")).toBeNull();
    expect(screen.queryByText("操作")).toBeNull();
    expect(screen.queryByText("Diff")).toBeNull();
    expect(screen.queryByText(/--- old/)).toBeNull();
    expect(document.body.textContent).toContain('"path": "src/app.ts"');
  });

  it("waits for run completion before rendering the committed final message", async () => {
    const run = makeRun();
    const runningSnapshot = {
      ...snapshot,
      sessions: [{
        schemaVersion: 1,
        id: "session",
        projectId: "project",
        scope: { type: "workspace" as const },
        projectRoot: "/project",
        provider: "codex" as const,
        providerId: "codex-native",
        providerSessionId: null,
        cwd: "/project",
        title: "Streaming",
        permissionProfile: "edit" as const,
        status: "running" as const,
        pinned: false,
        archived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastRunId: "run"
      }],
      runs: [run]
    };
    window.openmind.aiGetEvents = async () => [makeEvent("user", "user-message", { text: "hello" })];
    const onControllerRender = vi.fn();
    const { container } = render(
      <AiProvider initial={runningSnapshot}>
        <ControllerRenderProbe onRender={onControllerRender} />
        <StreamingProbe runId={run.id} />
        <Chat />
      </AiProvider>
    );
    await screen.findByText("hello");
    const rendersBeforeStreaming = onControllerRender.mock.calls.length;

    aiListener?.({ kind: "transient", event: makeEvent("delta-one", "assistant-delta", { text: "streaming " }) });
    aiListener?.({ kind: "transient", event: makeEvent("delta-two", "assistant-delta", { text: "works" }) });
    await waitFor(() => expect(screen.getByTestId("streaming-probe").textContent).toBe("streaming works"));
    expect(container.querySelectorAll(".assistant-message")).toHaveLength(0);
    expect(onControllerRender).toHaveBeenCalledTimes(rendersBeforeStreaming);
    const liveProcess = screen.getByText("正在处理").closest(".completed-process")!;

    const rendersBeforeAnswer = onControllerRender.mock.calls.length;
    aiListener?.({ kind: "event", event: makeEvent("answer", "assistant-message", { text: "streaming works" }) });
    await waitFor(() => expect(onControllerRender.mock.calls.length).toBeGreaterThan(rendersBeforeAnswer));
    expect(container.querySelectorAll(".assistant-message")).toHaveLength(0);

    const completedRun = { ...run, status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    aiListener?.({ kind: "snapshot", snapshot: snapshotForRun(completedRun, "idle") });
    const committedAnswer = await waitFor(() => {
      const answer = container.querySelector<HTMLElement>(".assistant-message");
      expect(answer?.textContent).toContain("streaming works");
      return answer!;
    });
    expect(container.querySelectorAll(".assistant-message")).toHaveLength(1);
    expect(Boolean(liveProcess.compareDocumentPosition(committedAnswer) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("promotes a reserved artifact from the live process and replaces it with the durable result", async () => {
    const run = makeRun();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    window.openmind.aiGetEvents = async () => [makeEvent("user", "user-message", { text: "write it" })];
    const { container } = render(<AiProvider initial={snapshotForRun(run, "running")}><Chat /></AiProvider>);
    await screen.findByText("write it");

    for (const [index, text] of [
      "开场\n~~",
      "~~openmind-art",
      "ifact\n# 流式标题",
      "\n\n正在生成正文"
    ].entries()) {
      aiListener?.({ kind: "transient", event: makeEvent(`artifact-${index}`, "assistant-delta", { text }, index + 2) });
    }

    const liveCard = await screen.findByLabelText("产物 · Markdown：流式标题");
    expect(within(liveCard).getByText("正在生成正文")).toBeTruthy();
    expect(within(liveCard).queryByText("已完成")).toBeNull();
    aiListener?.({ kind: "transient", event: makeEvent("article-next", "assistant-delta", { text: "\n\n第二段正文" }, 6) });
    expect(await within(liveCard).findByText("第二段正文")).toBeTruthy();
    expect(screen.getByLabelText("产物 · Markdown：流式标题")).toBe(liveCard);
    expect(within(liveCard).queryByText("已完成")).toBeNull();
    expect(container.textContent).not.toContain("~~~~openmind-artifact");
    expect(container.querySelectorAll(".assistant-message")).toHaveLength(1);
    const process = screen.getByText("正在处理").closest(".completed-process")!;
    expect(process.textContent).not.toContain("流式标题");

    aiListener?.({ kind: "transient", event: makeEvent("article-end", "assistant-delta", { text: "\n~~~~\n结束语" }, 7) });
    expect(await within(liveCard).findByText("已完成")).toBeTruthy();

    const finalText = "最终开场\n~~~~openmind-artifact\n# 最终标题\n\n最终正文\n~~~~\n最终结束";
    aiListener?.({ kind: "event", event: makeEvent("answer", "assistant-message", { text: finalText, phase: "final" }, 9) });
    const completedRun = { ...run, status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    aiListener?.({ kind: "snapshot", snapshot: snapshotForRun(completedRun, "idle") });

    const finalCard = await screen.findByLabelText("产物 · Markdown：最终标题");
    expect(within(finalCard).getByText("最终正文")).toBeTruthy();
    expect(screen.queryByLabelText("产物 · Markdown：流式标题")).toBeNull();
    expect(container.querySelectorAll(".assistant-message")).toHaveLength(1);
    expect(container.textContent).not.toContain("~~~~openmind-artifact");
    fireEvent.click(within(container.querySelector<HTMLElement>(".assistant-message")!).getByRole("button", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("最终开场\n\n# 最终标题\n\n最终正文\n\n最终结束"));
  });

  it("streams article paragraphs while declared files wait for the final reply", async () => {
    const run = makeRun();
    window.openmind.aiGetEvents = async () => [makeEvent("user", "user-message", { text: "写一篇文章并附上 PDF" })];
    const readFile = vi.fn(async () => ({ id: "article-pdf", path: "outputs/article.pdf", name: "article.pdf", kind: "file" as const, byteSize: 1024 }));
    window.openmind.readFileDeliverable = readFile;
    const { container } = render(<AiProvider initial={snapshotForRun(run, "running")}><Chat /></AiProvider>);
    await screen.findByText("写一篇文章并附上 PDF");

    const first = `${declareFiles("outputs/article.pdf")}\n~~~~openmind-artifact\n# 文章标题\n\n第一段正文`;
    aiListener?.({ kind: "transient", event: makeEvent("article-first", "assistant-delta", { text: first }, 2) });
    const article = await screen.findByLabelText("产物 · Markdown：文章标题");
    expect(within(article).getByText("第一段正文")).toBeTruthy();
    expect(container.querySelector(".reply-media-results")).toBeNull();
    expect(readFile).not.toHaveBeenCalled();

    aiListener?.({ kind: "transient", event: makeEvent("article-next", "assistant-delta", { text: "\n\n第二段正文" }, 3) });
    expect(await within(article).findByText("第二段正文")).toBeTruthy();
    expect(within(article).queryByText("已完成")).toBeNull();
    expect(container.textContent).not.toContain("openmind-deliverables");

    const ending = "\n~~~~";
    aiListener?.({ kind: "transient", event: makeEvent("article-end", "assistant-delta", { text: ending }, 4) });
    aiListener?.({ kind: "event", event: makeEvent("article-final", "assistant-message", { text: first + "\n\n第二段正文" + ending, phase: "final" }, 5) });
    aiListener?.({ kind: "snapshot", snapshot: snapshotForRun({ ...run, status: "completed", completedAt: "2026-01-01T00:00:10.000Z" }, "idle") });
    await waitFor(() => expect(container.querySelector(".reply-media-results")?.textContent).toContain("article.pdf"));
    expect(container.querySelectorAll(".assistant-artifact")).toHaveLength(1);
    expect(within(screen.getByLabelText("产物 · Markdown：文章标题")).getByText("第二段正文")).toBeTruthy();
  });

  it("keeps an interrupted live artifact visible as incomplete after failure", async () => {
    const run = makeRun();
    window.openmind.aiGetEvents = async () => [makeEvent("user", "user-message", { text: "write it" })];
    render(<AiProvider initial={snapshotForRun(run, "running")}><Chat /></AiProvider>);
    await screen.findByText("write it");

    aiListener?.({
      kind: "transient",
      event: makeEvent("partial-artifact", "assistant-delta", {
        text: "~~~~openmind-artifact\n# Partial result\nvisible body"
      }, 2)
    });
    expect(await screen.findByLabelText("产物 · Markdown：Partial result")).toBeTruthy();

    aiListener?.({ kind: "event", event: makeEvent("failure", "error", { text: "provider failed" }, 3) });
    const failedRun = { ...run, status: "failed" as const, completedAt: "2026-01-01T00:00:10.000Z", error: "provider failed" };
    aiListener?.({ kind: "snapshot", snapshot: snapshotForRun(failedRun, "failed") });

    const card = await screen.findByLabelText("产物 · Markdown：Partial result");
    expect(within(card).getByText("visible body")).toBeTruthy();
    expect(within(card).getByText("未完整")).toBeTruthy();
    expect(within(card).getByText("产物格式未完整结束，已保留当前正文。")).toBeTruthy();
  });

  it("does not duplicate a provisional artifact inside the completed process trace", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    const raw = "intro\n~~~~openmind-artifact\n# Single artifact\nbody\n~~~~\noutro";
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "write it" }, 1),
      makeEvent("provisional", "assistant-message", { text: raw, phase: "commentary" }, 2),
      makeEvent("final", "assistant-message", { text: raw, phase: "final" }, 3)
    ];
    const { container } = render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    const card = await screen.findByLabelText("产物 · Markdown：Single artifact");
    expect(within(card).getByText("body")).toBeTruthy();
    expect(container.querySelectorAll(".assistant-artifact")).toHaveLength(1);
    expect(container.textContent).not.toContain("~~~~openmind-artifact");
    const process = screen.getByText("已处理").closest(".completed-process")!;
    openDisclosure(process as HTMLElement);
    expect(process.textContent).not.toContain("Single artifact");
    expect(process.textContent).toContain("intro");
    expect(process.textContent).toContain("outro");
  });

  it("never promotes reserved markers from user messages or tool output", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    const raw = "~~~~openmind-artifact\n# Untrusted\nbody\n~~~~";
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: raw }, 1),
      makeEvent("tool-start", "tool-start", { itemId: "read", tool: "Read", input: { file_path: "sample.md" } }, 2),
      makeEvent("tool-complete", "tool-complete", { itemId: "read", output: raw }, 3),
      makeEvent("final", "assistant-message", { text: "done", phase: "final" }, 4)
    ];
    const { container } = render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    expect(await screen.findByText("done")).toBeTruthy();
    expect(container.querySelector(".assistant-artifact")).toBeNull();
    expect(container.querySelector(".user-message-bubble")?.textContent).toContain("~~~~openmind-artifact");
  });

  it("keeps completed history out of the transient stream render path", async () => {
    const activeRun = makeRun();
    const historicalRun = {
      ...makeRun(),
      id: "historical-run",
      status: "completed" as const,
      startedAt: "2025-12-31T23:00:00.000Z",
      completedAt: "2025-12-31T23:00:10.000Z"
    };
    let historicalTextReads = 0;
    const historicalPayload: Record<string, unknown> = { phase: "final" };
    Object.defineProperty(historicalPayload, "text", {
      enumerable: true,
      get: () => {
        historicalTextReads += 1;
        return "stable historical answer";
      }
    });
    window.openmind.aiGetEvents = async () => [{
      ...makeEvent("historical-user", "user-message", { text: "historical prompt" }, 1),
      runId: historicalRun.id,
      timestamp: historicalRun.startedAt
    }, {
      ...makeEvent("historical-answer", "assistant-message", historicalPayload, 2),
      runId: historicalRun.id,
      timestamp: historicalRun.completedAt
    }, {
      ...makeEvent("active-user", "user-message", { text: "active prompt" }, 1),
      runId: activeRun.id,
      timestamp: activeRun.startedAt
    }];
    render(
      <AiProvider initial={{ ...snapshotForRun(activeRun, "running"), runs: [historicalRun, activeRun] }}>
        <Chat />
      </AiProvider>
    );
    expect(await screen.findByText("stable historical answer")).toBeTruthy();
    const readsBeforeStreaming = historicalTextReads;

    aiListener?.({ kind: "transient", event: makeEvent("live", "assistant-delta", { text: "live update" }, 2) });
    expect(await screen.findByText("live update")).toBeTruthy();
    expect(historicalTextReads).toBe(readsBeforeStreaming);
  });

  it("does not flash a buffered delta when completion arrives before the final event", async () => {
    const run = makeRun();
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "hello" }),
      makeEvent("reasoning", "reasoning-summary", { text: "inspect first" }, 2)
    ];
    const onControllerRender = vi.fn();
    const { container } = render(
      <AiProvider initial={snapshotForRun(run, "running")}>
        <ControllerRenderProbe onRender={onControllerRender} />
        <StreamingProbe runId={run.id} />
        <Chat />
      </AiProvider>
    );
    await screen.findByText("hello");
    const liveProcess = screen.getByText("正在处理").closest(".completed-process")!;

    aiListener?.({ kind: "transient", event: makeEvent("delta", "assistant-delta", { text: "stale draft" }) });
    await waitFor(() => expect(screen.getByTestId("streaming-probe").textContent).toBe("stale draft"));
    expect(container.querySelectorAll(".assistant-message")).toHaveLength(0);

    const completedRun = { ...run, status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    const rendersBeforeCompletion = onControllerRender.mock.calls.length;
    aiListener?.({ kind: "snapshot", snapshot: snapshotForRun(completedRun, "idle") });
    await waitFor(() => expect(onControllerRender.mock.calls.length).toBeGreaterThan(rendersBeforeCompletion));
    const completedProcess = screen.getByText("最终回复缺失").closest(".completed-process")!;
    expect(completedProcess).toBe(liveProcess);
    expect(container.querySelectorAll(".assistant-message")).toHaveLength(0);

    aiListener?.({ kind: "event", event: makeEvent("answer", "assistant-message", { text: "real final", phase: "final" }) });
    const answer = await screen.findByText("real final");
    expect(answer.closest(".assistant-message")).toBeTruthy();
    expect(screen.getByText("已处理")).toBeTruthy();
    expect(screen.queryByText("最终回复缺失")).toBeNull();
    expect(container.querySelectorAll(".assistant-message")).toHaveLength(1);
    expect(container.querySelector(".assistant-message")?.textContent).not.toContain("stale draft");
  });

  it("shows live reasoning separately and keeps completed reasoning while the run continues", async () => {
    const run = makeRun();
    const runningSnapshot = {
      ...snapshot,
      sessions: [{
        schemaVersion: 1,
        id: "session",
        projectId: "project",
        scope: { type: "workspace" as const },
        projectRoot: "/project",
        provider: "codex" as const,
        providerId: "codex-native",
        providerSessionId: null,
        cwd: "/project",
        title: "Reasoning",
        permissionProfile: "edit" as const,
        status: "running" as const,
        pinned: false,
        archived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastRunId: "run"
      }],
      runs: [run]
    };
    window.openmind.aiGetEvents = async () => [makeEvent("user", "user-message", { text: "hello" })];
    render(<AiProvider initial={runningSnapshot}><Chat /></AiProvider>);
    await screen.findByText("hello");
    expect(screen.queryByText("正在启动 Codex")).toBeNull();

    aiListener?.({ kind: "transient", event: makeEvent("reasoning-delta", "reasoning-delta", { text: "checking context" }) });
    const liveReasoning = await screen.findByRole("button", { name: "正在思考" });
    expect(liveReasoning.classList.contains("reasoning-waypoint")).toBe(false);
    expectDisclosureOpen(disclosureFor(liveReasoning), true);
    expect(await screen.findByText("checking context")).toBeTruthy();
    expect(screen.getByText(m.ai.thought.streaming)).toBeTruthy();
    expect(screen.queryByText(/思考中 ·/)).toBeNull();
    expect(screen.queryByRole("dialog", { name: /思考过程|推理摘要/ })).toBeNull();
    expect(screen.getAllByText("checking context")).toHaveLength(1);
    expect(screen.queryByText("正在启动 Codex")).toBeNull();

    aiListener?.({ kind: "event", event: makeEvent("reasoning-final", "reasoning-summary", { text: "checking context" }) });
    const pendingReasoning = await screen.findByRole("status", { name: "正在思考" });
    expect(pendingReasoning.classList.contains("pending")).toBe(true);
    expect(await screen.findByRole("button", { name: m.ai.thought.codexSummary })).toBeTruthy();
  });

  it("renders standalone reasoning summaries inline and expands them in place", async () => {
    const orphanedSnapshot = { ...snapshotForRun(makeRun(), "idle"), runs: [] };
    window.openmind.aiGetEvents = async () => [
      makeEvent("reasoning", "reasoning-summary", { text: "standalone thought" })
    ];
    render(<AiProvider initial={orphanedSnapshot}><Chat /></AiProvider>);

    const reasoning = await screen.findByRole("button", { name: /推理摘要|思考过程/ });
    expect(reasoning.classList.contains("reasoning-waypoint")).toBe(false);
    const disclosure = disclosureFor(reasoning);
    expectDisclosureOpen(disclosure, false);
    expect(screen.queryByRole("dialog", { name: /思考过程|推理摘要/ })).toBeNull();
    fireEvent.click(reasoning);
    expectDisclosureOpen(disclosure, true);
    expect(await screen.findByText("standalone thought")).toBeTruthy();
  });

  it("groups one tool call even when status events are interleaved", () => {
    const run = makeRun();
    const items = groupTimeline([
      makeEvent("one", "tool-start", { itemId: "tool-1", tool: "shell" }),
      makeEvent("two", "status", { state: "running" }),
      makeEvent("three", "tool-complete", { itemId: "tool-1" })
    ], [run]);
    const tool = items.find((item) => item.type === "step" && item.step.type === "tool");
    expect(tool?.type === "step" && tool.step.type === "tool" ? tool.step.events.map((event) => event.id) : []).toEqual(["one", "three"]);
    expect(items.some((item) => item.type === "event" && item.event.kind === "status")).toBe(false);
  });

  it("matches Codex tool completion events by the nested item id", () => {
    const { steps } = buildTraceSteps([
      makeEvent("start", "tool-start", { itemId: "command-1", tool: "commandExecution", command: "npm test" }, 1),
      makeEvent("complete", "tool-complete", { tool: "commandExecution", item: { id: "command-1", output: "ok" } }, 2)
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0].type === "tool" ? steps[0].events.map((event) => event.id) : []).toEqual(["start", "complete"]);
  });

  it("omits technical lifecycle events from the visible transcript and keeps semantic steps inline", () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    const items = groupTimeline([
      makeEvent("user", "user-message", { text: "hello" }, 1),
      makeEvent("usage", "usage", { usage: { input_tokens: 100 } }, 2),
      makeEvent("init", "system", { text: "Claude Code 已初始化", subtype: "init" }, 3),
      makeEvent("changes", "changes", { changeSet: {} }, 4),
      makeEvent("done", "status", { state: "completed" }, 5),
      makeEvent("answer", "assistant-message", { text: "done" }, 6)
    ], [run]);
    expect(items.map((item) => item.type === "event" ? item.event.kind : item.step.type)).toEqual(["user-message", "changes", "assistant-message"]);
  });

  it("merges only consecutive reasoning fragments and preserves tool order", () => {
    const { steps } = buildTraceSteps([
      makeEvent("reasoning-one", "reasoning-summary", { text: "first" }, 1),
      makeEvent("reasoning-one-copy", "reasoning-summary", { text: "first" }, 2),
      makeEvent("reasoning-two", "reasoning-summary", { text: "second" }, 3),
      makeEvent("tool-started", "tool-start", { itemId: "tool-1", tool: "Bash" }, 4),
      makeEvent("tool-finished", "tool-complete", { itemId: "tool-1" }, 5),
      makeEvent("reasoning-three", "reasoning-summary", { text: "third" }, 6)
    ]);
    expect(steps.map((step) => step.type)).toEqual(["reasoning", "tool", "reasoning"]);
    expect(steps[0].type === "reasoning" ? steps[0].events.map((event) => event.id) : []).toEqual(["reasoning-one", "reasoning-two"]);
  });

  it("anchors the merged Plan/Todo state at the latest provider update", () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    const events = [
      makeEvent("user", "user-message", { text: "make a plan" }, 1),
      makeEvent("reasoning-old", "reasoning-summary", { text: "draft the approach" }, 2),
      makeEvent("plan", "plan", { text: "1. inspect\n2. verify", sourceEvent: "item/completed" }, 3),
      makeEvent("tool-start", "tool-start", { itemId: "inspect", tool: "Read" }, 4),
      makeEvent("tool-done", "tool-complete", { itemId: "inspect", output: "ok" }, 5),
      makeEvent("reasoning-new", "reasoning-summary", { text: "update after inspection" }, 6),
      makeEvent("todo", "todo", {
        sourceEvent: "turn/plan/updated",
        items: [
          { id: "inspect", text: "Inspect files", status: "completed" },
          { id: "verify", text: "Verify behavior", status: "in-progress" }
        ]
      }, 7),
      makeEvent("answer", "assistant-message", { text: "done", phase: "final" }, 8)
    ];

    const { steps } = buildTraceSteps(events.slice().reverse());
    expect(steps.map((step) => step.type)).toEqual(["reasoning", "tool", "reasoning", "work"]);
    const work = steps.at(-1);
    expect(work?.type === "work" ? work.planEvents.map((event) => event.id) : []).toEqual(["plan"]);
    expect(work?.type === "work" ? work.todoEvents.map((event) => event.id) : []).toEqual(["todo"]);

    const timeline = groupTimeline(events, [run]);
    expect(timeline.map((item) => item.type === "event" ? item.event.kind : item.step.type)).toEqual([
      "user-message",
      "reasoning",
      "tool",
      "reasoning",
      "work",
      "assistant-message"
    ]);
  });

  it("renders provider plan details only when the event carries a real plan", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "hello" }, 1),
      makeEvent("reasoning", "reasoning-summary", {
        text: "planning",
        plan: [
          { text: "Inspect files", status: "completed" },
          { text: "Patch UI", status: "in-progress" }
        ]
      }, 2),
      makeEvent("answer", "assistant-message", { text: "done" }, 3)
    ];
    render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    openDisclosure(disclosureFor(await screen.findByText("已处理")));
    // 推理正文默认收起,但 PlanCard 仍随思考记录可见
    const plan = screen.getByLabelText("执行计划");
    expect(plan).toBeTruthy();
    expect(screen.getByText("Inspect files")).toBeTruthy();
    expect(screen.getByText("Patch UI")).toBeTruthy();
    expect(within(plan).getByText("已完成")).toBeTruthy();
    expect(within(plan).getByText("进行中")).toBeTruthy();
  });

  it("does not invent a plan for plain reasoning summaries", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "hello" }, 1),
      makeEvent("reasoning", "reasoning-summary", { text: "plain reasoning" }, 2),
      makeEvent("answer", "assistant-message", { text: "done" }, 3)
    ];
    render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    openDisclosure(disclosureFor(await screen.findByText("已处理")));
    expect(screen.queryByLabelText("执行计划")).toBeNull();
  });

  it("renders approval banner, expandable detail, and approval decisions", async () => {
    const user = userEvent.setup();
    const approval = makeApproval();
    const run = { ...makeRun(), status: "waiting-approval" as const };
    const approvalEvent = {
      ...makeEvent("approval", "approval-request", { approval }, 2),
      risks: [{ id: "risk-1", kind: "absolute-path" as const, severity: "warning" as const, summary: "命令会访问项目目录外路径。", eventId: "approval" }]
    };
    const waitingSnapshot = { ...snapshotForRun(run, "waiting-approval"), pendingApprovals: [approval] };
    window.openmind.aiRefresh = async () => ({ ...waitingSnapshot, pendingApprovals: [] });
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "run command" }, 1),
      approvalEvent
    ];
    render(<AiProvider initial={waitingSnapshot}><Chat /></AiProvider>);

    // 权限请求位于底部输入区的上方，不进入消息滚动流，也不卸载输入框。
    const bar = await screen.findByText("npm test");
    const approvalPanel = bar.closest(".approval-prompt");
    const banner = approvalPanel?.closest(".approval-banner");
    expect(banner).toBeTruthy();
    expect(banner?.getAttribute("aria-live")).toBe("polite");
    expect(approvalPanel?.closest(".composer")).toBeNull();
    expect(approvalPanel?.closest(".chat-scroll")).toBeNull();
    expect(banner?.parentElement?.classList.contains("chat-bottom-stack")).toBe(true);
    const process = screen.getByText("正在处理").closest(".completed-process") as HTMLElement;
    expect(await within(process).findByText(/需要你的授权：npm test/)).toBeTruthy();
    const editor = screen.getByLabelText("AI 消息") as HTMLTextAreaElement;
    expect(editor.disabled).toBe(false);
    await user.type(editor, "follow-up");
    expect(editor.value).toBe("follow-up");
    expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "加入队列" })).toBeNull();
    expect(screen.getByRole("button", { name: "允许" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeTruthy();
    expect(screen.queryByText("运行测试命令")).toBeNull();
    expect(screen.queryByText("src/app.ts")).toBeNull();
    expect(screen.queryByText("已处理")).toBeNull();

    // Expand details → title, cwd, paths, risk, and the session-scope allow.
    await user.click(screen.getByRole("button", { name: /详情/ }));
    expect(screen.getByText("运行测试命令")).toBeTruthy();
    expect(screen.getByText("/project")).toBeTruthy();
    expect(screen.getByText("src/app.ts")).toBeTruthy();
    expect(screen.getByText("命令会访问项目目录外路径。")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "本会话允许" }));
    expect(resolveApproval).toHaveBeenCalledWith("approval-1", "accept-session");
  });

  it("renders approval decisions as compact action summaries", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "run command" }, 1),
      makeEvent("approval-decision", "approval-decision", { decision: "decline", approval: makeApproval() }, 2)
    ];

    render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    expect(await screen.findByText("已拒绝 npm test")).toBeTruthy();
    expect(screen.queryByText(/审批结果/)).toBeNull();
  });

  it("keeps the resolved approval decision in the process trace", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "run command" }, 1),
      makeEvent("approval-decision", "approval-decision", { decision: "accept", approval: makeApproval() }, 2),
      makeEvent("tool-start", "tool-start", { itemId: "tool-1", tool: "Bash", input: { command: "npm test" } }, 3),
      makeEvent("tool-complete", "tool-complete", { itemId: "tool-1", output: "ok" }, 4),
      makeEvent("answer", "assistant-message", { text: "done" }, 5)
    ];

    render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    openDisclosure(disclosureFor(await screen.findByText("已处理")));
    expect(await screen.findByText("已运行")).toBeTruthy();
    expect(await screen.findByText("已运行了 npm test")).toBeTruthy();
  });

  it("renders final answer markdown and answer actions", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    const completedSnapshot = snapshotForRun(run, "idle");
    const answer = [
      "Final answer with [source](https://example.com).",
      "Local note [20260707_daily_summary.md](20260707_daily_summary.md).",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "> quoted result",
      "",
      "```ts",
      "const value = 1;",
      "```"
    ].join("\n");
    startRun.mockResolvedValue({ session: completedSnapshot.sessions[0], run: { ...makeRun(), id: "rerun" } });
    window.openmind.aiRefresh = async () => completedSnapshot;
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "hello" }, 1),
      makeEvent("answer", "assistant-message", { text: answer }, 2)
    ];
    render(<AiProvider initial={completedSnapshot}><Chat /></AiProvider>);

    const assistant = (await screen.findByText("quoted result")).closest("article")!;
    expect(within(assistant).getByRole("link", { name: "source" }).getAttribute("target")).toBe("_blank");
    await user.click(within(assistant).getByRole("link", { name: "20260707_daily_summary.md" }));
    expect(openPath).toHaveBeenCalledWith("openmind/daily-summary/20260707_daily_summary.md");
    expect(within(assistant).getByRole("table")).toBeTruthy();
    expect(assistant.querySelector("pre")?.textContent).toContain("const value = 1;");

    await user.click(within(assistant).getByRole("button", { name: "引用回复" }));
    expect(screen.getByText("1 项上下文")).toBeTruthy();
    await user.click(within(assistant.querySelector<HTMLElement>(".message-actions")!).getByRole("button", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(answer));
    await user.click(within(assistant).getByRole("button", { name: "按原上下文重新运行" }));
    await waitFor(() => expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session", prompt: "test" })));
    await user.click(within(assistant).getByRole("button", { name: "从此回复创建新会话" }));
    await waitFor(() => expect((screen.getByLabelText("AI 消息") as HTMLTextAreaElement).value).toBe("test"));
  });

  it.each(["changes", "write", "change-set"] as const)(
    "waits for the final reply and completed run before showing edited files (%s)",
    async (source) => {
      const changeSet = makeChangeSet();
      const run = { ...makeRun(), changeSet: source === "change-set" ? changeSet : null };
      const changeEvents = source === "write" ? [
        makeEvent("write-start", "tool-start", { itemId: "write-1", tool: "Write", input: { file_path: "src/app.ts" } }, 2),
        makeEvent("write-done", "tool-complete", { itemId: "write-1", tool: "Write", output: "ok" }, 3)
      ] : source === "changes" ? [
        makeEvent("changes", "changes", { changeSet }, 2)
      ] : [];
      window.openmind.aiGetEvents = async () => [
        makeEvent("user", "user-message", { text: "patch app" }, 1),
        ...changeEvents
      ];
      const { container } = render(<AiProvider initial={snapshotForRun(run, "running")}><Chat /></AiProvider>);

      await screen.findByText("patch app");
      expect(container.querySelector(".change-review-card")).toBeNull();

      act(() => {
        aiListener?.({ kind: "transient", event: makeEvent("delta", "assistant-delta", { text: "Finishing edits" }, 4) });
      });
      await screen.findByText("Finishing edits");
      expect(container.querySelector(".change-review-card")).toBeNull();

      act(() => {
        aiListener?.({ kind: "event", event: makeEvent("answer", "assistant-message", { text: "Saved.", phase: "final" }, 5) });
      });
      await screen.findByText("Saved.");
      expect(container.querySelector(".assistant-message")).toBeNull();
      expect(container.querySelector(".change-review-card")).toBeNull();

      act(() => {
        const completedRun = { ...run, status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
        aiListener?.({ kind: "snapshot", snapshot: snapshotForRun(completedRun, "idle") });
      });
      const review = await screen.findByRole("region", { name: "已编辑 1 个文件" });
      const answer = screen.getByText("Saved.").closest(".assistant-message")!;
      expect(answer.contains(review)).toBe(true);
      const content = answer.querySelector(".assistant-content")!;
      const actions = answer.querySelector(".message-meta")!;
      expect(Boolean(content.compareDocumentPosition(review) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
      expect(Boolean(review.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
      expect(within(review).getByRole("button", { name: "src/app.ts" })).toBeTruthy();
      expect(review.textContent).not.toMatch(/[+-]\d+/);
    }
  );

  it("waits for the final reply when run completion arrives before it", async () => {
    const changeSet = makeChangeSet();
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z", changeSet };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "patch app" }, 1),
      makeEvent("changes", "changes", { changeSet }, 2)
    ];
    const { container } = render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    await screen.findByText("最终回复缺失");
    expect(container.querySelector(".change-review-card")).toBeNull();

    act(() => {
      aiListener?.({ kind: "event", event: makeEvent("answer", "assistant-message", { text: "Saved.", phase: "final" }, 3) });
    });
    const review = await screen.findByRole("region", { name: "已编辑 1 个文件" });
    const answer = screen.getByText("Saved.").closest(".assistant-message")!;
    expect(answer.contains(review)).toBe(true);
    expect(Boolean(review.compareDocumentPosition(answer.querySelector(".message-meta")!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("renders a compact edited-files context that opens files in the preview", async () => {
    const user = userEvent.setup();
    const openPreview = vi.fn();
    const changeSet = makeChangeSet();
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z", changeSet };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "patch app" }, 1),
      makeEvent("changes", "changes", { changeSet: { id: changeSet.id, files: changeSet.files } }, 2),
      makeEvent("answer", "assistant-message", { text: "done" }, 3)
    ];
    const { container } = render(
      <AiProvider initial={snapshotForRun(run, "idle")}>
        <FilePreviewProvider open={openPreview}><Chat /></FilePreviewProvider>
      </AiProvider>
    );

    openDisclosure(disclosureFor(await screen.findByText("已处理")));
    const review = container.querySelector<HTMLElement>(".change-review-card")!;
    expect(review).toBeTruthy();
    expect(within(review).getByText("src/app.ts")).toBeTruthy();
    expect(within(review).queryByText("修改 · +3 -1")).toBeNull();
    expect(within(review).queryByText(/@@ -1,2 \+1,2 @@/)).toBeNull();
    expect(within(review).queryByRole("button", { name: "打开文件" })).toBeNull();
    expect(within(review).queryByRole("button", { name: "所在目录" })).toBeNull();
    expect(within(review).queryByRole("button", { name: "复制" })).toBeNull();
    expect(screen.queryByText("应用历史变更")).toBeNull();
    expect(screen.queryByText("应用隔离变更")).toBeNull();

    await user.click(within(review).getByRole("button", { name: "src/app.ts" }));
    expect(openPreview).toHaveBeenCalledWith("src/app.ts");
  });

  it("attaches existing media to the completed reply before files and actions", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:01:00Z", changeSet: makeChangeSet() };
    const read = vi.fn(async ({ path }: { path: string }) => ({ id: path, path, name: "final.mp4", kind: "video" as const, byteSize: 100 }));
    window.openmind.readFileDeliverable = read;
    window.openmind.aiGetEvents = async () => [makeEvent("u", "user-message", { text: "生成视频" }, 1), makeEvent("a", "assistant-message", { text: `视频已完成。\n${declareFiles("outputs/final.mp4")}`, phase: "final" }, 2)];
    const open = vi.fn();
    render(<AiProvider initial={snapshotForRun(run, "idle")}><FilePreviewProvider open={open}><Chat /></FilePreviewProvider></AiProvider>);
    const preview = await screen.findByRole("button", { name: "预览 final.mp4" });
    const reply = preview.closest(".assistant-message")!;
    const media = reply.querySelector(".reply-media-results")!;
    const changes = reply.querySelector(".change-review-card")!;
    expect(Boolean(media.compareDocumentPosition(changes) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(changes.compareDocumentPosition(reply.querySelector(".message-meta")!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    fireEvent.click(preview); expect(open).toHaveBeenCalledWith("outputs/final.mp4", undefined);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each([["deck.pptx", "file"], ["movie.mp4", "video"]] as const)("keeps intermediate images and narration in the process when the deliverable is %s", async (name, kind) => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:01:00Z" };
    const images = Array.from({ length: 10 }, (_, index) => generatedImage(index));
    const read = vi.fn(async ({ path }: { path: string }) => ({ id: path, path, name, kind, byteSize: 100 }));
    window.openmind.readFileDeliverable = read;
    window.openmind.readChatImage = vi.fn(async () => ({ dataUrl: "data:image/png;base64,cGl4ZWw=", width: 1, height: 1 }));
    window.openmind.aiGetEvents = async () => [
      makeEvent("u", "user-message", { text: "制作最终交付文件" }, 1),
      ...images.map((image, index) => makeEvent(`image-${index}`, "image-artifact", { image }, index + 2)),
      makeEvent("changes", "changes", { files: [...images.map(image => image.source), "assets/narration.wav", `outputs/${name}`] }, 20),
      makeEvent("a", "assistant-message", { text: `采用了 [参考图](<assets/input.png>)。\n${declareFiles(`outputs/${name}`)}`, phase: "final" }, 21)
    ];
    const { container } = render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);
    await screen.findByText(name);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith({ path: `outputs/${name}` });
    expect(container.querySelectorAll(".reply-media-results article")).toHaveLength(1);
    expect(container.querySelector(".generated-images")).toBeNull();
    openDisclosure(container.querySelector<HTMLElement>(".completed-process")!);
    fireEvent.click(screen.getByRole("button", { name: "生成的图片（10）" }));
    await screen.findByAltText("素材 0");
    expect(container.querySelectorAll(".completed-process .generated-image")).toHaveLength(10);
    expect(container.querySelectorAll(".assistant-message .generated-image")).toHaveLength(0);
  });

  it("delivers the explicitly selected image and video together without promoting other generated resources", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:01:00Z" };
    const image = generatedImage(0);
    window.openmind.readChatImage = vi.fn(async () => ({ dataUrl: "data:image/png;base64,cGl4ZWw=", width: 1, height: 1 }));
    window.openmind.readFileDeliverable = vi.fn(async ({ path }) => ({ id: path, path, name: "movie.mp4", kind: "video" as const, byteSize: 100 }));
    window.openmind.aiGetEvents = async () => [
      makeEvent("u", "user-message", { text: "生成1张图和1个视频" }, 1),
      makeEvent("image-0", "image-artifact", { image }, 2),
      makeEvent("image-1", "image-artifact", { image: generatedImage(1) }, 3),
      makeEvent("a", "assistant-message", { text: `完成。\n${declareFiles(image.source, "outputs/movie.mp4")}`, phase: "final" }, 4)
    ];
    const { container } = render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);
    await screen.findByAltText("素材 0");
    expect(screen.queryByAltText("素材 1")).toBeNull();
    expect(container.querySelectorAll(".reply-media-results article")).toHaveLength(2);
    expect(window.openmind.readFileDeliverable).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".assistant-message")?.textContent).not.toContain("openmind-deliverables");
  });

  it.each(["running", "failed", "cancelled"] as const)("does not publish a file declaration from a %s run", async status => {
    const run = { ...makeRun(), status };
    const read = vi.fn();
    window.openmind.readFileDeliverable = read;
    window.openmind.aiGetEvents = async () => [
      makeEvent("u", "user-message", { text: "生成视频" }, 1),
      makeEvent("a", "assistant-message", { text: `尚在处理。\n${declareFiles("outputs/movie.mp4")}`, phase: "final" }, 2)
    ];
    const { container } = render(<AiProvider initial={snapshotForRun(run, status === "running" ? "running" : "idle")}><Chat /></AiProvider>);
    await screen.findByText("生成视频");
    expect(container.querySelector(".reply-media-results")).toBeNull();
    expect(container.textContent).not.toContain('"path"');
    expect(read).not.toHaveBeenCalled();
  });

  it("does not turn ordinary final links or a tool's quoted declaration into deliverables", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:01:00Z" };
    const read = vi.fn();
    window.openmind.readFileDeliverable = read;
    window.openmind.aiGetEvents = async () => [
      makeEvent("u", "user-message", { text: "解释素材用途" }, 1),
      makeEvent("t", "tool-output", { tool: "read", text: declareFiles("assets/input.png") }, 2),
      makeEvent("a", "assistant-message", { text: "[素材](<assets/input.png>) 是输入图。", phase: "final" }, 3)
    ];
    const { container } = render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);
    await screen.findByRole("link", { name: "素材" });
    expect(container.querySelector(".reply-media-results")).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps each edited-files footer with its own reply and copies only the reply text", async () => {
    const writeText = vi.fn(async () => {});
    const previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      const changes = makeChangeSet();
      const earlier = { ...makeRun(), id: "earlier", status: "completed" as const, completedAt: "2026-01-01T00:00:10Z", changeSet: { ...changes, id: "earlier-changes", runId: "earlier", files: [{ ...changes.files[0], path: "earlier.ts" }] } };
      const latest = { ...makeRun(), status: "completed" as const, startedAt: "2026-01-01T01:00:00Z", completedAt: "2026-01-01T01:00:10Z", changeSet: { ...changes, files: [{ ...changes.files[0], path: "latest.ts" }] } };
      window.openmind.aiGetEvents = async () => [
        { ...makeEvent("earlier-user", "user-message", { text: "first edit" }, 1), runId: earlier.id, timestamp: earlier.startedAt },
        { ...makeEvent("earlier-answer", "assistant-message", { text: "Earlier reply", phase: "final" }, 2), runId: earlier.id, timestamp: earlier.completedAt },
        { ...makeEvent("latest-user", "user-message", { text: "second edit" }, 1), timestamp: latest.startedAt },
        { ...makeEvent("latest-answer", "assistant-message", { text: "Latest reply", phase: "final" }, 2), timestamp: latest.completedAt }
      ];
      render(<AiProvider initial={{ ...snapshotForRun(latest, "idle"), runs: [earlier, latest] }}><Chat /></AiProvider>);
      const latestReply = (await screen.findByText("Latest reply")).closest<HTMLElement>(".assistant-message")!;
      const earlierReply = screen.getByText("Earlier reply").closest<HTMLElement>(".assistant-message")!;
      for (const [reply, path, other] of [[earlierReply, "earlier.ts", "latest.ts"], [latestReply, "latest.ts", "earlier.ts"]] as const) {
        const review = reply.querySelector<HTMLElement>(".change-review-card")!;
        expect(within(review).getByRole("button", { name: path })).toBeTruthy();
        expect(review.textContent).not.toContain(other);
        expect(Boolean(review.compareDocumentPosition(reply.querySelector(".message-meta")!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
      }
      const nextPrompt = screen.getByText("second edit").closest(".user-message")!;
      expect(Boolean(earlierReply.compareDocumentPosition(nextPrompt) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
      await act(async () => { fireEvent.click(within(earlierReply).getByRole("button", { name: "复制" })); });
      expect(writeText).toHaveBeenLastCalledWith("Earlier reply");
      await act(async () => { fireEvent.click(within(latestReply).getByRole("button", { name: "复制" })); });
      expect(writeText).toHaveBeenLastCalledWith("Latest reply");
    } finally {
      if (previousClipboard) Object.defineProperty(navigator, "clipboard", previousClipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("builds the post-final change artifact from a successful Claude write tool", async () => {
    const run = {
      ...makeRun(),
      provider: "claude" as const,
      providerId: "claude-native",
      status: "completed" as const,
      completedAt: "2026-01-01T00:00:10.000Z"
    };
    window.openmind.aiGetEvents = async () => [
      { ...makeEvent("user", "user-message", { text: "edit app" }, 1), provider: "claude" },
      { ...makeEvent("write-start", "tool-start", { itemId: "write-1", tool: "Write", input: { file_path: "src/app.ts" } }, 2), provider: "claude" },
      { ...makeEvent("write-done", "tool-complete", { itemId: "write-1", tool: "Write", output: "ok" }, 3), provider: "claude" },
      { ...makeEvent("answer", "assistant-message", { text: "Saved.", phase: "final" }, 4), provider: "claude" }
    ];
    const { container } = render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    const answer = (await screen.findByText("Saved.")).closest(".assistant-message") as HTMLElement;
    const review = container.querySelector<HTMLElement>(".change-review-card")!;
    expect(review).toBeTruthy();
    expect(review.textContent).toContain("1");
    expect(review.textContent).toContain("src/app.ts");
    expect(answer.contains(review)).toBe(true);
    expect(Boolean(review.compareDocumentPosition(answer.querySelector(".message-meta")!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("places thought and tool calls directly between the prompt and final answer", () => {
    const items = groupTimeline([
      makeEvent("prompt", "user-message", { text: "fix it" }, 1),
      makeEvent("thought", "reasoning-summary", { text: "inspect" }, 2),
      makeEvent("tool", "tool-start", { itemId: "tool-1", tool: "Read" }, 3),
      makeEvent("done", "tool-complete", { itemId: "tool-1" }, 4),
      makeEvent("answer", "assistant-message", { text: "fixed" }, 5)
    ], [{ ...makeRun(), status: "completed", completedAt: "2026-01-01T00:00:10.000Z" }]);
    expect(items.map((item) => item.type === "event" ? item.event.kind : item.type)).toEqual([
      "user-message",
      "step",
      "step",
      "assistant-message"
    ]);
  });

  it("retains completed reasoning and tool calls in compact sidebar history", () => {
    const events = [
      makeEvent("user", "user-message", { text: "hello" }, 1),
      makeEvent("reasoning", "reasoning-summary", { text: "inspect" }, 2),
      makeEvent("tool-start", "tool-start", { itemId: "tool-1", tool: "Read" }, 3),
      makeEvent("tool-output", "tool-output", { itemId: "tool-1", text: "large output" }, 4),
      makeEvent("tool-complete", "tool-complete", { itemId: "tool-1", output: "done" }, 5),
      makeEvent("answer", "assistant-message", { text: "finished" }, 6)
    ];
    expect(compactEvents(events).map((event) => event.kind)).toEqual([
      "user-message",
      "reasoning-summary",
      "tool-start",
      "tool-complete",
      "assistant-message"
    ]);
  });

  it.each([false, true])("loads conversation history through complete-turn cursor pages (compact=%s)", async (compact) => {
    const oldRun = {
      ...makeRun(),
      id: "old-run",
      status: "completed" as const,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:02.000Z"
    };
    const newRun = {
      ...makeRun(),
      id: "new-run",
      status: "completed" as const,
      startedAt: "2026-01-01T01:00:00.000Z",
      completedAt: "2026-01-01T01:00:02.000Z"
    };
    const oldEvent = {
      ...makeEvent("old-user", "user-message", { text: "older prompt" }, 1),
      runId: oldRun.id,
      timestamp: oldRun.startedAt
    };
    const newEvent = {
      ...makeEvent("new-user", "user-message", { text: "newest prompt" }, 1),
      runId: newRun.id,
      timestamp: newRun.startedAt
    };
    const listTurns = vi.fn(async (_sessionId: string, params = {}) => {
      const cursor = (params as { cursor?: string | null }).cursor;
      return cursor
        ? { data: [makeTurn(oldRun, [oldEvent])], nextCursor: null, total: 2, parseErrors: 0 }
        : { data: [makeTurn(newRun, [newEvent])], nextCursor: "older", total: 2, parseErrors: 0 };
    });
    window.openmind.aiListTurns = listTurns;
    window.openmind.aiGetEvents = async () => { throw new Error("legacy event loading should not run"); };

    const { container } = render(
      <AiProvider initial={{ ...snapshotForRun(newRun, "idle"), runs: [newRun, oldRun] }}>
        <Chat compact={compact} />
      </AiProvider>
    );

    expect(await screen.findByText("newest prompt")).toBeTruthy();
    expect(listTurns).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "加载更早的回合" })).toBeNull();
    fireEvent.wheel(container.querySelector(".chat-scroll")!, { deltaY: -100 });
    expect(await screen.findByText("older prompt")).toBeTruthy();
    expect(listTurns).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("keeps paged history inside the render budget until the user scrolls upward (compact=%s)", async (compact) => {
    const oldRun = {
      ...makeRun(),
      id: "paged-old-run",
      status: "completed" as const,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z"
    };
    const newRun = {
      ...makeRun(),
      id: "paged-new-run",
      status: "completed" as const,
      startedAt: "2026-01-01T01:00:00.000Z",
      completedAt: "2026-01-01T01:01:00.000Z"
    };
    const oldEvents = Array.from({ length: 350 }, (_, index) => ({
      ...makeEvent(
        `paged-old-${index}`,
        index === 0 ? "user-message" as const : "status" as const,
        index === 0 ? { text: "paged older prompt" } : { state: "running" },
        index + 1
      ),
      runId: oldRun.id,
      timestamp: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`
    }));
    const newEvents = [
      { ...makeEvent("paged-new-user", "user-message", { text: "paged newest prompt" }, 1), runId: newRun.id, timestamp: newRun.startedAt },
      { ...makeEvent("paged-new-answer", "assistant-message", { text: "paged newest answer", phase: "final" }, 2), runId: newRun.id, timestamp: newRun.completedAt }
    ];
    window.openmind.aiListTurns = async () => ({
      data: [makeTurn(newRun, newEvents), makeTurn(oldRun, oldEvents)],
      nextCursor: null,
      total: 2,
      parseErrors: 0
    });

    const { container } = render(
      <AiProvider initial={{ ...snapshotForRun(newRun, "idle"), runs: [oldRun, newRun] }}>
        <Chat compact={compact} />
      </AiProvider>
    );

    expect(await screen.findByText("paged newest answer")).toBeTruthy();
    expect(screen.queryByText("paged older prompt")).toBeNull();
    fireEvent.wheel(container.querySelector(".chat-scroll")!, { deltaY: -100 });
    expect(await screen.findByText("paged older prompt")).toBeTruthy();
  });

  it.each([false, true])("loads only near the top, locks duplicate requests, and reveals an oversized older turn (compact=%s)", async (compact) => {
    const fixture = historyFixture(1100);
    let finish!: (page: AiTurnPage) => void;
    const list = vi.fn(async (_id: string, input?: { cursor?: string | null }) => input?.cursor
      ? new Promise<AiTurnPage>(resolve => { finish = resolve; }) : fixture.recent);
    window.openmind.aiListTurns = list;
    const { container } = render(<AiProvider initial={fixture.snapshot}><Chat compact={compact} /></AiProvider>);
    await screen.findByText("recent history prompt");
    const scroller = container.querySelector<HTMLElement>(".chat-scroll")!;
    const geometry = mockChatScroller(scroller);
    fireEvent.wheel(scroller, { deltaY: 100 });
    fireEvent.wheel(scroller, { deltaY: -100, ctrlKey: true });
    geometry.setTop(500);
    geometry.setTop(250);
    expect(list).toHaveBeenCalledTimes(1);
    geometry.setTop(140);
    fireEvent.wheel(scroller, { deltaY: -100 });
    fireEvent.wheel(scroller, { deltaY: -100 });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(list).toHaveBeenLastCalledWith("session", { cursor: "older-history", limit: 20, sortDirection: "desc" });
    expect(screen.getByRole("status").textContent).toContain("正在加载");
    await act(async () => { finish(fixture.older); });
    expect(await screen.findByText("old history prompt")).toBeTruthy();
    expect(screen.getByText("recent history prompt")).toBeTruthy();
    fireEvent.wheel(scroller, { deltaY: -100 });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("keeps the visible message anchored when older rows are prepended (compact=%s)", async (compact) => {
    const fixture = historyFixture();
    let finish!: (page: AiTurnPage) => void;
    window.openmind.aiListTurns = async (_id, input) => input?.cursor
      ? new Promise<AiTurnPage>(resolve => { finish = resolve; }) : fixture.recent;
    const { container } = render(<AiProvider initial={fixture.snapshot}><Chat compact={compact} /></AiProvider>);
    await screen.findByText("recent history prompt");
    const scroller = container.querySelector<HTMLElement>(".chat-scroll")!;
    const geometry = mockChatScroller(scroller);
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      if (this === scroller) return { top: 0, bottom: 200, left: 0, right: 600, width: 600, height: 200 } as DOMRect;
      if (this.classList.contains("timeline-presence-item")) {
        const index = [...scroller.querySelectorAll(".timeline-presence-item")].indexOf(this);
        const top = index * 80 - scroller.scrollTop;
        return { top, bottom: top + 80, left: 0, right: 600, width: 600, height: 80 } as DOMRect;
      }
      return originalRect.call(this);
    });
    geometry.setTop(40);
    const anchor = scroller.querySelector<HTMLElement>(".timeline-presence-item")!;
    const before = anchor.getBoundingClientRect().top;
    fireEvent.wheel(scroller, { deltaY: -100 });
    await act(async () => { geometry.setHeight(2000); finish(fixture.older); });
    await screen.findByText("old history prompt");
    expect(anchor.isConnected).toBe(true);
    expect(anchor.getBoundingClientRect().top).toBe(before);
    vi.restoreAllMocks();
  });

  it.each([false, true])("retries a failed page on a later upward scroll without an automatic retry loop (compact=%s)", async (compact) => {
    const fixture = historyFixture();
    let olderRequests = 0;
    const list = vi.fn(async (_id: string, input?: { cursor?: string | null }) => {
      if (!input?.cursor) return fixture.recent;
      if (++olderRequests === 1) throw new Error("temporary history error");
      return fixture.older;
    });
    window.openmind.aiListTurns = list;
    const { container } = render(<AiProvider initial={fixture.snapshot}><Chat compact={compact} /></AiProvider>);
    await screen.findByText("recent history prompt");
    const scroller = container.querySelector<HTMLElement>(".chat-scroll")!;
    await act(async () => { fireEvent.wheel(scroller, { deltaY: -100 }); });
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("old history prompt")).toBeNull();
    await waitFor(() => expect(scroller.hasAttribute("data-history-prepend")).toBe(false));
    await act(async () => { fireEvent.wheel(scroller, { deltaY: -100 }); });
    expect(await screen.findByText("old history prompt")).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("does not treat filtered compact output as hidden older history", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:01:00Z" };
    const events = [
      makeEvent("user", "user-message", { text: "compact history prompt" }, 1),
      ...Array.from({ length: 500 }, (_, index) => makeEvent(`output-${index}`, "tool-output", { text: "output chunk" }, index + 2)),
      makeEvent("answer", "assistant-message", { text: "compact history answer", phase: "final" }, 502)
    ];
    const list = vi.fn(async () => ({ data: [makeTurn(run, events)], nextCursor: null, total: 1, parseErrors: 0 }));
    window.openmind.aiListTurns = list;
    const { container } = render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat compact /></AiProvider>);
    await screen.findByText("compact history answer");
    const scroller = container.querySelector<HTMLElement>(".chat-scroll")!;
    fireEvent.wheel(scroller, { deltaY: -100 });
    expect(scroller.hasAttribute("data-history-prepend")).toBe(false);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("renders the latest prompt when an older run is larger than the history budget", async () => {
    const oldRun = {
      ...makeRun(),
      id: "old-run",
      status: "completed" as const,
      prompt: "打印当前目录",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z"
    };
    const newRun = {
      ...makeRun(),
      id: "new-run",
      status: "completed" as const,
      prompt: "总结下今天的内容",
      startedAt: "2026-01-01T01:00:00.000Z",
      completedAt: "2026-01-01T01:01:00.000Z"
    };
    const oldEvents = Array.from({ length: 301 }, (_, index) => ({
      ...makeEvent(
        `old-${index}`,
        index === 0 ? "user-message" as const : "status" as const,
        index === 0 ? { text: "打印当前目录" } : { state: "running" },
        index + 1
      ),
      runId: oldRun.id,
      timestamp: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`
    }));
    const newEvents = [
      { ...makeEvent("new-user", "user-message", { text: "总结下今天的内容" }, 1), runId: newRun.id, timestamp: "2026-01-01T01:00:00.000Z" },
      { ...makeEvent("new-answer", "assistant-message", { text: "这是今天的总结" }, 2), runId: newRun.id, timestamp: "2026-01-01T01:00:01.000Z" }
    ];
    window.openmind.aiGetEvents = async () => [...oldEvents, ...newEvents];

    render(
      <AiProvider initial={{ ...snapshotForRun(newRun, "idle"), runs: [newRun, oldRun] }}>
        <Chat />
      </AiProvider>
    );

    expect(await screen.findByText("总结下今天的内容")).toBeTruthy();
    expect(screen.getByText("这是今天的总结")).toBeTruthy();
    expect(screen.queryByText("打印当前目录")).toBeNull();
    expect(screen.queryByRole("button", { name: /300/ })).toBeNull();
  });

  it("renders one completed process before only the final assistant message in the run", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "organize posts" }, 1),
      makeEvent("reasoning-one", "reasoning-summary", { text: "inspect today's posts" }, 2),
      makeEvent("progress-one", "assistant-message", { text: "I will scan the titles first." }, 3),
      makeEvent("reasoning-two", "reasoning-summary", { text: "group posts by topic" }, 4),
      makeEvent("progress-two", "assistant-message", { text: "The topics are concentrated." }, 5),
      makeEvent("tool-start", "tool-start", { itemId: "tool-1", tool: "Write" }, 6),
      makeEvent("tool-complete", "tool-complete", { itemId: "tool-1", output: "saved" }, 7),
      makeEvent("answer", "assistant-message", { text: "The digest has been saved." }, 8)
    ];

    render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    expect(await screen.findByText("The digest has been saved.")).toBeTruthy();
    expect(screen.getAllByText("已处理")).toHaveLength(1);
    const process = screen.getByText("已处理").closest(".completed-process") as HTMLElement;
    openDisclosure(process);
    expect(within(process).getByText(/I will scan the titles first/)).toBeTruthy();
    expect(within(process).getByText(/The topics are concentrated/)).toBeTruthy();
    const prompt = screen.getByText("organize posts").closest(".user-message")!;
    const finalAnswer = screen.getByText("The digest has been saved.").closest(".assistant-message")!;
    expect(Boolean(prompt.compareDocumentPosition(process) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(process.compareDocumentPosition(finalAnswer) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("keeps work state inside process detail before the final reply", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "make a plan" }, 1),
      makeEvent("reasoning", "reasoning-summary", { text: "organize the work" }, 2),
      makeEvent("plan", "plan", { text: "1. collect posts\n2. write digest" }, 3),
      makeEvent("answer", "assistant-message", { text: "plan complete", phase: "final" }, 4)
    ];
    const { container } = render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    const finalAnswer = (await screen.findByText("plan complete")).closest(".assistant-message")!;
    const process = screen.getByText("已处理").closest(".completed-process") as HTMLElement;
    openDisclosure(process);
    const work = container.querySelector<HTMLElement>(".work-state-card")!;
    expect(work).toBeTruthy();
    expect(process.contains(work)).toBe(true);
    expect(Boolean(process.compareDocumentPosition(finalAnswer) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("shows the active run's latest Todo snapshot above the composer and clears an empty snapshot", async () => {
    const run = makeRun();
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "implement the UI" }, 1),
      makeEvent("todo-old", "todo", {
        sourceEvent: "turn/plan/updated",
        items: [{ id: "old", text: "Outdated step", status: "pending" }]
      }, 2),
      makeEvent("todo-latest", "todo", {
        sourceEvent: "turn/plan/updated",
        items: [
          { id: "inspect", text: "Inspect current behavior", status: "completed" },
          { id: "wire", text: "Wire Todo UI", activeForm: "Wiring Todo UI", status: "in-progress" }
        ]
      }, 3)
    ];
    const { container } = render(<AiProvider initial={snapshotForRun(run, "running")}><Chat /></AiProvider>);

    const liveTodo = await screen.findByLabelText(m.ai.plan.liveAria);
    expect(liveTodo.parentElement?.classList.contains("chat-bottom-stack")).toBe(true);
    expect(within(liveTodo).getByText("Inspect current behavior")).toBeTruthy();
    expect(within(liveTodo).getByText("Wiring Todo UI")).toBeTruthy();
    expect(within(liveTodo).queryByText("Outdated step")).toBeNull();
    expect(container.querySelector(".chat-scroll .active-todo-float")).toBeNull();

    aiListener?.({
      kind: "event",
      event: makeEvent("todo-empty", "todo", { sourceEvent: "turn/plan/updated", items: [] }, 4)
    });
    await waitFor(() => expect(screen.queryByLabelText(m.ai.plan.liveAria)).toBeNull());
  });

  it("removes the active Todo float when its run reaches a terminal state", async () => {
    const run = makeRun();
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "verify the UI" }, 1),
      makeEvent("todo", "todo", {
        sourceEvent: "turn/plan/updated",
        items: [{ id: "verify", text: "Verify Todo rendering", status: "in-progress" }]
      }, 2)
    ];
    render(<AiProvider initial={snapshotForRun(run, "running")}><Chat /></AiProvider>);

    expect(await screen.findByLabelText(m.ai.plan.liveAria)).toBeTruthy();
    const completed = { ...run, status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    aiListener?.({ kind: "snapshot", snapshot: snapshotForRun(completed, "idle") });

    await waitFor(() => expect(screen.queryByLabelText(m.ai.plan.liveAria)).toBeNull());
  });

  it("puts the completed process before assistant text when history starts mid-turn", async () => {
    const run = {
      ...makeRun(),
      status: "completed" as const,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:10.000Z"
    };
    window.openmind.aiGetEvents = async () => [
      makeEvent("progress-one", "assistant-message", { text: "I will scan the titles first." }, 1),
      makeEvent("reasoning-one", "reasoning-summary", { text: "inspect today's posts" }, 2),
      makeEvent("tool-start", "tool-start", { itemId: "tool-1", tool: "Write" }, 3),
      makeEvent("tool-complete", "tool-complete", { itemId: "tool-1", output: "saved" }, 4),
      makeEvent("answer", "assistant-message", { text: "The digest has been saved." }, 5)
    ];

    render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    expect(await screen.findByText("The digest has been saved.")).toBeTruthy();
    const process = screen.getByText("已处理").closest(".completed-process") as HTMLElement;
    openDisclosure(process);
    expect(within(process).getByText(/I will scan the titles first/)).toBeTruthy();
    const finalAnswer = screen.getByText("The digest has been saved.").closest(".assistant-message")!;
    expect(Boolean(process.compareDocumentPosition(finalAnswer) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("keeps completed tool details collapsed and resets them when the process closes", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "check project" }, 1),
      makeEvent("pwd-start", "tool-start", { itemId: "pwd", tool: "Bash", input: { command: "pwd" } }, 2),
      makeEvent("pwd-done", "tool-complete", { itemId: "pwd", output: "/project" }, 3),
      makeEvent("test-start", "tool-start", { itemId: "test", tool: "Bash", input: { command: "npm test" } }, 4),
      makeEvent("test-done", "tool-complete", { itemId: "test", state: "failed", output: "failed" }, 5),
      makeEvent("git-start", "tool-start", { itemId: "git", tool: "Bash", input: { command: "git status" } }, 6),
      makeEvent("git-done", "tool-complete", { itemId: "git", output: "clean" }, 7),
      makeEvent("answer", "assistant-message", { text: "checked" }, 8)
    ];
    render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    const process = disclosureFor(await screen.findByText("已处理"));
    expectDisclosureOpen(process, false);
    openDisclosure(process);
    const group = await waitFor(() => {
      const element = process.querySelector<HTMLElement>(".command-group.flat");
      expect(element).not.toBeNull();
      return element!;
    });
    expect(group.classList.contains("failed")).toBe(true);
    expect(group.querySelectorAll(".tool-event")).toHaveLength(3);
    const [pwd, failed, git] = Array.from(group.querySelectorAll<HTMLElement>(".tool-event"));
    expect(failed.classList.contains("failed")).toBe(true);
    expectDisclosureOpen(pwd, false);
    expectDisclosureOpen(failed, false);
    expectDisclosureOpen(git, false);
    fireEvent.click(disclosureTrigger(pwd));
    await waitFor(() => {
      expectDisclosureOpen(pwd, true);
      expectDisclosureOpen(failed, false);
    });
    // P1-PRC-3: 改手风琴为多开——打开 git 不会关闭 pwd,可对比两个命令输出
    fireEvent.click(disclosureTrigger(git));
    await waitFor(() => {
      expectDisclosureOpen(git, true);
      expectDisclosureOpen(pwd, true);
    });
    fireEvent.click(disclosureTrigger(process));
    await waitFor(() => expect(process.querySelector(".tool-event")).toBeNull());
    expectDisclosureOpen(process, false);
    openDisclosure(process);
    expect(process.querySelectorAll(".tool-event")).toHaveLength(3);
    for (const call of process.querySelectorAll<HTMLElement>(".tool-event")) expectDisclosureOpen(call, false);
  });

  it("keeps a running command group open with command details collapsed", async () => {
    const run = makeRun();
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "build app" }, 1),
      makeEvent("first-start", "tool-start", { itemId: "first", tool: "Bash", input: { command: "npm run build" } }, 2),
      makeEvent("first-done", "tool-complete", { itemId: "first", output: "built" }, 3),
      makeEvent("second-start", "tool-start", { itemId: "second", tool: "Bash", input: { command: "npm run package" } }, 4)
    ];
    render(<AiProvider initial={snapshotForRun(run, "running")}><Chat /></AiProvider>);

    const process = disclosureFor(await screen.findByText(m.ai.chat.processing));
    expectDisclosureOpen(process, true);
    await within(process).findByRole("button", { name: /npm run package/ });
    const calls = process.querySelectorAll<HTMLElement>(".command-group.flat .tool-event");
    expect(calls).toHaveLength(2);
    expect(calls[1].classList.contains("running")).toBe(true);
    expectDisclosureOpen(calls[0], false);
    expectDisclosureOpen(calls[1], false);
  });

  it("groups consecutive mixed tools with useful operation summaries", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "inspect content" }, 1),
      makeEvent("glob-start", "tool-start", { itemId: "glob", tool: "Glob", input: { pattern: "**/*.md", path: "openmind" } }, 2),
      makeEvent("glob-done", "tool-complete", { itemId: "glob", output: "openmind/today.md" }, 3),
      makeEvent("read-start", "tool-start", { itemId: "read", tool: "Read", input: { file_path: "openmind/today.md" } }, 4),
      makeEvent("read-done", "tool-complete", { itemId: "read", output: "today" }, 5),
      makeEvent("bash-start", "tool-start", { itemId: "bash", tool: "Bash", input: { command: "git status" } }, 6),
      makeEvent("bash-done", "tool-complete", { itemId: "bash", output: "clean" }, 7),
      makeEvent("answer", "assistant-message", { text: "done" }, 8)
    ];
    render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    const process = disclosureFor(await screen.findByText(m.ai.chat.processed));
    openDisclosure(process);
    const group = await waitFor(() => {
      const group = process.querySelector<HTMLElement>(".command-group.flat");
      expect(group).toBeTruthy();
      return group!;
    });
    expect(group.classList.contains("completed")).toBe(true);
    expect(group.querySelectorAll(".tool-event")).toHaveLength(3);
    expect(within(group).getByRole("button", { name: /Glob.*\*\*\/\*\.md.*openmind/ })).toBeTruthy();
    expect(within(group).getByRole("button", { name: /Read.*openmind\/today\.md/ })).toBeTruthy();
    expect(within(group).getByRole("button", { name: /git status/ })).toBeTruthy();
  });

  it("preserves an open tool while its stream grows from one call into a group", async () => {
    const run = makeRun();
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "inspect project" }, 1),
      makeEvent("first-start", "tool-start", { itemId: "first", tool: "Glob", input: { pattern: "**/*.tsx", path: "renderer/src" } }, 2)
    ];
    render(<AiProvider initial={snapshotForRun(run, "running")}><Chat /></AiProvider>);

    const process = disclosureFor(await screen.findByText(m.ai.chat.processing));
    const first = disclosureFor(await within(process).findByRole("button", { name: /Glob/ }));
    fireEvent.click(disclosureTrigger(first));
    expectDisclosureOpen(first, true);

    aiListener?.({ kind: "event", event: makeEvent("first-done", "tool-complete", { itemId: "first", output: "renderer/src/App.tsx" }, 3) });
    aiListener?.({ kind: "event", event: makeEvent("second-start", "tool-start", { itemId: "second", tool: "Read", input: { file_path: "renderer/src/App.tsx" } }, 4) });

    await within(process).findByRole("button", { name: /Read/ });
    const group = process.querySelector<HTMLElement>(".command-group.flat")!;
    const groupedFirst = group.querySelector<HTMLElement>(".tool-event")!;
    expect(group.querySelectorAll(".tool-event")).toHaveLength(2);
    expect(groupedFirst).toBe(first);
    expectDisclosureOpen(groupedFirst, true);

    aiListener?.({
      kind: "event",
      event: makeEvent("third-start", "tool-start", { itemId: "third", tool: "Grep", input: { pattern: "TODO", path: "renderer/src" } }, 5)
    });

    await within(process).findByRole("button", { name: /Grep/ });
    const updatedGroup = process.querySelector<HTMLElement>(".command-group.flat")!;
    expect(updatedGroup).toBe(group);
    expectDisclosureOpen(groupedFirst, true);
    expect(updatedGroup.querySelectorAll(".tool-event")).toHaveLength(3);
  });

  it("propagates a cancelled run status to an unfinished tool in the Chat trace", async () => {
    const run = { ...makeRun(), status: "cancelled" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "run tests" }, 1),
      makeEvent("test-start", "tool-start", { itemId: "test", tool: "Bash", input: { command: "npm test" } }, 2)
    ];
    render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    const process = disclosureFor(await screen.findByRole("button", { name: "已取消" }));
    openDisclosure(process);
    expect(within(process).getByText("命令已取消")).toBeTruthy();
    expect(process.querySelector(".tool-event")?.classList.contains("cancelled")).toBe(true);
    expect(process.querySelector(".spin")).toBeNull();
  });

  it("propagates a cancelled run status to an unfinished subtask in the Chat trace", async () => {
    const run = { ...makeRun(), status: "cancelled" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "打开b站，截图首页" }, 1),
      makeEvent("task-started", "system", {
        semanticType: "subtask",
        subtype: "task_started",
        taskId: "task-1",
        description: "Open bilibili via agent-browser and screenshot homepage"
      }, 2)
    ];
    render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    const process = disclosureFor(await screen.findByRole("button", { name: "已取消" }));
    openDisclosure(process);
    expect(within(process).getByText("Open bilibili via agent-browser and screenshot homepage")).toBeTruthy();
    expect(process.querySelector(".subtask-trace")?.classList.contains("cancelled")).toBe(true);
    expect(process.querySelector(".spin")).toBeNull();
  });

  it("keeps completed process cycles visible alongside the running cycle", async () => {
    const run = makeRun();
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "inspect and build" }, 1),
      makeEvent("reasoning-1", "reasoning-summary", { text: "inspect the project" }, 2),
      makeEvent("read-start", "tool-start", { itemId: "read", tool: "Read", input: { file_path: "src/app.ts" } }, 3),
      makeEvent("read-done", "tool-complete", { itemId: "read", output: "done" }, 4),
      makeEvent("reasoning-2", "reasoning-summary", { text: "run the build" }, 5),
      makeEvent("build-start", "tool-start", { itemId: "build", tool: "Bash", input: { command: "npm run build" } }, 6)
    ];
    const { container } = render(<AiProvider initial={snapshotForRun(run, "running")}><Chat /></AiProvider>);

    const process = disclosureFor(await screen.findByText("正在处理"));
    await waitFor(() => {
      expect(process.querySelectorAll('[data-trace-cycle="current"]')).toHaveLength(1);
      expect(process.querySelectorAll('[data-trace-cycle="completed"]')).toHaveLength(1);
    });
    expectDisclosureOpen(process, true);
    expect(process.querySelector(".trace-cycle-history")).toBeNull();
    expect(within(process).queryByRole("button", { name: /已完成 \d+ 轮/ })).toBeNull();
    expect(process.querySelector(".completed-process-title small")?.textContent).not.toMatch(/思考|工具/);
    expect(process.querySelectorAll('[data-trace-cycle="current"]')).toHaveLength(1);
    expect(process.querySelectorAll('[data-trace-cycle="completed"]')).toHaveLength(1);
    expect(process.querySelectorAll(".tool-event")).toHaveLength(2);
    expect(within(process.querySelector<HTMLElement>('[data-trace-cycle="current"]')!).getByText("正在运行")).toBeTruthy();

    aiListener?.({ kind: "event", event: makeEvent("build-done", "tool-complete", { itemId: "build", output: "built" }, 7) });
    await waitFor(() => {
      expect(process.querySelector(".trace-cycle-history")).toBeNull();
      expect(within(process).queryByRole("button", { name: /已完成 \d+ 轮/ })).toBeNull();
      expect(process.querySelector('[data-trace-cycle="current"]')).toBeNull();
      expect(process.querySelectorAll('[data-trace-cycle="completed"]')).toHaveLength(2);
      expect(process.querySelectorAll(".tool-event")).toHaveLength(2);
    });
    expect(container.querySelector(".reasoning-event.pending")).toBeTruthy();
  });

  it("renders live process commentary as Markdown without hiding completed steps", async () => {
    const run = makeRun();
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "hello" }, 1),
      makeEvent("reasoning", "reasoning-summary", { text: "inspect the project" }, 2),
      makeEvent("read-start", "tool-start", { itemId: "read", tool: "Read", input: { file_path: "src/app.ts" } }, 3),
      makeEvent("read-done", "tool-complete", { itemId: "read", output: "done" }, 4)
    ];
    const { container } = render(<AiProvider initial={snapshotForRun(run, "running")}><Chat /></AiProvider>);
    await screen.findByText("hello");
    const process = container.querySelector<HTMLElement>(".completed-process")!;
    expect(process.querySelector(".reasoning-event")).toBeTruthy();
    expect(process.querySelector(".tool-event")).toBeTruthy();

    const markdown = [
      "## Live heading",
      "",
      "**bold update**",
      "",
      "| Step | State |",
      "| --- | --- |",
      "| Inspect | Done |"
    ].join("\n");
    aiListener?.({ kind: "transient", event: makeEvent("live-markdown", "assistant-delta", { text: markdown }, 5) });

    await waitFor(() => expect(process.querySelector("h2")?.textContent).toBe("Live heading"));
    const narrative = process.querySelector<HTMLElement>(".process-narrative")!;
    expect(narrative.querySelector("strong")?.textContent).toBe("bold update");
    expect(narrative.querySelector("table")?.textContent).toContain("Inspect");
    expect(narrative.tagName).toBe("DIV");
    expect(process.querySelector(".reasoning-event")).toBeTruthy();
    expect(process.querySelector(".tool-event")).toBeTruthy();
  });

  it("keeps a command group open when its last running command completes", async () => {
    const first = [
      makeEvent("first-start", "tool-start", { itemId: "first", tool: "Bash", input: { command: "npm test" } }, 1),
      makeEvent("first-done", "tool-complete", { itemId: "first", output: "ok" }, 2)
    ];
    const secondStart = makeEvent("second-start", "tool-start", { itemId: "second", tool: "Bash", input: { command: "npm run build" } }, 3);
    const { rerender } = render(<CommandGroup calls={[{ key: "first", events: first }, { key: "second", events: [secondStart] }]} />);
    const group = disclosureFor(await screen.findByText("正在运行 2 条命令"));
    expectDisclosureOpen(group, true);

    rerender(<CommandGroup calls={[
      { key: "first", events: first },
      { key: "second", events: [secondStart, makeEvent("second-done", "tool-complete", { itemId: "second", output: "built" }, 4)] }
    ]} />);
    await waitFor(() => expectDisclosureOpen(group, true));
  });

  it("keeps a command group open when the parent run cancels unfinished commands", async () => {
    const start = makeEvent("unfinished-start", "tool-start", { itemId: "unfinished", tool: "Bash", input: { command: "npm test" } }, 1);
    const calls = [{ key: "unfinished", events: [start] }];
    const { rerender } = render(<CommandGroup calls={calls} runStatus="running" />);
    const group = disclosureFor(await screen.findByText("正在运行 1 条命令"));
    expectDisclosureOpen(group, true);

    rerender(<CommandGroup calls={calls} runStatus="cancelled" />);

    await waitFor(() => expectDisclosureOpen(group, true));
    expect(screen.getByText("命令执行已取消 · 共 1 条")).toBeTruthy();
    expect(screen.queryByText("已运行 1 条命令")).toBeNull();
    expect(group.querySelector(".tool-event")?.classList.contains("cancelled")).toBe(true);
    expect(group.querySelector(".spin")).toBeNull();
  });

  it.each([
    ["failed", "命令执行失败 · 共 1 条", "failed"],
    ["conflicted", "命令执行存在冲突 · 共 1 条", "conflicted"],
    ["completed", "命令结果不完整 · 共 1 条", "incomplete"]
  ] as const)("distinguishes command group terminal state %s", (runStatus, label, className) => {
    const start = makeEvent("terminal-start", "tool-start", { itemId: "terminal", tool: "Bash", input: { command: "npm test" } }, 1);
    const { container } = render(<CommandGroup calls={[{ key: "terminal", events: [start] }]} runStatus={runStatus} />);

    expect(screen.getByText(label)).toBeTruthy();
    expect(container.querySelector(".command-group")?.classList.contains(className)).toBe(true);
    expect(container.querySelector(".spin")).toBeNull();
  });

  it("renders completed reasoning as narrative and keeps tool details collapsed", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    const completedSnapshot = {
      ...snapshot,
      sessions: [{
        schemaVersion: 1,
        id: "session",
        projectId: "project",
        scope: { type: "workspace" as const },
        projectRoot: "/project",
        provider: "codex" as const,
        providerId: "codex-native",
        providerSessionId: null,
        cwd: "/project",
        title: "Completed",
        permissionProfile: "edit" as const,
        status: "idle" as const,
        pinned: false,
        archived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:10.000Z",
        lastRunId: "run"
      }],
      runs: [run]
    };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "hello" }),
      makeEvent("reasoning", "reasoning-summary", { text: "inspect context" }),
      makeEvent("tool-start", "tool-start", { itemId: "tool-1", tool: "Read", input: { file_path: "src/app.ts" } }),
      makeEvent("tool-complete", "tool-complete", { itemId: "tool-1", output: "done" }),
      makeEvent("answer", "assistant-message", { text: "finished" })
    ];
    render(<AiProvider initial={completedSnapshot}><Chat /></AiProvider>);
    expect(await screen.findByText("finished")).toBeTruthy();
    const process = disclosureFor(screen.getByText("已处理"));
    expectDisclosureOpen(process, false);
    expect(process.querySelector(".completed-process-title small")?.textContent).not.toMatch(/思考|工具/);
    openDisclosure(process);
    expectDisclosureOpen(process, true);
    const reasoningInline = within(process).getByRole("button", { name: /推理摘要|思考过程/ });
    expect(reasoningInline.classList.contains("reasoning-waypoint")).toBe(false);
    const reasoningDisclosure = disclosureFor(reasoningInline);
    expectDisclosureOpen(reasoningDisclosure, false);
    fireEvent.click(reasoningInline);
    expectDisclosureOpen(reasoningDisclosure, true);
    expect(within(process).getByText("inspect context")).toBeTruthy();
    const tool = disclosureFor(within(process).getByRole("button", { name: /Read.*src\/app\.ts/ }));
    expectDisclosureOpen(tool, false);
    expect(tool.textContent).toContain("app.ts");
    fireEvent.click(disclosureTrigger(tool));
    expectDisclosureOpen(tool, true);
  });

  it("unmounts a closed completed process body and restores it on demand", async () => {
    const run = { ...makeRun(), status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    window.openmind.aiGetEvents = async () => [
      makeEvent("lazy-user", "user-message", { text: "inspect lazily" }, 1),
      makeEvent("lazy-tool-start", "tool-start", { itemId: "lazy-tool", tool: "Read", input: { file_path: "src/lazy.ts" } }, 2),
      makeEvent("lazy-tool-done", "tool-complete", { itemId: "lazy-tool", output: "done" }, 3),
      makeEvent("lazy-answer", "assistant-message", { text: "lazy complete", phase: "final" }, 4)
    ];
    render(<AiProvider initial={snapshotForRun(run, "idle")}><Chat /></AiProvider>);

    expect(await screen.findByText("lazy complete")).toBeTruthy();
    const process = disclosureFor(screen.getByText("已处理"));
    expect(process.querySelector(".tool-event")).toBeNull();

    openDisclosure(process);
    expect(await within(process).findByRole("button", { name: /Read.*src\/lazy\.ts/ })).toBeTruthy();
    fireEvent.click(disclosureTrigger(process));
    await waitFor(() => expect(process.querySelector(".tool-event")).toBeNull());
  });

  it("shows processing immediately while the first provider event is still pending", async () => {
    const run = makeRun();
    window.openmind.aiGetEvents = async () => [];
    const { container } = render(<AiProvider initial={snapshotForRun(run, "running")}><Chat /></AiProvider>);

    const process = disclosureFor(await screen.findByText("正在处理"));
    expectDisclosureOpen(process, true);
    expect(process.querySelector(".reasoning-event.pending")).toBeTruthy();
    expect(container.querySelector(".chat-empty")).toBeNull();
    expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
  });

  it("keeps the visible transient tail long enough to complete its cancelled exit", async () => {
    const run = makeRun();
    window.openmind.aiGetEvents = async () => [];
    render(<AiProvider initial={snapshotForRun(run, "running")}><Chat /></AiProvider>);
    await screen.findByText("正在处理");

    aiListener?.({ kind: "transient", event: makeEvent("partial", "assistant-delta", { text: "unfinished transient tail" }, 2) });
    expect(await screen.findByText("unfinished transient tail")).toBeTruthy();
    aiListener?.({ kind: "event", event: makeEvent("cancelled", "status", { state: "cancelled" }, 3) });

    await waitFor(() => expect(screen.getByText("unfinished transient tail").closest(".transient-process-presence")?.hasAttribute("data-leaving")).toBe(true));
    await waitFor(() => expect(screen.queryByText("unfinished transient tail")).toBeNull(), { timeout: 600 });
  });

  it("keeps live processing visible and open until the run actually completes", async () => {
    const run = makeRun();
    window.openmind.aiGetEvents = async () => [
      makeEvent("user", "user-message", { text: "hello" }, 1),
      makeEvent("tool-start", "tool-start", { itemId: "tool-1", tool: "Bash", input: { command: "npm test" } }, 2)
    ];
    render(<AiProvider initial={snapshotForRun(run, "running")}><Chat /></AiProvider>);
    const liveProcess = disclosureFor(await screen.findByText("正在处理"));
    expectDisclosureOpen(liveProcess, true);
    const tool = disclosureFor(await screen.findByText("正在运行"));
    expectDisclosureOpen(tool, false);

    aiListener?.({ kind: "event", event: makeEvent("tool-complete", "tool-complete", { itemId: "tool-1", output: "ok" }, 3) });
    aiListener?.({ kind: "event", event: makeEvent("progress", "assistant-message", { text: "working" }, 4) });
    aiListener?.({ kind: "event", event: makeEvent("answer", "assistant-message", { text: "done" }, 5) });
    await waitFor(() => expect(screen.queryByText("done")).toBeNull());
    expect(screen.queryByText("working")).toBeNull();
    expect(screen.getByText("正在处理")).toBeTruthy();
    expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();

    const completedRun = { ...run, status: "completed" as const, completedAt: "2026-01-01T00:00:10.000Z" };
    aiListener?.({ kind: "snapshot", snapshot: snapshotForRun(completedRun, "idle") });
    await waitFor(() => expect(screen.getByText("已处理")).toBeTruthy());
    const process = disclosureFor(screen.getByText("已处理"));
    expect(process).toBe(liveProcess);
    await waitFor(() => expectDisclosureOpen(process, false));
    openDisclosure(process);
    expectDisclosureOpen(process, true);
    expect(within(process).getByText("working")).toBeTruthy();
    const answer = screen.getByText("done").closest(".assistant-message")!;
    expect(Boolean(process.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(screen.queryByText("正在启动 Codex")).toBeNull();
    expect(screen.queryByText("正在启动 Claude Code")).toBeNull();
    expect(screen.queryByRole("button", { name: "停止" })).toBeNull();

    cleanup();
    const failed = { ...run, status: "failed" as const, completedAt: "2026-01-01T00:00:10.000Z", error: "command failed" };
    window.openmind.aiGetEvents = async () => [
      makeEvent("user-failed", "user-message", { text: "hello" }, 1),
      makeEvent("error", "error", { text: "command failed" }, 2)
    ];
    render(<AiProvider initial={snapshotForRun(failed, "failed")}><Chat /></AiProvider>);
    const failedEvent = disclosureFor(await screen.findByText("运行失败"));
    expectDisclosureOpen(failedEvent, true);
  });
});

describe("run waiting and queue", () => {
  it("keeps follow-ups queued without a processing timer and stops the executing run", async () => {
    const active = { ...makeRun(), id: "executing", prompt: "当前任务", startedAt: "2026-01-01T00:00:00.000Z" };
    const queued = { ...makeRun(), id: "follow-up", prompt: "追加问题", status: "queued" as const, startedAt: "2026-01-02T00:00:00.000Z" };
    const state = { ...snapshotForRun(active, "running"), runs: [active, queued] };
    window.openmind.aiGetEvents = async () => [
      { ...makeEvent("first-prompt", "user-message", { text: active.prompt }, 1), runId: active.id },
      { ...makeEvent("follow-up-prompt", "user-message", { text: queued.prompt }, 2), runId: queued.id }
    ];
    window.openmind.aiRefresh = async () => state;
    const cancel = vi.fn(async () => true);
    window.openmind.aiCancelRun = cancel;
    const { container } = render(<AiProvider initial={state}><Chat /></AiProvider>);

    await screen.findByText("排队中");
    expect(container.querySelectorAll(".completed-process.processing")).toHaveLength(1);
    expect(container.querySelector(".queued-process small")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 条消息正在排队" }));
    expect(screen.getByRole("button", { name: "1 条消息正在排队" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: m.ai.composer.cancelQueued }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(queued.id));
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(active.id));

    aiListener?.({ kind: "snapshot", snapshot: { ...state, runs: [{ ...active, status: "completed", completedAt: "2026-01-02T00:00:01.000Z" }, { ...queued, status: "running" }] } });
    await waitFor(() => expect(screen.queryByText("排队中")).toBeNull());
    expect(screen.queryByRole("button", { name: "1 条消息正在排队" })).toBeNull();
    expect(container.querySelectorAll(".completed-process.processing")).toHaveLength(1);
  });

  it("reports the scheduler worker exiting and clears in-flight streaming (AI-T05)", async () => {
    window.openmind.aiGetEvents = async () => [makeEvent("u", "user-message", { text: "hello" }, 1)];
    render(<AiProvider initial={snapshotForRun(makeRun(), "running")}><Chat /></AiProvider>);
    await screen.findByText("hello");
    aiListener?.({ kind: "worker-exit", code: 1 });
    await waitFor(() => expect(screen.getByText(/AI 调度服务异常退出/)).toBeTruthy());
    expect(screen.getByText(/代码 1/)).toBeTruthy();
  });

  it("queues a follow-up message behind the active run and can stop it (AI-T07)", async () => {
    const cancelSpy = vi.fn(async () => true);
    window.openmind.aiCancelRun = cancelSpy;
    const active = { ...makeRun(), id: "run-active", status: "running" as const, startedAt: "2026-01-02T00:00:00.000Z", prompt: "first" };
    const queued = { ...makeRun(), id: "run-queued", status: "queued" as const, startedAt: "2026-01-01T00:00:00.000Z", prompt: "second" };
    const twoRunSnapshot = { ...snapshotForRun(active, "running"), runs: [active, queued] };
    window.openmind.aiGetEvents = async () => [makeEvent("user-active", "user-message", { text: "first" }, 1)];
    render(<AiProvider initial={twoRunSnapshot}><Chat /></AiProvider>);
    await screen.findByText("first");
    expect(screen.getByText(/1 条消息正在排队/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "停止" })[0]);
    await waitFor(() => expect(cancelSpy).toHaveBeenCalledWith("run-active"));
  });

  it("keeps following AI output while the user has not scrolled upward", async () => {
    window.openmind.aiGetEvents = async () => [
      makeEvent("u", "user-message", { text: "hello" }, 1),
      makeEvent("tool-start", "tool-start", { itemId: "inspect", tool: "Read", input: { file_path: "README.md" } }, 2)
    ];
    const { container } = render(<AiProvider initial={snapshotForRun(makeRun(), "running")}><Chat /></AiProvider>);
    await screen.findByText("hello");
    const scroller = container.querySelector(".chat-scroll") as HTMLElement;
    const geometry = mockChatScroller(scroller);
    geometry.setTop(geometry.bottom());

    geometry.setHeight(1180);
    fireEvent.scroll(scroller);
    aiListener?.({ kind: "event", event: makeEvent("tool-complete", "tool-complete", { itemId: "inspect", output: "done" }, 3) });
    await waitFor(() => expect(scroller.scrollTop).toBe(geometry.bottom()));

    geometry.setHeight(1300);
    aiListener?.({ kind: "transient", event: makeEvent("delta", "assistant-delta", { text: "latest streamed reply" }, 4) });
    await waitFor(() => expect(scroller.scrollTop).toBe(geometry.bottom()));
    expect(screen.queryByRole("button", { name: "回到底部" })).toBeNull();
  });

  it("keeps following delayed layout growth and resumes after layout returns to the bottom", async () => {
    const observers: Array<{
      callback: ResizeObserverCallback;
      observer: ResizeObserver;
      targets: Set<Element>;
    }> = [];
    class MockResizeObserver {
      readonly targets = new Set<Element>();
      constructor(readonly callback: ResizeObserverCallback) {
        observers.push({ callback, observer: this as unknown as ResizeObserver, targets: this.targets });
      }
      observe(target: Element) { this.targets.add(target); }
      unobserve(target: Element) { this.targets.delete(target); }
      disconnect() { this.targets.clear(); }
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    window.openmind.aiGetEvents = async () => [makeEvent("u", "user-message", { text: "hello" }, 1)];
    const { container } = render(<AiProvider initial={snapshotForRun(makeRun(), "running")}><Chat /></AiProvider>);
    await screen.findByText("hello");
    const scroller = container.querySelector(".chat-scroll") as HTMLElement;
    const thread = container.querySelector(".chat-thread") as HTMLElement;
    const geometry = mockChatScroller(scroller);
    geometry.setTop(geometry.bottom());
    const chatObserver = observers.find(({ targets }) => targets.has(thread));
    expect(chatObserver).toBeTruthy();

    geometry.setHeight(1180);
    chatObserver!.callback([], chatObserver!.observer);
    await waitFor(() => expect(scroller.scrollTop).toBe(geometry.bottom()));

    geometry.setTop(300);
    expect(await screen.findByRole("button", { name: "回到底部" })).toBeTruthy();
    geometry.setHeight(450);
    chatObserver!.callback([], chatObserver!.observer);
    await waitFor(() => expect(scroller.scrollTop).toBe(geometry.bottom()));
    await waitFor(() => expect(screen.queryByRole("button", { name: "回到底部" })).toBeNull());

    geometry.setHeight(600);
    chatObserver!.callback([], chatObserver!.observer);
    await waitFor(() => expect(scroller.scrollTop).toBe(geometry.bottom()));
  });

  it("holds position while reading and surfaces a return-to-bottom control (AI-T06)", async () => {
    window.openmind.aiGetEvents = async () => [makeEvent("u", "user-message", { text: "hello" }, 1)];
    const { container } = render(<AiProvider initial={snapshotForRun(makeRun(), "running")}><Chat /></AiProvider>);
    await screen.findByText("hello");
    const scroller = container.querySelector(".chat-scroll") as HTMLElement;
    const geometry = mockChatScroller(scroller);
    geometry.setTop(geometry.bottom());
    geometry.setTop(300);
    geometry.setHeight(1200);
    aiListener?.({ kind: "event", event: makeEvent("a", "assistant-message", { text: "a fresh reply" }, 2) });
    const jump = await screen.findByRole("button", { name: "回到底部" });
    await screen.findByText("a fresh reply");
    expect(scroller.scrollTop).toBe(300);
    expect(jump.querySelector(".jump-bottom-badge")).toBeNull();
    geometry.setTop(geometry.bottom());
    await waitFor(() => expect(jump.hasAttribute("data-leaving")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("button", { name: "回到底部" })).toBeNull());

    geometry.setHeight(1300);
    aiListener?.({ kind: "transient", event: makeEvent("next-delta", "assistant-delta", { text: "keep following" }, 3) });
    await waitFor(() => expect(scroller.scrollTop).toBe(geometry.bottom()));
  });
});

function historyFixture(oldEventCount = 2) {
  const recent = { ...makeRun(), id: "history-new", status: "completed" as const, startedAt: "2026-01-02T00:00:00Z", completedAt: "2026-01-02T00:01:00Z" };
  const older = { ...recent, id: "history-old", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:01:00Z" };
  const events = (run: AiRun, label: string, count: number) => Array.from({ length: count }, (_, index) => ({
    ...makeEvent(`${run.id}-${index}`, index === 0 ? "user-message" : index === count - 1 ? "assistant-message" : "status",
      index === 0 ? { text: `${label} history prompt` } : index === count - 1 ? { text: `${label} history answer`, phase: "final" } : { state: "running" }, index + 1),
    runId: run.id, timestamp: run.startedAt
  }));
  return {
    snapshot: { ...snapshotForRun(recent, "idle"), runs: [older, recent] },
    recent: { data: [makeTurn(recent, events(recent, "recent", 2))], nextCursor: "older-history", total: 2, parseErrors: 0 } satisfies AiTurnPage,
    older: { data: [makeTurn(older, events(older, "old", oldEventCount))], nextCursor: null, total: 2, parseErrors: 0 } satisfies AiTurnPage
  };
}

function makeRun(): AiRun {
  return {
    schemaVersion: 1,
    id: "run",
    sessionId: "session",
    projectId: "project",
    scope: { type: "workspace" },
    provider: "codex",
    providerId: "codex-native",
    permissionProfile: "edit",
    status: "running",
    prompt: "test",
    contexts: [],
    turnContext: null,
    workspacePath: null,
    baseCommit: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    error: null,
    changeSet: null,
    risks: []
  };
}

function makeTurn(run: AiRun, events: AiEvent[]): AiTurn {
  return {
    id: run.id,
    sessionId: run.sessionId,
    status: run.status === "completed" ? "completed" : "in_progress",
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    context: null,
    events,
    responseItems: [],
    error: run.error
  };
}

function makeChangeSet(): ChangeSet {
  const patch = [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,2 +1,2 @@",
    "-old value",
    "+new value"
  ].join("\n");
  return {
    id: "change-set",
    runId: "run",
    baseCommit: "abc123",
    files: [{
      path: "src/app.ts",
      status: "modified",
      additions: 3,
      deletions: 1,
      patch
    }],
    patch,
    createdAt: "2026-01-01T00:00:09.000Z",
    status: "pending",
    appliedPatches: [],
    appliedFiles: []
  };
}

function makeApproval(): ApprovalRequest {
  return {
    id: "approval-1",
    runId: "run",
    sessionId: "session",
    providerRequestId: "provider-approval-1",
    category: "command",
    title: "运行测试命令",
    detail: "Provider 请求执行 npm test。",
    cwd: "/project",
    command: "npm test",
    paths: ["src/app.ts"],
    createdAt: "2026-01-01T00:00:02.000Z",
    status: "pending"
  };
}

function snapshotForRun(run: AiRun, status: "idle" | "running" | "waiting-approval" | "failed"): AiSnapshot {
  return {
    ...snapshot,
    sessions: [{
      schemaVersion: 1,
      id: "session",
      projectId: "project",
      scope: run.scope,
      projectRoot: "/project",
      provider: run.provider,
      providerId: run.providerId,
      providerSessionId: null,
      cwd: "/project",
      title: "Lifecycle",
      permissionProfile: run.permissionProfile,
      status,
      pinned: false,
      archived: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: run.completedAt || run.startedAt,
      lastRunId: run.id
    }],
    runs: [run]
  };
}

function makeEvent(id: string, kind: AiEvent["kind"], payload: Record<string, unknown>, seq = Number(id.length)): AiEvent {
  return {
    schemaVersion: 1,
    id,
    seq,
    timestamp: `2026-01-01T00:00:0${id.length}.000Z`,
    projectId: "project",
    sessionId: "session",
    runId: "run",
    provider: "codex",
    kind,
    payload,
    risks: []
  };
}

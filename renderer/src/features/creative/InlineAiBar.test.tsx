import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { InlineAiBar } from "./InlineAiBar";

type AiEventCallback = Parameters<DesktopApi["onAiEvent"]>[0];

afterEach(() => cleanup());

beforeEach(() => {
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
  };
  window.matchMedia = (() => ({
    matches: false, media: "", onchange: null,
    addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    dispatchEvent: () => true
  })) as typeof window.matchMedia;
});

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [{
    id: "codex-native", provider: "codex", label: "Codex", runtime: "native",
    available: true, version: "1", supportsApprovals: true, supportsResume: true,
    supportsImages: true, diagnostic: null, detectedModel: null, contextWindow: null, installable: false, oneMillion: false
  }],
  sessions: [],
  runs: [],
  pendingApprovals: []
};

/** aiStartRun 必须返回 { session, run } 结构(ai-context.send 会解构)。 */
function makeStartRunResult() {
  return {
    session: {
      schemaVersion: 1, id: "sess-1", projectId: "p", scope: { type: "workspace" as const }, projectRoot: "/project",
      title: "t", provider: "codex", providerId: "codex-native", providerSessionId: null,
      cwd: "/project", permissionProfile: "read-only", status: "idle",
      pinned: false, archived: false, createdAt: "now", updatedAt: "now", lastRunId: null
    },
    run: {
      schemaVersion: 1, id: "run-1", sessionId: "sess-1", projectId: "p", scope: { type: "workspace" as const },
      provider: "codex", providerId: "codex-native", permissionProfile: "read-only",
      status: "running", prompt: "x", contexts: [], turnContext: null,
      workspacePath: null, baseCommit: null, startedAt: "now", completedAt: null,
      error: null, changeSet: null, risks: []
    }
  };
}

function makeApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
  return {
    aiRefresh: async () => snapshot,
    aiGetEvents: async () => [],
    aiStartRun: vi.fn(async () => makeStartRunResult()),
    aiCancelRun: async () => true,
    onAiEvent: () => () => undefined,
    ...overrides
  } as unknown as DesktopApi;
}

const selectedText = { start: 0, end: 4, text: "这是", bookmark: 42 };
const emptySelection = { start: 0, end: 0, text: "" };

/** 渲染 InlineAiBar。 */
function renderBar(
  api: DesktopApi,
  props: {
    disabled?: boolean;
    onReplace?: (s: number, e: number, t: string) => void;
    selection?: { start: number; end: number; text: string };
  } = {}
) {
  const Harness = () => {
    return (
      <AiProvider initial={snapshot}>
        <InlineAiBar
          selection={props.selection ?? emptySelection}
          disabled={props.disabled}
          onReplace={props.onReplace ?? vi.fn()}
        />
      </AiProvider>
    );
  };
  window.openmind = api;
  return render(<Harness />);
}

describe("InlineAiBar", () => {
  it("无选区时不显示操作条", () => {
    renderBar(makeApi());
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("有选区时显示操作条与 5 个动作按钮", async () => {
    renderBar(makeApi(), { selection: selectedText });
    await waitFor(() => expect(screen.getByRole("toolbar")).toBeDefined());
    expect(screen.getByText("改写")).toBeDefined();
    expect(screen.getByText("续写")).toBeDefined();
    expect(screen.getByText("精简")).toBeDefined();
    expect(screen.getByText("换语气")).toBeDefined();
    expect(screen.getByText("翻译")).toBeDefined();
  });

  it("disabled 时不显示操作条", async () => {
    renderBar(makeApi(), { disabled: true, selection: selectedText });
    await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());
  });

  it("点击改写触发 aiStartRun", async () => {
    const startRun = vi.fn(async () => makeStartRunResult());
    renderBar(makeApi({ aiStartRun: startRun as never }), { selection: selectedText });
    await waitFor(() => expect(screen.getByRole("toolbar")).toBeDefined());
    fireEvent.click(screen.getByText("改写"));
    await waitFor(() => expect(startRun).toHaveBeenCalled());
    const firstCall = startRun.mock.calls.find(() => true);
    const input = (firstCall as unknown as { prompt?: string }[] | undefined)?.[0];
    expect(input?.prompt).toContain("原文");
  });

  it("aiStartRun reject 时不崩溃", async () => {
    const startRun = vi.fn(async () => { throw new Error("provider 不可用"); });
    renderBar(makeApi({ aiStartRun: startRun as never }), { selection: selectedText });
    await waitFor(() => expect(screen.getByRole("toolbar")).toBeDefined());
    fireEvent.click(screen.getByText("改写"));
    // start 的 catch 会 setError,操作条回到无 run 状态;不崩溃即通过
    await waitFor(() => expect(startRun).toHaveBeenCalled());
  });

  it.each([true, false])("改写完成后替换选中，应用成功=%s", async (applied) => {
    const onReplace = vi.fn(() => applied);
    let emit: AiEventCallback = () => undefined;
    const completedSnapshot: AiSnapshot = {
      ...snapshot,
      runs: [{
        schemaVersion: 1, id: "run-1", sessionId: "sess-1", projectId: "p", scope: { type: "workspace" },
        provider: "codex", providerId: "codex-native", permissionProfile: "read-only",
        status: "completed", prompt: "x", contexts: [], turnContext: null,
        workspacePath: null, baseCommit: null, startedAt: "now", completedAt: "now",
        error: null, changeSet: null, risks: []
      }]
    };
    const api = makeApi({
      onAiEvent: (cb: AiEventCallback) => {
        emit = cb;
        return () => undefined;
      }
    });
    renderBar(api, { onReplace, selection: selectedText });
    await waitFor(() => expect(screen.getByRole("toolbar")).toBeDefined());
    fireEvent.click(screen.getByText("改写"));
    await waitFor(() => expect(screen.queryByText("改写")).toBeNull(), { timeout: 2000 });
    emit({ kind: "snapshot", snapshot: completedSnapshot });
    const replaceBtn = await screen.findByText("替换选中");
    fireEvent.click(replaceBtn);
    expect(onReplace).toHaveBeenCalledWith(0, 4, "", 42);
    if (!applied) expect(screen.getByText("选中的内容已经改变，请重新选择后改写。")).toBeTruthy();
  });

  it("改写后点击放弃触发 reset(操作条消失)", async () => {
    let emit: AiEventCallback = () => undefined;
    const completedSnapshot: AiSnapshot = {
      ...snapshot,
      runs: [{
        schemaVersion: 1, id: "run-1", sessionId: "sess-1", projectId: "p", scope: { type: "workspace" },
        provider: "codex", providerId: "codex-native", permissionProfile: "read-only",
        status: "completed", prompt: "x", contexts: [], turnContext: null,
        workspacePath: null, baseCommit: null, startedAt: "now", completedAt: "now",
        error: null, changeSet: null, risks: []
      }]
    };
    renderBar(makeApi({
      onAiEvent: (cb: AiEventCallback) => {
        emit = cb;
        return () => undefined;
      }
    }), { selection: selectedText });
    await waitFor(() => expect(screen.getByRole("toolbar")).toBeDefined());
    fireEvent.click(screen.getByText("改写"));
    await waitFor(() => expect(screen.queryByText("改写")).toBeNull(), { timeout: 2000 });
    emit({ kind: "snapshot", snapshot: completedSnapshot });
    const discardBtn = await screen.findByText("放弃");
    fireEvent.click(discardBtn);
    await waitFor(() => expect(screen.queryByText("替换选中")).toBeNull());
  });
});

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceDefinitionSchema, type DesktopApi } from "@shared/contracts";
import { messages } from "@shared/messages";
import { CollectorSourcesPanel } from "./CollectorSourcesPanel";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const community = SourceDefinitionSchema.parse({
  id: "reddit-local", name: "r/LocalLLaMA", kind: "reddit", skillId: "reddit-fetcher", enabled: true,
  url: "https://www.reddit.com/r/LocalLLaMA/hot.json", frequency: "daily", status: "idle"
});

describe("Collector source management", () => {
  it("shows the actual Reddit communities and persists source enablement through IPC", async () => {
    let saved = community;
    const updateSource = vi.fn(async () => (saved = { ...community, enabled: false }));
    window.openmind = {
      listSources: vi.fn(async () => [saved, { ...community, id: "rss-one", name: "Unrelated RSS", kind: "rss", skillId: "rss-article-saver" }]),
      updateSource
    } as unknown as DesktopApi;
    render(<CollectorSourcesPanel skillId="reddit-fetcher" title="Reddit" />);
    expect(await screen.findByRole("link", { name: community.url! })).toBeTruthy();
    expect(screen.queryByText("Unrelated RSS")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "编辑 r/LocalLLaMA" }));
    fireEvent.click(screen.getByRole("switch", { name: messages.rss.enabled }));
    expect(updateSource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: messages.skillCenter.common.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(updateSource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "编辑 r/LocalLLaMA" }));
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: messages.skillCenter.sourceEditor.saveChanges }));
    await waitFor(() => expect(updateSource).toHaveBeenCalledWith(community.id, expect.objectContaining({ enabled: false })));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(screen.getByRole("listitem")).queryByText(messages.skillCenter.sourceStatus.disabled)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "编辑 r/LocalLLaMA" }));
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("keeps each community's status, last fetch and address together while filtering cards", async () => {
    const failed = { ...community, status: "failed" as const, recentError: "Request timed out", lastRunAt: "2026-10-29T12:32:00Z" };
    const disabled = { ...community, id: "reddit-off", name: "r/Disabled", url: "https://www.reddit.com/r/Disabled/hot.json", enabled: false, status: "success" as const };
    const openExternal = vi.fn();
    window.openmind = { listSources: async () => [failed, disabled], openExternal } as unknown as DesktopApi;
    render(<CollectorSourcesPanel skillId="reddit-fetcher" title="Reddit" />);
    const card = await screen.findByRole("listitem", { name: community.name });
    expect(within(card).queryByText("失败")).toBeNull();
    expect(within(card).queryByText("Request timed out")).toBeNull();
    const indicator = within(card).getByRole("img", { name: messages.skillCenter.sourceStatus.lastFailed });
    fireEvent.focus(indicator);
    expect((await screen.findByRole("tooltip")).textContent).toContain("Request timed out");
    fireEvent.blur(indicator);
    expect(within(card).getByText(/^上次 /)).toBeTruthy();
    expect(within(card).getByRole("button", { name: "编辑 r/LocalLLaMA" })).toBeTruthy();
    fireEvent.click(within(card).getByRole("link", { name: community.url! }));
    expect(openExternal).toHaveBeenCalledWith(community.url);
    const disabledCard = screen.getByRole("listitem", { name: disabled.name });
    expect(within(disabledCard).queryByRole("img")).toBeNull();
    expect(within(disabledCard).queryByText("已停用")).toBeNull();
    expect(within(disabledCard).getByText("尚未运行")).toBeTruthy();
    expect(within(disabledCard).queryByRole("switch")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "LocalLLaMA" } });
    expect(screen.queryByRole("listitem", { name: disabled.name })).toBeNull();
    expect(screen.getByRole("listitem", { name: community.name })).toBeTruthy();
  });

  it("shows the X request count without exposing raw login information", async () => {
    const listSources = vi.fn();
    window.openmind = {
      listSources,
      getXFollowingCurls: vi.fn(async () => [
        "curl https://x.com/fixture -H 'Authorization: Bearer private-fixture-value'",
        "curl https://x.com/fixture-two -H 'Cookie: private-fixture-cookie'"
      ])
    } as unknown as DesktopApi;
    render(<CollectorSourcesPanel skillId="x-following-fetcher" title="X/Twitter" />);
    expect(await screen.findByText(messages.skillCenter.xCurl.configured(2))).toBeTruthy();
    expect(screen.getByRole("button", { name: messages.skillCenter.xCurl.edit })).toBeTruthy();
    expect(document.body.textContent).not.toContain("private-fixture");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(listSources).not.toHaveBeenCalled();
  });

  it("reuses the existing community editor", async () => {
    const updateSource = vi.fn(async () => ({ ...community, name: "Local models" }));
    window.openmind = { listSources: async () => [community], updateSource } as unknown as DesktopApi;
    render(<CollectorSourcesPanel skillId="reddit-fetcher" title="Reddit" />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑 r/LocalLLaMA" }));
    fireEvent.change(screen.getByRole("textbox", { name: "社区名称" }), { target: { value: "Local models" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(updateSource).toHaveBeenCalledWith(community.id, expect.objectContaining({ name: "Local models" })));
  });

  it("allows a failed source read to be retried without presenting an empty list", async () => {
    window.openmind = { listSources: vi.fn().mockRejectedValueOnce(new Error("Sources unavailable")).mockResolvedValue([community]) } as unknown as DesktopApi;
    render(<CollectorSourcesPanel skillId="reddit-fetcher" title="Reddit" />);
    expect((await screen.findByRole("alert")).textContent).toContain("Sources unavailable");
    expect(screen.queryByText(messages.skillCenter.sourceCopy.reddit.empty)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("link", { name: community.url! })).toBeTruthy();
  });
});


it("refreshes individual community results after a run event and on visible polling", async () => {
  let callback!: Parameters<DesktopApi["onSkillEvent"]>[0];
  let rows = [{ ...community, status: "failed", recentError: "Previous failure" } as typeof community];
  const listSources = vi.fn(async () => structuredClone(rows));
  const unsubscribe = vi.fn();
  window.openmind = { listSources, onSkillEvent: (cb: typeof callback) => { callback = cb; return unsubscribe; } } as unknown as DesktopApi;
  const view = render(<CollectorSourcesPanel skillId="reddit-fetcher" title="Reddit" />);
  await screen.findByRole("listitem", { name: community.name });
  expect(listSources).toHaveBeenCalledWith({ kind: "reddit", skillId: "reddit-fetcher" });
  expect(screen.getByRole("img", { name: messages.skillCenter.sourceStatus.lastFailed })).toBeTruthy();
  rows = [{ ...community, status: "running", recentError: "Previous failure" }];
  await act(async () => { callback({ type: "status", skillId: "reddit-fetcher", state: "running" }); await new Promise(resolve => setTimeout(resolve, 130)); });
  expect(screen.getByRole("img", { name: messages.skillCenter.sourceStatus.lastFailed })).toBeTruthy();
  expect(screen.queryByText(messages.skillCenter.sourceStatus.running)).toBeNull();
  rows = [{ ...community, status: "success" }];
  await act(async () => { callback({ type: "status", skillId: "reddit-fetcher", state: "success" }); await new Promise(resolve => setTimeout(resolve, 130)); });
  expect(screen.queryByRole("img", { name: messages.skillCenter.sourceStatus.lastFailed })).toBeNull();
  expect(screen.queryByText(messages.skillCenter.sourceStatus.success)).toBeNull();
  // A later CLI run has no desktop push event and is picked up by polling.
  rows = [{ ...community, status: "failed", recentError: "CLI failure" }];
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5100)); });
  expect(screen.getByRole("img", { name: messages.skillCenter.sourceStatus.lastFailed })).toBeTruthy();
  expect(screen.queryByText("CLI failure")).toBeNull();
  view.unmount(); expect(unsubscribe).toHaveBeenCalledTimes(1);
}, 10_000);

it("locks enablement while saving and retains the draft when saving fails", async () => {
  let fail!: (error: Error) => void;
  const updateSource = vi.fn(() => new Promise<typeof community>((_resolve, reject) => { fail = reject; }));
  window.openmind = { listSources: async () => [community], updateSource } as unknown as DesktopApi;
  render(<CollectorSourcesPanel skillId="reddit-fetcher" title="Reddit" />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑 r/LocalLLaMA" }));
  const toggle = screen.getByRole("switch") as HTMLButtonElement;
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: messages.skillCenter.sourceEditor.saveChanges }));
  fireEvent.click(toggle);
  expect(updateSource).toHaveBeenCalledTimes(1);
  expect(toggle.disabled).toBe(true);
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  await act(async () => { fail(new Error("Retry save")); });
  expect(toggle.disabled).toBe(false);
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(screen.getByText("Retry save")).toBeTruthy();
  updateSource.mockResolvedValueOnce({ ...community, enabled: false });
  fireEvent.click(screen.getByRole("button", { name: messages.skillCenter.sourceEditor.saveChanges }));
  await waitFor(() => expect(updateSource).toHaveBeenCalledTimes(2));
  expect(updateSource).toHaveBeenLastCalledWith(community.id, expect.objectContaining({ enabled: false }));
});

it("paginates communities and searches the entire source collection", async () => {
  const sources = Array.from({ length: 75 }, (_, i) => ({ ...community, id: `community-${i}`, name: `Community ${i}` }));
  window.openmind = { listSources: async () => sources } as unknown as DesktopApi;
  render(<CollectorSourcesPanel skillId="reddit-fetcher" title="Reddit" />);
  await screen.findByText("Community 0"); expect(screen.getAllByRole("listitem")).toHaveLength(30);
  fireEvent.click(screen.getByText(messages.rss.next)); expect(screen.getByText("Community 30")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Community 74" } });
  expect(screen.getAllByRole("listitem")).toHaveLength(1); expect(screen.getByText("Community 74")).toBeTruthy();
});

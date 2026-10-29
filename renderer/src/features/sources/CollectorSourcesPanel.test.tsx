import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceDefinitionSchema, type DesktopApi } from "@shared/contracts";
import { messages } from "@shared/messages";
import { CollectorSourcesPanel } from "./CollectorSourcesPanel";

afterEach(cleanup);

const community = SourceDefinitionSchema.parse({
  id: "reddit-local", name: "r/LocalLLaMA", kind: "reddit", skillId: "reddit-fetcher", enabled: true,
  url: "https://www.reddit.com/r/LocalLLaMA/hot.json", frequency: "daily", status: "idle"
});

describe("Collector source management", () => {
  it("shows the actual Reddit communities and persists source enablement through IPC", async () => {
    const updateSource = vi.fn(async () => ({ ...community, enabled: false }));
    window.openmind = {
      listSources: vi.fn(async () => [community, { ...community, id: "rss-one", name: "Unrelated RSS", kind: "rss", skillId: "rss-article-saver" }]),
      updateSource
    } as unknown as DesktopApi;
    render(<CollectorSourcesPanel skillId="reddit-fetcher" title="Reddit" />);
    expect(await screen.findByRole("link", { name: community.url! })).toBeTruthy();
    expect(screen.queryByText("Unrelated RSS")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "停用 r/LocalLLaMA" }));
    await waitFor(() => expect(updateSource).toHaveBeenCalledWith(community.id, { enabled: false }));
    expect(await screen.findByRole("switch", { name: "启用 r/LocalLLaMA" })).toBeTruthy();
  });

  it("keeps each community's status, last fetch and address together while filtering cards", async () => {
    const failed = { ...community, status: "failed" as const, recentError: "Request timed out", lastRunAt: "2026-10-29T12:32:00Z" };
    const disabled = { ...community, id: "reddit-off", name: "r/Disabled", url: "https://www.reddit.com/r/Disabled/hot.json", enabled: false, status: "success" as const };
    const openExternal = vi.fn();
    window.openmind = { listSources: async () => [failed, disabled], openExternal } as unknown as DesktopApi;
    render(<CollectorSourcesPanel skillId="reddit-fetcher" title="Reddit" />);
    const card = await screen.findByRole("listitem", { name: community.name });
    expect(within(card).getByText("失败")).toBeTruthy();
    expect(within(card).getByText("Request timed out")).toBeTruthy();
    expect(within(card).getByText(/^上次 /)).toBeTruthy();
    expect(within(card).getByRole("button", { name: "编辑 r/LocalLLaMA" })).toBeTruthy();
    fireEvent.click(within(card).getByRole("link", { name: community.url! }));
    expect(openExternal).toHaveBeenCalledWith(community.url);
    const disabledCard = screen.getByRole("listitem", { name: disabled.name });
    expect(within(disabledCard).getByText("已停用")).toBeTruthy();
    expect(within(disabledCard).getByText("尚未运行")).toBeTruthy();
    expect(within(disabledCard).getByRole("switch").getAttribute("aria-checked")).toBe("false");
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserToolSession, mapBrowserAction, playwrightArgs, type BrowserMcpClient } from "./browser-tool";

const sessions: BrowserToolSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
});

describe("Internal Agent Browser Tool", () => {
  it("maps only the supported browser action vocabulary", () => {
    expect(mapBrowserAction({ action: "navigate", url: "https://example.com" }, "/tmp/out")).toEqual({
      name: "browser_navigate",
      arguments: { url: "https://example.com" }
    });
    expect(mapBrowserAction({ action: "click", ref: "e1" }, "/tmp/out")).toEqual({
      name: "browser_click",
      arguments: { target: "e1" }
    });
    expect(mapBrowserAction({ action: "snapshot", depth: 3 }, "/tmp/out")).toEqual({
      name: "browser_snapshot",
      arguments: { depth: 3 }
    });
    expect(() => mapBrowserAction({ action: "run_code", value: "await page.goto('https://example.com')" }, "/tmp/out")).toThrow("不支持");
    expect(() => mapBrowserAction({ action: "navigate", url: "file:///etc/passwd" }, "/tmp/out")).toThrow("HTTP(S)");
  });

  it("uses the extension only when existing-tab reuse is enabled", () => {
    const reused = playwrightArgs("/tmp/out", true);
    const isolated = playwrightArgs("/tmp/out", false);
    expect(reused).toContain("--extension");
    expect(reused).not.toContain("--headless");
    expect(isolated).toContain("--headless");
    expect(isolated).not.toContain("--extension");
  });

  it("keeps a persistent MCP client for multiple actions and closes it", async () => {
    const callTool = vi.fn()
      .mockResolvedValueOnce({ content: [{ type: "text", text: "snapshot" }] })
      .mockResolvedValueOnce({ content: [{ type: "text", text: "clicked" }] });
    const client: BrowserMcpClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      callTool,
      close: vi.fn().mockResolvedValue(undefined)
    };
    const session = new BrowserToolSession({
      workspaceRoot: "/tmp",
      outputDir: "/tmp/cctools-browser-tool-test",
      reuseExistingTabs: true,
      extensionToken: null,
      clientFactory: () => client
    });
    sessions.push(session);

    await expect(session.call({ action: "snapshot" })).resolves.toMatchObject({ text: "snapshot", tool: "browser_snapshot" });
    await expect(session.call({ action: "click", target: "e1" })).resolves.toMatchObject({ text: "clicked", tool: "browser_click" });
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenNthCalledWith(1, { name: "browser_snapshot", arguments: {} });
    expect(callTool).toHaveBeenNthCalledWith(2, { name: "browser_click", arguments: { target: "e1" } });

    await session.close();
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});

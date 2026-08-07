import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserToolSession } from "./browser-tool";

const browserExecutablePath = process.env.CCTOOLS_BROWSER_EXECUTABLE_PATH?.trim() || "";
const enabled = process.env.CCTOOLS_BROWSER_LIVE_E2E === "1" && fs.existsSync(browserExecutablePath);
const liveDescribe = enabled ? describe : describe.skip;
const servers: http.Server[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

liveDescribe("Internal Agent Browser Tool live E2E", () => {
  it("drives a local page through the real Playwright MCP process", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body><main><h1>Browser E2E</h1><p>local evidence page</p></main></body></html>");
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("live E2E server did not bind");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-browser-live-"));
    roots.push(root);
    const session = new BrowserToolSession({
      workspaceRoot: root,
      outputDir: root,
      reuseExistingTabs: false,
      extensionToken: null,
      browserExecutablePath
    });
    try {
      await expect(session.call({ action: "navigate", url: `http://127.0.0.1:${address.port}/` })).resolves.toMatchObject({ tool: "browser_navigate" });
      await expect(session.call({ action: "snapshot" })).resolves.toMatchObject({ text: expect.stringContaining("Browser E2E") });
      await expect(session.call({ action: "screenshot", filename: "live.png" })).resolves.toMatchObject({ tool: "browser_take_screenshot" });
      expect(fs.existsSync(path.join(root, "live.png"))).toBe(true);
    } finally {
      await session.close();
    }
  }, 60_000);
});

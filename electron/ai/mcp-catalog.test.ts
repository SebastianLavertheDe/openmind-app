import { describe, expect, it } from "vitest";
import type { BrowserAutomationStatus } from "../../shared/contracts";
import { buildMcpServerCatalog } from "./mcp-catalog";

function status(patch: Partial<BrowserAutomationStatus> = {}): BrowserAutomationStatus {
  return {
    backend: "playwright-mcp",
    enabled: true,
    reuseExistingTabs: true,
    evidenceDir: ".cctools/browser-evidence",
    extensionTokenConfigured: true,
    secureStorageAvailable: true,
    packageAvailable: true,
    ready: true,
    diagnostic: "已就绪",
    ...patch
  };
}

describe("buildMcpServerCatalog", () => {
  it("describes the controlled browser MCP service and its exposed tool", () => {
    const [server] = buildMcpServerCatalog(status());
    expect(server).toMatchObject({
      id: "cctools_browser",
      backend: "Microsoft Playwright MCP",
      transport: "stdio",
      status: "enabled",
      providers: ["Codex", "Claude"]
    });
    expect(server.tools.map((tool) => tool.id)).toEqual(["capture_source_evidence"]);
    expect(server.tools[0].inputs).toContain("capture_scope");
    expect(server.tools.some((tool) => tool.id.includes("unsafe"))).toBe(false);
  });

  it("reports disabled and unavailable states independently", () => {
    expect(buildMcpServerCatalog(status({ enabled: false }))[0].status).toBe("disabled");
    expect(buildMcpServerCatalog(status({ packageAvailable: false }))[0].status).toBe("unavailable");
  });
});

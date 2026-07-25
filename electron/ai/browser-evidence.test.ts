import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BROWSER_EVIDENCE_TOOL,
  browserAutomationConfigFromEnv,
  browserEvidenceInstructions,
  buildBrowserMcpProcess,
  buildCodexBrowserConfig,
  type BrowserAutomationConfig
} from "./browser-evidence";

const enabled: BrowserAutomationConfig = {
  enabled: true,
  reuseExistingTabs: true,
  evidenceDir: ".cctools/browser-evidence",
  extensionToken: "extension-token"
};

describe("browser evidence MCP configuration", () => {
  it("does not attach a browser server while the feature is disabled", () => {
    expect(buildBrowserMcpProcess({ runtime: "native" }, "/workspace", { ...enabled, enabled: false })).toBeNull();
  });

  it("starts the controlled bridge with a workspace-bound output directory", () => {
    const cwd = path.resolve("workspace");
    const server = buildBrowserMcpProcess({ runtime: "native" }, cwd, enabled);
    expect(server?.command).toBe(process.execPath);
    expect(server?.args[0]).toMatch(/browser-evidence-mcp\.js$/);
    expect(server?.args).toContain(path.resolve(cwd, ".cctools/browser-evidence"));
    expect(server?.env).toEqual(expect.objectContaining({
      ELECTRON_RUN_AS_NODE: "1",
      PLAYWRIGHT_MCP_EXTENSION_TOKEN: "extension-token"
    }));
  });

  it("exposes only capture_source_evidence to Codex", () => {
    const config = buildCodexBrowserConfig({ runtime: "native" }, path.resolve("workspace"), enabled);
    const server = (config?.mcp_servers as Record<string, Record<string, unknown>>).cctools_browser;
    expect(server.enabled_tools).toEqual([BROWSER_EVIDENCE_TOOL]);
    expect(JSON.stringify(config)).not.toContain("browser_run_code_unsafe");
    expect(server.default_tools_approval_mode).toBe("approve");
  });

  it("prompts the model to capture selectively, reuse tabs, and avoid side effects", () => {
    const instructions = browserEvidenceInstructions(enabled);
    expect(instructions).toContain("自主判断");
    expect(instructions).toContain("复用该标签页");
    expect(instructions).toContain("恢复原滚动位置");
    expect(instructions).toContain("禁止提交表单");
  });

  it("reads browser preferences from the AI worker environment", () => {
    expect(browserAutomationConfigFromEnv({
      CCTOOLS_BROWSER_AUTOMATION_ENABLED: "true",
      CCTOOLS_BROWSER_REUSE_EXISTING_TABS: "false",
      CCTOOLS_BROWSER_EVIDENCE_DIR: "assets/evidence",
      PLAYWRIGHT_MCP_EXTENSION_TOKEN: "token"
    })).toEqual({ enabled: true, reuseExistingTabs: false, evidenceDir: "assets/evidence", extensionToken: "token" });
  });
});

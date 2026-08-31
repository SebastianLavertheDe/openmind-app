import fs from "node:fs";
import os from "node:os";
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
  evidenceDir: "assets/browser-evidence",
  extensionToken: "extension-token"
};

describe("browser evidence MCP configuration", () => {
  it("does not attach a browser server while the feature is disabled", () => {
    expect(buildBrowserMcpProcess({ runtime: "native" }, "/workspace", { ...enabled, enabled: false })).toBeNull();
  });

  it("starts the controlled bridge with a workspace-bound output directory", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-browser-workspace-"));
    try {
      const server = buildBrowserMcpProcess({ runtime: "native" }, cwd, enabled);
      expect(server?.command).toBe(process.execPath);
      expect(server?.args[0]).toMatch(/browser-evidence-mcp\.js$/);
      expect(server?.args).toContain(path.resolve(cwd, "assets/browser-evidence"));
      expect(server?.env).toEqual(expect.objectContaining({
        ELECTRON_RUN_AS_NODE: "1",
        PLAYWRIGHT_MCP_EXTENSION_TOKEN: "extension-token"
      }));
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("rejects an evidence output directory that escapes through a Workspace symlink", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-browser-boundary-"));
    const workspace = path.join(fixture, "workspace");
    const outside = path.join(fixture, "outside");
    fs.mkdirSync(workspace);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(workspace, "escape"), process.platform === "win32" ? "junction" : "dir");
    try {
      expect(() => buildBrowserMcpProcess({ runtime: "native" }, workspace, {
        ...enabled,
        evidenceDir: "escape/evidence"
      })).toThrow(/Workspace/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("rejects a broken symlink in the evidence output path", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-browser-broken-"));
    fs.symlinkSync(
      path.join(workspace, "missing-target"),
      path.join(workspace, "broken"),
      process.platform === "win32" ? "junction" : "dir"
    );
    try {
      expect(() => buildBrowserMcpProcess({ runtime: "native" }, workspace, {
        ...enabled,
        evidenceDir: "broken/evidence"
      })).toThrow(/Workspace/);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("exposes only capture_source_evidence to Codex", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-browser-codex-"));
    try {
      const config = buildCodexBrowserConfig({ runtime: "native" }, cwd, enabled);
      const server = (config?.mcp_servers as Record<string, Record<string, unknown>>).openmind_browser;
      expect(server.enabled_tools).toEqual([BROWSER_EVIDENCE_TOOL]);
      expect(JSON.stringify(config)).not.toContain("browser_run_code_unsafe");
      expect(server.default_tools_approval_mode).toBe("approve");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("prompts the model to capture selectively, reuse tabs, and avoid side effects", () => {
    const instructions = browserEvidenceInstructions(enabled);
    expect(instructions).toContain("自主判断");
    expect(instructions).toContain("复用该标签页");
    expect(instructions).toContain("恢复原滚动位置");
    expect(instructions).toContain("capture_scope");
    expect(instructions).toContain("comment 截单条评论且排除子回复");
    expect(instructions).toContain("禁止提交表单");
  });

  it("reads browser preferences from the AI worker environment", () => {
    expect(browserAutomationConfigFromEnv({
      OPENMIND_BROWSER_AUTOMATION_ENABLED: "true",
      OPENMIND_BROWSER_REUSE_EXISTING_TABS: "false",
      OPENMIND_BROWSER_EVIDENCE_DIR: "assets/evidence",
      PLAYWRIGHT_MCP_EXTENSION_TOKEN: "token"
    })).toEqual({ enabled: true, reuseExistingTabs: false, evidenceDir: "assets/evidence", extensionToken: "token" });
  });
});

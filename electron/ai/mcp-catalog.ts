import type { BrowserAutomationStatus, McpServerDefinition } from "../../shared/contracts";

export function buildMcpServerCatalog(browser: BrowserAutomationStatus): McpServerDefinition[] {
  const status = !browser.packageAvailable ? "unavailable" : browser.enabled ? "enabled" : "disabled";
  return [{
    id: "cctools_browser",
    title: "写作证据截图",
    description: "写作时按需打开来源链接，定位原文并生成可引用的证据截图。",
    backend: "Microsoft Playwright MCP",
    transport: "stdio",
    connection: "Playwright Chrome 扩展",
    enabled: browser.enabled,
    available: browser.packageAvailable,
    status,
    diagnostic: browser.diagnostic,
    providers: ["Codex", "Claude"],
    settingsSection: "browser",
    tools: [{
      id: "capture_source_evidence",
      title: "截取原文证据",
      description: "复用 URL 完全匹配的 Chrome 标签页，定位引文、截图并恢复浏览器现场。",
      inputs: ["url", "quote", "capture_scope", "caption", "filename"],
      outputs: ["PNG", "JSON 元数据", "Markdown 图片引用"]
    }]
  }];
}

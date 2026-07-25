import fs from "node:fs";
import path from "node:path";
import type { BrowserAutomationStatus, UserPreferences } from "../shared/contracts";

export interface SecureStringCodec {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

/** Stores the Chrome extension token encrypted by Electron safeStorage. */
export class BrowserExtensionTokenStore {
  constructor(
    private readonly filePath: string,
    private readonly codec: SecureStringCodec
  ) {}

  isAvailable(): boolean {
    return this.codec.isEncryptionAvailable();
  }

  read(): string | null {
    if (!this.isAvailable()) return null;
    try {
      const value = this.codec.decryptString(fs.readFileSync(this.filePath));
      return value.trim() || null;
    } catch {
      return null;
    }
  }

  write(rawToken: string): void {
    const token = rawToken.trim();
    if (!token) throw new Error("Chrome 扩展令牌不能为空。");
    if (!this.isAvailable()) throw new Error("当前系统的安全存储不可用，无法保存浏览器扩展令牌。");
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const encrypted = this.codec.encryptString(token);
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  clear(): void {
    try { fs.unlinkSync(this.filePath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function resolveBrowserExtensionToken(store: BrowserExtensionTokenStore): string | null {
  return store.read() || process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN?.trim() || null;
}

export function browserAutomationStatus(
  preferences: UserPreferences,
  store: BrowserExtensionTokenStore,
  packageAvailable: boolean
): BrowserAutomationStatus {
  const tokenConfigured = Boolean(resolveBrowserExtensionToken(store));
  const ready = preferences.browserAutomationEnabled && packageAvailable;
  let diagnostic = "AI 写作取证已关闭。";
  if (preferences.browserAutomationEnabled && !packageAvailable) diagnostic = "Playwright MCP 未随应用安装，浏览器工具不可用。";
  else if (preferences.browserAutomationEnabled && !tokenConfigured) diagnostic = "可用；首次连接时需要在 Playwright Chrome 扩展中确认标签页。保存扩展令牌后可免重复确认。";
  else if (preferences.browserAutomationEnabled) diagnostic = "已准备好复用 Chrome 登录状态和扩展授权的标签页。";
  return {
    backend: "playwright-mcp",
    enabled: preferences.browserAutomationEnabled,
    reuseExistingTabs: preferences.browserReuseExistingTabs,
    evidenceDir: preferences.browserEvidenceDir,
    extensionTokenConfigured: tokenConfigured,
    secureStorageAvailable: store.isAvailable(),
    packageAvailable,
    ready,
    diagnostic
  };
}

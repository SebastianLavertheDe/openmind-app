import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { WechatAccountInputSchema, type WechatAccountInput, type WechatAccountView } from "../../shared/wechat";

export type SecretStorage = {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};
export type WechatCredentials = { appId: string; appSecret: string; author: string };

/** App-private encrypted credentials; never included in content or settings exports. */
export class WechatAccountStore {
  private readonly filePath: string;

  constructor(userData: string, private readonly encryption: SecretStorage) {
    this.filePath = path.join(userData, "credentials", "wechat-account.bin");
  }

  getView(): WechatAccountView {
    const account = this.read();
    return account ? { appId: account.appId, author: account.author, configured: true } : { appId: "", author: "", configured: false };
  }

  read(): WechatCredentials | null {
    if (!fs.existsSync(this.filePath)) return null;
    this.assertSecureStorage();
    try {
      const info = fs.lstatSync(this.filePath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024) throw new Error();
      const parsed = WechatAccountInputSchema.parse(JSON.parse(this.encryption.decryptString(fs.readFileSync(this.filePath))));
      if (!parsed.appSecret) throw new Error();
      return { appId: parsed.appId, appSecret: parsed.appSecret, author: parsed.author };
    } catch {
      throw new Error("无法读取公众号凭据，请在设置中重新配置。 ");
    }
  }

  save(raw: WechatAccountInput): WechatAccountView {
    const input = WechatAccountInputSchema.parse(raw);
    this.assertSecureStorage();
    const previous = input.appSecret ? null : this.read();
    const appSecret = input.appSecret || (previous?.appId === input.appId ? previous.appSecret : "");
    if (!appSecret) throw new Error("请输入公众号 AppSecret；更换 AppID 时需要重新填写。 ");
    const account = { appId: input.appId, author: input.author, appSecret };
    const temporary = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    try {
      const encrypted = this.encryption.encryptString(JSON.stringify(account));
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, encrypted, { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, this.filePath);
    } catch {
      throw new Error("公众号凭据加密保存失败，请检查系统钥匙串和应用目录权限。 ");
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    return { appId: account.appId, author: account.author, configured: true };
  }

  disconnect(): void {
    fs.rmSync(this.filePath, { force: true });
  }

  private assertSecureStorage(): void {
    if (!this.encryption.isEncryptionAvailable() || this.encryption.getSelectedStorageBackend?.() === "basic_text") {
      throw new Error("系统安全存储不可用。请解锁系统钥匙串，或启用 Secret Service / KWallet 后重试。AppSecret 不会以明文保存。 ");
    }
  }
}

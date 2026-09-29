// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WechatAccountStore, type SecretStorage } from "./wechat-account-store";

const roots: string[] = [];
const input = { appId: "wx1234567890abcdef", appSecret: "1234567890abcdef1234567890abcdef", author: "编辑" };
export const testEncryption: SecretStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "gnome_libsecret",
  encryptString: (value) => Buffer.from(Buffer.from(value).toString("base64")),
  decryptString: (value) => Buffer.from(value.toString(), "base64").toString()
};
function fixture(encryption = testEncryption) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-wechat-account-"));
  roots.push(root);
  return { root, store: new WechatAccountStore(root, encryption) };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("WechatAccountStore", () => {
  it("persists only encrypted bytes in app-private credentials and returns a secret-free view", () => {
    const { root, store } = fixture();
    expect(store.getView()).toEqual({ appId: "", author: "", configured: false });
    expect(store.save(input)).toEqual({ appId: input.appId, author: input.author, configured: true });
    const file = path.join(root, "credentials/wechat-account.bin");
    expect(fs.readFileSync(file, "utf8")).not.toContain(input.appSecret);
    expect(JSON.stringify(store.getView())).not.toContain(input.appSecret);
    expect(new WechatAccountStore(root, testEncryption).read()).toEqual(input);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("preserves a blank secret only for the same AppID", () => {
    const { store } = fixture();
    store.save(input);
    store.save({ appId: input.appId, appSecret: "", author: "新作者" });
    expect(store.read()).toEqual({ ...input, author: "新作者" });
    expect(() => store.save({ appId: "wxfedcba0987654321", author: "" })).toThrow("更换 AppID");
    expect(store.read()?.appId).toBe(input.appId);
  });

  it.each([
    { ...testEncryption, isEncryptionAvailable: () => false },
    { ...testEncryption, getSelectedStorageBackend: () => "basic_text" }
  ])("refuses insecure OS storage without writing a credential file", (encryption) => {
    const { root, store } = fixture(encryption);
    expect(() => store.save(input)).toThrow("系统安全存储不可用");
    expect(fs.existsSync(path.join(root, "credentials"))).toBe(false);
  });

  it("discards encryption errors and removes the account on disconnect", () => {
    const { root, store } = fixture();
    store.save(input);
    const broken = new WechatAccountStore(root, { ...testEncryption, encryptString: () => { throw new Error(input.appSecret); } });
    expect(() => broken.save(input)).toThrow("加密保存失败");
    try { broken.save(input); } catch (error) { expect(String(error)).not.toContain(input.appSecret); }
    expect(store.read()).toEqual(input);
    store.disconnect();
    expect(store.getView().configured).toBe(false);
  });
});

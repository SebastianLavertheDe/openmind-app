import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UserPreferencesSchema } from "../shared/contracts";
import {
  BrowserExtensionTokenStore,
  browserAutomationStatus,
  type SecureStringCodec
} from "./browser-automation-settings";

const roots: string[] = [];
const codec: SecureStringCodec = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, "")
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("BrowserExtensionTokenStore", () => {
  it("persists only encrypted token bytes and can clear the exact secret file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-browser-token-"));
    roots.push(root);
    const file = path.join(root, "token.bin");
    const store = new BrowserExtensionTokenStore(file, codec);

    store.write("plain-token");

    expect(fs.readFileSync(file, "utf8")).toBe("encrypted:plain-token");
    expect(store.read()).toBe("plain-token");
    store.clear();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("reports whether the feature can launch and whether an extension token exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-browser-status-"));
    roots.push(root);
    const store = new BrowserExtensionTokenStore(path.join(root, "token.bin"), codec);
    store.write("token");
    const preferences = UserPreferencesSchema.parse({ browserAutomationEnabled: true });

    const status = browserAutomationStatus(preferences, store, true);

    expect(status.ready).toBe(true);
    expect(status.extensionTokenConfigured).toBe(true);
    expect(status.diagnostic).toContain("已准备好");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureUserDataPath, type UserDataBootstrapApp } from "./user-data-bootstrap";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function appWithSwitch(hasSwitch = false): UserDataBootstrapApp & { setPath: ReturnType<typeof vi.fn> } {
  return {
    commandLine: { hasSwitch: () => hasSwitch },
    setPath: vi.fn()
  };
}

describe("configureUserDataPath", () => {
  it("creates and selects an absolute environment override", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-userdata-bootstrap-"));
    temporaryRoots.push(root);
    const target = path.join(root, "profile");
    const electronApp = appWithSwitch();

    expect(configureUserDataPath(electronApp, target)).toBe(target);
    expect(fs.statSync(target).isDirectory()).toBe(true);
    expect(electronApp.setPath).toHaveBeenCalledWith("userData", target);
  });

  it("lets Electron's command-line switch take precedence", () => {
    const electronApp = appWithSwitch(true);
    expect(configureUserDataPath(electronApp, "/should/not/be/created")).toBeNull();
    expect(electronApp.setPath).not.toHaveBeenCalled();
  });

  it("rejects relative paths", () => {
    expect(() => configureUserDataPath(appWithSwitch(), "relative/profile")).toThrow("必须是绝对路径");
  });
});

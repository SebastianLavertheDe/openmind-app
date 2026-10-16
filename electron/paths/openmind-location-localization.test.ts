import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "../../shared/messages";
import { buildAppPaths } from "./app-paths-service";
import { OpenmindLocationService } from "./openmind-location-service";

const temporaryRoots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-location-locale-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  setLocale("zh-CN");
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("desktop root warning localization", () => {
  it("switches warnings without recreating the service", () => {
    const userData = makeRoot();
    const service = new OpenmindLocationService({ paths: buildAppPaths(userData) });
    const missingRoot = path.join(userData, "missing");

    setLocale("en");
    expect(service.inspect(missingRoot).warnings).toEqual(["The openmind root folder does not exist or cannot be resolved."]);
    setLocale("zh-CN");
    expect(service.inspect(missingRoot).warnings).toEqual(["openmind 根目录不存在或无法解析。"]);
  });

  it("blocks app-private path conflicts in both languages", () => {
    const userData = makeRoot();
    const service = new OpenmindLocationService({ paths: buildAppPaths(userData) });

    setLocale("en");
    expect(() => service.bind(userData)).toThrow("Path conflict:");
    setLocale("zh-CN");
    expect(() => service.bind(userData)).toThrow("路径冲突：");
  });

  it("keeps running-task protection active after a language switch", () => {
    const root = makeRoot();
    const service = new OpenmindLocationService({ paths: buildAppPaths(makeRoot()), activeRunCount: () => 1 });

    setLocale("en");
    expect(() => service.bind(root)).toThrow("Tasks are running.");
    setLocale("zh-CN");
    expect(() => service.bind(root)).toThrow("有运行中的任务");
  });
});

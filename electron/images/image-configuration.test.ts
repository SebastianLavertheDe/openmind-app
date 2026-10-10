// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IMAGE_PROVIDERS } from "../../shared/image-generation";
vi.mock("electron", () => ({ app: {} }));
import { ImageConfigurationStore } from "./image-configuration";

const roots: string[] = [];
const flash = IMAGE_PROVIDERS[0].models[0].id;
const pro = IMAGE_PROVIDERS[0].models[1].id;
const connection = { id: "doubao", name: "Doubao shared", enabled: true, protocol: "openai-chat", model: "text-model", apiKey: "fixture-secret", baseUrl: IMAGE_PROVIDERS[0].baseUrl };
const capability = { provider: "volcengine" as const, models: [flash] };
const selection = { providerId: "doubao", provider: "volcengine" as const, model: flash };
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-image-config-"));
  roots.push(root);
  const file = path.join(root, "config/providers.yaml");
  const write = (providers: Array<Record<string, unknown>>) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, default: String(providers.find(entry => entry.enabled !== false)!.id), providers }));
  };
  return { root, file, write, store: new ImageConfigurationStore(root) };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("shared Provider image capability", () => {
  it("does not infer image generation from a text connection, vision model, or official URL", () => {
    const { write, store } = fixture();
    write([{ ...connection, model: "gpt-4o" }]);
    expect(store.view()).toEqual({ providers: [], defaultSelection: null });
    expect(() => store.select(selection)).toThrow("不可用");
    expect(() => store.credentials(selection)).toThrow("不可用");
  });
  it("reuses exactly one YAML entry and key, persisting only the selected model", () => {
    const { root, file, write, store } = fixture();
    write([{ ...connection, imageGeneration: capability }]);
    const before = fs.readFileSync(file, "utf8");
    expect(store.view().providers).toEqual([expect.objectContaining({ id: connection.id, name: connection.name, provider: "volcengine", models: [flash], configured: true })]);
    expect(store.view().defaultSelection).toEqual(selection);
    expect(JSON.stringify(store.view())).not.toContain(connection.apiKey);
    expect(store.credentials(selection)).toMatchObject({ apiKey: connection.apiKey, baseUrl: connection.baseUrl });
    expect(store.select(selection).defaultSelection).toEqual(selection);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.readFileSync(path.join(root, "config/image-providers.json"), "utf8")).not.toContain(connection.apiKey);
    expect(store.select(null).defaultSelection).toBeNull();
  });
  it("rejects unconfigured models and invalidates disabled or removed capabilities", () => {
    const { write, store } = fixture();
    write([{ ...connection, imageGeneration: capability }]);
    expect(() => store.select({ ...selection, model: pro })).toThrow("不可用");
    store.select(selection);
    write([{ ...connection, imageGeneration: null }]);
    expect(store.view()).toEqual({ providers: [], defaultSelection: null });
    expect(() => store.credentials(selection)).toThrow("不可用");
    write([{ ...connection, id: "text" }, { ...connection, enabled: false, imageGeneration: capability }]);
    expect(store.view().defaultSelection).toBeNull();
    expect(() => store.select(selection)).toThrow("不可用");
    expect(() => store.credentials(selection)).toThrow("不可用");
  });
  it("routes repeated vendor/model pairs by Provider ID without falling back to another account", () => {
    const { write, store } = fixture();
    write([{ ...connection, imageGeneration: capability }, { ...connection, id: "doubao-work", apiKey: "second-fixture-secret", imageGeneration: capability }]);
    expect(() => store.credentials({ provider: "volcengine", model: flash })).toThrow("不可用");
    expect(store.credentials({ ...selection, providerId: "doubao-work" }).apiKey).toBe("second-fixture-secret");
    expect(() => store.select({ ...selection, providerId: "removed" })).toThrow("不可用");
    expect(() => store.select({ ...selection, provider: "openai", model: "gpt-image-2" })).toThrow("不可用");
  });
  it("maps Google's text endpoint to the native image API while sharing its key", () => {
    const { write, store } = fixture();
    const model = IMAGE_PROVIDERS[2].models[0].id;
    write([{ ...connection, id: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", imageGeneration: { provider: "google", models: [model] } }]);
    expect(store.credentials({ providerId: "gemini", provider: "google", model })).toMatchObject({ apiKey: connection.apiKey, baseUrl: IMAGE_PROVIDERS[2].baseUrl });
  });
  it("requires a bound content root and rejects symlinked configuration directories", () => {
    expect(() => new ImageConfigurationStore("")).toThrow("内容目录");
    const { root, store } = fixture();
    const outside = fixture().root;
    fs.symlinkSync(outside, path.join(root, "config"), "dir");
    expect(() => store.view()).toThrow();
    expect(() => store.select(null)).toThrow();
    expect(fs.existsSync(path.join(outside, "image-providers.json"))).toBe(false);
  });
});

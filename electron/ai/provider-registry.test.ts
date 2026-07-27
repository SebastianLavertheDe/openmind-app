import { ProviderRegistry } from "./provider-registry";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
const originalPath = process.env.PATH;
function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-providers-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.env.PATH = originalPath;
});

/** 设置 spawn 命令路由表。 */
function mockSpawnByCommand(routes: Record<string, (args: string[]) => string | null>) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-provider-bin-"));
  roots.push(bin);
  process.env.PATH = bin;

  for (const [command, route] of Object.entries(routes)) {
    const cases = [
      ["--version"],
      ["app-server", "--help"],
      ["auth", "status"]
    ].map((args) => ({ args, output: route(args) }));
    const script = [
      "#!/bin/bash",
      "case \"$*\" in",
      ...cases
        .filter((item): item is { args: string[]; output: string } => item.output !== null)
        .map((item) => `  "${item.args.join(" ")}") printf %s ${shellLiteral(item.output)}; exit 0 ;;`),
      "esac",
      "exit 1"
    ].join("\n");
    const file = path.join(bin, command);
    fs.writeFileSync(file, script, "utf8");
    fs.chmodSync(file, 0o755);
  }
}

function shellLiteral(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

describe("ProviderRegistry", () => {
  describe("detect (同步读缓存)", () => {
    it("初始缓存为空,返回 []", () => {
      const registry = new ProviderRegistry("/project");
      expect(registry.detect()).toEqual([]);
    });

    it("refresh 后 detect 返回缓存的结果", async () => {
      const root = createRoot();
      vi.spyOn(os, "homedir").mockReturnValue(root);
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
      mockSpawnByCommand({
        codex: () => "codex 1.0.0",
        claude: () => "claude 1.2.0",
        // codex app-server --help 成功 → null diagnostic
        // 注:这里 codex/claude 命令同时用于 --version 和额外探测,都返回非空
      });

      const registry = new ProviderRegistry(root);
      await registry.refresh();
      const cached = registry.detect();
      expect(cached.length).toBeGreaterThan(0);
      expect(cached.every((p) => p.id && p.provider && p.runtime)).toBe(true);
    });
  });

  describe("refresh (异步探测)", () => {
    beforeEach(() => {
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    });

    it("返回 native providers(linux),version 来自 spawn stdout", async () => {
      const root = createRoot();
      vi.spyOn(os, "homedir").mockReturnValue(root);
      mockSpawnByCommand({
        codex: (args) => (args[0] === "--version" ? "codex 0.42.0" : "help ok"),
        claude: (args) => (args[0] === "--version" ? "claude 2.1.0" : '{"loggedIn":true}')
      });

      const registry = new ProviderRegistry(root);
      const providers = await registry.refresh();

      const codexNative = providers.find((p) => p.id === "codex-native");
      expect(codexNative).toBeDefined();
      expect(codexNative!.available).toBe(true);
      expect(codexNative!.version).toBe("codex 0.42.0");
      expect(codexNative!.runtime).toBe("native");

      const claudeNative = providers.find((p) => p.id === "claude-native");
      expect(claudeNative!.available).toBe(true);
      expect(claudeNative!.version).toBe("claude 2.1.0");
    });

    it("spawn 失败(--version 无输出)时 available=false 且有 diagnostic", async () => {
      const root = createRoot();
      vi.spyOn(os, "homedir").mockReturnValue(root);
      mockSpawnByCommand({
        codex: () => null,
        claude: () => null
      });

      const registry = new ProviderRegistry(root);
      const providers = await registry.refresh();

      for (const p of providers) {
        expect(p.available).toBe(false);
        expect(p.diagnostic).toBeTruthy();
      }
    });

    it("并发调用复用同一 in-flight promise", async () => {
      const root = createRoot();
      vi.spyOn(os, "homedir").mockReturnValue(root);
      mockSpawnByCommand({
        codex: () => "codex 1.0",
        claude: () => "claude 1.0"
      });

      const registry = new ProviderRegistry(root);
      const [a, b, c] = await Promise.all([registry.refresh(), registry.refresh(), registry.refresh()]);
      expect(a).toBe(b);
      expect(b).toBe(c);
    });

    it("refresh 完成后 inflight 清空(可再次 refresh)", async () => {
      const root = createRoot();
      vi.spyOn(os, "homedir").mockReturnValue(root);
      mockSpawnByCommand({
        codex: () => "codex 1.0",
        claude: () => "claude 1.0"
      });

      const registry = new ProviderRegistry(root);
      const first = await registry.refresh();
      const second = await registry.refresh();
      expect(second).toEqual(first);
    });

    it("探测异常时 refresh 不抛,finally 清 inflight", async () => {
      const root = createRoot();
      vi.spyOn(os, "homedir").mockReturnValue(root);
      // 让所有命令返回 null → available=false,不阻断
      mockSpawnByCommand({
        codex: () => null,
        claude: () => null
      });

      const registry = new ProviderRegistry(root);
      const providers = await registry.refresh();
      expect(providers.every((p) => p.available === false)).toBe(true);
      // 可再次调用(inflight 已清)
      await registry.refresh();
    });
  });

  describe("probeCodexModel (通过 os.homedir 读 config.toml)", () => {
    it("refresh 后 detectedModel 反映 config.toml 的 model 字段", async () => {
      const root = createRoot();
      vi.spyOn(os, "homedir").mockReturnValue(root);
      fs.mkdirSync(path.join(root, ".codex"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".codex", "config.toml"),
        'model = "gpt-5.2"\n'
      );
      mockSpawnByCommand({
        codex: () => "codex 1.0",
        claude: () => "claude 1.0"
      });

      const registry = new ProviderRegistry(root);
      const providers = await registry.refresh();
      const codex = providers.find((p) => p.id === "codex-native");
      expect(codex!.detectedModel).toBe("gpt-5.2");
    });

    it("[model] section 的 name 字段也能解析", async () => {
      const root = createRoot();
      vi.spyOn(os, "homedir").mockReturnValue(root);
      fs.mkdirSync(path.join(root, ".codex"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".codex", "config.toml"),
        '[model]\nname = "o3-mini"\n'
      );
      mockSpawnByCommand({ codex: () => "codex 1.0", claude: () => "claude 1.0" });

      const registry = new ProviderRegistry(root);
      const providers = await registry.refresh();
      expect(providers.find((p) => p.id === "codex-native")!.detectedModel).toBe("o3-mini");
    });

    it("config.toml 不存在时 detectedModel=null", async () => {
      const root = createRoot();
      vi.spyOn(os, "homedir").mockReturnValue(root);
      mockSpawnByCommand({ codex: () => "codex 1.0", claude: () => "claude 1.0" });

      const registry = new ProviderRegistry(root);
      const providers = await registry.refresh();
      expect(providers.find((p) => p.id === "codex-native")!.detectedModel).toBeNull();
    });
  });

  describe("probeClaudeModel (通过 settings.json)", () => {
    it("优先读取 settings.json 顶层 model", async () => {
      const root = createRoot();
      vi.spyOn(os, "homedir").mockReturnValue(root);
      fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".claude", "settings.json"),
        JSON.stringify({ model: "claude-config-model", env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "fallback" } })
      );
      mockSpawnByCommand({ codex: () => "codex 1.0", claude: () => "claude 1.0" });

      const registry = new ProviderRegistry(root);
      const providers = await registry.refresh();
      expect(providers.find((p) => p.id === "claude-native")!.detectedModel).toBe("claude-config-model");
    });

    it("读 ANTHROPIC_DEFAULT_SONNET_MODEL 优先", async () => {
      const root = createRoot();
      vi.spyOn(os, "homedir").mockReturnValue(root);
      fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".claude", "settings.json"),
        JSON.stringify({ env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4", ANTHROPIC_MODEL: "fallback" } })
      );
      mockSpawnByCommand({ codex: () => "codex 1.0", claude: () => "claude 1.0" });

      const registry = new ProviderRegistry(root);
      const providers = await registry.refresh();
      expect(providers.find((p) => p.id === "claude-native")!.detectedModel).toBe("claude-sonnet-4");
    });

    it("无 env 时 detectedModel=null", async () => {
      const root = createRoot();
      vi.spyOn(os, "homedir").mockReturnValue(root);
      mockSpawnByCommand({ codex: () => "codex 1.0", claude: () => "claude 1.0" });

      const registry = new ProviderRegistry(root);
      const providers = await registry.refresh();
      expect(providers.find((p) => p.id === "claude-native")!.detectedModel).toBeNull();
    });
  });

  describe("WSL 探测路径 (win32 + WSL UNC projectRoot)", () => {
    it("win32 + WSL projectRoot 时生成 wsl provider", async () => {
      const home = createRoot();
      vi.spyOn(os, "homedir").mockReturnValue(home);
      vi.spyOn(process, "platform", "get").mockReturnValue("win32");
      // WSL UNC 路径 → parseWslPath 返回 {distro, linuxPath}
      const wslProjectRoot = "\\\\wsl.localhost\\Ubuntu\\home\\user\\project";
      // mock wsl.exe 返回版本 + codex/claude native 探测
      // wsl 命令参数复杂,用通配脚本:只要 exit 0 就输出版本
      const bin = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-wsl-bin-"));
      roots.push(bin);
      process.env.PATH = bin;
      // Claude 只有经登录 shell 才能命中新版 CLI；直接调用模拟被旧版遮蔽。
      const wslScript = `#!/bin/bash
if [[ "$*" == *"auth status"* ]]; then
  if [[ "$*" == *"/bin/sh -lc"* ]]; then echo '{"loggedIn":true}'; else echo 'old claude prompt'; fi
  exit 0
fi
if [[ "$*" == *"claude --version"* ]]; then
  if [[ "$*" == *"/bin/sh -lc"* ]]; then echo "2.1.177 (Claude Code)"; else echo "1.0.71 (Claude Code)"; fi
  exit 0
fi
if [[ "$*" == *"--version" ]]; then echo "tool-1.0"; exit 0; fi
if [[ "$*" == *"app-server --help"* ]]; then echo "ok"; exit 0; fi
if [[ "$*" == *".claude/settings.json"* ]]; then echo '{"model":"wsl-claude-model"}'; exit 0; fi
if [[ "$*" == *".codex/config.toml"* ]]; then echo 'model = "wsl-codex-model"'; exit 0; fi
exit 1`;
      fs.writeFileSync(path.join(bin, "wsl.exe"), wslScript, { mode: 0o755 });
      // native 命令(在 win32 下走 locateWindowsCommands → where.exe,这里跳过)
      // 给 where.exe 一个空输出脚本,避免 native 路径报错
      fs.writeFileSync(path.join(bin, "where.exe"), "#!/bin/bash\necho ''\nexit 0", { mode: 0o755 });

      const registry = new ProviderRegistry(wslProjectRoot);
      const providers = await registry.refresh();
      const wslProviders = providers.filter((p) => p.runtime === "wsl");
      expect(wslProviders.length).toBeGreaterThan(0);
      expect(wslProviders.every((p) => p.id.includes("-wsl-Ubuntu"))).toBe(true);
      expect(wslProviders.find((p) => p.provider === "claude")!.available).toBe(true);
      expect(wslProviders.find((p) => p.provider === "claude")!.version).toBe("2.1.177 (Claude Code)");
      expect(wslProviders.find((p) => p.provider === "claude")!.detectedModel).toBe("wsl-claude-model");
      expect(wslProviders.find((p) => p.provider === "codex")!.detectedModel).toBe("wsl-codex-model");
    });

    it("parseClaudeAuthStatus: 'not logged in' 返回 false", async () => {
      // 直接测 parseClaudeAuthStatus 导出函数
      const { parseClaudeAuthStatus } = await import("./provider-registry");
      expect(parseClaudeAuthStatus("You are not logged in")).toBe(false);
      expect(parseClaudeAuthStatus(null)).toBe(false);
      expect(parseClaudeAuthStatus('{"loggedIn":true}')).toBe(true);
      expect(parseClaudeAuthStatus("Logged in as user")).toBe(true);
    });
  });
});

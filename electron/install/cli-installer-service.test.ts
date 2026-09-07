import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gzipSync, zipSync } from "fflate";
import { buildAppPaths } from "../paths/app-paths-service";
import {
  CliInstallerError,
  CliInstallerService,
  detectCliToolPlatform,
  extractBinary,
  type CliInstallerTransport
} from "./cli-installer-service";

let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-cli-installer-"));
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("detectCliToolPlatform", () => {
  it("limits the one-click phase to native Windows/macOS", () => {
    expect(detectCliToolPlatform("win32", "x64")).toBe("windows-x64");
    expect(detectCliToolPlatform("win32", "arm64")).toBe("windows-arm64");
    expect(detectCliToolPlatform("darwin", "arm64")).toBe("macos-arm64");
    expect(detectCliToolPlatform("linux", "x64")).toBeNull();
    expect(detectCliToolPlatform("freebsd", "x64")).toBeNull();
  });
});

describe("extractBinary", () => {
  it("extracts matching binaries from ZIP and tar.gz assets", () => {
    const zip = Buffer.from(zipSync({ "bin/claude.exe": new Uint8Array([1, 2, 3]) }));
    expect(extractBinary(zip, "claude-windows-x64.zip", "claude")).toEqual(Buffer.from([1, 2, 3]));
    const tar = buildTar([["codex/codex", Buffer.from("elf")]]);
    expect(extractBinary(Buffer.from(gzipSync(new Uint8Array(tar))), "codex-macos-arm64.tar.gz", "codex")).toEqual(Buffer.from("elf"));
  });
});

describe("CliInstallerService", () => {
  it("detects app-private before system PATH", () => {
    const paths = buildAppPaths(path.join(root, "user-data"));
    fs.mkdirSync(paths.toolBin, { recursive: true });
    fs.writeFileSync(path.join(paths.toolBin, "claude"), "#!/bin/sh\n");
    fs.writeFileSync(path.join(paths.toolBin, "claude-manifest.json"), JSON.stringify({ schemaVersion: 1, cli: "claude", version: "2.1.0", digest: "a".repeat(64), sourceUrl: "https://claude.ai/install.sh", method: "claude-native", installedAt: new Date().toISOString() }));
    const service = new CliInstallerService(paths, { platform: "darwin", arch: "arm64", systemPathResolver: () => "/usr/local/bin/claude" });
    expect(service.detect("claude")).toMatchObject({ installed: true, source: "app-tools", executablePath: path.join(paths.toolBin, "claude") });
  });

  it("falls back to a system PATH executable when no app-private manifest exists", () => {
    const paths = buildAppPaths(path.join(root, "user-data"));
    const service = new CliInstallerService(paths, { platform: "darwin", arch: "arm64", systemPathResolver: () => "/usr/local/bin/codex" });
    expect(service.detect("codex")).toEqual({ installed: true, source: "system-path", executablePath: "/usr/local/bin/codex" });
  });

  it("runs Claude's official script inside an isolated app-private HOME and records a digest", async () => {
    const paths = buildAppPaths(path.join(root, "user-data"));
    const transport: CliInstallerTransport = vi.fn(async (url) => {
      expect(url).toBe("https://claude.ai/install.sh");
      return { statusCode: 200, body: Buffer.from("#!/bin/sh\necho installer\n") };
    });
    const commandRunner = vi.fn(async (_command, _args, options) => {
      const launcher = path.join(options.cwd, "native-home", ".local", "bin", "claude");
      fs.mkdirSync(path.dirname(launcher), { recursive: true });
      fs.writeFileSync(launcher, "#!/bin/sh\necho claude\n");
      return { stdout: "Claude Code 2.1.3", stderr: "" };
    });
    const phases: string[] = [];
    const service = new CliInstallerService(paths, { platform: "darwin", arch: "arm64", transport, commandRunner, onProgress: (item) => phases.push(item.phase) });
    const status = await service.install("claude");
    expect(status.installed).toBe(true);
    expect(status.version).toBe("2.1.3");
    expect(fs.existsSync(path.join(paths.tools, "native", "claude"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(paths.toolBin, "claude-manifest.json"), "utf8")).digest).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.readFileSync(path.join(paths.toolBin, "claude"), "utf8")).toContain(`export HOME='${path.join(paths.tools, "native", "claude")}'`);
    expect(phases).toEqual(["resolving", "downloading", "verifying", "installing", "done"]);
    const calls = commandRunner.mock.calls.length;
    await service.install("claude");
    expect(commandRunner).toHaveBeenCalledTimes(calls);
  });

  it("runs Codex's official Windows standalone installer without Node/npm", async () => {
    const paths = buildAppPaths(path.join(root, "user-data"));
    const legacyRoot = seedLegacyCodexInstall(paths);
    const transport: CliInstallerTransport = vi.fn(async (url) => {
      expect(url).toBe("https://chatgpt.com/codex/install.ps1");
      return { statusCode: 200, finalUrl: "https://releases.openai.com/codex/install.ps1", body: Buffer.from("Write-Host installer\n") };
    });
    const commandRunner = vi.fn(async (command, args, options) => {
      if (command === "powershell.exe") {
        const installDir = String(options.env.CODEX_INSTALL_DIR);
        fs.mkdirSync(installDir, { recursive: true });
        fs.writeFileSync(path.join(installDir, "codex.exe"), "native-codex");
        return { stdout: "Codex CLI 0.42.0 installed successfully.", stderr: "" };
      }
      expect(command).toBe(path.join(paths.tools, "native", "codex", "bin", "codex.exe"));
      expect(args).toEqual(["--version"]);
      return { stdout: "codex-cli 0.42.0", stderr: "" };
    });
    const service = new CliInstallerService(paths, { platform: "win32", arch: "x64", transport, commandRunner });
    const status = await service.install("codex");
    expect(status.installed).toBe(true);
    expect(status.version).toBe("0.42.0");
    expect(status.sourceUrl).toBe("https://chatgpt.com/codex/install.ps1");
    expect(commandRunner).toHaveBeenNthCalledWith(
      1,
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", expect.stringMatching(/install\.ps1$/)],
      expect.objectContaining({
        env: expect.objectContaining({
          CODEX_NON_INTERACTIVE: "1",
          OS: "Windows_NT",
          CODEX_INSTALL_DIR: path.join(paths.tools, "native", "codex", "bin"),
          CODEX_HOME: path.join(paths.tools, "native", "codex", "home")
        })
      })
    );
    const launcher = fs.readFileSync(status.executablePath, "utf8");
    expect(launcher).toContain(path.join(paths.tools, "native", "codex", "bin", "codex.exe"));
    expect(launcher).not.toMatch(/\bnode\b|\bnpm\b|set "HOME=/i);
    expect(fs.existsSync(legacyRoot)).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(paths.toolBin, "codex-manifest.json"), "utf8"))).toMatchObject({ method: "codex-standalone", version: "0.42.0" });
  });

  it("preserves a legacy managed Codex install when standalone migration fails", async () => {
    const paths = buildAppPaths(path.join(root, "user-data"));
    const legacyRoot = seedLegacyCodexInstall(paths);
    const oldLauncher = fs.readFileSync(path.join(paths.toolBin, "codex.cmd"), "utf8");
    const service = new CliInstallerService(paths, {
      platform: "win32",
      arch: "x64",
      transport: async () => ({ statusCode: 200, finalUrl: "https://releases.openai.com/codex/install.ps1", body: Buffer.from("script") }),
      commandRunner: async (_command, _args, options) => {
        fs.writeFileSync(path.join(String(options.env.CODEX_HOME), "partial"), "partial");
        throw new Error("installer failed");
      }
    });

    await expect(service.install("codex")).rejects.toMatchObject({ code: "install-command-failed" });

    expect(fs.readFileSync(path.join(paths.toolBin, "codex.cmd"), "utf8")).toBe(oldLauncher);
    expect(JSON.parse(fs.readFileSync(path.join(paths.toolBin, "codex-manifest.json"), "utf8"))).toMatchObject({ method: "codex-npm", version: "0.41.0" });
    expect(fs.existsSync(legacyRoot)).toBe(true);
    expect(fs.existsSync(path.join(paths.tools, "native", "codex"))).toBe(false);
  });

  it("checks OpenAI's release channel and upgrades with the official standalone installer", async () => {
    const paths = buildAppPaths(path.join(root, "user-data"));
    let installedVersion = "0.42.0";
    const commandRunner = vi.fn(async (command, _args, options) => {
      if (command === "sh") {
        const installDir = String(options.env.CODEX_INSTALL_DIR);
        fs.mkdirSync(installDir, { recursive: true });
        fs.writeFileSync(path.join(installDir, "codex"), "#!/bin/sh\n", { mode: 0o755 });
        return { stdout: `Codex CLI ${installedVersion} installed successfully.`, stderr: "" };
      }
      return { stdout: `codex-cli ${installedVersion}`, stderr: "" };
    });
    const transport: CliInstallerTransport = vi.fn(async (url) => {
      if (url === "https://chatgpt.com/codex/install.sh") return { statusCode: 200, finalUrl: url, body: Buffer.from("#!/bin/sh\n") };
      expect(url).toBe("https://releases.openai.com/codex/channels/latest");
      return { statusCode: 200, body: Buffer.from(JSON.stringify({ tag_name: "rust-v0.43.0" })) };
    });
    const service = new CliInstallerService(paths, { platform: "darwin", arch: "arm64", transport, commandRunner });
    await service.install("codex");

    await expect(service.checkForUpdate("codex")).resolves.toMatchObject({ currentVersion: "0.42.0", latestVersion: "0.43.0", updateAvailable: true, canUpgrade: true, source: "official" });
    installedVersion = "0.43.0";
    await expect(service.upgrade("codex")).resolves.toMatchObject({ installed: true, version: "0.43.0" });
    expect(commandRunner).toHaveBeenCalledTimes(4);
    expect(transport).toHaveBeenCalledWith("https://chatgpt.com/codex/install.sh", expect.any(AbortSignal));
  });

  it("checks Claude's latest channel instead of parsing the bootstrap script", async () => {
    const paths = buildAppPaths(path.join(root, "user-data"));
    fs.mkdirSync(paths.toolBin, { recursive: true });
    fs.writeFileSync(path.join(paths.toolBin, "claude.exe"), "launcher");
    fs.writeFileSync(path.join(paths.toolBin, "claude-manifest.json"), JSON.stringify({
      schemaVersion: 1,
      cli: "claude",
      version: "2.1.177",
      digest: "a".repeat(64),
      sourceUrl: "https://claude.ai/install.ps1",
      method: "claude-native",
      installedAt: new Date().toISOString()
    }));
    const transport: CliInstallerTransport = vi.fn(async (url) => {
      expect(url).toBe("https://downloads.claude.ai/claude-code-releases/latest");
      return { statusCode: 200, body: Buffer.from("2.1.233\n") };
    });
    const service = new CliInstallerService(paths, { platform: "win32", arch: "x64", transport });

    await expect(service.checkForUpdate("claude")).resolves.toMatchObject({
      currentVersion: "2.1.177",
      latestVersion: "2.1.233",
      updateAvailable: true,
      canUpgrade: true,
      source: "official"
    });
  });

  it("offers an app-private automatic update for a system PATH CLI", async () => {
    const paths = buildAppPaths(path.join(root, "user-data"));
    const commandRunner = vi.fn(async () => ({ stdout: "2.1.177 (Claude Code)", stderr: "" }));
    const transport: CliInstallerTransport = vi.fn(async (url) => {
      expect(url).toBe("https://downloads.claude.ai/claude-code-releases/latest");
      return { statusCode: 200, body: Buffer.from("2.1.233\n") };
    });
    const service = new CliInstallerService(paths, {
      platform: "win32",
      arch: "x64",
      transport,
      commandRunner,
      systemPathResolver: () => "C:\\Users\\say\\.local\\bin\\claude.exe"
    });

    await expect(service.checkForUpdate("claude")).resolves.toMatchObject({
      installed: true,
      currentVersion: "2.1.177",
      latestVersion: "2.1.233",
      updateAvailable: true,
      canUpgrade: true,
      source: "official"
    });
    expect(commandRunner).toHaveBeenCalledWith(
      "C:\\Users\\say\\.local\\bin\\claude.exe",
      ["--version"],
      expect.objectContaining({ cwd: process.cwd(), env: process.env })
    );
  });

  it("rejects a redirect from the official Claude host", async () => {
    const paths = buildAppPaths(path.join(root, "user-data"));
    const commandRunner = vi.fn();
    const service = new CliInstallerService(paths, {
      platform: "darwin",
      arch: "arm64",
      transport: async () => ({ statusCode: 200, finalUrl: "https://attacker.example/install.sh", body: Buffer.from("script") }),
      commandRunner
    });
    await expect(service.install("claude")).rejects.toMatchObject<CliInstallerError>({ code: "download-failed" });
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it("rejects a redirect from the official Codex installer entrypoint", async () => {
    const paths = buildAppPaths(path.join(root, "user-data"));
    const commandRunner = vi.fn();
    const service = new CliInstallerService(paths, {
      platform: "win32",
      arch: "x64",
      transport: async () => ({ statusCode: 200, finalUrl: "https://attacker.example/install.ps1", body: Buffer.from("script") }),
      commandRunner
    });
    await expect(service.install("codex")).rejects.toMatchObject<CliInstallerError>({ code: "download-failed" });
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it("accepts Claude's official downloads redirect", async () => {
    const paths = buildAppPaths(path.join(root, "user-data"));
    const commandRunner = vi.fn(async (_command, _args, options) => {
      const launcher = path.join(options.cwd, "native-home", ".local", "bin", "claude");
      fs.mkdirSync(path.dirname(launcher), { recursive: true });
      fs.writeFileSync(launcher, "#!/bin/sh\n");
      return { stdout: "Claude Code 2.1.3", stderr: "" };
    });
    const service = new CliInstallerService(paths, {
      platform: "darwin",
      arch: "arm64",
      transport: async () => ({ statusCode: 200, finalUrl: "https://downloads.claude.ai/claude-code-releases/bootstrap.sh", body: Buffer.from("script") }),
      commandRunner
    });
    await expect(service.install("claude")).resolves.toMatchObject({ installed: true, version: "2.1.3" });
  });

  it("cancels an active native install and leaves no installed state", async () => {
    const paths = buildAppPaths(path.join(root, "user-data"));
    const commandRunner = vi.fn((_command, _args, options) => new Promise<{ stdout: string; stderr: string }>((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }));
    const service = new CliInstallerService(paths, { platform: "darwin", arch: "arm64", transport: async () => ({ statusCode: 200, body: Buffer.from("script") }), commandRunner });
    const pending = service.install("claude");
    await vi.waitFor(() => expect(commandRunner).toHaveBeenCalled());
    expect(service.cancel("claude")).toBe(true);
    await expect(pending).rejects.toMatchObject<CliInstallerError>({ code: "cancelled" });
    expect(service.status("claude").installed).toBe(false);
    expect(fs.readdirSync(paths.staging)).toHaveLength(0);
  });

  it("fails closed when the platform is unsupported or the official download is unavailable", async () => {
    const paths = buildAppPaths(path.join(root, "user-data"));
    await expect(new CliInstallerService(paths, { platform: "linux", arch: "x64" }).install("codex")).rejects.toMatchObject({ code: "platform-unsupported" });
    const service = new CliInstallerService(paths, { platform: "darwin", arch: "arm64", transport: async () => { throw new Error("offline"); } });
    await expect(service.install("codex")).rejects.toMatchObject({ code: "download-failed" });
  });
});

function seedLegacyCodexInstall(paths: ReturnType<typeof buildAppPaths>): string {
  const legacyRoot = path.join(paths.tools, "npm-global", "codex");
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.mkdirSync(paths.toolBin, { recursive: true });
  fs.writeFileSync(path.join(paths.toolBin, "codex.cmd"), "@echo off\r\nold-node codex.js %*\r\n");
  fs.writeFileSync(path.join(paths.toolBin, "codex-manifest.json"), JSON.stringify({
    schemaVersion: 1,
    cli: "codex",
    version: "0.41.0",
    digest: "a".repeat(64),
    sourceUrl: "https://registry.npmjs.org/@openai%2fcodex",
    method: "codex-npm",
    installedAt: new Date().toISOString()
  }));
  return legacyRoot;
}

function buildTar(entries: Array<[string, Buffer]>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, data] of entries) {
    const header = Buffer.alloc(512);
    header.write(name.slice(0, 99), 0, "utf8");
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "utf8");
    header.write("0", 156, "utf8");
    header.write("ustar\0", 257, "utf8");
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

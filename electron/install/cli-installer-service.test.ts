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
  resolveNpmCliPath,
  type CliInstallerTransport
} from "./cli-installer-service";

let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-cli-installer-"));
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("detectCliToolPlatform", () => {
  it("limits the one-click phase to native Windows/macOS", () => {
    expect(detectCliToolPlatform("win32", "x64")).toBe("windows-x64");
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

  it("installs Codex into an npm prefix using managed Node, never system npm", async () => {
    const paths = buildAppPaths(path.join(root, "user-data"));
    const runtimeRoot = path.join(root, "runtime");
    const node = path.join(runtimeRoot, "bin", "node");
    const npmCli = path.join(runtimeRoot, "lib", "node_modules", "npm", "bin", "npm-cli.js");
    fs.mkdirSync(path.dirname(node), { recursive: true });
    fs.mkdirSync(path.dirname(npmCli), { recursive: true });
    fs.writeFileSync(node, "node");
    fs.writeFileSync(npmCli, "npm");
    const commandRunner = vi.fn(async (_command, args) => {
      const prefix = String(args[args.indexOf("--prefix") + 1]);
      const packageRoot = path.join(prefix, "node_modules", "@openai", "codex");
      fs.mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
      fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@openai/codex", version: "0.42.0", bin: { codex: "bin/codex.js" } }));
      fs.writeFileSync(path.join(packageRoot, "bin", "codex.js"), "console.log('codex')\n");
      return { stdout: "", stderr: "" };
    });
    const service = new CliInstallerService(paths, { platform: "darwin", arch: "arm64", commandRunner, resolveNodeRuntime: () => ({ nodeExecutable: node, npmCliPath: npmCli }) });
    const status = await service.install("codex");
    expect(status.installed).toBe(true);
    expect(status.version).toBe("0.42.0");
    expect(commandRunner).toHaveBeenCalledWith(node, expect.arrayContaining([npmCli, "install", "--prefix", expect.any(String), "@openai/codex"]), expect.anything());
    expect(fs.readFileSync(status.executablePath, "utf8")).toContain(node);
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

  it("fails closed when the platform or managed Node runtime is unavailable", async () => {
    const paths = buildAppPaths(path.join(root, "user-data"));
    await expect(new CliInstallerService(paths, { platform: "linux", arch: "x64" }).install("codex")).rejects.toMatchObject({ code: "platform-unsupported" });
    await expect(new CliInstallerService(paths, { platform: "darwin", arch: "arm64" }).install("codex")).rejects.toMatchObject({ code: "runtime-unavailable" });
  });
});

describe("resolveNpmCliPath", () => {
  it("finds npm next to a managed Node binary", () => {
    const node = path.join(root, "bin", "node");
    const npm = path.join(root, "bin", "npm-cli.js");
    fs.mkdirSync(path.dirname(node), { recursive: true });
    fs.writeFileSync(node, "node");
    fs.writeFileSync(npm, "npm");
    expect(resolveNpmCliPath(node)).toBe(npm);
  });
});

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

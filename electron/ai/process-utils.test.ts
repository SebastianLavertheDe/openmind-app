import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWslLoginCommand,
  decodeProcessOutput,
  execInProject,
  execInProjectFromFile,
  execInProjectToFile,
  killProcessTree,
  parseWslPath,
  replaceFileAtomicallySync,
  safeRelative,
  spawnInDirectory,
  spawnNativeInDirectory,
  toWslPath
} from "./process-utils";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-process-"));
  roots.push(root);
  return root;
}

describe("streamed process output", () => {
  it("writes output larger than execFile maxBuffer without buffering it in memory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-stream-output-"));
    roots.push(root);
    const output = path.join(root, "large-output.bin");
    const size = 70 * 1024 * 1024;
    await execInProjectToFile(root, process.execPath, ["-e", `process.stdout.write(Buffer.alloc(${size}, 120))`], output);
    expect(fs.statSync(output).size).toBe(size);
  }, 30_000);

  it("parses both Windows WSL UNC path forms", () => {
    expect(parseWslPath("\\\\wsl.localhost\\Ubuntu\\home\\say\\project")).toEqual({
      distro: "Ubuntu",
      linuxPath: "/home/say/project"
    });
    expect(parseWslPath("\\\\wsl$\\Ubuntu\\home\\say\\project")).toEqual({
      distro: "Ubuntu",
      linuxPath: "/home/say/project"
    });
  });

  it("falls back safely when replacing an existing file returns EPERM", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-atomic-replace-"));
    roots.push(root);
    const target = path.join(root, "session.json");
    const temporary = path.join(root, "session.json.tmp");
    fs.writeFileSync(target, "old");
    fs.writeFileSync(temporary, "new");
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    });
    replaceFileAtomicallySync(temporary, target);
    expect(fs.readFileSync(target, "utf8")).toBe("new");
    expect(fs.existsSync(temporary)).toBe(false);
    expect(fs.readdirSync(root).filter((name) => name.includes(".bak-"))).toEqual([]);
  });
});

describe("toWslPath", () => {
  it("WSL UNC 路径返回 linuxPath", () => {
    expect(toWslPath("\\\\wsl.localhost\\Ubuntu\\home\\user")).toBe("/home/user");
  });

  it("指定 distro 匹配时返回 linuxPath", () => {
    expect(toWslPath("\\\\wsl.localhost\\Ubuntu\\home\\user", "Ubuntu")).toBe("/home/user");
  });

  it("指定 distro 不匹配时走 mnt 转换", () => {
    // distro 不匹配 → parseWslPath 返回 Ubuntu,但 distro 校验失败 → 走 mnt 转换
    // Windows 盘符路径才走 mnt
    expect(toWslPath("C:\\Users\\test", "Debian")).toBe("/mnt/c/Users/test");
  });

  it("Windows 盘符路径转 /mnt", () => {
    expect(toWslPath("C:\\Users\\test")).toBe("/mnt/c/Users/test");
    expect(toWslPath("D:\\repo\\file.txt")).toBe("/mnt/d/repo/file.txt");
  });

  it("已是 linux 路径时原样返回(无盘符无反斜杠)", () => {
    expect(toWslPath("/home/user")).toBe("/home/user");
  });
});

describe("buildWslLoginCommand", () => {
  it("通过登录 shell 构造解析命令并原样转发参数", () => {
    const invocation = buildWslLoginCommand("printf", ["%s|%s", "a b", "$HOME"]);
    expect(invocation.command).toBe("/bin/sh");
    expect(invocation.args).toEqual([
      "-lc",
      expect.stringContaining('resolved="$(command -v "$1")"'),
      "openmind-wsl-login",
      "printf",
      "%s|%s",
      "a b",
      "$HOME"
    ]);
  });

  it.skipIf(process.platform === "win32")("通过登录 shell 解析命令并原样转发参数", async () => {
    const invocation = buildWslLoginCommand("printf", ["%s|%s", "a b", "$HOME"]);
    const child = spawnInDirectory(createRoot(), invocation.command, invocation.args);
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    const code = await waitForClose(child);
    expect(code).toBe(0);
    expect(stdout).toBe("a b|$HOME");
  });
});

describe("execInProject", () => {
  it("成功执行命令并返回 stdout", async () => {
    const root = createRoot();
    const result = await execInProject(root, process.execPath, ["-e", "process.stdout.write('hello')"]);
    expect(result.stdout.trim()).toBe("hello");
  });

  it("非零退出码抛错含 stderr", async () => {
    const root = createRoot();
    await expect(execInProject(root, process.execPath, ["-e", "process.exit(1)"])).rejects.toThrow();
  });

  it("带 input 时走 spawn 路径(stdin 传入)", async () => {
    const root = createRoot();
    // cat 不一定存在,用 node 读 stdin
    const result = await execInProject(
      root,
      process.execPath,
      ["-e", "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(d.toUpperCase()))"],
      { input: "hello" }
    );
    expect(result.stdout).toBe("HELLO");
  });

  it("带 input 时非零退出码抛错", async () => {
    const root = createRoot();
    await expect(
      execInProject(root, process.execPath, ["-e", "process.exit(2)"], { input: "x" })
    ).rejects.toThrow();
  });

  it("stderr 被捕获", async () => {
    const root = createRoot();
    const result = await execInProject(
      root,
      process.execPath,
      ["-e", "process.stderr.write('warn message')"]
    );
    expect(result.stderr).toContain("warn message");
  });
});

describe("execInProjectFromFile", () => {
  it("从文件读 stdin 并返回 stdout", async () => {
    const root = createRoot();
    const inputFile = path.join(root, "input.txt");
    fs.writeFileSync(inputFile, "line1\nline2\n");
    const result = await execInProjectFromFile(
      root,
      process.execPath,
      ["-e", "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(d.split('\\n').length+''))"],
      inputFile
    );
    expect(result.stdout).toBe("3"); // 2 换行 → 3 段
  });

  it("非零退出码抛错", async () => {
    const root = createRoot();
    const inputFile = path.join(root, "input.txt");
    fs.writeFileSync(inputFile, "x");
    await expect(
      execInProjectFromFile(root, process.execPath, ["-e", "process.exit(1)"], inputFile)
    ).rejects.toThrow();
  });
});

describe("execInProjectToFile", () => {
  it("非零退出码抛错", async () => {
    const root = createRoot();
    const outFile = path.join(root, "out.txt");
    await expect(
      execInProjectToFile(root, process.execPath, ["-e", "process.exit(1)"], outFile)
    ).rejects.toThrow();
  });
});

describe("spawnInDirectory / spawnNativeInDirectory", () => {
  it.skipIf(process.platform !== "win32")("uses the Windows npm launcher when where lists a POSIX shim first", async () => {
    const root = createRoot();
    const command = "openmind-npm-shim-test";
    fs.writeFileSync(path.join(root, command), "#!/bin/sh\nexit 99\n");
    fs.writeFileSync(path.join(root, `${command}.cmd`), "@echo off\r\necho windows-launcher\r\n");
    vi.stubEnv("PATH", `${root};${process.env.PATH || ""}`);
    const child = spawnNativeInDirectory(root, command, []);
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    expect(await waitForClose(child)).toBe(0);
    expect(stdout.trim()).toBe("windows-launcher");
  });

  it.skipIf(process.platform !== "win32")("resolves an explicit extensionless npm shim to its Windows sibling", async () => {
    const root = createRoot();
    const command = path.join(root, "npm-tool");
    fs.writeFileSync(command, "#!/bin/sh\nexit 99\n");
    fs.writeFileSync(`${command}.cmd`, "@echo off\r\necho explicit-launcher\r\n");
    const child = spawnNativeInDirectory(root, command, []);
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    expect(await waitForClose(child)).toBe(0);
    expect(stdout.trim()).toBe("explicit-launcher");
  });

  it.skipIf(process.platform !== "win32")("preserves spaces and quoted config values through a Windows launcher", async () => {
    const root = path.join(createRoot(), "launcher with spaces");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "args.cjs"), "console.log(JSON.stringify(process.argv.slice(2)))");
    const command = path.join(root, "tool.cmd");
    fs.writeFileSync(command, `@echo off\r\n"${process.execPath}" "%~dp0args.cjs" %*\r\n`);
    const args = ["two words", "-c", 'name="provider with spaces"'];
    const child = spawnNativeInDirectory(root, command, args);
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    expect(await waitForClose(child)).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual(args);
  });

  it("spawnInDirectory 返回子进程,stdout 可读", async () => {
    const root = createRoot();
    const child = spawnInDirectory(root, process.execPath, ["-e", "process.stdout.write('spawned')"]);
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    const code = await waitForClose(child);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("spawned");
  });

  it("spawnInDirectory 带 env 选项", async () => {
    const root = createRoot();
    const child = spawnInDirectory(root, process.execPath, ["-e", "process.stdout.write(process.env.MY_TEST_VAR || 'none')"], {
      env: { MY_TEST_VAR: "injected" }
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(stdout).toBe("injected");
  });

  it("spawnNativeInDirectory 返回子进程(linux 上等价 spawn)", async () => {
    const root = createRoot();
    const child = spawnNativeInDirectory(root, process.execPath, ["-e", "process.stdout.write('native')"]);
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    const code = await waitForClose(child);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("native");
  });
});

describe("killProcessTree", () => {
  it("终止一个运行中的子进程(linux: process group kill)", async () => {
    const root = createRoot();
    // Use Node instead of sleep so the same process fixture works on Windows.
    const child = spawnInDirectory(root, process.execPath, ["-e", "setTimeout(() => {}, 30_000)"]);
    // 等它真正启动
    await new Promise((r) => setTimeout(r, 50));
    expect(child.pid).toBeTruthy();
    const closed = waitForClose(child);
    await killProcessTree(child);
    // 进程应被终止(close 事件触发)
    const code = await closed;
    expect(code).not.toBe(0); // 被 signal 杀掉
  });

  it("pid 为空时 early return 不抛错", async () => {
    const root = createRoot();
    const child = spawnInDirectory(root, process.execPath, ["-e", "process.stdout.write('done')"]);
    await waitForClose(child);
    // 进程已退出,pid 可能已被回收 —— 不抛错即可
    await expect(killProcessTree(child)).resolves.toBeUndefined();
  });
});

describe("decodeProcessOutput", () => {
  it("UTF-8 buffer 正确解码", () => {
    const buf = Buffer.from("你好世界", "utf8");
    expect(decodeProcessOutput(buf)).toBe("你好世界");
  });

  it("字符串入参转 buffer 后解码", () => {
    expect(decodeProcessOutput("plain text")).toBe("plain text");
  });

  it("null 字节占比 >10% 时按 utf16le 解码", () => {
    // 构造一个 null 字节占比高的 buffer(模拟 Windows powershell 输出)
    const buf = Buffer.alloc(20, 0);
    buf.write("AB", 0, "utf16le");
    const decoded = decodeProcessOutput(buf);
    // utf16le 解码后 null 被去掉,只剩可见字符
    expect(decoded).toBe("AB");
  });

  it("去掉残留的 null 字节(低占比 utf8 路径)", () => {
    // 单个 null 字节在较长 buffer 里占比低 → utf8 解码后去掉 null
    const buf = Buffer.from("hello\x00world", "utf8");
    expect(decodeProcessOutput(buf)).toBe("helloworld");
  });

  it("空 buffer 返回空串", () => {
    expect(decodeProcessOutput(Buffer.alloc(0))).toBe("");
  });
});

describe("safeRelative", () => {
  it("正常相对路径返回", () => {
    const root = path.resolve(path.sep, "project");
    expect(safeRelative(root, path.join(root, "src", "file.ts"))).toBe("src/file.ts");
  });

  it("超出项目目录(父级)时抛错", () => {
    const root = createRoot();
    expect(() => safeRelative(root, path.resolve(root, "..", "outside.txt"))).toThrow("路径超出项目目录");
  });

  it("绝对路径(其他盘/根)时抛错", () => {
    const root = createRoot();
    const otherRoot = process.platform === "win32" ? `${path.parse(root).root}outside` : "/absolute/elsewhere";
    expect(() => safeRelative(root, otherRoot)).toThrow("路径超出项目目录");
  });
});

function waitForClose(child: ReturnType<typeof spawnInDirectory>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
}

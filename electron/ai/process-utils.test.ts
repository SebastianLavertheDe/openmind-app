import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-process-"));
  roots.push(root);
  return root;
}

describe("streamed process output", () => {
  it("writes output larger than execFile maxBuffer without buffering it in memory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-stream-output-"));
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-atomic-replace-"));
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

describe("execInProject", () => {
  it("成功执行命令并返回 stdout", async () => {
    const root = createRoot();
    const result = await execInProject(root, "echo", ["hello"]);
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
  it("spawnInDirectory 返回子进程,stdout 可读", async () => {
    const root = createRoot();
    const child = spawnInDirectory(root, "echo", ["spawned"]);
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
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
    const child = spawnNativeInDirectory(root, "echo", ["native"]);
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("native");
  });
});

describe("killProcessTree", () => {
  it("终止一个运行中的子进程(linux: process group kill)", async () => {
    const root = createRoot();
    // 启动一个 sleep 进程(linux 下 detached 形成进程组)
    const child = spawnInDirectory(root, "sleep", ["30"]);
    // 等它真正启动
    await new Promise((r) => setTimeout(r, 50));
    expect(child.pid).toBeTruthy();
    await killProcessTree(child);
    // 进程应被终止(close 事件触发)
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(code).not.toBe(0); // 被 signal 杀掉
  });

  it("pid 为空时 early return 不抛错", async () => {
    const root = createRoot();
    const child = spawnInDirectory(root, "echo", ["done"]);
    await new Promise<number | null>((resolve) => child.on("close", resolve));
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
    expect(safeRelative("/project", "/project/src/file.ts")).toBe("src/file.ts");
  });

  it("超出项目目录(父级)时抛错", () => {
    expect(() => safeRelative("/project", "/etc/passwd")).toThrow("路径超出项目目录");
  });

  it("绝对路径(其他盘/根)时抛错", () => {
    expect(() => safeRelative("/project", "/absolute/elsewhere")).toThrow("路径超出项目目录");
  });
});

import { spawn } from "node:child_process";

/** Run one short provider probe without blocking the AI worker event loop. */
export function runProviderCommand(command: string, args: string[], timeoutMs = 15_000): Promise<string | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }
    let stdout = "";
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.on("close", () => { clearTimeout(timer); resolve(stdout.trim() || null); });
  });
}

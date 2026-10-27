import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export class RssBusyError extends Error {
  constructor() { super("RSS configuration is busy; retry shortly."); }
}

/** CLI startup can race another installer before a run has been admitted. */
export async function waitForRssMutation<T>(work: () => T): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return work(); }
    catch (error) {
      if (!(error instanceof RssBusyError) || attempt >= 100) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}

/** Shared with the Python task runner. Lock files never outlive a dead owner. */
export function withRssLock<T>(directory: string, name: string, work: () => T): T {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${name}.lock`);
  const token = crypto.randomUUID();
  for (let attempt = 0; ; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token }), { flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let stale = false;
      try { const owner = JSON.parse(fs.readFileSync(file, "utf8")); try { process.kill(owner.pid, 0); } catch (e) { stale = (e as NodeJS.ErrnoException).code === "ESRCH"; } }
      catch { stale = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs > 60_000; }
      if (!stale || attempt > 1) throw new RssBusyError();
      fs.rmSync(file, { force: true });
    }
  }
  try { return work(); }
  finally { if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).token === token) fs.unlinkSync(file); }
}

export function rssPrivateDirectory(root: string, ...parts: string[]): string {
  const canonical = fs.realpathSync(root);
  let current = canonical;
  for (const part of parts) {
    if (!part || part === "." || part === ".." || /[\\/]/.test(part)) throw new Error("Invalid private path");
    current = path.join(current, part);
    if (fs.existsSync(current)) {
      const real = fs.realpathSync(current);
      if (!real.startsWith(`${canonical}${path.sep}`)) throw new Error("Private path escapes the content root");
    }
  }
  return current;
}

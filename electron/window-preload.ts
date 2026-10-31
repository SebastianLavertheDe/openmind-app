import fs from "node:fs";
import path from "node:path";

/** Keep a development window's bridge intact while .build is cleaned or rebuilt. */
export function prepareWindowPreload(source: string, snapshotRoot?: string): { path: string; dispose(): void } {
  if (!snapshotRoot) return { path: source, dispose() {} };
  const root = path.resolve(snapshotRoot);
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, "window-"));
  if (path.dirname(directory) !== root) throw new Error("Preload snapshot escaped its temporary directory.");
  const snapshot = path.join(directory, "preload.cjs");
  const dispose = () => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  try {
    fs.copyFileSync(source, snapshot);
    return { path: snapshot, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

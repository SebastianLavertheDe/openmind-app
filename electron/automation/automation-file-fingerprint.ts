import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Returns a bounded metadata fingerprint for exact paths below openmindRoot.
 * It never follows a symlink outside the bound and does not read file
 * contents, so polling does not copy user content into Automation state.
 */
export function createAutomationFileFingerprint(openmindRoot: string): (paths: readonly string[]) => string | undefined {
  const root = canonicalDirectory(openmindRoot);
  if (!root) return () => undefined;
  return (paths) => {
    const hash = crypto.createHash("sha256");
    for (const relative of [...paths].sort()) {
      const candidate = path.resolve(root, relative);
      if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return undefined;
      let stat: fs.Stats;
      try {
        const real: string = fs.realpathSync(candidate);
        if (real !== root && !real.startsWith(`${root}${path.sep}`)) {
          hash.update(`${relative}:escape\0`);
          continue;
        }
        stat = fs.statSync(real);
        hash.update(`${relative}:${stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other"}:${stat.size}:${stat.mtimeMs}\0`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") {
          hash.update(`${relative}:missing\0`);
          continue;
        }
        return undefined;
      }
    }
    return hash.digest("hex");
  };
}

function canonicalDirectory(value: string): string | undefined {
  try {
    const candidate = fs.realpathSync(path.resolve(value));
    return fs.statSync(candidate).isDirectory() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pruneIncompatibleWindowsDistlibLaunchers } = require("./bundled-python-runtime-utils.cjs");

/**
 * `afterPack` runs for every target, including unsigned portable builds.
 * `afterSign` runs again when Authenticode modifies executable bytes. Register
 * this hook for both stages so every distributable container gets an accurate
 * manifest, whether it is signed or not.
 */
module.exports = async function finalizeBundledPythonRuntime(context) {
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  const runtimeRoot = path.join(resourcesDir, "python-runtime");
  if (!fs.existsSync(runtimeRoot)) return;

  for (const entry of fs.readdirSync(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const targetRoot = path.join(runtimeRoot, entry.name);
    const manifestFile = path.join(targetRoot, "manifest.json");
    if (!fs.existsSync(manifestFile)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    if (manifest.schemaVersion !== 2 || manifest.target !== entry.name) {
      throw new Error(`Cannot finalize invalid bundled Python manifest: ${manifestFile}`);
    }
    const prunedLaunchers = pruneIncompatibleWindowsDistlibLaunchers(targetRoot, entry.name);
    if (prunedLaunchers.length) console.log(`Pruned ${prunedLaunchers.length} incompatible distlib launcher(s) from ${entry.name}.`);
    const filesDigest = digestTree(targetRoot, new Set(["manifest.json"]));
    const temporary = `${manifestFile}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, `${JSON.stringify({ ...manifest, filesDigest }, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, manifestFile);
    console.log(`Finalized bundled Python ${entry.name} digest after signing: ${filesDigest}`);
  }
};

function digestTree(root, excludedRelativePaths = new Set()) {
  const hash = crypto.createHash("sha256");
  const walk = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (excludedRelativePaths.has(relative)) continue;
      if (entry.isSymbolicLink()) throw new Error(`Bundled runtime may not contain symlinks: ${relative}`);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        hash.update(relative); hash.update("\0");
        hash.update(fs.readFileSync(absolute)); hash.update("\0");
      } else throw new Error(`Bundled runtime contains unsupported file: ${relative}`);
    }
  };
  walk(root);
  return hash.digest("hex");
}

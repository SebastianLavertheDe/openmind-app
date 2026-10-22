const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// The launcher outlives Electron and its Chromium file handles. Never remove
// sessionData from Electron's will-quit/exit handlers on Windows.
function runWithTemporaryProfile(command, args, options, { spawn = spawnSync, remove = fs.rmSync, warn = console.warn } = {}) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const userData = fs.mkdtempSync(path.join(temporaryRoot, "openmind-ui-catalog-"));
  if (path.dirname(path.resolve(userData)) !== temporaryRoot) throw new Error("UI catalog profile escaped the temporary directory.");
  try {
    return spawn(command, args, {
      ...options,
      env: { ...options.env, OPENMIND_UI_CATALOG_USER_DATA_DIR: userData }
    });
  } finally {
    try {
      remove(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      // Antivirus or another process can briefly retain a handle even after
      // Electron exits. Report it without masking the original test result.
      warn(`Could not remove temporary UI catalog profile ${userData}: ${error.message}`);
    }
  }
}

module.exports = { runWithTemporaryProfile };

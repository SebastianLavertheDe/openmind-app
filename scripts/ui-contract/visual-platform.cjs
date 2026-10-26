function skipUnsupportedVisualPlatform(check) {
  if (process.platform === "win32" || process.platform === "darwin") return false;
  console.log(`${check} skipped on ${process.platform}; visual gates target Windows and macOS.`);
  return true;
}

module.exports = { skipUnsupportedVisualPlatform };

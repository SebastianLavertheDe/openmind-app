const path = require("node:path");
const { audit } = require("./ui-contract/audit.cjs");
const root = path.resolve(__dirname, "..");
const rendererRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "renderer/src");
const { failures, sourceCount } = audit(rendererRoot);
if (failures.length) {
  console.error(`UI ownership check failed (${failures.length}):\n${failures.map(item => `${path.relative(root, item.file)}:${item.line}: ${item.message}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`UI ownership check passed: ${sourceCount} renderer files; shared components, typed imports and CSS ownership verified.`);
}

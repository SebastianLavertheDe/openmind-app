const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const outfile = path.join(root, ".build", "electron", "electron", "preload.js");

esbuild.buildSync({
  entryPoints: [path.join(root, "electron", "preload.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: false,
  logLevel: "info"
});

const output = fs.readFileSync(outfile, "utf8");
if (/require\((["'])\.\.?[\\/]/.test(output)) {
  throw new Error("Sandboxed preload bundle still contains a local require().");
}

console.log(`Sandbox-compatible preload bundle written: ${path.relative(root, outfile)}`);

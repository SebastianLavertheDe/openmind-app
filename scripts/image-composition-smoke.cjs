// Real Electron canvas/CLI checks. All data and profiles are temporary.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { PNG } = require("pngjs");
const electron = require("electron");
const repo = path.resolve(__dirname, "..");
const cli = path.join(repo, ".build/electron/electron/images/skill-image-cli.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-composition-smoke-"));
const env = { ...process.env, OPENMIND_USER_DATA_DIR: path.join(root, "must-not-open") };
delete env.ELECTRON_RUN_AS_NODE;
const headless = process.platform === "linux" && !env.DISPLAY;
const command = headless ? "xvfb-run" : electron;
const prefix = headless ? ["-a", electron] : [];

function solid(name, width, height, color) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([...color, 255], i);
  const file = path.join(root, name); fs.writeFileSync(file, PNG.sync.write(png)); return file;
}
function pixel(png, x, y) { return [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)]; }
function run(name, job, throughEntry = false, expectedSuccess = true) {
  const input = path.join(root, `${name}.json`), output = path.join(root, `${name}.png`);
  fs.writeFileSync(input, JSON.stringify(job));
  // --no-sandbox is confined to this test harness, matching the repo's E2E runner.
  const args = [...prefix, "--no-sandbox", throughEntry ? repo : cli, "--openmind-compose-image", input, output];
  const result = spawnSync(command, args, { env, encoding: "utf8", timeout: 45000, windowsHide: true });
  if (expectedSuccess) {
    assert.equal(result.status, 0, `${result.error || ""}\n${result.stderr}`);
    const png = PNG.sync.read(fs.readFileSync(output));
    assert.equal(png.width, job.width); assert.equal(png.height, job.height);
    assert.equal(JSON.parse(result.stdout.trim().split("\n").at(-1)).path, output);
    return png;
  }
  assert.equal(result.status, 1, `${result.error || ""}\n${result.stdout}\n${result.stderr}`);
  return result;
}

try {
  assert.ok(fs.existsSync(cli), "Run npm run build:electron first");
  const red = solid("original.png", 80, 120, [255, 0, 0]);
  const blue = solid("illustration.png", 80, 120, [0, 0, 255]);
  const before = fs.readFileSync(red);
  const cover = run("cover", { kind: "fit", image: red, width: 2350, height: 1000, fit: "contain" });
  assert.deepEqual(pixel(cover, 0, 500), [255, 255, 255]);
  assert.deepEqual(pixel(cover, 1175, 500), [255, 0, 0]);
  const cropped = run("crop", { kind: "fit", image: red, width: 160, height: 90, fit: "cover" });
  assert.deepEqual(pixel(cropped, 0, 0), [255, 0, 0]);
  const horizontal = { kind: "diptych", original: red, illustration: blue, width: 176, height: 120, gap: 16 };
  const pair = run("pair", horizontal, true);
  assert.deepEqual(pixel(pair, 40, 60), [255, 0, 0]);
  assert.deepEqual(pixel(pair, 88, 60), [255, 255, 255]);
  assert.deepEqual(pixel(pair, 136, 60), [0, 0, 255]);
  const vertical = run("vertical", { ...horizontal, width: 80, height: 256, direction: "vertical" });
  assert.deepEqual(pixel(vertical, 40, 60), [255, 0, 0]);
  assert.deepEqual(pixel(vertical, 40, 196), [0, 0, 255]);
  assert.deepEqual(fs.readFileSync(red), before);
  const previousOutput = fs.readFileSync(path.join(root, "pair.png"));
  const refused = run("pair", horizontal, true, false);
  // Electron launchers can route startup diagnostics to either captured stream.
  assert.match(refused.stdout + refused.stderr, /already exists/);
  assert.deepEqual(fs.readFileSync(path.join(root, "pair.png")), previousOutput);
  const invalid = path.join(root, "invalid.png"); fs.writeFileSync(invalid, "<svg onload='alert(1)'></svg>");
  run("invalid-image", { kind: "fit", image: invalid, width: 100, height: 100 }, false, false);
  assert.ok(!fs.existsSync(path.join(root, "invalid-image.png")));
  assert.ok(!fs.existsSync(env.OPENMIND_USER_DATA_DIR), "Composition must never initialize the ordinary app profile");
  console.log("Image composition smoke passed: exact dimensions, contain/crop, two panel directions, original preservation, overwrite refusal, invalid image rejection and isolated entry.");
} finally { fs.rmSync(root, { recursive: true, force: true }); }

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { ImageCompositionSchema } from "../../shared/image-composition";
import { composeImage } from "./image-composition";

async function main(): Promise<void> {
  const flag = process.argv.indexOf("--openmind-compose-image");
  if (flag < 0 || process.argv.length !== flag + 3) throw new Error("Expected composition JSON and a new output PNG path");
  const input = path.resolve(process.argv[flag + 1]);
  const output = path.resolve(process.argv[flag + 2]);
  if (path.extname(output).toLowerCase() !== ".png") throw new Error("Output must be a PNG file");
  if (fs.existsSync(output)) throw new Error("Output already exists; choose a new file name");
  if (fs.statSync(input).size > 64 * 1024) throw new Error("Composition JSON is too large");
  const job = ImageCompositionSchema.parse(JSON.parse(fs.readFileSync(input, "utf8")));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-image-compose-"));
  app.setPath("userData", profile);
  app.setPath("sessionData", profile);
  try {
    await app.whenReady();
    const bytes = await composeImage(job);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, bytes, { flag: "wx" });
    fs.writeSync(1, `${JSON.stringify({ path: output, width: job.width, height: job.height })}\n`);
  } finally {
    // Chromium may hold cache files until process exit on Windows. Only this
    // disposable directory is ever touched; never fall back to the user's profile.
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* OS can reclaim the temporary profile later. */ }
  }
}

void main().then(() => app.quit(), error => {
  // app.exit is immediate; synchronous output preserves diagnostics for callers.
  fs.writeSync(2, `${error instanceof Error ? error.message : String(error)}\n`);
  app.exit(1);
});

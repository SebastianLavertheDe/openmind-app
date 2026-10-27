import { app } from "electron";
import path from "node:path";

// Dispatch before importing main: frame rendering must never initialize the
// desktop's settings, content root, window or AI worker.
const legacyScript = process.argv.findIndex(value => path.basename(value) === "render_frames.cjs");
const renderFrames = process.argv.includes("--openmind-render-video-frames")
  || legacyScript > 0 && process.argv.length === legacyScript + 3;
if (process.argv.includes("--openmind-compose-image")) {
  // Fixed application module: a command-line path never selects executable code.
  require("./images/skill-image-cli");
} else if (renderFrames) {
  const bundle = app.isPackaged
    ? path.join(process.resourcesPath, "skill-library")
    : path.resolve(__dirname, "../../skill-library");
  // Load the App-owned renderer, never a script supplied on the command line.
  require(path.join(bundle, "om-short-video", "scripts", "render_frames.cjs"));
} else {
  require("./main");
}

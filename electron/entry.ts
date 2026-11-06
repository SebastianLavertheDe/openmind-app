import { app } from "electron";
import path from "node:path";

// Dispatch before importing main: utility and retired Skill commands must never
// initialize the desktop's settings, content root, window or AI worker.
const legacyScript = process.argv.findIndex(value => path.basename(value) === "render_frames.cjs");
const renderFrames = process.argv.includes("--openmind-render-video-frames")
  || legacyScript > 0 && process.argv.length === legacyScript + 3;
if (process.argv.includes("--openmind-compose-image")) {
  // Fixed application module: a command-line path never selects executable code.
  require("./images/skill-image-cli");
} else if (renderFrames) {
  // Old installed scripts may still invoke this entry after an app update.
  process.stderr.write("The built-in short-video Skill has been retired; frame rendering is no longer available.\n");
  app.exit(1);
} else {
  require("./main");
}

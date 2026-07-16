const fs = require("node:fs");
const path = require("node:path");

const target = path.resolve(__dirname, "..", ".build");
if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });

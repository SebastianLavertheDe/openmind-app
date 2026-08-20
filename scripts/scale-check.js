const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");

const appRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(appRoot, ".build");
const sessionStorePath = path.join(buildRoot, "electron", "electron", "ai", "session-store.js");

if (!fs.existsSync(sessionStorePath)) {
  throw new Error("Built SessionStore is missing. Run npm run build before npm run scale:check.");
}

const { SessionStore } = require(sessionStorePath);
const sessionCount = Number(process.env.OPENMIND_SCALE_SESSIONS || 1000);
const eventCount = Number(process.env.OPENMIND_SCALE_EVENTS || 10000);
const largeOutputBytes = Number(process.env.OPENMIND_SCALE_OUTPUT_BYTES || 1024 * 1024);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-scale-"));

const timings = {};

run().catch((error) => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore cleanup failure */ }
  throw error;
});

async function run() {
  const store = new SessionStore(root);
  measure("initialize", () => store.initialize());

  const created = [];
  measure("createSessions", () => {
    for (let index = 0; index < sessionCount; index++) {
      created.push(store.createSession({
        provider: index % 2 ? "claude" : "codex",
        providerId: `${index % 2 ? "claude" : "codex"}:scale:${index}`,
        cwd: ".",
        title: `Scale Session ${String(index).padStart(4, "0")}`,
        permissionProfile: index % 3 === 0 ? "read-only" : index % 3 === 1 ? "edit" : "auto"
      }));
    }
  });

  const longSession = created[0];
  const run = store.createRun(longSession, "scale run", []);
  const startAppend = performance.now();
  for (let index = 0; index < eventCount; index++) {
    await store.appendEvent(run, "assistant-message", { text: `event ${index} searchable-token-${index % 97}` });
  }
  timings.appendEventsMs = round(performance.now() - startAppend);

  const largeText = "x".repeat(largeOutputBytes);
  await store.appendEvent(run, "tool-output", { tool: "scale-output", text: largeText });

  const sessions = measure("listSessions", () => store.listSessions());
  const search = measure("searchSessions", () => store.search("Scale Session 0999"));
  const events = measure("readEvents", () => store.readEvents(longSession.id));
  const large = events.find((event) => event.kind === "tool-output" && event.payload.tool === "scale-output");

  assert(sessions.length === sessionCount, `Expected ${sessionCount} sessions, got ${sessions.length}.`);
  assert(search.length >= 1, "Session search did not find the expected session.");
  assert(events.length === eventCount + 1, `Expected ${eventCount + 1} reassembled events, got ${events.length}.`);
  assert(String(large?.payload.text || "").length === largeOutputBytes, "Large output did not reassemble to the original size.");
  assert(timings.listSessionsMs < 2000, `Session listing took ${timings.listSessionsMs}ms.`);
  assert(timings.searchSessionsMs < 2000, `Session search took ${timings.searchSessionsMs}ms.`);
  assert(timings.readEventsMs < 3000, `Long event read took ${timings.readEventsMs}ms.`);

  const report = {
    generatedAt: new Date().toISOString(),
    sessionCount,
    eventCount,
    largeOutputBytes,
    timings
  };
  fs.mkdirSync(buildRoot, { recursive: true });
  fs.writeFileSync(path.join(buildRoot, "scale-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`Scale check passed: ${sessionCount} sessions, ${eventCount} events, ${formatBytes(largeOutputBytes)} output.`);
}

function measure(name, action) {
  const start = performance.now();
  const result = action();
  timings[`${name}Ms`] = round(performance.now() - start);
  return result;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

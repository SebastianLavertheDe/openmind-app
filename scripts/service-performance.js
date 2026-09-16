// Real compiled service paths, synthetic content and userData only.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");

const appRoot = path.resolve(__dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-service-performance-"));
const contentRoot = path.join(temporary, "content");
fs.mkdirSync(contentRoot);
process.env.OPENMIND_ROOT = contentRoot;
process.env.OPENMIND_USER_DATA_DIR = path.join(temporary, "user-data");

function measure(operation) {
  const originalRead = fs.readFileSync;
  const originalStat = fs.lstatSync;
  let reads = 0;
  let taskReads = 0;
  let lstats = 0;
  fs.readFileSync = function (file, ...args) {
    reads++;
    if (String(file).endsWith(`${path.sep}task.json`)) taskReads++;
    return originalRead.call(this, file, ...args);
  };
  fs.lstatSync = function (...args) { lstats++; return originalStat.apply(this, args); };
  const started = performance.now();
  try {
    const value = operation();
    return { milliseconds: +(performance.now() - started).toFixed(2), reads, taskReads, lstats, value };
  } finally {
    fs.readFileSync = originalRead;
    fs.lstatSync = originalStat;
  }
}

(async () => {
  const { ProjectService } = require(path.join(appRoot, ".build/electron/electron/project/project-service.js"));
  const { readContentAsync } = require(path.join(appRoot, ".build/electron/electron/lib/content.js"));
  const { CONTENT_PREVIEW_MAX_BYTES } = require(path.join(appRoot, ".build/electron/shared/content-kinds.js"));
  const service = new ProjectService(contentRoot, { stateRoot: path.join(temporary, "state") });
  const project = service.createProject({ name: "Performance fixture" }).project;
  const task = service.createProjectTask(project.name, "Fixture task", "fixture-provider");
  const taskRoot = service.tasks.projectDirectory(project.name);
  for (let index = 1; index < 1_000; index++) {
    const taskId = crypto.randomUUID();
    const directory = path.join(taskRoot, taskId);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, "task.json"), JSON.stringify({ ...task, taskId }));
  }
  const projectSummaries = Array.from({ length: 3 }, () => measure(() => service.listProjects()[0].taskCount));
  service.archiveProjectTask(project.name, task.taskId);
  const changedSummary = measure(() => service.listProjects()[0].taskCount);

  const file = path.join(contentRoot, "large.md");
  const fd = fs.openSync(file, "w");
  try {
    const chunk = Buffer.alloc(1024 * 1024, "a");
    for (let index = 0; index < 64; index++) fs.writeSync(fd, chunk);
  } finally { fs.closeSync(fd); }
  const contentReads = [];
  const open = fs.promises.open;
  let readBytes = 0;
  fs.promises.open = async function (...args) {
    const handle = await open.apply(this, args);
    const read = handle.read.bind(handle);
    handle.read = async (...readArgs) => {
      const result = await read(...readArgs);
      readBytes += result.bytesRead;
      return result;
    };
    return handle;
  };
  try {
    for (let index = 0; index < 3; index++) {
      readBytes = 0;
      let yielded = false;
      setImmediate(() => { yielded = true; });
      const started = performance.now();
      const result = await readContentAsync("openmind/large.md");
      contentReads.push({ milliseconds: +(performance.now() - started).toFixed(2), readBytes, yielded, characters: result.content.length, truncated: result.truncated });
    }
  } finally { fs.promises.open = open; }

  const passed = projectSummaries.every((sample) => sample.value === 1_000 && sample.lstats < 2_200)
    && projectSummaries.slice(1).every((sample) => sample.taskReads === 0)
    && changedSummary.value === 999 && changedSummary.taskReads === 1
    && contentReads.every((sample) => sample.yielded && sample.readBytes <= CONTENT_PREVIEW_MAX_BYTES + 1 && sample.characters === CONTENT_PREVIEW_MAX_BYTES && sample.truncated);
  const report = { generatedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch }, projectSummaries, changedSummary, contentReads, passed };
  fs.writeFileSync(path.join(appRoot, ".build/service-performance-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!passed) throw new Error("Service performance I/O budget failed");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
});

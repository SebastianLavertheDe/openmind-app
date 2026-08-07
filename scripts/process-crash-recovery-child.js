#!/usr/bin/env node
"use strict";

const path = require("node:path");

const runsRoot = path.resolve(process.argv[2] || "");
if (!runsRoot) throw new Error("runs root is required");

const { RunStore } = require(path.join(__dirname, "..", ".build", "electron", "electron", "execution", "run-store.js"));
const store = new RunStore(runsRoot);
const secret = "process-crash-drill-secret";
const run = store.create({
  skillId: "process-crash-recovery",
  version: "1.0.0",
  digest: "a".repeat(64),
  inputs: { secretInput: secret },
  providerBindings: { provider: "credential-1" },
  trigger: { type: "manual" },
  externalExportBindingIds: [],
  rootGeneration: 1
}, "process-crash-run");
store.transition(run.id, "inspecting");
store.transition(run.id, "preparing_runtime");
store.transition(run.id, "running");
store.bindProcessPid(run.id, process.pid);
store.appendOutput(run.id, "stdout", "child process reached running state");

process.stdout.write("READY\n");
setInterval(() => {}, 1000);

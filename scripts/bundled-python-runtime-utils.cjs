"use strict";

const fs = require("node:fs");
const path = require("node:path");

// PE COFF machine identifiers. distlib ships launchers for several Windows
// architectures in every copy of pip. They are only used to generate entry
// points for the architecture of the running interpreter.
const WINDOWS_MACHINE_BY_TARGET = new Map([
  ["windows-ia32", 0x014c],
  ["windows-x64", 0x8664],
  ["windows-arm64", 0xaa64]
]);

/**
 * Remove pip/distlib launcher executables which cannot run for `target`.
 *
 * NSIS portable extraction has been observed to omit ARM launchers from an
 * x64 payload. Keeping only the native launcher architecture makes every
 * distribution format contain the same runtime tree, instead of weakening the
 * runtime integrity check for files that this Python cannot use.
 *
 * The check deliberately uses PE headers rather than launcher filenames, so
 * future distlib naming changes and all supported Windows targets are handled
 * consistently.
 */
function pruneIncompatibleWindowsDistlibLaunchers(runtimeRoot, target) {
  const incompatible = findIncompatibleWindowsDistlibLaunchers(runtimeRoot, target);
  for (const launcher of incompatible) fs.rmSync(launcher.file, { force: true });
  return incompatible.map((launcher) => launcher.relative);
}

function listIncompatibleWindowsDistlibLaunchers(runtimeRoot, target) {
  return findIncompatibleWindowsDistlibLaunchers(runtimeRoot, target).map((launcher) => launcher.relative);
}

function findIncompatibleWindowsDistlibLaunchers(runtimeRoot, target) {
  const expectedMachine = WINDOWS_MACHINE_BY_TARGET.get(target);
  if (!expectedMachine || !fs.existsSync(runtimeRoot)) return [];

  const incompatible = [];
  const visit = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    if (isPipVendorDistlib(runtimeRoot, directory)) {
      for (const entry of entries) {
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".exe") continue;
        const file = path.join(directory, entry.name);
        const machine = readPortableExecutableMachine(file);
        if (machine === null || machine === expectedMachine) continue;
        incompatible.push({ file, relative: path.relative(runtimeRoot, file).split(path.sep).join("/") });
      }
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      visit(path.join(directory, entry.name));
    }
  };

  visit(runtimeRoot);
  return incompatible.sort((left, right) => left.relative.localeCompare(right.relative));
}

function isPipVendorDistlib(runtimeRoot, directory) {
  const segments = path.relative(runtimeRoot, directory)
    .split(path.sep)
    .map((segment) => segment.toLowerCase());
  const tail = segments.slice(-3);
  return tail.length === 3 && tail[0] === "pip" && tail[1] === "_vendor" && tail[2] === "distlib";
}

function readPortableExecutableMachine(file) {
  const descriptor = fs.openSync(file, "r");
  try {
    const dosHeader = Buffer.alloc(64);
    if (fs.readSync(descriptor, dosHeader, 0, dosHeader.length, 0) !== dosHeader.length) return null;
    if (dosHeader[0] !== 0x4d || dosHeader[1] !== 0x5a) return null; // MZ
    const peOffset = dosHeader.readUInt32LE(0x3c);
    // A launcher header should be close to the beginning. Bound the offset so
    // malformed data cannot cause an unexpectedly large sparse read.
    if (peOffset < dosHeader.length || peOffset > 1024 * 1024) return null;
    const peHeader = Buffer.alloc(6);
    if (fs.readSync(descriptor, peHeader, 0, peHeader.length, peOffset) !== peHeader.length) return null;
    if (peHeader[0] !== 0x50 || peHeader[1] !== 0x45 || peHeader[2] !== 0 || peHeader[3] !== 0) return null; // PE\0\0
    return peHeader.readUInt16LE(4);
  } finally {
    fs.closeSync(descriptor);
  }
}

module.exports = {
  pruneIncompatibleWindowsDistlibLaunchers,
  listIncompatibleWindowsDistlibLaunchers,
  readPortableExecutableMachine
};

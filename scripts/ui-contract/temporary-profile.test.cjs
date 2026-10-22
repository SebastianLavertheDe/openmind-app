const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { runWithTemporaryProfile } = require("./temporary-profile.cjs");

for (const status of [0, 3]) {
  test(`removes the profile after the child releases open files, preserving exit ${status}`, () => {
    let profile;
    const result = runWithTemporaryProfile(process.execPath, ["-e", `
      const fs = require('node:fs');
      const path = require('node:path');
      const profile = process.env.OPENMIND_UI_CATALOG_USER_DATA_DIR;
      fs.openSync(path.join(profile, 'session-lock'), 'w');
      console.log(profile);
      process.exit(${status});
    `], { env: process.env, encoding: "utf8" }, {
      remove(directory, options) {
        profile = directory;
        assert.ok(fs.existsSync(path.join(directory, "session-lock")));
        fs.rmSync(directory, options);
      }
    });
    assert.equal(result.status, status);
    assert.equal(result.stdout.trim(), profile);
    assert.equal(fs.existsSync(profile), false);
  });
}

test("a locked profile warns without masking the visual failure or throwing during exit", () => {
  let profile;
  const warnings = [];
  try {
    const result = runWithTemporaryProfile(process.execPath, ["-e", "process.exit(7)"], { env: process.env }, {
      remove(directory) { profile = directory; throw Object.assign(new Error("profile is locked"), { code: "EPERM" }); },
      warn(message) { warnings.push(message); }
    });
    assert.equal(result.status, 7);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes(profile));
    assert.match(warnings[0], /profile is locked/);
  } finally {
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
  }
});

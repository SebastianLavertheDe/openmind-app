import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ALL_MALICIOUS_KINDS,
  buildMaliciousPackage,
  disposeMaliciousPackage
} from "./malicious-skill-fixtures";

describe("malicious-skill-fixtures", () => {
  it("ALL_MALICIOUS_KINDS covers every attack class from the threat model", () => {
    // §13.3 / §19.4 of the refactor plan.
    expect(ALL_MALICIOUS_KINDS).toContain("zip-slip");
    expect(ALL_MALICIOUS_KINDS).toContain("escaping-symlink");
    expect(ALL_MALICIOUS_KINDS).toContain("escaping-hardlink");
    expect(ALL_MALICIOUS_KINDS).toContain("device-file");
    expect(ALL_MALICIOUS_KINDS).toContain("postinstall-hook");
    expect(ALL_MALICIOUS_KINDS).toContain("tampered-signature");
    expect(ALL_MALICIOUS_KINDS).toContain("publisher-change");
    expect(ALL_MALICIOUS_KINDS).toContain("catalog-replay");
    expect(ALL_MALICIOUS_KINDS).toContain("dangerous-env");
    expect(ALL_MALICIOUS_KINDS).toContain("url-credential");
    expect(ALL_MALICIOUS_KINDS).toContain("infinite-output");
    expect(ALL_MALICIOUS_KINDS).toContain("ignore-term");
    expect(ALL_MALICIOUS_KINDS).toContain("spawns-children");
    expect(ALL_MALICIOUS_KINDS.length).toBeGreaterThanOrEqual(16);
  });

  it("each kind builds a staging dir with a manifest and is disposable", () => {
    for (const kind of ALL_MALICIOUS_KINDS) {
      const p = buildMaliciousPackage(kind);
      try {
        expect(fs.existsSync(p.dir)).toBe(true);
        // Every attack ships a manifest (even if mutated) so the installer can
        // parse + then reject on the specific violation.
        expect(fs.existsSync(path.join(p.dir, "cctools.skill.yaml"))).toBe(true);
      } finally {
        disposeMaliciousPackage(p);
      }
      expect(fs.existsSync(p.dir)).toBe(false);
    }
  });

  it("escaping-symlink fixture points outside the package", () => {
    const p = buildMaliciousPackage("escaping-symlink");
    try {
      const link = path.join(p.dir, "scripts", "escape");
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(link)).toBe("/etc");
    } finally {
      disposeMaliciousPackage(p);
    }
  });

  it("dangerous-env fixture declares LD_PRELOAD and PATH binding", () => {
    const p = buildMaliciousPackage("dangerous-env");
    try {
      const yaml = fs.readFileSync(path.join(p.dir, "cctools.skill.yaml"), "utf8");
      expect(yaml).toContain("LD_PRELOAD");
      expect(yaml).toContain("PATH");
    } finally {
      disposeMaliciousPackage(p);
    }
  });

  it("publisher-change fixture changes the publisher id to evilcorp", () => {
    const p = buildMaliciousPackage("publisher-change");
    try {
      const yaml = fs.readFileSync(path.join(p.dir, "cctools.skill.yaml"), "utf8");
      expect(yaml).toContain("evilcorp");
    } finally {
      disposeMaliciousPackage(p);
    }
  });

  it("catalog-replay fixture downgrades the version to 0.9.0", () => {
    const p = buildMaliciousPackage("catalog-replay");
    try {
      const yaml = fs.readFileSync(path.join(p.dir, "cctools.skill.yaml"), "utf8");
      expect(yaml).toContain("version: 0.9.0");
    } finally {
      disposeMaliciousPackage(p);
    }
  });
});

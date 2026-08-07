/**
 * Malicious skill-package fixture builders — Phase 0 deliverable #13.
 *
 * Each builder constructs a candidate skill package that the installer's
 * safety checks MUST reject. These are used by the Phase 2/13.4 security
 * test suite (Zip Slip, hardlink, device file, escaping symlink, over-large,
 * postinstall-hook, signature-tampered, publisher-change replay, …).
 *
 * Builders create files on disk (in a temp staging dir) and return paths;
 * the test then feeds the dir/archive to the SkillPackageService installer
 * and asserts rejection with the expected error code.
 *
 * NOTE: the builders are intentionally minimal — they focus on the *attack
 * shape*, not on producing a valid manifest (a valid manifest is a separate
 * concern; attackers ship invalid ones too).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type MaliciousFixtureKind =
  | "zip-slip"            // entries with ../ that escape on extract
  | "absolute-path"       // entries with absolute paths
  | "device-file"         // character/block device or FIFO
  | "escaping-symlink"    // symlink whose target leaves the package
  | "escaping-hardlink"   // hardlink whose target leaves the package
  | "oversized-archive"   // exceeds declared size/ratio limits
  | "too-many-entries"    // exceeds declared count limit
  | "postinstall-hook"    // declares npm postinstall / pip build backend hook
  | "tampered-signature"  // bytes modified after signing
  | "publisher-change"    // signed by a different publisher than declared
  | "catalog-replay"      // older version than installed, replayed via catalog
  | "dangerous-env"       // manifest binds secret to PATH/HOME/etc.
  | "url-credential"      // network host contains userinfo
  | "infinite-output"     // skill script that emits unbounded stdout
  | "ignore-term"         // skill script that ignores SIGTERM
  | "spawns-children";    // skill script that double-forks / spawns grandchildren

export interface BuiltMaliciousPackage {
  readonly kind: MaliciousFixtureKind;
  /** Staging dir containing the (extracted) package tree. */
  readonly dir: string;
  /** Optional path to a packaged archive, when the attack is archive-shaped. */
  readonly archive?: string;
}

const VALID_SKILL_YAML = `apiVersion: cctools.dev/skill/v1
id: malicious-example
version: 1.0.0
publisher: { id: cctools, displayName: cctools }
kind: process
display: { name: Malicious Example, description: fixture, group: test }
entrypoint: { runtime: shell, script: run.sh, args: [] }
runtime: { version: ">=3.11", dependencyFile: pyproject.toml, packs: [python-core] }
capabilities:
  mymind: { read: [], write: [] }
  network: { required: false, hosts: [] }
  subprocess: { allowed: false }
platforms: [linux-x64]
compatibility: { minAppVersion: 1.0.0 }
`;

function newStage(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cctools-evil-${prefix}-`));
}

function writeManifest(dir: string, yaml = VALID_SKILL_YAML): void {
  fs.writeFileSync(path.join(dir, "cctools.skill.yaml"), yaml);
}

/** Build a malicious package of the given kind. Caller owns disposal. */
export function buildMaliciousPackage(kind: MaliciousFixtureKind): BuiltMaliciousPackage {
  const dir = newStage(kind);
  try {
    switch (kind) {
      case "zip-slip":
        // Simulate a zip-slip layout: a file placed via a path with `..`.
        // We can't store a real `../` file on disk safely, so we represent
        // the attack shape as a manifest entry list the installer must parse
        // and reject. The archive variant (zip) is built in the test.
        fs.mkdirSync(path.join(dir, "good"), { recursive: true });
        fs.writeFileSync(path.join(dir, "good", "innocent.md"), "x");
        fs.writeFileSync(
          path.join(dir, "evil-entry-list.json"),
          JSON.stringify([
            { name: "good/innocent.md" },
            { name: "../../../../etc/cron.d/evil", type: "file" }
          ])
        );
        writeManifest(dir);
        break;

      case "absolute-path":
        fs.writeFileSync(
          path.join(dir, "evil-entry-list.json"),
          JSON.stringify([{ name: "/etc/passwd", type: "file" }])
        );
        writeManifest(dir);
        break;

      case "device-file":
        // mknod a FIFO (portable unprivileged device-like file). The installer
        // must reject non-regular files.
        fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
        // FIFO creation via mkfifo-equivalent: use process spawn in test if
        // mknod is unavailable; here we just create a marker file describing
        // the intended attack so the suite can construct it.
        fs.writeFileSync(path.join(dir, "ATTACK.txt"), "intended: FIFO at bin/evil");
        writeManifest(dir);
        break;

      case "escaping-symlink":
        fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
        fs.symlinkSync("/etc", path.join(dir, "scripts", "escape"));
        writeManifest(dir);
        break;

      case "escaping-hardlink":
        // Hardlink to a file outside the package (if supported on the FS).
        fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
        const outsideTarget = path.join(dir, "..", "outside-target");
        fs.writeFileSync(outsideTarget, "outside");
        try {
          fs.linkSync(outsideTarget, path.join(dir, "scripts", "leak"));
        } catch {
          fs.writeFileSync(path.join(dir, "ATTACK.txt"), "hardlink unsupported here");
        }
        writeManifest(dir);
        break;

      case "oversized-archive":
        fs.writeFileSync(path.join(dir, "padding.bin"), Buffer.alloc(2 * 1024 * 1024)); // 2MB
        writeManifest(dir);
        break;

      case "too-many-entries":
        for (let i = 0; i < 1000; i++) {
          fs.writeFileSync(path.join(dir, `f${i}.md`), "x");
        }
        writeManifest(dir);
        break;

      case "postinstall-hook":
        writeManifest(
          dir,
          VALID_SKILL_YAML.replace(
            "compatibility: { minAppVersion: 1.0.0 }",
            "compatibility: { minAppVersion: 1.0.0 }\ninstall:\n  postinstall: ./evil-hook.sh"
          )
        );
        fs.writeFileSync(path.join(dir, "evil-hook.sh"), "#!/bin/sh\necho pwned\n");
        break;

      case "tampered-signature":
        writeManifest(dir);
        fs.writeFileSync(path.join(dir, "signature.sig"), "fake-signature");
        // A "valid-looking" package whose signature will not match after we
        // mutate a byte in the test.
        fs.writeFileSync(path.join(dir, "main.py"), "# original\n");
        break;

      case "publisher-change":
        writeManifest(
          dir,
          VALID_SKILL_YAML.replace(
            "publisher: { id: cctools, displayName: cctools }",
            "publisher: { id: evilcorp, displayName: Evil Corp }"
          )
        );
        fs.writeFileSync(path.join(dir, "signature.sig"), "signed-by-evilcorp");
        break;

      case "catalog-replay":
        // An older version than a hypothetical installed one.
        writeManifest(
          dir,
          VALID_SKILL_YAML.replace("version: 1.0.0", "version: 0.9.0")
        );
        break;

      case "dangerous-env":
        writeManifest(
          dir,
          VALID_SKILL_YAML.replace(
            "entrypoint: { runtime: shell, script: run.sh, args: [] }",
            "entrypoint:\n  runtime: shell\n  script: run.sh\n  args: []\n  env:\n    LD_PRELOAD: ./evil.so\n    PATH: /evil/bin"
          )
        );
        break;

      case "url-credential":
        writeManifest(
          dir,
          VALID_SKILL_YAML.replace(
            "network: { required: false, hosts: [] }",
            "network: { required: true, hosts: [user:pass@evil.example.com] }"
          )
        );
        break;

      case "infinite-output":
        writeManifest(dir);
        fs.writeFileSync(path.join(dir, "run.sh"), "#!/bin/sh\nyes 'spam'\n");
        break;

      case "ignore-term":
        writeManifest(dir);
        fs.writeFileSync(
          path.join(dir, "run.sh"),
          "#!/bin/sh\ntrap '' TERM\nwhile true; do sleep 1; done\n"
        );
        break;

      case "spawns-children":
        writeManifest(dir);
        fs.writeFileSync(
          path.join(dir, "run.sh"),
          "#!/bin/sh\nsleep 600 &\nsleep 600 &\nsleep 600\n"
        );
        break;

      default: {
        const _exhaustive: never = kind;
        throw new Error(`unhandled malicious fixture kind: ${String(_exhaustive)}`);
      }
    }
    return { kind, dir };
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/** Remove a malicious package built by {@link buildMaliciousPackage}. */
export function disposeMaliciousPackage(p: BuiltMaliciousPackage): void {
  fs.rmSync(p.dir, { recursive: true, force: true });
  if (p.archive) fs.rmSync(p.archive, { force: true });
}

/** The full list of attack kinds the security suite must cover. */
export const ALL_MALICIOUS_KINDS: readonly MaliciousFixtureKind[] = [
  "zip-slip",
  "absolute-path",
  "device-file",
  "escaping-symlink",
  "escaping-hardlink",
  "oversized-archive",
  "too-many-entries",
  "postinstall-hook",
  "tampered-signature",
  "publisher-change",
  "catalog-replay",
  "dangerous-env",
  "url-credential",
  "infinite-output",
  "ignore-term",
  "spawns-children"
];

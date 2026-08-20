/**
 * Clean-machine smoke matrix — Phase 0 deliverable #14.
 *
 * Declarative matrix of the clean-machine scenarios the release gate (§19.5,
 * §19.7) must exercise on platforms that have NO pre-installed Python / uv /
 * Node / Git / ffmpeg. Each scenario records the platform, environment
 * preconditions, and the assertions that must hold.
 *
 * The matrix is data so CI can enumerate it; the assertions are encoded as
 * stable string codes consumed by the E2E runner.
 */

export type SmokePlatform =
  | "windows-11-x64"
  | "windows-non-admin"
  | "macos-applesilicon-current"
  | "macos-applesilicon-previous"
  | "macos-intel";

export type SmokeEnvironment =
  | "no-python-uv-node-git-ffmpeg"
  | "online"
  | "offline"
  | "http-tls-proxy"
  | "cjk-username"
  | "space-long-path"
  | "readonly-openmind"
  | "unwritable-export"
  | "keychain-unavailable-locked"
  | "low-disk"
  | "force-quit-during-install"
  | "force-quit-during-update"
  | "concurrent-multi-skill"
  | "app-crash"
  | "old-version-upgrade"
  | "new-version-rollback";

export type SmokeAssertionCode =
  | "app-starts-without-repo"
  | "binds-existing-openmind"
  | "imports-claude-skills"
  | "installs-skill"
  | "configures-provider"
  | "installs-python-core-runtime"
  | "runs-process-skill"
  | "runs-workflow-skill"
  | "runs-agent-skill-external-bridge"
  | "stops-run-cleanly"
  | "opens-artifact"
  | "automation-runs-on-schedule"
  | "skill-update-active-ready-only"
  | "runtime-update-atomic"
  | "rollback-restores-previous"
  | "uninstall-preserves-openmind"
  | "external-export-relink-revoke"
  | "openmind-tree-unchanged"
  | "no-secret-in-logs";

export interface SmokeScenario {
  readonly id: string;
  readonly platform: SmokePlatform;
  readonly environment: SmokeEnvironment;
  readonly assertions: readonly SmokeAssertionCode[];
  readonly gate: "v1-baseline" | "v1-full" | "ga";
}

/**
 * The clean-machine matrix. v1-baseline must pass to ship the basic product
 * (Windows x64 + macOS arm64, online + offline + no-runtime). The full matrix
 * is the GA gate.
 */
export const CLEAN_MACHINE_MATRIX: readonly SmokeScenario[] = [
  // --- v1 baseline: Windows 11 x64 ---
  {
    id: "win11-x64-online-no-runtime",
    platform: "windows-11-x64",
    environment: "no-python-uv-node-git-ffmpeg",
    assertions: [
      "app-starts-without-repo", "binds-existing-openmind", "imports-claude-skills",
      "installs-skill", "configures-provider", "installs-python-core-runtime",
      "runs-process-skill", "stops-run-cleanly", "opens-artifact",
      "openmind-tree-unchanged", "no-secret-in-logs"
    ],
    gate: "v1-baseline"
  },
  {
    id: "win11-x64-offline",
    platform: "windows-11-x64",
    environment: "offline",
    assertions: [
      "app-starts-without-repo", "binds-existing-openmind",
      "installs-python-core-runtime", "runs-process-skill", "openmind-tree-unchanged"
    ],
    gate: "v1-baseline"
  },
  {
    id: "win11-x64-non-admin",
    platform: "windows-non-admin",
    environment: "online",
    assertions: ["app-starts-without-repo", "installs-skill", "runs-process-skill"],
    gate: "v1-baseline"
  },
  {
    id: "win11-x64-force-quit-install",
    platform: "windows-11-x64",
    environment: "force-quit-during-install",
    assertions: ["installs-python-core-runtime", "openmind-tree-unchanged"],
    gate: "v1-full"
  },
  {
    id: "win11-x64-update-rollback",
    platform: "windows-11-x64",
    environment: "new-version-rollback",
    assertions: ["rollback-restores-previous", "openmind-tree-unchanged"],
    gate: "v1-full"
  },

  // --- v1 baseline: macOS Apple Silicon ---
  {
    id: "macos-as-online-no-runtime",
    platform: "macos-applesilicon-current",
    environment: "no-python-uv-node-git-ffmpeg",
    assertions: [
      "app-starts-without-repo", "binds-existing-openmind", "imports-claude-skills",
      "installs-skill", "configures-provider", "installs-python-core-runtime",
      "runs-process-skill", "runs-agent-skill-external-bridge",
      "stops-run-cleanly", "opens-artifact", "openmind-tree-unchanged", "no-secret-in-logs"
    ],
    gate: "v1-baseline"
  },
  {
    id: "macos-as-offline",
    platform: "macos-applesilicon-current",
    environment: "offline",
    assertions: ["app-starts-without-repo", "runs-process-skill", "openmind-tree-unchanged"],
    gate: "v1-baseline"
  },
  {
    id: "macos-as-keychain-locked",
    platform: "macos-applesilicon-current",
    environment: "keychain-unavailable-locked",
    assertions: ["configures-provider"],
    gate: "v1-full"
  },

  // --- v1 full: Windows/macOS edge environments ---
  {
    id: "win11-x64-cjk-username",
    platform: "windows-11-x64",
    environment: "cjk-username",
    assertions: ["app-starts-without-repo", "runs-process-skill", "openmind-tree-unchanged"],
    gate: "v1-full"
  },
  {
    id: "win11-x64-space-long-path",
    platform: "windows-11-x64",
    environment: "space-long-path",
    assertions: ["app-starts-without-repo", "runs-process-skill"],
    gate: "v1-full"
  },
  {
    id: "any-external-export-relink",
    platform: "windows-11-x64",
    environment: "unwritable-export",
    assertions: ["external-export-relink-revoke"],
    gate: "v1-full"
  },
  {
    id: "any-app-crash-recovery",
    platform: "windows-11-x64",
    environment: "app-crash",
    assertions: ["stops-run-cleanly", "openmind-tree-unchanged"],
    gate: "ga"
  }
] as const;

// Linux/WSL release scenarios and signed App-update assertions are
// intentionally absent: formal Linux support and signed release are outside
// the current scope. Runtime target abstractions may still be unit-tested.

/** All scenarios that must pass for a given gate. */
export function scenariosForGate(gate: SmokeScenario["gate"]): readonly SmokeScenario[] {
  return CLEAN_MACHINE_MATRIX.filter((s) => s.gate === gate);
}

/** Every distinct assertion code referenced by the matrix. */
export function allAssertionCodes(): readonly SmokeAssertionCode[] {
  const set = new Set<SmokeAssertionCode>();
  for (const s of CLEAN_MACHINE_MATRIX) for (const a of s.assertions) set.add(a);
  return [...set];
}

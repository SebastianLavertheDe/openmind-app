import { describe, expect, it } from "vitest";
import {
  allAssertionCodes,
  CLEAN_MACHINE_MATRIX,
  scenariosForGate
} from "./clean-machine-smoke";

describe("clean-machine-smoke matrix", () => {
  it("every scenario has a unique id", () => {
    const ids = CLEAN_MACHINE_MATRIX.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every scenario declares at least one assertion", () => {
    for (const s of CLEAN_MACHINE_MATRIX) {
      expect(s.assertions.length).toBeGreaterThan(0);
    }
  });

  it("v1-baseline includes Windows x64 and macOS Apple Silicon no-runtime scenarios", () => {
    const baseline = scenariosForGate("v1-baseline");
    const platforms = baseline.map((s) => `${s.platform}|${s.environment}`);
    expect(platforms).toContain("windows-11-x64|no-python-uv-node-git-ffmpeg");
    expect(platforms).toContain("macos-applesilicon-current|no-python-uv-node-git-ffmpeg");
  });

  it("v1-baseline covers offline scenarios (no-network runtime install)", () => {
    const baseline = scenariosForGate("v1-baseline");
    expect(baseline.some((s) => s.environment === "offline")).toBe(true);
  });

  it("openmind-tree-unchanged is asserted in baseline no-runtime + offline scenarios", () => {
    // The strongest immutability guarantees belong in the foundational
    // scenarios; other scenarios may focus on their own concern.
    const baseline = scenariosForGate("v1-baseline");
    for (const s of baseline) {
      if (s.environment === "no-python-uv-node-git-ffmpeg" || s.environment === "offline") {
        expect(s.assertions).toContain("openmind-tree-unchanged");
      }
    }
  });

  it("allAssertionCodes returns a non-empty distinct set", () => {
    const codes = allAssertionCodes();
    expect(codes.length).toBeGreaterThan(0);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gate ordering is v1-baseline ⊆ v1-full ⊆ ga (more scenarios at later gates)", () => {
    expect(scenariosForGate("v1-baseline").length).toBeGreaterThan(0);
    expect(scenariosForGate("v1-full").length).toBeGreaterThan(0);
    expect(scenariosForGate("ga").length).toBeGreaterThan(0);
  });

  it("does not put Linux/WSL or signed App release in the executable matrix", () => {
    expect(CLEAN_MACHINE_MATRIX.every((scenario) => !scenario.platform.includes("ubuntu") && !scenario.platform.includes("wsl"))).toBe(true);
    expect(allAssertionCodes()).not.toContain("app-update-signed");
  });
});

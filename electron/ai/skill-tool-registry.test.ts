import { describe, expect, it } from "vitest";
import { SkillToolRegistry } from "./skill-tool-registry";

/**
 * The installed store under the bound openmind root is the only skill source;
 * broker-backed execution is covered by installed-skill-execution-resolver
 * tests. These tests pin the no-store invariants of the registry shell.
 */
describe("SkillToolRegistry", () => {
  it("reports no skills and no activity without a bound store", () => {
    const registry = new SkillToolRegistry(process.cwd());
    expect(registry.listDefinitions()).toEqual([]);
    expect(registry.captureSessionSnapshot()).toEqual([]);
    expect(registry.activeCount()).toBe(0);
    expect(registry.isRunning("any-invocation")).toBe(false);
  });

  it("refuses to run a skill without an ExecutionBroker", async () => {
    const registry = new SkillToolRegistry(process.cwd());
    await expect(registry.run("some-skill")).rejects.toThrow(/ExecutionBroker/);
  });

  it("refresh is a no-op: the installed store is read on demand", () => {
    const registry = new SkillToolRegistry(process.cwd());
    expect(() => registry.refresh()).not.toThrow();
    expect(registry.listDefinitions()).toEqual([]);
  });
});

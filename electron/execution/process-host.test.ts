import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessHost, type ProcessSpec } from "./process-host";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ProcessHost", () => {
  it("runs with an explicit minimal environment and bounded output", async () => {
    const result = await new ProcessHost(256).run(spec("process.stdout.write((process.env.PATH || 'missing') + '|api-key=sk-test-secret\\n')"), {
      knownSecrets: ["sk-test-secret"],
      onOutput: (output) => {
        expect(output.text).not.toContain("sk-test-secret");
      }
    });
    expect(result.outcome).toBe("succeeded");
    expect(result.stdout).toContain("missing");

    const bounded = await new ProcessHost(64).run(spec("process.stdout.write('x'.repeat(200))"));
    expect(bounded.droppedBytes).toBeGreaterThan(0);
  });

  it("terminates a timed-out process and an aborted process", async () => {
    const host = new ProcessHost();
    const timedOut = await host.run(spec("setTimeout(() => {}, 30_000)", { timeoutMs: 40, gracefulStopMs: 0 }));
    expect(timedOut.outcome).toBe("timed_out");

    const controller = new AbortController();
    const running = host.run(spec("setTimeout(() => {}, 30_000)", { timeoutMs: 30_000, gracefulStopMs: 0 }), { signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(running).resolves.toMatchObject({ outcome: "cancelled" });
  });

  it("rejects non-absolute executables and dangerous env names", async () => {
    const host = new ProcessHost();
    await expect(host.run({ ...spec(""), executable: "node" })).rejects.toThrow(/绝对路径/);
    await expect(host.run({ ...spec(""), env: { NODE_OPTIONS: "--require=evil" } })).rejects.toThrow(/危险环境变量/);
  });
});

function spec(script: string, overrides: Partial<ProcessSpec> = {}): ProcessSpec {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-process-host-"));
  roots.push(cwd);
  return {
    executable: process.execPath,
    args: ["-e", script],
    cwd,
    env: { OPENMIND_RUN_ID: "run-test" },
    timeoutMs: 5_000,
    gracefulStopMs: 50,
    ...overrides
  };
}

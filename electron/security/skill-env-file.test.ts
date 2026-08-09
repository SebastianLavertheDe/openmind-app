import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSkillEnvFile } from "./skill-env-file";

describe("loadSkillEnvFile", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("loads values beside the Skill and identifies secrets for log redaction", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-skill-env-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, ".env"), [
      "# local provider",
      "export NVIDIA_API_KEY=nvapi-local-secret",
      "NVIDIA_API_BASE_URL=https://integrate.api.nvidia.com/v1 # endpoint",
      "MODEL='minimaxai/minimax-m2.1'",
      'LABEL="daily\\nsummary" # quoted comment',
      "PATH=/untrusted/bin"
    ].join("\n"));

    const result = loadSkillEnvFile(root);

    expect(result.path).toBe(path.join(root, ".env"));
    expect(result.values).toMatchObject({
      NVIDIA_API_KEY: "nvapi-local-secret",
      NVIDIA_API_BASE_URL: "https://integrate.api.nvidia.com/v1",
      MODEL: "minimaxai/minimax-m2.1",
      LABEL: "daily\nsummary"
    });
    expect(result.values.PATH).toBeUndefined();
    expect(result.ignoredNames).toEqual(["PATH"]);
    expect(result.secretValues).toEqual(["nvapi-local-secret"]);
  });

  it("returns an empty environment when the Skill has no .env", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-skill-env-"));
    roots.push(root);
    expect(loadSkillEnvFile(root)).toEqual({ path: null, values: {}, secretValues: [], ignoredNames: [] });
  });

  it("rejects malformed, symlinked and oversized files", () => {
    const malformed = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-skill-env-"));
    const symlinked = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-skill-env-"));
    const oversized = fs.mkdtempSync(path.join(os.tmpdir(), "cctools-skill-env-"));
    roots.push(malformed, symlinked, oversized);
    fs.writeFileSync(path.join(malformed, ".env"), "NOT AN ENV LINE\n");
    expect(() => loadSkillEnvFile(malformed)).toThrow("KEY=VALUE");
    fs.writeFileSync(path.join(symlinked, "real.env"), "API_KEY=value\n");
    fs.symlinkSync(path.join(symlinked, "real.env"), path.join(symlinked, ".env"));
    expect(() => loadSkillEnvFile(symlinked)).toThrow("符号链接");
    fs.writeFileSync(path.join(oversized, ".env"), "x".repeat(512 * 1024 + 1));
    expect(() => loadSkillEnvFile(oversized)).toThrow("过大");
  });
});

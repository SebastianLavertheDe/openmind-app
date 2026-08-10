import { describe, expect, it } from "vitest";
import {
  SKILL_MANIFEST_API_VERSION,
  SkillManifestSchema,
  diffSkillCapabilities,
  matchesSemverRange,
  validateManifest
} from "./skill-manifest-schema";

/** A minimal-but-valid process manifest used as the base for many tests. */
function baseProcessManifest(): Record<string, unknown> {
  return {
    apiVersion: "cctools.dev/skill/v1",
    id: "daily-article-summarizer",
    version: "1.0.0",
    publisher: { id: "cctools", displayName: "cctools" },
    kind: "process",
    display: { name: "每日文章总结", description: "汇总", group: "analysis" },
    entrypoint: {
      runtime: "python",
      script: "main.py",
      args: ["--date", "{{ inputs.date }}"]
    },
    runtime: {
      version: ">=3.11,<3.13",
      dependencyFile: "pyproject.toml",
      lockFile: "uv.lock",
      packs: ["python-core"]
    },
    inputs: {
      type: "object",
      required: ["date"],
      properties: { date: { type: "string", format: "compact-date" } }
    },
    capabilities: {
      mymind: {
        read: ["article/**", "reddit/**"],
        write: ["daily-summary/**"]
      },
      network: { required: true, hosts: [] },
      subprocess: { allowed: false }
    },
    artifacts: [
      { id: "daily-summary", type: "markdown", path: "daily-summary/{{ inputs.date }}_daily_summary.md" }
    ],
    execution: {
      concurrency: { maxInstances: 1, mutexes: ["mymind:daily-summary"] },
      timeoutSeconds: 1800,
      gracefulStopSeconds: 10,
      retry: { maxAttempts: 1 }
    },
    platforms: ["windows-x64", "macos-arm64", "linux-x64"],
    compatibility: { minAppVersion: "1.0.0" }
  };
}

describe("SkillManifestSchema", () => {
  it("computes a stable capability diff for a new manifest", () => {
    const previous = { capabilities: { mymind: { read: ["article/**"], write: [] }, network: { required: false, hosts: [] }, browser: false } };
    const next = { capabilities: { mymind: { read: ["article/**"], write: ["daily-summary/**"] }, network: { required: true, hosts: ["api.example.com"] }, browser: true } };

    expect(diffSkillCapabilities(previous, next)).toEqual({
      added: [
        "capabilities.browser=true",
        "capabilities.mymind.write[]=daily-summary/**",
        "capabilities.network.hosts[]=api.example.com",
        "capabilities.network.required=true"
      ],
      removed: [
        "capabilities.browser=false",
        "capabilities.network.required=false"
      ],
      changed: true
    });
    expect(diffSkillCapabilities(previous, { capabilities: { mymind: { read: ["article/**"], write: [] }, network: { required: false, hosts: [] }, browser: false } }).changed).toBe(false);
  });

  it("matches exact, caret, tilde and comparator Skill version ranges", () => {
    expect(matchesSemverRange("1.2.3", "1.2.3")).toBe(true);
    expect(matchesSemverRange("1.4.0", "^1.2.3")).toBe(true);
    expect(matchesSemverRange("2.0.0", "^1.2.3")).toBe(false);
    expect(matchesSemverRange("1.2.9", "~1.2.3")).toBe(true);
    expect(matchesSemverRange("1.3.0", "~1.2.3")).toBe(false);
    expect(matchesSemverRange("1.5.0", ">=1.0.0,<2.0.0")).toBe(true);
    expect(matchesSemverRange("2.0.0", ">=1.0.0,<2.0.0")).toBe(false);
    expect(matchesSemverRange("1.8.0", "1.x")).toBe(true);
    expect(matchesSemverRange("2.0.0", "1.x")).toBe(false);
    expect(matchesSemverRange("1.2.9", "1.2.x || >=2.0.0,<3.0.0")).toBe(true);
    expect(matchesSemverRange("2.4.0", "1.2.x || >=2.0.0,<3.0.0")).toBe(true);
    expect(matchesSemverRange("3.0.0", "1.2.x || >=2.0.0,<3.0.0")).toBe(false);
  });

  describe("valid manifests", () => {
    it("accepts a minimal valid process manifest with defaults applied", () => {
      const r = validateManifest(baseProcessManifest());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const m = r.manifest;
      expect(m.kind).toBe("process");
      if (m.kind !== "process") return;
      expect(m.execution.timeoutSeconds).toBe(1800);
      expect(m.execution.concurrency.maxInstances).toBe(1);
      expect(m.capabilities.mymind.write).toEqual(["daily-summary/**"]);
    });

    it("accepts a CLI-hosted agent manifest without entrypoint, runtime, or direct API provider", () => {
      const agent: Record<string, unknown> = {
        ...baseProcessManifest(),
        kind: "agent"
      };
      delete agent.entrypoint;
      delete agent.runtime;
      const r = validateManifest(agent);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.manifest.kind).toBe("agent");
      expect("provider" in r.manifest).toBe(false);
    });

    it("strips obsolete Agent provider settings instead of exposing a direct-API host", () => {
      const agent: Record<string, unknown> = {
        ...baseProcessManifest(),
        kind: "agent",
        provider: { required: true, fallbackOk: false }
      };
      delete agent.entrypoint;
      delete agent.runtime;
      const r = validateManifest(agent);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.manifest.kind).toBe("agent");
      expect("provider" in r.manifest).toBe(false);
    });

    it("accepts a workflow manifest with steps", () => {
      const wf: Record<string, unknown> = {
        ...baseProcessManifest(),
        kind: "workflow"
      };
      delete wf.entrypoint;
      delete wf.runtime;
      wf.workflow = {
        steps: [
          { id: "fetch", skill: "rss-article-saver", version: "^1.0.0", with: { date: "{{ inputs.date }}" } },
          { id: "summarize", skill: "daily-article-summarizer", version: "^1.0.0", needs: ["fetch"], with: { date: "{{ inputs.date }}" } }
        ]
      };
      const r = validateManifest(wf);
      expect(r.ok).toBe(true);
    });
  });

  describe("structural rejections", () => {
    it("rejects an unknown apiVersion", () => {
      const m = { ...baseProcessManifest(), apiVersion: "cctools.dev/skill/v2" };
      expect(validateManifest(m).ok).toBe(false);
    });

    it("rejects an invalid semver version", () => {
      const m = { ...baseProcessManifest(), version: "1.0" };
      expect(validateManifest(m).ok).toBe(false);
    });

    it("rejects an id that starts with a digit or has uppercase", () => {
      expect(validateManifest({ ...baseProcessManifest(), id: "1abc" }).ok).toBe(false);
      expect(validateManifest({ ...baseProcessManifest(), id: "DailySummary" }).ok).toBe(false);
    });

    it("rejects an empty platforms array", () => {
      const m = { ...baseProcessManifest(), platforms: [] };
      expect(validateManifest(m).ok).toBe(false);
    });

    it("rejects an unknown platform target", () => {
      const m = { ...baseProcessManifest(), platforms: ["windows-x64", "freebsd-x64"] };
      expect(validateManifest(m).ok).toBe(false);
    });
  });

  describe("path safety", () => {
    it("rejects an absolute entrypoint script", () => {
      const m = baseProcessManifest();
      (m.entrypoint as Record<string, unknown>).script = "/etc/passwd";
      expect(validateManifest(m).ok).toBe(false);
    });

    it("rejects a '..' segment in entrypoint script", () => {
      const m = baseProcessManifest();
      (m.entrypoint as Record<string, unknown>).script = "../escape/main.py";
      expect(validateManifest(m).ok).toBe(false);
    });

    it("rejects a drive-prefixed (Windows absolute) entrypoint", () => {
      const m = baseProcessManifest();
      (m.entrypoint as Record<string, unknown>).script = "C:/evil/main.py";
      expect(validateManifest(m).ok).toBe(false);
    });

    it("rejects a mymind read pattern containing '..'", () => {
      const m = baseProcessManifest();
      m.capabilities = {
        mymind: { read: ["../secret/**"], write: [] },
        network: { required: false, hosts: [] },
        subprocess: { allowed: false }
      };
      expect(validateManifest(m).ok).toBe(false);
    });

    it("rejects a network host containing userinfo", () => {
      const m = baseProcessManifest();
      m.capabilities = {
        mymind: { read: [], write: [] },
        network: { required: true, hosts: ["user:pass@evil.com"] },
        subprocess: { allowed: false }
      };
      expect(validateManifest(m).ok).toBe(false);
    });
  });

  describe("kind discrimination", () => {
    it("discriminates by kind", () => {
      const r = SkillManifestSchema.safeParse(baseProcessManifest());
      expect(r.success).toBe(true);
      // TypeScript narrows: process has entrypoint/runtime.
      if (r.success && r.data.kind === "process") {
        expect(r.data.entrypoint.script).toBe("main.py");
        expect(r.data.runtime.packs).toContain("python-core");
      }
    });

    it("rejects a process manifest missing entrypoint", () => {
      const m = baseProcessManifest();
      delete m.entrypoint;
      expect(validateManifest(m).ok).toBe(false);
    });

    it("rejects a process manifest missing runtime", () => {
      const m = baseProcessManifest();
      delete m.runtime;
      expect(validateManifest(m).ok).toBe(false);
    });
  });

  describe("error reporting", () => {
    it("validateManifest returns structured errors with paths", () => {
      const m = baseProcessManifest();
      delete m.version;
      const r = validateManifest(m);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      // Zod issue paths point at the bad field.
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("version"))).toBe(true);
    });
  });

  it("apiVersion constant matches schema literal", () => {
    expect(SKILL_MANIFEST_API_VERSION).toBe("cctools.dev/skill/v1");
  });
});

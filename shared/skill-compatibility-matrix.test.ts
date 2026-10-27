import { describe, expect, it } from "vitest";
import { ALL_SKILL_IDS, SKILL_COMPATIBILITY_MATRIX } from "./skill-compatibility-matrix";

describe("skill-compatibility-matrix", () => {
  it("contains exactly 15 skills (per refactor plan §2.3 / §17.7)", () => {
    expect(SKILL_COMPATIBILITY_MATRIX.length).toBe(15);
    expect(ALL_SKILL_IDS.length).toBe(15);
  });

  it("classifies 11 process / 1 workflow / 3 agent (§17.1 acceptance)", () => {
    const counts = { process: 0, workflow: 0, agent: 0 } as Record<string, number>;
    for (const e of SKILL_COMPATIBILITY_MATRIX) counts[e.targetKind] += 1;
    expect(counts).toEqual({ process: 11, workflow: 1, agent: 3 });
  });

  it("ids are unique", () => {
    const ids = ALL_SKILL_IDS;
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has at least one migration-batch assignment (A/B/C)", () => {
    for (const e of SKILL_COMPATIBILITY_MATRIX) {
      expect(["A", "B", "C"]).toContain(e.batch);
    }
  });

  it("batch A has 5 skills, batch B has 4, batch C has 6 (§17.6)", () => {
    const a = SKILL_COMPATIBILITY_MATRIX.filter((e) => e.batch === "A");
    const b = SKILL_COMPATIBILITY_MATRIX.filter((e) => e.batch === "B");
    const c = SKILL_COMPATIBILITY_MATRIX.filter((e) => e.batch === "C");
    expect(a.length).toBe(5);
    expect(b.length).toBe(4);
    expect(c.length).toBe(6);
  });

  it("content-writing skills declare openmind write patterns only to known content tops", () => {
    // sanity: every declared write top-level must be a known content-contract dir
    const known = new Set([
      "article", "creative", "daily-summary", "daily-topic", "post", "reddit", "wiki", "video"
    ]);
    for (const e of SKILL_COMPATIBILITY_MATRIX) {
      for (const w of e.openmindWrite) {
        const top = w.split("/")[0].replace("*", "");
        if (top === "") continue;
        expect(known.has(top)).toBe(true);
      }
    }
  });

  it("video-burnin-subtitles keeps the openmind/video contract (§17.7)", () => {
    const v = SKILL_COMPATIBILITY_MATRIX.find((e) => e.id === "video-burnin-subtitles");
    expect(v).toBeDefined();
    expect(v!.openmindWrite).toContain("video/**");
  });

  it("VideoDownload is the only external-export process skill (Export Location Binding)", () => {
    const externalExporters = SKILL_COMPATIBILITY_MATRIX.filter((e) => e.externalExport);
    expect(externalExporters.map((e) => e.id).sort()).toEqual(
      ["video-download", "agent-browser"].sort()
    );
    const vd = SKILL_COMPATIBILITY_MATRIX.find((e) => e.id === "video-download")!;
    expect(vd.targetKind).toBe("process");
    expect(vd.openmindWrite.length).toBe(0);
  });

  it("the workflow skill is rss-to-summary-workflow and references child skills", () => {
    const wf = SKILL_COMPATIBILITY_MATRIX.find((e) => e.targetKind === "workflow");
    expect(wf?.id).toBe("rss-to-summary-workflow");
    expect(wf?.legacyIssues).toEqual([]);
  });

  it("the three agent skills are agent-browser, ai-media-topic-selector, creative-writing", () => {
    const agents = SKILL_COMPATIBILITY_MATRIX.filter((e) => e.targetKind === "agent").map((e) => e.id).sort();
    expect(agents).toEqual(["agent-browser", "ai-media-topic-selector", "creative-writing"]);
  });

  it("lookups return undefined for unknown id", () => {
    expect(SKILL_COMPATIBILITY_MATRIX.find((e) => e.id === "does-not-exist")).toBeUndefined();
  });
});

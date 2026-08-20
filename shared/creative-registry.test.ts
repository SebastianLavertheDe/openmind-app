import { describe, expect, it } from "vitest";
import {
  bucketForStage,
  CREATIVE_BUCKETS,
  CREATIVE_PLATFORMS,
  CREATIVE_PREFERRED_FILES,
  CREATIVE_STAGE_DISK_FOLDERS,
  CREATIVE_STAGE_SCAN_FOLDERS,
  CREATIVE_WORKFLOW_STAGES,
  LEGACY_PLATFORM_DISPLAY_TO_ID,
  nextWorkflowStage,
  normalizePlatformId,
  preferredCreativeFile,
  stageFromProjectPath
} from "./creative-registry";

describe("stageFromProjectPath", () => {
  it("derives the stage from the disk folder segment on both slashes", () => {
    expect(stageFromProjectPath("openmind/creative/01-内容生产/文稿库/02-制作中/proj")).toBe("drafting");
    expect(stageFromProjectPath("openmind/creative\\03-待审核\\proj")).toBe("review");
    expect(stageFromProjectPath("openmind/creative/05-已发布/proj")).toBe("published");
  });

  it("defaults to drafting when no stage folder is found", () => {
    expect(stageFromProjectPath("openmind/creative/文稿库/proj")).toBe("drafting");
    expect(stageFromProjectPath("anything")).toBe("drafting");
  });
});

describe("bucketForStage", () => {
  it("maps each workflow stage to its bucket", () => {
    expect(bucketForStage("today")).toBe("topic");
    expect(bucketForStage("drafting")).toBe("drafting");
    expect(bucketForStage("review")).toBe("pending");
    expect(bucketForStage("ready")).toBe("pending");
    expect(bucketForStage("published")).toBe("published");
  });

  it("defaults to drafting for unknown stages", () => {
    expect(bucketForStage("nonsense")).toBe("drafting");
  });

  it("CREATIVE_BUCKETS partitions workflow stages into disjoint buckets", () => {
    const allStages = CREATIVE_BUCKETS.flatMap((b) => b.stages);
    // every workflow stage except 'archived' belongs to exactly one bucket
    for (const stage of CREATIVE_WORKFLOW_STAGES) {
      expect(allStages.filter((s) => s === stage)).toHaveLength(1);
    }
  });
});

describe("nextWorkflowStage", () => {
  it("advances drafting→review→ready→published", () => {
    expect(nextWorkflowStage("drafting")).toBe("review");
    expect(nextWorkflowStage("review")).toBe("ready");
    expect(nextWorkflowStage("ready")).toBe("published");
  });

  it("clamps to published for terminal/unknown stages", () => {
    expect(nextWorkflowStage("published")).toBe("published");
    expect(nextWorkflowStage("today")).toBe("published");
  });
});

describe("preferredCreativeFile", () => {
  it("prefers review.md for the review stage", () => {
    const files = ["draft.md", "review.md", "wechat-draft.md"];
    expect(preferredCreativeFile(files, "review")).toBe("review.md");
  });

  it("uses the default preference order for other stages", () => {
    const files = ["xiaohongshu-draft.md", "draft.md"];
    expect(preferredCreativeFile(files, "drafting")).toBe("draft.md");
  });

  it("falls back to the first available file when no preference matches", () => {
    expect(preferredCreativeFile(["custom.md"], "drafting")).toBe("custom.md");
  });

  it("returns empty string for no files", () => {
    expect(preferredCreativeFile([], "drafting")).toBe("");
  });

  it("CREATIVE_PREFERRED_FILES.review lists review.md before draft.md before wechat-draft.md", () => {
    expect(CREATIVE_PREFERRED_FILES.review).toEqual(["review.md", "draft.md", "wechat-draft.md"]);
  });
});

describe("normalizePlatformId", () => {
  it("returns the id unchanged for a known platform", () => {
    expect(normalizePlatformId("wechat")).toBe("wechat");
    expect(normalizePlatformId("xiaohongshu")).toBe("xiaohongshu");
    expect(normalizePlatformId("twitter")).toBe("twitter");
  });

  it("maps legacy Chinese display names to platform ids", () => {
    expect(normalizePlatformId("公众号")).toBe("wechat");
    expect(normalizePlatformId("小红书")).toBe("xiaohongshu");
  });

  it("returns '' for empty/whitespace input", () => {
    expect(normalizePlatformId("")).toBe("");
    expect(normalizePlatformId("   ")).toBe("");
    expect(normalizePlatformId(null)).toBe("");
    expect(normalizePlatformId(undefined)).toBe("");
  });

  it("passes through unknown values unchanged", () => {
    expect(normalizePlatformId("douyin")).toBe("douyin");
  });

  it("LEGACY_PLATFORM_DISPLAY_TO_ID covers 公众号 and 小红书", () => {
    expect(LEGACY_PLATFORM_DISPLAY_TO_ID).toEqual({ 公众号: "wechat", 小红书: "xiaohongshu" });
  });
});

describe("registry shape invariants", () => {
  it("CREATIVE_STAGE_SCAN_FOLDERS covers all disk folders", () => {
    const folders = CREATIVE_STAGE_SCAN_FOLDERS.map((f) => f.diskFolder);
    expect(folders).toEqual(["01-今日推荐", "02-制作中", "03-待审核", "04-待发布", "05-已发布", "99-归档"]);
  });

  it("CREATIVE_STAGE_DISK_FOLDERS maps non-today stages to their disk folders", () => {
    expect(CREATIVE_STAGE_DISK_FOLDERS.drafting).toBe("02-制作中");
    expect(CREATIVE_STAGE_DISK_FOLDERS.archived).toBe("99-归档");
  });

  it("CREATIVE_PLATFORMS maps ids to their draft file names", () => {
    const byId = Object.fromEntries(CREATIVE_PLATFORMS.map((p) => [p.id, p.file]));
    expect(byId).toEqual({
      wechat: "wechat-draft.md",
      xiaohongshu: "xiaohongshu-draft.md",
      twitter: "twitter-thread.md"
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { ManualSkillController } from "./manual-skill-controller";
import type { SkillToolRegistry } from "./skill-tool-registry";

/** 构造一个最小 SkillToolRegistry stub,所有方法可被单独覆盖。 */
function makeSkillTools(overrides: Partial<SkillToolRegistry> = {}) {
  return {
    isRunning: vi.fn().mockReturnValue(false),
    run: vi.fn().mockResolvedValue("ok"),
    stop: vi.fn().mockResolvedValue(true),
    ...overrides
  } as unknown as SkillToolRegistry;
}

describe("ManualSkillController", () => {
  const projectRoot = "/project";

  describe("startSkill", () => {
    it("正在运行时抛错", () => {
      const skillTools = makeSkillTools({ isRunning: vi.fn().mockReturnValue(true) });
      const controller = new ManualSkillController(skillTools, projectRoot, vi.fn());
      expect(() => controller.startSkill("daily-article-summarizer")).toThrow("该技能正在运行。");
    });

    it("委托 run 并传 invocationId=manual:<id>,返回 true", () => {
      const run = vi.fn().mockResolvedValue("ok");
      const skillTools = makeSkillTools({ run });
      const publish = vi.fn();
      const controller = new ManualSkillController(skillTools, projectRoot, publish);

      const result = controller.startSkill("daily-article-summarizer");
      expect(result).toBe(true);

      expect(run).toHaveBeenCalledWith(
        "daily-article-summarizer",
        {},
        projectRoot,
        expect.objectContaining({
          invocationId: "manual:daily-article-summarizer",
          onEvent: expect.any(Function)
        })
      );
    });

    it("传 date 时作为 { date } 参数传入", () => {
      const run = vi.fn().mockResolvedValue("ok");
      const skillTools = makeSkillTools({ run });
      const controller = new ManualSkillController(skillTools, projectRoot, vi.fn());

      controller.startSkill("daily-article-summarizer", "2026-07-08");
      expect(run).toHaveBeenCalledWith(
        "daily-article-summarizer",
        { date: "2026-07-08" },
        projectRoot,
        expect.objectContaining({ invocationId: "manual:daily-article-summarizer" })
      );
    });

    it("run reject 时 publish 一个 stderr skill-event", async () => {
      const run = vi.fn().mockRejectedValue(new Error("boom"));
      const skillTools = makeSkillTools({ run });
      const publish = vi.fn();
      const controller = new ManualSkillController(skillTools, projectRoot, publish);

      controller.startSkill("daily-article-summarizer");
      // 等 microtask flush
      await Promise.resolve();
      await Promise.resolve();

      expect(publish).toHaveBeenCalledWith({
        kind: "skill-event",
        event: expect.objectContaining({
          skillId: "daily-article-summarizer",
          invocationId: "manual:daily-article-summarizer",
          type: "output",
          stream: "stderr",
          text: "boom\n"
        })
      });
    });

    it("run reject 非 Error 时 String() 化", async () => {
      const run = vi.fn().mockRejectedValue("plain string error");
      const skillTools = makeSkillTools({ run });
      const publish = vi.fn();
      const controller = new ManualSkillController(skillTools, projectRoot, publish);

      controller.startSkill("rss");
      await Promise.resolve();
      await Promise.resolve();

      expect(publish).toHaveBeenCalledWith({
        kind: "skill-event",
        event: expect.objectContaining({ text: "plain string error\n", stream: "stderr" })
      });
    });

    it("onEvent 回调转发为 skill-event publish", () => {
      const run = vi.fn().mockImplementation((_id, _input, _root, opts) => {
        opts.onEvent!({ skillId: "x", invocationId: "manual:x", type: "status", state: "success", timestamp: "now" });
        return Promise.resolve("ok");
      });
      const skillTools = makeSkillTools({ run });
      const publish = vi.fn();
      const controller = new ManualSkillController(skillTools, projectRoot, publish);

      controller.startSkill("x");
      expect(publish).toHaveBeenCalledWith({
        kind: "skill-event",
        event: expect.objectContaining({ type: "status", state: "success" })
      });
    });
  });

  describe("startSource", () => {
    it("正在运行时抛错", () => {
      const skillTools = makeSkillTools({ isRunning: vi.fn().mockReturnValue(true) });
      const controller = new ManualSkillController(skillTools, projectRoot, vi.fn());
      expect(() => controller.startSource("src-1", "rss")).toThrow("该数据源正在运行。");
    });

    it("委托 run,invocationId=manual:<sourceId>,展开 sourceId", () => {
      const run = vi.fn().mockResolvedValue("ok");
      const skillTools = makeSkillTools({ run });
      const controller = new ManualSkillController(skillTools, projectRoot, vi.fn());

      controller.startSource("src-1", "rss");
      expect(run).toHaveBeenCalledWith(
        "rss",
        { sourceId: "src-1" },
        projectRoot,
        expect.objectContaining({ invocationId: "manual:src-1" })
      );
    });

    it("date/sourceUrl/sourceName 同时传入时全部展开", () => {
      const run = vi.fn().mockResolvedValue("ok");
      const skillTools = makeSkillTools({ run });
      const controller = new ManualSkillController(skillTools, projectRoot, vi.fn());

      controller.startSource("src-1", "rss", "2026-07-08", "https://feed.xml", "My Feed");
      expect(run).toHaveBeenCalledWith(
        "rss",
        { date: "2026-07-08", sourceId: "src-1", sourceUrl: "https://feed.xml", sourceName: "My Feed" },
        projectRoot,
        expect.objectContaining({ invocationId: "manual:src-1" })
      );
    });

    it("仅传部分可选参数时其余不展开", () => {
      const run = vi.fn().mockResolvedValue("ok");
      const skillTools = makeSkillTools({ run });
      const controller = new ManualSkillController(skillTools, projectRoot, vi.fn());

      controller.startSource("src-1", "rss", undefined, "https://feed.xml");
      expect(run).toHaveBeenCalledWith(
        "rss",
        { sourceId: "src-1", sourceUrl: "https://feed.xml" },
        projectRoot,
        expect.any(Object)
      );
    });

    it("run reject 时 publish 含 sourceId 的 stderr event", async () => {
      const run = vi.fn().mockRejectedValue(new Error("fail"));
      const skillTools = makeSkillTools({ run });
      const publish = vi.fn();
      const controller = new ManualSkillController(skillTools, projectRoot, publish);

      controller.startSource("src-1", "rss");
      await Promise.resolve();
      await Promise.resolve();

      expect(publish).toHaveBeenCalledWith({
        kind: "skill-event",
        event: expect.objectContaining({
          skillId: "rss",
          sourceId: "src-1",
          invocationId: "manual:src-1",
          stream: "stderr",
          text: "fail\n"
        })
      });
    });
  });

  describe("stopSkill / stopSource", () => {
    it("stopSkill 委托 stop(manual:<skillId>)", async () => {
      const stop = vi.fn().mockResolvedValue(true);
      const skillTools = makeSkillTools({ stop });
      const controller = new ManualSkillController(skillTools, projectRoot, vi.fn());

      const result = await controller.stopSkill("rss");
      expect(stop).toHaveBeenCalledWith("manual:rss");
      expect(result).toBe(true);
    });

    it("stopSource 委托 stop(manual:<sourceId>)", async () => {
      const stop = vi.fn().mockResolvedValue(false);
      const skillTools = makeSkillTools({ stop });
      const controller = new ManualSkillController(skillTools, projectRoot, vi.fn());

      const result = await controller.stopSource("src-1");
      expect(stop).toHaveBeenCalledWith("manual:src-1");
      expect(result).toBe(false);
    });
  });
});

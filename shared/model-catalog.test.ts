import { describe, expect, it } from "vitest";
import {
  AUTO_MODEL,
  MODEL_CATALOG,
  effectiveModelInfo,
  findModelSpec,
  formatContextWindow,
  isOneMillionModel,
  resolveModelSpec
} from "./model-catalog";

describe("model-catalog", () => {
  describe("isOneMillionModel", () => {
    it("识别第一方 1M 模型前缀", () => {
      expect(isOneMillionModel("claude-opus-4-8")).toBe(true);
      expect(isOneMillionModel("claude-sonnet-4-6")).toBe(true);
      expect(isOneMillionModel("claude-fable-5")).toBe(true);
    });

    it("识别 GLM 的 [1m] 后缀与其它 1M 标记", () => {
      expect(isOneMillionModel("glm-5.2[1m]")).toBe(true);
      expect(isOneMillionModel("GLM-4-1M")).toBe(true);
      expect(isOneMillionModel("some-model-1000k")).toBe(true);
    });

    it("非 1M 模型返回 false", () => {
      expect(isOneMillionModel("claude-haiku-4-5")).toBe(false);
      expect(isOneMillionModel("glm-4.5-air")).toBe(false);
      expect(isOneMillionModel(null)).toBe(false);
      expect(isOneMillionModel("")).toBe(false);
    });
  });

  describe("formatContextWindow", () => {
    it("格式化百万级与千级窗口", () => {
      expect(formatContextWindow(1_000_000)).toBe("1M");
      expect(formatContextWindow(200_000)).toBe("200K");
      expect(formatContextWindow(128_000)).toBe("128K");
    });

    it("未知窗口显示「未知」", () => {
      expect(formatContextWindow(0)).toBe("未知");
      expect(formatContextWindow(-1)).toBe("未知");
    });
  });

  describe("resolveModelSpec / findModelSpec", () => {
    it("目录命中返回精确条目", () => {
      expect(findModelSpec("claude", "claude-haiku-4-5")?.contextWindow).toBe(200_000);
      expect(findModelSpec("codex", "gpt-5")?.label).toBe("GPT-5");
    });

    it("目录未命中时用启发式合成（保留 1M 判定）", () => {
      const spec = resolveModelSpec("claude", "glm-4.6[1m]");
      expect(spec?.id).toBe("glm-4.6[1m]");
      expect(spec?.oneMillion).toBe(true);
      expect(spec?.contextWindow).toBe(0);
    });

    it("auto / 空值返回 null", () => {
      expect(resolveModelSpec("codex", AUTO_MODEL)).toBeNull();
      expect(resolveModelSpec("codex", null)).toBeNull();
    });
  });

  describe("effectiveModelInfo", () => {
    const detectedClaude = { detectedModel: "glm-5.2[1m]", contextWindow: 1_000_000, oneMillion: true };

    it("auto 时回落到探测模型", () => {
      const info = effectiveModelInfo("claude", AUTO_MODEL, detectedClaude);
      expect(info?.label).toBe("GLM-5.2 (1M)");
      expect(info?.oneMillion).toBe(true);
      expect(info?.contextWindow).toBe(1_000_000);
    });

    it("用户覆盖优先于探测模型", () => {
      const info = effectiveModelInfo("claude", "claude-haiku-4-5", detectedClaude);
      expect(info?.label).toBe("Claude Haiku 4.5");
      expect(info?.oneMillion).toBe(false);
      expect(info?.contextWindow).toBe(200_000);
    });

    it("auto 且探测不到模型时返回 null", () => {
      expect(effectiveModelInfo("codex", AUTO_MODEL, { detectedModel: null, contextWindow: null, oneMillion: false })).toBeNull();
    });

    it("覆盖了一个目录外模型时仍能用启发式判定 1M", () => {
      const info = effectiveModelInfo("codex", "custom-1m-model", null);
      expect(info?.oneMillion).toBe(true);
      expect(info?.label).toBe("custom-1m-model");
    });
  });

  it("两个 provider kind 的目录都包含可选项", () => {
    expect(MODEL_CATALOG.claude.length).toBeGreaterThan(0);
    expect(MODEL_CATALOG.codex.length).toBeGreaterThan(0);
    expect(MODEL_CATALOG.claude.some((m) => m.oneMillion)).toBe(true);
  });
});

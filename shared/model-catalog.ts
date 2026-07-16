/**
 * 模型目录与 1M 检测。
 *
 * 设计原则：cctools 把上下文管理委托给 provider（codex app-server / Claude Code SDK），
 * provider 实际用的模型由各自的配置决定（codex ~/.codex/config.toml、Claude 的
 * ANTHROPIC_DEFAULT_*_MODEL / settings.json）。因此「用的哪种模型、是不是 1M」以
 * 探测到的真实模型为准，这里只提供目录参考、上下文窗口查询和 1M 判定。
 *
 * 1M 的判定是启发式的：模型 id 含 `[1m]` / `1m` / `-1m-` / `1000k` / `1024k`，或命中
 * 已知 1M 模型集合（覆盖 GLM `[1m]` 后缀与 Claude Opus 4.6+/Sonnet 4.6/Fable 5）。
 */

import { messages } from "./messages";

export type ProviderKind = "codex" | "claude";

export interface ModelSpec {
  /** 传给 provider 的模型 id，如 "claude-opus-4-8"、"glm-5.2[1m]"、"gpt-5"。 */
  id: string;
  /** 展示名。 */
  label: string;
  /** 上下文窗口（token），0 表示未知。 */
  contextWindow: number;
  /** 是否支持 1M 窗口。 */
  oneMillion: boolean;
}

/** 「跟随 CLI 配置」——不向 provider 传模型覆盖，沿用其自身配置。 */
export const AUTO_MODEL = "auto";

/** 上下文窗口未知时的展示值。 */
export const UNKNOWN_CONTEXT_WINDOW = 0;

/**
 * 已知模型参考目录。仅用于展示与快捷选择，不是 provider 实际可用模型的权威清单——
 * 真实模型以探测结果为准（见 provider-registry）。
 */
export const MODEL_CATALOG: Record<ProviderKind, ModelSpec[]> = {
  claude: [
    { id: "claude-fable-5", label: "Claude Fable 5", contextWindow: 1_000_000, oneMillion: true },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8", contextWindow: 1_000_000, oneMillion: true },
    { id: "claude-opus-4-7", label: "Claude Opus 4.7", contextWindow: 1_000_000, oneMillion: true },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", contextWindow: 1_000_000, oneMillion: true },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", contextWindow: 1_000_000, oneMillion: true },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", contextWindow: 200_000, oneMillion: false },
    { id: "glm-5.2[1m]", label: "GLM-5.2 (1M)", contextWindow: 1_000_000, oneMillion: true },
    { id: "glm-4.5-air", label: "GLM-4.5 Air", contextWindow: 128_000, oneMillion: false }
  ],
  codex: [
    { id: "gpt-5", label: "GPT-5", contextWindow: 400_000, oneMillion: false },
    { id: "gpt-5-codex", label: "GPT-5 Codex", contextWindow: 400_000, oneMillion: false },
    { id: "o3", label: "o3", contextWindow: 200_000, oneMillion: false }
  ]
};

/** 已知支持 1M 窗口的第一方模型 id 前缀（用于精确命中，避免误判）。 */
const KNOWN_ONE_MILLION_PREFIXES = [
  "claude-fable-5",
  "claude-mythos-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6"
];

/** 判定一个模型 id 是否支持 1M 上下文窗口。 */
export function isOneMillionModel(id: string | null | undefined): boolean {
  if (!id) return false;
  const normalized = id.toLowerCase();
  if (KNOWN_ONE_MILLION_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  // GLM 的 [1m] 后缀，以及其它常见的 1M 标记。
  return /\[?1m\]?/.test(normalized) || /[-_]?1000k/.test(normalized) || /[-_]?1024k/.test(normalized);
}

/** 在目录里按 id 查找；找不到返回 null。 */
export function findModelSpec(provider: ProviderKind, id: string): ModelSpec | null {
  return MODEL_CATALOG[provider].find((spec) => spec.id === id) ?? null;
}

/**
 * 解析某个 provider 下「当前生效」的模型信息。
 *
 * 优先用目录里的精确条目；目录没有时根据 id 合成一条（用启发式判定 1M，上下文窗口未知）。
 * `id` 为空（auto / 探测不到）时返回 null。
 */
export function resolveModelSpec(provider: ProviderKind, id: string | null | undefined): ModelSpec | null {
  if (!id || id === AUTO_MODEL) return null;
  return findModelSpec(provider, id) ?? {
    id,
    label: id,
    contextWindow: UNKNOWN_CONTEXT_WINDOW,
    oneMillion: isOneMillionModel(id)
  };
}

/** 把上下文窗口 token 数格式化为展示串：「1M」、「200K」、「未知」。 */
export function formatContextWindow(tokens: number): string {
  if (!tokens || tokens <= 0) return messages.model.contextWindowUnknown;
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`;
  }
  return `${Math.round(tokens / 1000)}K`;
}

/** 探测到的模型信息（来自 ProviderCapabilities）。 */
export interface DetectedModel {
  detectedModel: string | null;
  contextWindow: number | null;
  oneMillion: boolean;
}

/** 解析后用于展示的生效模型信息；id 解析不到时返回 null。 */
export interface EffectiveModelInfo {
  label: string;
  contextWindow: number;
  oneMillion: boolean;
}

/**
 * 解析某 provider 当前生效的模型：用户覆盖优先，auto 时回落到探测模型。
 * 供设置卡片与对话头部共用。覆盖为 auto 且探测不到模型时返回 null。
 */
export function effectiveModelInfo(
  kind: ProviderKind,
  override: string | undefined,
  detected: DetectedModel | null
): EffectiveModelInfo | null {
  const isAuto = !override || override === AUTO_MODEL;
  const id = isAuto ? (detected?.detectedModel ?? null) : override;
  if (!id) return null;
  const spec = resolveModelSpec(kind, id);
  return {
    label: spec?.label ?? id,
    contextWindow: spec?.contextWindow ?? detected?.contextWindow ?? 0,
    oneMillion: spec?.oneMillion ?? (isAuto ? (detected?.oneMillion ?? false) : isOneMillionModel(id))
  };
}

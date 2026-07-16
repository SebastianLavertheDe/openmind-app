import type { ProviderKind } from "./model-catalog";

/**
 * 各 provider 在 rollout worldState 里的 baseInstructions 文本，按 ProviderKind 索引。
 * 此前 rollout.ts 用 `session.provider === "claude" ? "..." : "..."` 内联 ternary，
 * 集中后新增 provider 只改这里一行。
 */
export const PROVIDER_BASE_INSTRUCTIONS: Record<ProviderKind, string> = {
  claude: "Claude Code preset system instructions",
  codex: "Codex app-server managed base instructions"
};

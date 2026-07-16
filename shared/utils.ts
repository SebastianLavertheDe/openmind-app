/**
 * 跨进程共享的小工具（electron 与 renderer 都可 import）。
 */

/** 把 unknown 收敛成 Record：非纯对象（含数组/null）返回空对象。统一此前散落在 session-store 与 timeline 的两份实现。 */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

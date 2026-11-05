/** Read compatibility only. A retired UI location never grants file authority. */
export function normalizeLegacyCreativeOrigin(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const origin = value as Record<string, unknown>;
  if (origin.page !== "creative") return value;
  let filePath = origin.previewPath || origin.filePath || null;
  if (typeof filePath === "string" && filePath && !/[\\/]/.test(filePath) && typeof origin.projectDir === "string") {
    filePath = `${origin.projectDir.replace(/[\\/]$/, "")}/${filePath}`;
  }
  return { page: "ai", filePath };
}

/** Keep saved text/paths while removing the retired context discriminator. */
export function normalizeLegacyCreativeContext(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const context = value as Record<string, unknown>;
  return context.kind === "creative" ? { ...context, kind: context.path ? "file" : "content" } : value;
}

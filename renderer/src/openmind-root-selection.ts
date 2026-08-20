import type { OpenmindRootPreview } from "@shared/contracts";

export function openmindRootPreviewBody(preview: OpenmindRootPreview): string {
  const root = preview.canonicalRoot || preview.candidate || "未解析";
  const missing = preview.health.missingCreateIfNeededEntries.length;
  const unknown = preview.health.unknownPreservedEntries.length;
  const notes = [
    `候选根目录：${root}`,
    `状态：${preview.canBind ? "可绑定" : "不可绑定"}`,
    missing ? `缺少的内容目录会按需创建：${missing} 项` : "内容目录结构可用",
    unknown ? `未知目录/文件将保留：${unknown} 项` : "未发现需要迁移或删除的未知内容"
  ];
  if (preview.blockingReasons.length) notes.push(`阻止原因：${preview.blockingReasons.join("；")}`);
  return notes.join("\n");
}

export function openmindRootPreviewError(preview: OpenmindRootPreview): string {
  return preview.blockingReasons.join("；") || "候选 openmind 根目录无法绑定。";
}

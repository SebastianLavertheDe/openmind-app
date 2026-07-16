import { Braces, FileCode2, FileText } from "lucide-react";
import type { ReactNode } from "react";

/**
 * P0-DIFF-2 / P2: 共享文件类型 icon 工具。
 *
 * 从 composer-suggestion-menu.tsx 抽离,供 diff 卡片 header 和 suggestion menu 复用。
 * 入参既可是完整路径（如 "src/foo.ts"）也可是裸扩展名（如 "ts"）。
 */
export function fileIcon(pathOrExtension: string, size = 15): ReactNode {
  const extension = pathOrExtension.includes(".")
    ? pathOrExtension.split(".").pop()?.toLocaleLowerCase() || ""
    : pathOrExtension.toLocaleLowerCase();
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "css", "html", "vue", "svelte"].includes(extension)) {
    return <FileCode2 size={size} />;
  }
  if (["json", "yaml", "yml", "toml", "xml"].includes(extension)) {
    return <Braces size={size} />;
  }
  return <FileText size={size} />;
}

/** 文件扩展名对应的彩色 token（用于 icon 着色）。 */
export function fileIconColor(pathOrExtension: string): string {
  const extension = pathOrExtension.includes(".")
    ? pathOrExtension.split(".").pop()?.toLocaleLowerCase() || ""
    : pathOrExtension.toLocaleLowerCase();
  if (["ts", "tsx"].includes(extension)) return "#3178c6";
  if (["js", "jsx"].includes(extension)) return "#eab308";
  if (["py"].includes(extension)) return "#3776ab";
  if (["rs"].includes(extension)) return "#dea584";
  if (["go"].includes(extension)) return "#00add8";
  if (["css"].includes(extension)) return "#1572b6";
  if (["html"].includes(extension)) return "#e34c26";
  if (["json"].includes(extension)) return "#b7791f";
  if (["yaml", "yml", "toml"].includes(extension)) return "#cb171e";
  return "var(--muted)";
}


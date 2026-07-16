import { useMemo } from "react";
import { messages as m } from "@shared/messages";
import { OverflowBox } from "../../design-system/OverflowBox";

/**
 * P0-DIFF-1: patch 行级着色 + P0-OFL-3: 限高/折叠/搜索。
 *
 * 直接解析 unified diff 文本——每行按首字符判定类型：
 *   `+`  新增行（绿底）   `-`  删除行（红底）
 *   `@@` hunk header（灰底）   ` ` 上下文行   `\` 文件头（---/+++）
 *
 * 配 `OverflowBox` 实现：max-height 260px + 渐变遮罩 + 展开全文 + ⌘F 搜索。
 * 超 50 行时折叠态只显前 30 行 + "展开 N 行"按钮。
 */

type DiffLineKind = "add" | "del" | "context" | "hunk" | "meta";

interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

const COLLAPSE_THRESHOLD = 50;

function parsePatch(patch: string): DiffLine[] {
  const rawLines = patch.split(/\r?\n/);
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const line of rawLines) {
    if (!line) continue;
    if (line.startsWith("@@")) {
      const match = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ kind: "hunk", text: line });
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) {
      result.push({ kind: "meta", text: line });
      continue;
    }
    if (line.startsWith("+")) {
      result.push({ kind: "add", text: line.slice(1), newLine: newLine++ });
      continue;
    }
    if (line.startsWith("-")) {
      result.push({ kind: "del", text: line.slice(1), oldLine: oldLine++ });
      continue;
    }
    if (line.startsWith(" ")) {
      result.push({ kind: "context", text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
      continue;
    }
    if (line.startsWith("\\")) {
      result.push({ kind: "meta", text: line });
      continue;
    }
    result.push({ kind: "context", text: line, oldLine: oldLine++, newLine: newLine++ });
  }
  return result;
}

export function PatchView({ patch }: { patch: string }) {
  const allLines = useMemo(() => parsePatch(patch), [patch]);
  const searchLines = useMemo(() => allLines.map((line) => line.text), [allLines]);
  const expandable = allLines.length > COLLAPSE_THRESHOLD;

  return (
    <div className="patch-view" data-collapsed={expandable || undefined}>
      <OverflowBox
        className="patch-overflow"
        maxHeight={260}
        expandable={expandable}
        expandLabel={m.ai.overflow.expandLines(allLines.length)}
        searchable
        lines={searchLines}
      >
        <table className="patch-table">
          <tbody>
            {allLines.map((line, index) => (
              <tr className={`patch-line ${line.kind}`} data-line={index} key={index}>
                <td className="patch-line-num old" aria-hidden="true">{line.oldLine ?? ""}</td>
                <td className="patch-line-num new" aria-hidden="true">{line.newLine ?? ""}</td>
                <td className="patch-line-sign" aria-hidden="true">
                  {line.kind === "add" ? "+" : line.kind === "del" ? "-" : ""}
                </td>
                <td className="patch-line-text">{line.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </OverflowBox>
    </div>
  );
}

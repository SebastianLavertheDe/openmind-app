import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownReader } from "../../../renderer/src/components/MarkdownReader";
import { ColumnSplitter } from "../../../renderer/src/components/ColumnSplitter";
import { PdfMaterialViewer } from "../../../renderer/src/features/projects/PdfMaterialViewer";
import { readingSelectionText } from "../../../renderer/src/components/document/document-selection";
import "../../../renderer/src/styles.css";
import "../../../renderer/src/styles/product.css";

const probe = window as any;
const params = new URLSearchParams(location.search);
const pages = Number(params.get("pages") || 200);
const mode = params.get("mode") || "markdown";
const paragraph = "这是用于性能分析的合成 PDF 提取文本，包含中文段落和 English terms。拖动文件预览与对话之间的分割线时，我们观察长文档的解析、排版和绘制成本。每一段的内容在拖动过程中保持不变，只有容器宽度发生变化。";
const content = Array.from({ length: pages }, (_, i) => `## 第 ${i + 1} 页：Document analysis\n\n${Array.from({ length: 6 }, () => paragraph.repeat(2)).join("\n\n")}\n\n| 指标 | 描述 |\n| --- | --- |\n| 样本 ${i + 1} | 文本提取和容器布局 |\n\n`).join("") + "\n\nEND-OF-DOCUMENT-SEARCH-TARGET";
probe.fixture = { pages, mode, chars: content.length };
probe.stats = { renders: 0, resizes: 0, cancels: 0 };
probe.selectionText = () => readingSelectionText(window.getSelection());

function makePdf(count: number) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids: string[] = [];
  for (let i = 0; i < count; i++) {
    const page = objects.length + 1;
    const stream = Array.from({ length: 24 }, (_, row) => `BT /F1 12 Tf 40 ${790 - row * 24} Td (Synthetic PDF page ${i + 1}, line ${row + 1}. Resize analysis.) Tj ET`).join("\n");
    kids.push(`${page} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page + 1} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Count ${count} /Kids [${kids.join(" ")}] >>`;
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(n => String(n).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
const pdf = makePdf(pages);

function App() {
  probe.stats.renders++;
  const grid = useRef<HTMLDivElement>(null);
  const ratio = useRef(.56);
  const start = useRef(ratio.current);
  const [active, setActive] = useState(false);
  const [generation, setGeneration] = useState(0);
  probe.reopen = () => setGeneration(value => value + 1);
  const columns = (value: number) => `minmax(360px, ${value}fr) 4px minmax(360px, ${1 - value}fr)`;
  return <div ref={grid} className={`ai-workbench with-file-preview preview-active${active ? " is-resizing-preview" : ""}`} style={{ "--workbench-columns": columns(ratio.current) } as any}>
    <main className="conversation-pane"><header className="conversation-header">文档实时分栏性能测试</header><div className="chat"><div className="chat-thread"><p>固定的合成对话。仅测量文档阅读与分割线，不连接 IPC、模型或用户数据。</p></div></div></main>
    <ColumnSplitter side="left" collapsed={false} ariaLabel="文件预览宽度" toggle={() => {}} resize={delta => {
      probe.stats.resizes++;
      ratio.current = Math.min(.7, Math.max(.34, ratio.current + delta / window.innerWidth));
      grid.current?.style.setProperty("--workbench-columns", columns(ratio.current));
    }} reset={() => { ratio.current = .56; grid.current?.style.setProperty("--workbench-columns", columns(ratio.current)); }}
      onResizeStart={() => { start.current = ratio.current; }} onResizeCancel={() => { probe.stats.cancels++; ratio.current = start.current; grid.current?.style.setProperty("--workbench-columns", columns(ratio.current)); }} onResizeActiveChange={setActive}/>
    <aside className="ai-file-preview"><header>合成长文档：{pages} 页段落</header><div className="ai-file-preview-body">
      {mode === "pdf" ? <div className="ai-file-preview-pdf"><PdfMaterialViewer key={generation} data={pdf} title="Synthetic PDF" onError={error => { probe.error = error; }}/></div> : <div className="content-selection-surface"><MarkdownReader key={generation} content={content} layout="file"/></div>}
    </div></aside>
  </div>;
}
const style = document.createElement("style");
style.textContent = "html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}.ai-workbench{height:100%;display:grid;min-height:0}.ai-file-preview,.conversation-pane{height:100%;min-height:0}";
document.head.append(style);
createRoot(document.getElementById("root")!).render(<App/>);

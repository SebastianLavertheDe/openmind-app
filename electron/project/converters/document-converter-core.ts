import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { unzipSync, strFromU8, type UnzipFileInfo } from "fflate";
import { XMLParser } from "fast-xml-parser";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import TurndownService from "turndown";
import { SUPPORTED_DOCUMENT_EXTENSIONS } from "./document-extensions";

// Re-exported for existing callers; the canonical definition lives in the
// dependency-free document-extensions module so the main process never has
// to load this file's heavy conversion libraries for the extension list.
export { SUPPORTED_DOCUMENT_EXTENSIONS };

const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_SPREADSHEET_CELLS = 50_000;
const MAX_SPREADSHEET_COLUMNS = 256;

export type ConvertedDocument = {
  title: string;
  markdown: string;
  warnings: string[];
};

type XmlRecord = Record<string, unknown>;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): XmlRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as XmlRecord
    : undefined;
}

function scalar(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  const record = asRecord(value);
  if (!record) return "";
  return scalar(record["#text"]);
}

function cleanTitle(input: string): string {
  const clean = input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean.slice(0, 200) || "未命名资料";
}

function fileTitle(inputPath: string): string {
  return cleanTitle(path.basename(inputPath, path.extname(inputPath)));
}

function normalizeMarkdown(markdown: string): string {
  return `${markdown.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{4,}/g, "\n\n\n").trim()}\n`;
}

async function readBoundedFile(inputPath: string): Promise<Buffer> {
  const info = await stat(inputPath);
  if (!info.isFile()) throw new Error("资料源不是普通文件");
  if (info.size <= 0) throw new Error("资料文件为空");
  if (info.size > MAX_SOURCE_BYTES) throw new Error("资料文件超过 100 MB 限制");
  return readFile(inputPath);
}

function inspectArchiveLimits(buffer: Uint8Array): void {
  let expandedBytes = 0;
  unzipSync(buffer, {
    filter: (entry: UnzipFileInfo) => {
      if (entry.originalSize > MAX_ARCHIVE_ENTRY_BYTES) {
        throw new Error(`Office 压缩包条目过大：${entry.name}`);
      }
      expandedBytes += entry.originalSize;
      if (expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
        throw new Error("Office 压缩包展开后超过 256 MB 限制");
      }
      return false;
    }
  });
}

function unzipSelected(buffer: Uint8Array, include: (name: string) => boolean): Record<string, Uint8Array> {
  let expandedBytes = 0;
  return unzipSync(buffer, {
    filter: (entry) => {
      if (entry.originalSize > MAX_ARCHIVE_ENTRY_BYTES) {
        throw new Error(`Office 压缩包条目过大：${entry.name}`);
      }
      expandedBytes += entry.originalSize;
      if (expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
        throw new Error("Office 压缩包展开后超过 256 MB 限制");
      }
      return include(entry.name);
    }
  });
}

function collectXmlText(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectXmlText(item, output);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    if (key === "t") {
      const text = scalar(child).trim();
      if (text) output.push(text);
      continue;
    }
    if (!key.startsWith("@_")) collectXmlText(child, output);
  }
}

async function convertPdf(inputPath: string, buffer: Buffer): Promise<ConvertedDocument> {
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    stopAtErrors: true,
    maxImageSize: 0,
    useSystemFonts: false,
    disableFontFace: true
  });
  try {
    // PDF.js transfers the typed array into its worker on first load. Loading
    // metadata and text concurrently can race that transfer on Node/Electron.
    const info = await parser.getInfo().catch(() => undefined);
    const text = await parser.getText();
    const title = cleanTitle(scalar(info?.info?.Title) || fileTitle(inputPath));
    const readablePages = text.pages.filter((page) => page.text.trim().length > 0);
    if (readablePages.length === 0) {
      throw new Error("PDF 不包含可读取文本；扫描 PDF 首版不执行 OCR");
    }
    const metadata = [
      `- 原始文件：../originals/${path.basename(inputPath)}`,
      `- 页数：${text.total}`,
      `- 导入时间：${new Date().toISOString()}`
    ];
    if (info?.info?.Author) metadata.push(`- 作者：${scalar(info.info.Author)}`);
    const pages = text.pages.map((page) => `## 第 ${page.num} 页\n\n${page.text.trim() || "_（此页未提取到文字）_"}`);
    return {
      title,
      markdown: normalizeMarkdown(`# ${title}\n\n## 元数据\n\n${metadata.join("\n")}\n\n${pages.join("\n\n")}`),
      warnings: readablePages.length < text.total ? ["部分 PDF 页面未提取到文字"] : []
    };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function convertDocx(inputPath: string, buffer: Buffer): Promise<ConvertedDocument> {
  inspectArchiveLimits(buffer);
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      externalFileAccess: false,
      includeEmbeddedStyleMap: false,
      convertImage: mammoth.images.imgElement(async () => ({ src: "" }))
    }
  );
  const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
  turndown.remove(["script", "style", "img"]);
  const title = fileTitle(inputPath);
  const body = turndown.turndown(result.value).trim();
  if (!body) throw new Error("DOCX 不包含可读取文本");
  return {
    title,
    markdown: normalizeMarkdown(`# ${title}\n\n${body}`),
    warnings: result.messages.map((message) => message.message)
  };
}

function slideNumber(name: string): number {
  return Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
}

function convertPptx(inputPath: string, buffer: Buffer): ConvertedDocument {
  const files = unzipSelected(buffer, (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const slideNames = Object.keys(files).sort((left, right) => slideNumber(left) - slideNumber(right));
  if (slideNames.length === 0) throw new Error("PPTX 不包含可读取的幻灯片");
  const slides = slideNames.map((name, index) => {
    const parsed = xmlParser.parse(strFromU8(files[name]));
    const text: string[] = [];
    collectXmlText(parsed, text);
    return `## Slide ${index + 1}\n\n${text.join("\n\n") || "_（此页未提取到文字）_"}`;
  });
  const title = fileTitle(inputPath);
  return {
    title,
    markdown: normalizeMarkdown(`# ${title}\n\n${slides.join("\n\n")}`),
    warnings: []
  };
}

function cellColumn(cellReference: string): number {
  const letters = cellReference.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "A";
  let column = 0;
  for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, column - 1);
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
}

function sharedStringValue(value: unknown): string {
  const texts: string[] = [];
  collectXmlText(value, texts);
  return texts.join("");
}

function worksheetToMarkdown(xml: string, sharedStrings: string[]): string {
  const parsed = asRecord(xmlParser.parse(xml));
  const worksheet = asRecord(parsed?.worksheet);
  const sheetData = asRecord(worksheet?.sheetData);
  const rows = asArray(sheetData?.row as XmlRecord | XmlRecord[] | undefined);
  const table: string[][] = [];
  let cellCount = 0;
  let maxColumn = -1;

  for (const row of rows) {
    const rowRecord = asRecord(row);
    if (!rowRecord) continue;
    const outputRow: string[] = [];
    for (const cellValue of asArray(rowRecord.c as XmlRecord | XmlRecord[] | undefined)) {
      const cell = asRecord(cellValue);
      if (!cell) continue;
      cellCount += 1;
      if (cellCount > MAX_SPREADSHEET_CELLS) throw new Error("XLSX 单个工作表超过 50,000 个单元格限制");
      const column = cellColumn(scalar(cell["@_r"]));
      if (column >= MAX_SPREADSHEET_COLUMNS) throw new Error("XLSX 单个工作表超过 256 列限制");
      maxColumn = Math.max(maxColumn, column);
      const type = scalar(cell["@_t"]);
      let value = scalar(cell.v);
      if (type === "s") value = sharedStrings[Number(value)] ?? "";
      if (type === "inlineStr") value = sharedStringValue(cell.is);
      if (!value && cell.f) value = `=${scalar(cell.f)}`;
      outputRow[column] = markdownCell(value);
    }
    table.push(outputRow);
  }
  if (maxColumn < 0) return "_（此工作表未提取到单元格）_";
  const width = maxColumn + 1;
  const normalized = table.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
  const header = normalized[0] ?? Array.from({ length: width }, (_, index) => `列 ${index + 1}`);
  const body = normalized.slice(1);
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

function convertXlsx(inputPath: string, buffer: Buffer): ConvertedDocument {
  const files = unzipSelected(buffer, (name) =>
    name === "xl/sharedStrings.xml" ||
    name === "xl/workbook.xml" ||
    /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
  );
  const sharedStringsXml = files["xl/sharedStrings.xml"];
  const sharedStrings = sharedStringsXml
    ? asArray(asRecord(asRecord(xmlParser.parse(strFromU8(sharedStringsXml)))?.sst)?.si as unknown)
      .map(sharedStringValue)
    : [];
  const workbookXml = files["xl/workbook.xml"];
  const workbook = workbookXml ? asRecord(xmlParser.parse(strFromU8(workbookXml))) : undefined;
  const sheetsNode = asRecord(asRecord(workbook?.workbook)?.sheets);
  const sheetNames = asArray(sheetsNode?.sheet as XmlRecord | XmlRecord[] | undefined)
    .map((sheet, index) => cleanTitle(scalar(asRecord(sheet)?.["@_name"]) || `Sheet ${index + 1}`));
  const worksheetNames = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((left, right) => slideNumber(left.replace("sheet", "slide")) - slideNumber(right.replace("sheet", "slide")));
  if (worksheetNames.length === 0) throw new Error("XLSX 不包含可读取的工作表");
  const sheets = worksheetNames.map((name, index) =>
    `## ${sheetNames[index] ?? `Sheet ${index + 1}`}\n\n${worksheetToMarkdown(strFromU8(files[name]), sharedStrings)}`
  );
  const title = fileTitle(inputPath);
  return {
    title,
    markdown: normalizeMarkdown(`# ${title}\n\n${sheets.join("\n\n")}`),
    warnings: []
  };
}

export async function convertDocumentToMarkdown(inputPath: string): Promise<ConvertedDocument> {
  const extension = path.extname(inputPath).toLowerCase();
  if (!SUPPORTED_DOCUMENT_EXTENSIONS.includes(extension as typeof SUPPORTED_DOCUMENT_EXTENSIONS[number])) {
    throw new Error(`不支持的文档格式：${extension || "无扩展名"}`);
  }
  const buffer = await readBoundedFile(inputPath);
  switch (extension) {
    case ".pdf":
      return convertPdf(inputPath, buffer);
    case ".docx":
      return convertDocx(inputPath, buffer);
    case ".pptx":
      return convertPptx(inputPath, buffer);
    case ".xlsx":
      return convertXlsx(inputPath, buffer);
    default:
      throw new Error(`不支持的文档格式：${extension}`);
  }
}

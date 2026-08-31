import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { convertDocumentToMarkdown } from "./document-converter-core";

async function writeZipFixture(extension: string, files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openmind-project-convert-"));
  const filePath = path.join(directory, `fixture${extension}`);
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)])));
  await writeFile(filePath, zipped);
  return filePath;
}

function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

describe("Project Office to Markdown conversion", () => {
  it("converts each PDF page into a Markdown page section", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "openmind-project-convert-"));
    const filePath = path.join(directory, "report.pdf");
    await writeFile(filePath, minimalPdf("Readable PDF text"));
    const result = await convertDocumentToMarkdown(filePath);
    expect(result.markdown).toContain("# report");
    expect(result.markdown).toContain("## 第 1 页");
    expect(result.markdown).toContain("Readable PDF text");
  });

  it("preserves DOCX headings, paragraphs, lists, and tables as Markdown", async () => {
    const filePath = await writeZipFixture(".docx", {
      "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      </Types>`,
      "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>`,
      "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Document heading</w:t></w:r></w:p>
        <w:p><w:r><w:t>Body paragraph</w:t></w:r></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:body></w:document>`,
      "word/_rels/document.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`
    });
    const result = await convertDocumentToMarkdown(filePath);
    expect(result.markdown).toContain("# Document heading");
    expect(result.markdown).toContain("Body paragraph");
    expect(result.markdown).toContain("Cell A");
    expect(result.markdown).toContain("Cell B");
  });

  it("converts PPTX slides into ordinary Markdown", async () => {
    const filePath = await writeZipFixture(".pptx", {
      "ppt/slides/slide1.xml": `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><a:p><a:r><a:t>First slide</a:t></a:r></a:p></p:cSld></p:sld>`,
      "ppt/slides/slide2.xml": `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:cSld></p:sld>`
    });
    const result = await convertDocumentToMarkdown(filePath);
    expect(result.markdown).toContain("## Slide 1");
    expect(result.markdown).toContain("First slide");
    expect(result.markdown).toContain("## Slide 2");
  });

  it("converts XLSX sheets and shared strings into Markdown tables", async () => {
    const filePath = await writeZipFixture(".xlsx", {
      "xl/workbook.xml": `<workbook xmlns="x"><sheets><sheet name="数据" sheetId="1"/></sheets></workbook>`,
      "xl/sharedStrings.xml": `<sst xmlns="x"><si><t>Name</t></si><si><t>OpenMind</t></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet xmlns="x"><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>Score</v></c></row>
        <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>10</v></c></row>
      </sheetData></worksheet>`
    });
    const result = await convertDocumentToMarkdown(filePath);
    expect(result.markdown).toContain("## 数据");
    expect(result.markdown).toContain("| Name | Score |");
    expect(result.markdown).toContain("| OpenMind | 10 |");
  });

  it("rejects unsupported formats", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "openmind-project-convert-"));
    const filePath = path.join(directory, "fixture.exe");
    await writeFile(filePath, "not a document");
    await expect(convertDocumentToMarkdown(filePath)).rejects.toThrow(/不支持/);
  });
});

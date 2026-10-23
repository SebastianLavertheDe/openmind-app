import { describe, expect, it } from "vitest";
import { FILE_DELIVERABLES_START_FENCE, parseFileDeliverables } from "./file-deliverables";
import { ArtifactFenceParser, assistantBlocksVisibleText, parseAssistantContent } from "./markdown-artifacts";

const manifest = (files: unknown) => `${FILE_DELIVERABLES_START_FENCE}\n${JSON.stringify(files)}\n~~~~`;
const selected = (text: string) => parseAssistantContent(text).flatMap(block => block.type === "files" ? block.files : []);

describe("explicit final file declarations", () => {
  it("does not infer deliverables from ordinary media links, code paths or resource descriptions", () => {
    expect(selected("素材：[输入](<assets/input.png>)\n`draft.wav`\noutputs/movie.mp4")).toEqual([]);
    expect(selected(`已完成。\n${manifest([{ path: "outputs/deck.pptx", title: "10 页演示" }])}`)).toEqual([{ path: "outputs/deck.pptx", title: "10 页演示" }]);
  });
  it("retains ordered mixed deliverables and copies readable links without the protocol", () => {
    const files = [{ path: "assets/final.png" }, { path: "outputs/final video.mp4", title: "成片" }];
    const text = `完成。\n${manifest(files)}\n请查看。`;
    expect(selected(text)).toEqual(files);
    const visible = assistantBlocksVisibleText(parseAssistantContent(text));
    expect(visible).toContain("[成片](outputs/final%20video.mp4)");
    expect(visible).not.toContain("openmind-deliverables");
  });
  it("ignores quoted protocol examples and nested declarations inside Markdown artifacts", () => {
    const value = manifest([{ path: "outputs/final.mp4" }]);
    expect(selected(`\`\`\`text\n${value}\n\`\`\``)).toEqual([]);
    expect(selected(`~~~~openmind-artifact\n# 示例\n${value}\n~~~~`)).toEqual([]);
  });
  it("handles every split boundary without exposing JSON or partial markers", () => {
    const value = `完成\n${manifest([{ path: "outputs/deck.pptx" }])}`;
    for (let split = 0; split <= value.length; split++) {
      const parser = new ArtifactFenceParser("split");
      parser.push(value.slice(0, split));
      expect(assistantBlocksVisibleText(parser.blocks())).not.toMatch(/openmind-deliverables|"path"/);
      parser.push(value.slice(split));
      expect(parser.finish()).toEqual(parseAssistantContent(value, "split"));
    }
    expect(selected(value.replaceAll("\n", "\r\n"))).toEqual([{ path: "outputs/deck.pptx" }]);
  });
  it("does not publish incomplete or malformed declarations", () => {
    expect(selected(`${FILE_DELIVERABLES_START_FENCE}\n[{"path":"done.mp4"}]`)).toEqual([]);
    expect(selected(`${FILE_DELIVERABLES_START_FENCE}\nnot json\n~~~~`)).toEqual([]);
    const parser = new ArtifactFenceParser("cancelled");
    parser.push(`${FILE_DELIVERABLES_START_FENCE}\n[{"path":"done.mp4"}]\n`);
    expect(parser.interrupt()).toMatchObject([{ type: "files", status: "incomplete", files: [] }]);
  });
  it.each(["https://host/a.mp4", "data:image/png;base64,x", "../secret.png", "outputs/../../secret.png", "//host/file", "bad\nname.mp4"])("rejects nonlocal or malformed path %s", path => {
    expect(parseFileDeliverables(JSON.stringify([{ path }]))).toEqual([]);
  });
  it("deduplicates normalized paths and bounds the declaration size", () => {
    expect(parseFileDeliverables(JSON.stringify([{ path: "outputs/a.mp4" }, { path: "outputs\\a.mp4" }]))).toHaveLength(1);
    expect(parseFileDeliverables(JSON.stringify(Array.from({ length: 33 }, (_, i) => ({ path: `${i}.png` }))))).toEqual([]);
    expect(parseFileDeliverables(" ".repeat(64_001))).toEqual([]);
  });
});

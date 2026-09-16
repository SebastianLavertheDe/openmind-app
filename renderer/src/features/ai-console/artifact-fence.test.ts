import { describe, expect, it } from "vitest";
import {
  ArtifactFenceParser,
  assistantBlocksVisibleText,
  parseAssistantContent,
  type AssistantContentBlock
} from "./artifact-fence";

const START = "~~~~openmind-artifact";
const END = "~~~~";

function comparable(blocks: readonly AssistantContentBlock[]) {
  return blocks.map(({ key: _key, ...block }) => block);
}

describe("parseAssistantContent", () => {
  it("keeps ordinary text as one text block", () => {
    expect(comparable(parseAssistantContent("普通回答\n\n- 没有产物"))).toEqual([
      { type: "text", text: "普通回答\n\n- 没有产物" }
    ]);
  });

  it("separates intro, one artifact, and outro", () => {
    const input = `好的，下面是文章。\n\n${START}\n# 示例文章\n\n这是正文。\n${END}\n\n文章已经生成。`;
    expect(comparable(parseAssistantContent(input, "run:item"))).toEqual([
      { type: "text", text: "好的，下面是文章。" },
      {
        type: "artifact",
        artifactType: "markdown",
        title: "示例文章",
        content: "# 示例文章\n\n这是正文。",
        status: "complete"
      },
      { type: "text", text: "文章已经生成。" }
    ]);
    expect(parseAssistantContent(input, "run:item")[1]?.key).toBe("artifact:run:item:1");
  });

  it("parses multiple artifacts and numbers multiple unnamed titles", () => {
    const input = `${START}\nfirst\n${END}\n中间\n${START}\nsecond\n${END}`;
    const blocks = parseAssistantContent(input);
    expect(blocks.filter((block) => block.type === "artifact").map((block) => block.title)).toEqual([
      "未命名产物 1",
      "未命名产物 2"
    ]);
  });

  it("allows triple-backtick code blocks inside an artifact", () => {
    const input = `${START}\n# Code\n\n\`\`\`typescript\nconst ready = true;\n\`\`\`\n${END}`;
    const artifact = parseAssistantContent(input)[0];
    expect(artifact?.type).toBe("artifact");
    if (artifact?.type === "artifact") expect(artifact.content).toContain("```typescript\nconst ready = true;\n```");
  });

  it("does not recognize reserved markers inside an ordinary Markdown fence", () => {
    const input = `\`\`\`text\n${START}\n# example\n${END}\n\`\`\`\nvisible`;
    expect(comparable(parseAssistantContent(input))).toEqual([{ type: "text", text: input }]);
  });

  it("supports LF and CRLF without leaking carriage returns into marker lines", () => {
    const lf = `intro\n${START}\n# Title\nbody\n${END}\noutro`;
    const crlf = lf.replaceAll("\n", "\r\n");
    expect(comparable(parseAssistantContent(crlf))).toEqual([
      { type: "text", text: "intro" },
      { type: "artifact", artifactType: "markdown", title: "Title", content: "# Title\r\nbody", status: "complete" },
      { type: "text", text: "outro" }
    ]);
  });

  it("treats a lone end fence and non-exclusive markers as ordinary Markdown", () => {
    expect(comparable(parseAssistantContent(END))).toEqual([{ type: "text", text: END }]);
    const inline = `before ${START}\nafter`;
    expect(comparable(parseAssistantContent(inline))).toEqual([{ type: "text", text: inline }]);
  });

  it("marks an unclosed durable artifact incomplete", () => {
    expect(comparable(parseAssistantContent(`${START}\n# Draft\nbody`))).toEqual([{
      type: "artifact",
      artifactType: "markdown",
      title: "Draft",
      content: "# Draft\nbody",
      status: "incomplete"
    }]);
  });

  it("keeps a nested start marker in the current artifact body", () => {
    const artifact = parseAssistantContent(`${START}\n# Outer\n${START}\nbody\n${END}`)[0];
    expect(artifact?.type).toBe("artifact");
    if (artifact?.type === "artifact") expect(artifact.content).toContain(START);
  });

  it("uses a single unnamed fallback without a numeric suffix", () => {
    const artifact = parseAssistantContent(`${START}\nbody\n${END}`)[0];
    expect(artifact?.type === "artifact" ? artifact.title : "").toBe("未命名产物");
  });

  it("returns visible reply text without protocol markers", () => {
    const blocks = parseAssistantContent(`intro\n${START}\n# Title\nbody\n${END}\noutro`);
    expect(assistantBlocksVisibleText(blocks)).toBe("intro\n\n# Title\nbody\n\noutro");
  });
});

describe("ArtifactFenceParser streaming", () => {
  const input = `intro\n\n${START}\n# Streaming title\n\nbody\n${END}\n\noutro`;
  const expected = comparable(parseAssistantContent(input));

  it("produces the same result at every possible delta split", () => {
    for (let split = 0; split <= input.length; split += 1) {
      const parser = new ArtifactFenceParser("split");
      parser.push(input.slice(0, split));
      parser.push(input.slice(split));
      expect(comparable(parser.finish()), `split at ${split}`).toEqual(expected);
    }
  });

  it("produces the same result when every character is a delta", () => {
    const parser = new ArtifactFenceParser("character");
    for (const character of input) parser.push(character);
    expect(comparable(parser.finish())).toEqual(expected);
    expect(parser.processedCharacterCount()).toBe(input.length);
  });

  it("buffers partial reserved markers and streams confirmed body text", () => {
    const parser = new ArtifactFenceParser("live");
    parser.push("intro\n~~");
    expect(assistantBlocksVisibleText(parser.blocks())).toBe("intro");
    parser.push("~~openmind-artifact\n# Live");
    expect(comparable(parser.blocks())).toEqual([
      { type: "text", text: "intro" },
      { type: "artifact", artifactType: "markdown", title: "Live", content: "# Live", status: "streaming" }
    ]);
    parser.push("\nbody\n~~");
    const artifact = parser.blocks().find((block) => block.type === "artifact");
    expect(artifact?.type === "artifact" ? artifact.content : "").toBe("# Live\nbody");
    parser.push("~~\n");
    expect(parser.blocks().find((block) => block.type === "artifact")?.status).toBe("complete");
  });

  it("keeps an interrupted artifact and marks it incomplete", () => {
    const parser = new ArtifactFenceParser("cancelled");
    parser.push(`${START}\n# Partial\nbody`);
    const artifact = parser.interrupt()[0];
    expect(artifact?.type).toBe("artifact");
    if (artifact?.type === "artifact") {
      expect(artifact.status).toBe("incomplete");
      expect(artifact.content).toBe("# Partial\nbody");
    }
  });

  it("processes a 100 KiB artifact without replaying historical input", () => {
    const body = "x".repeat(100 * 1024);
    const value = `${START}\n# Large\n${body}\n${END}`;
    const parser = new ArtifactFenceParser("large");
    for (let offset = 0; offset < value.length; offset += 137) parser.push(value.slice(offset, offset + 137));
    const blocks = parser.finish();
    expect(parser.processedCharacterCount()).toBe(value.length);
    expect(blocks[0]?.type === "artifact" ? blocks[0].content.length : 0).toBeGreaterThanOrEqual(body.length);
  });
});

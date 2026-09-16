export const MARKDOWN_ARTIFACT_START_FENCE = "~~~~openmind-artifact";
export const MARKDOWN_ARTIFACT_END_FENCE = "~~~~";

export type AssistantTextBlock = {
  type: "text";
  key: string;
  text: string;
};

export type AssistantArtifactBlock = {
  type: "artifact";
  key: string;
  artifactType: "markdown";
  title: string;
  content: string;
  status: "streaming" | "complete" | "incomplete";
};

export type AssistantContentBlock = AssistantTextBlock | AssistantArtifactBlock;

export type ArtifactFenceParserState = "normal" | "normal-fenced-code" | "artifact";

type InternalTextBlock = { type: "text"; text: string };
type InternalArtifactBlock = {
  type: "artifact";
  content: string;
  title: string;
  status: AssistantArtifactBlock["status"];
};
type InternalBlock = InternalTextBlock | InternalArtifactBlock;
type MarkdownFence = { character: "`" | "~"; length: number };

/**
 * Incremental parser for the reserved OpenMind Markdown artifact fence.
 *
 * Completed input is consumed exactly once. Only the unfinished line is kept
 * aside so a reserved marker split across provider deltas is never flashed as
 * ordinary Markdown. `blocks()` derives a render snapshot without reparsing
 * any previously consumed line.
 */
export class ArtifactFenceParser {
  private state: ArtifactFenceParserState = "normal";
  private readonly internalBlocks: InternalBlock[] = [];
  private pendingLine = "";
  private normalFence: MarkdownFence | null = null;
  private ended = false;
  private processedCharacters = 0;

  constructor(private readonly keyPrefix: string) {}

  push(delta: string): void {
    if (!delta || this.ended) return;
    this.processedCharacters += delta.length;
    let offset = 0;
    while (offset < delta.length) {
      const newline = delta.indexOf("\n", offset);
      if (newline < 0) {
        this.pendingLine += delta.slice(offset);
        return;
      }
      this.pendingLine += delta.slice(offset, newline);
      this.consumeLine(this.pendingLine, "\n");
      this.pendingLine = "";
      offset = newline + 1;
    }
  }

  /** Finish a durable message. An open artifact becomes incomplete. */
  finish(): AssistantContentBlock[] {
    if (!this.ended) {
      this.consumeEndOfInput();
      this.ended = true;
    }
    return this.blocks();
  }

  /** Preserve an interrupted transient stream and mark its open artifact. */
  interrupt(): AssistantContentBlock[] {
    return this.finish();
  }

  blocks(): AssistantContentBlock[] {
    const preview = this.previewBlocks();
    const unnamedCount = preview.filter((block) => block.type === "artifact" && !block.title).length;
    let unnamedIndex = 0;
    const result: AssistantContentBlock[] = [];

    preview.forEach((block) => {
      if (block.type === "text") {
        const text = trimBoundaryLineBreaks(block.text);
        if (!text) return;
        const blockIndex = result.length;
        result.push({
          type: "text",
          key: `text:${this.keyPrefix}:${blockIndex}`,
          text
        });
        return;
      }

      const content = trimBoundaryLineBreaks(block.content);
      const extractedTitle = block.title;
      if (!extractedTitle) unnamedIndex += 1;
      const blockIndex = result.length;
      result.push({
        type: "artifact",
        key: `artifact:${this.keyPrefix}:${blockIndex}`,
        artifactType: "markdown",
        title: extractedTitle || (unnamedCount > 1 ? `未命名产物 ${unnamedIndex}` : "未命名产物"),
        content,
        status: block.status
      });
    });

    return result;
  }

  hasArtifact(): boolean {
    return this.internalBlocks.some((block) => block.type === "artifact");
  }

  /** Test/performance diagnostic: every pushed character is counted once. */
  processedCharacterCount(): number {
    return this.processedCharacters;
  }

  private consumeLine(rawLine: string, newline: "\n"): void {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const eol = rawLine.endsWith("\r") ? `\r${newline}` : newline;

    if (this.state === "artifact") {
      if (line === MARKDOWN_ARTIFACT_END_FENCE) {
        const artifact = this.currentArtifact();
        if (artifact) artifact.status = "complete";
        this.state = "normal";
        return;
      }
      this.appendArtifact(`${rawLine}${newline}`, line);
      return;
    }

    if (this.state === "normal" && line === MARKDOWN_ARTIFACT_START_FENCE) {
      this.internalBlocks.push({ type: "artifact", content: "", title: "", status: "streaming" });
      this.state = "artifact";
      return;
    }

    this.appendText(`${line}${eol}`);
    if (this.state === "normal-fenced-code") {
      if (this.normalFence && closesMarkdownFence(line, this.normalFence)) {
        this.normalFence = null;
        this.state = "normal";
      }
      return;
    }

    const openedFence = opensMarkdownFence(line);
    if (openedFence) {
      this.normalFence = openedFence;
      this.state = "normal-fenced-code";
    }
  }

  private consumeEndOfInput(): void {
    const rawLine = this.pendingLine;
    this.pendingLine = "";
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    if (this.state === "artifact") {
      if (line === MARKDOWN_ARTIFACT_END_FENCE) {
        const artifact = this.currentArtifact();
        if (artifact) artifact.status = "complete";
        this.state = "normal";
      } else {
        this.appendArtifact(rawLine, line);
        const artifact = this.currentArtifact();
        if (artifact) artifact.status = "incomplete";
      }
      return;
    }

    if (this.state === "normal" && line === MARKDOWN_ARTIFACT_START_FENCE) {
      this.internalBlocks.push({ type: "artifact", content: "", title: "", status: "incomplete" });
      this.state = "artifact";
      return;
    }
    this.appendText(rawLine);
  }

  private previewBlocks(): InternalBlock[] {
    const preview = this.internalBlocks.map((block) => ({ ...block }));
    if (!this.pendingLine || this.ended) return preview;

    if (this.state === "artifact") {
      if (!MARKDOWN_ARTIFACT_END_FENCE.startsWith(stripTrailingCarriageReturn(this.pendingLine))) {
        appendPreview(preview, "artifact", this.pendingLine);
        const artifact = preview.at(-1);
        if (artifact?.type === "artifact" && !artifact.title) artifact.title = artifactTitleFromLine(stripTrailingCarriageReturn(this.pendingLine));
      }
      return preview;
    }

    if (this.state === "normal" && MARKDOWN_ARTIFACT_START_FENCE.startsWith(stripTrailingCarriageReturn(this.pendingLine))) {
      return preview;
    }
    appendPreview(preview, "text", this.pendingLine);
    return preview;
  }

  private appendText(text: string): void {
    if (!text) return;
    const last = this.internalBlocks.at(-1);
    if (last?.type === "text") last.text += text;
    else this.internalBlocks.push({ type: "text", text });
  }

  private appendArtifact(content: string, line: string): void {
    const artifact = this.currentArtifact();
    if (!artifact) return;
    artifact.content += content;
    if (!artifact.title) artifact.title = artifactTitleFromLine(line);
  }

  private currentArtifact(): InternalArtifactBlock | undefined {
    const last = this.internalBlocks.at(-1);
    return last?.type === "artifact" ? last : undefined;
  }
}

export function parseAssistantContent(text: string, keyPrefix = "assistant"): AssistantContentBlock[] {
  const parser = new ArtifactFenceParser(keyPrefix);
  parser.push(text);
  return parser.finish();
}

export function assistantBlocksVisibleText(blocks: readonly AssistantContentBlock[]): string {
  return blocks
    .map((block) => block.type === "text" ? block.text : block.content)
    .filter(Boolean)
    .join("\n\n");
}

export function containsAssistantArtifact(blocks: readonly AssistantContentBlock[]): boolean {
  return blocks.some((block) => block.type === "artifact");
}

function appendPreview(blocks: InternalBlock[], type: InternalBlock["type"], value: string): void {
  if (!value) return;
  const last = blocks.at(-1);
  if (type === "text") {
    if (last?.type === "text") last.text += value;
    else blocks.push({ type: "text", text: value });
    return;
  }
  if (last?.type === "artifact") last.content += value;
}

function stripTrailingCarriageReturn(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function trimBoundaryLineBreaks(value: string): string {
  return value.replace(/^(?:\r?\n)+/, "").replace(/(?:\r?\n)+$/, "");
}

function artifactTitleFromLine(line: string): string {
  const match = /^ {0,3}#(?!#)\s+(.+?)\s*$/.exec(line);
  return match ? match[1].replace(/\s+#+\s*$/, "").trim() : "";
}

function opensMarkdownFence(line: string): MarkdownFence | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const delimiter = match[1];
  if (delimiter[0] === "`" && match[2].includes("`")) return null;
  return { character: delimiter[0] as MarkdownFence["character"], length: delimiter.length };
}

function closesMarkdownFence(line: string, fence: MarkdownFence): boolean {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
  return Boolean(match && match[1][0] === fence.character && match[1].length >= fence.length);
}

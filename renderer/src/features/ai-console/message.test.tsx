import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantContent, ChatMarkdown } from "./message";
import { localFileReference } from "./file-preview-context";
import { parseAssistantContent } from "./artifact-fence";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("ChatMarkdown streaming", () => {
  it("throttles growing Markdown and flushes the final non-streaming text immediately", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<ChatMarkdown text="first" streaming />);

    rerender(<ChatMarkdown text="first second" streaming />);
    expect(container.textContent).toBe("first");

    act(() => vi.advanceTimersByTime(96));
    expect(container.textContent).toBe("first second");

    rerender(<ChatMarkdown text="first second final" streaming={false} />);
    expect(container.textContent).toBe("first second final");
  });

  it("uses bounded plain text for a long live response and restores rich Markdown when final", () => {
    const longMarkdown = `${"streaming content ".repeat(520)}\n\n## Final heading`;
    const { container, rerender } = render(<ChatMarkdown text={longMarkdown} streaming />);

    expect(container.querySelector(".streaming-markdown-plain")?.textContent).toBe(longMarkdown);
    expect(container.querySelector("h2")).toBeNull();

    rerender(<ChatMarkdown text={longMarkdown} streaming={false} />);
    expect(container.querySelector(".streaming-markdown-plain")).toBeNull();
    expect(container.querySelector("h2")?.textContent).toBe("Final heading");
  });
});

describe("ChatMarkdown code blocks", () => {
  it("copies the complete code block from a virtual document fragment", async () => {
    const code = "line of code\n".repeat(700);
    const writeText = vi.fn(async () => {});
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      render(<ChatMarkdown text={`\`\`\`text\n${code}\`\`\``}/>);
      await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "复制" })[1]); });
      expect(writeText).toHaveBeenCalledWith(code);
    } finally {
      if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });
  it("renders the full block without a terminal titlebar or expand control", () => {
    const { container } = render(
      <ChatMarkdown text={'```text\nfirst line\nsecond line\nthird line\n```'} />
    );

    expect(container.querySelector(".markdown-code-titlebar")).toBeNull();
    expect(container.querySelector(".overflow-box")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toContain("third line");
    expect(screen.queryByRole("button", { name: /展开全部/ })).toBeNull();
    expect(screen.getByRole("button", { name: "复制" })).toBeTruthy();
  });
});

describe("ChatMarkdown inline code", () => {
  it("does not turn curl error output into a file-preview button", () => {
    const error = "curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to x.com:443";
    const { container } = render(<ChatMarkdown text={`\`${error}\``} />);

    expect(container.querySelector(".local-file-code")).toBeNull();
    expect(container.querySelector("code")?.textContent).toBe(error);
  });

  it("keeps real local paths clickable", () => {
    const { container } = render(<ChatMarkdown text="`openmind/article/example.md`" />);

    expect(container.querySelector(".local-file-code")?.textContent).toBe("openmind/article/example.md");
  });

  it("treats spaced filenames ending in an extension as file references", () => {
    const { container } = render(<ChatMarkdown text="`Agentic Design Patterns.pdf`" />);

    expect(container.querySelector(".local-file-code")?.textContent).toBe("Agentic Design Patterns.pdf");
  });

  it("keeps plain multi-word inline code non-clickable", () => {
    const { container } = render(<ChatMarkdown text="`hello world`" />);

    expect(container.querySelector(".local-file-code")).toBeNull();
  });

  it("renders angle-bracket markdown links with spaces as file references", () => {
    const { container } = render(<ChatMarkdown text="[Agentic Design Patterns.md](<materials/documents/Agentic Design Patterns.md>)" />);

    const link = container.querySelector("a.local-file-link");
    expect(link?.textContent).toBe("Agentic Design Patterns.md");
    // Markdown 渲染器会把空格编码成 %20；localFileReference 解析时会解码还原。
    expect(link?.getAttribute("href")).toBe("materials/documents/Agentic%20Design%20Patterns.md");
    expect(localFileReference(link?.getAttribute("href") ?? "")).toBe("materials/documents/Agentic Design Patterns.md");
  });
});

describe("AssistantContent artifacts", () => {
  it("renders protocol fences as a separate Markdown artifact card", () => {
    const raw = "开场说明\n\n~~~~openmind-artifact\n# 示例文章\n\n正文内容\n~~~~\n\n结束语";
    const { container } = render(<AssistantContent blocks={parseAssistantContent(raw, "run:event")} />);

    expect(container.textContent).not.toContain("~~~~openmind-artifact");
    expect(container.textContent).not.toContain("~~~~");
    expect(screen.getByText("开场说明").closest(".assistant-artifact")).toBeNull();
    expect(screen.getByText("结束语").closest(".assistant-artifact")).toBeNull();
    const card = screen.getByLabelText("产物 · Markdown：示例文章");
    expect(within(card).getByText("文档")).toBeTruthy();
    expect(within(card).getByText("Markdown")).toBeTruthy();
    expect(within(card).getAllByText("示例文章")).toHaveLength(1);
    expect(within(card).getByText("正文内容")).toBeTruthy();
    expect(within(card).getByText("已完成")).toBeTruthy();
  });

  it("copies only the Markdown body inside one artifact", async () => {
    const writeText = vi.fn(async () => {});
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      const raw = "intro\n~~~~openmind-artifact\n# Copy me\n\nbody\n~~~~\noutro";
      render(<AssistantContent blocks={parseAssistantContent(raw)} />);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "复制正文" })));
      expect(writeText).toHaveBeenCalledWith("# Copy me\n\nbody");
    } finally {
      if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("keeps incomplete artifact content visible with a non-blocking warning", () => {
    render(<AssistantContent blocks={parseAssistantContent("~~~~openmind-artifact\n# Partial\nbody")} />);
    const card = screen.getByLabelText("产物 · Markdown：Partial");
    expect(within(card).getByText("body")).toBeTruthy();
    expect(within(card).getByText("未完整")).toBeTruthy();
    expect(within(card).getByText("产物格式未完整结束，已保留当前正文。")).toBeTruthy();
  });
});

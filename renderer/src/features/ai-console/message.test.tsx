import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMarkdown } from "./message";

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
});

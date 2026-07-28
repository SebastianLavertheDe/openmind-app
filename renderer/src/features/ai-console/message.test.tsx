import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatMarkdown } from "./message";

afterEach(cleanup);

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
    const { container } = render(<ChatMarkdown text="`mymind/article/example.md`" />);

    expect(container.querySelector(".local-file-code")?.textContent).toBe("mymind/article/example.md");
  });
});

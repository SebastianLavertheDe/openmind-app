import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownReader, addCjkLatinSpacing } from "./MarkdownReader";

afterEach(cleanup);

describe("MarkdownReader", () => {
  it("adds spacing between CJK text and Latin words or numbers", () => {
    expect(addCjkLatinSpacing("提取Chrome热门插件，GPT5表现提升20%并支持中文"))
      .toBe("提取 Chrome 热门插件，GPT5 表现提升 20% 并支持中文");
  });

  it("does not rewrite inline code or link labels", () => {
    render(<MarkdownReader content={"正文支持GPT5，`提取Chrome插件`，[访问OpenAI官网](https://openai.com)。"} />);
    expect(screen.getByText("正文支持 GPT5，", { exact: false })).toBeTruthy();
    expect(screen.getByText("提取Chrome插件").tagName).toBe("CODE");
    expect(screen.getByRole("link", { name: "访问OpenAI官网" })).toBeTruthy();
  });

  it("uses the wider file layout only when requested", () => {
    const { container, rerender } = render(<MarkdownReader content="正文" />);
    expect(container.querySelector("article")?.classList.contains("file-reader")).toBe(false);

    rerender(<MarkdownReader content="正文" layout="file" />);
    expect(container.querySelector("article")?.classList.contains("file-reader")).toBe(true);
  });
});

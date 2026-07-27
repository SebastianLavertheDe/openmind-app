import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownReader, addCjkLatinSpacing, normalizeMarkdownTables } from "./MarkdownReader";

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

  it("repairs a malformed generated table delimiter for preview", () => {
    const content = [
      "| 热点 | 传播潜力 | 写作价值 |",
      "|---|---:---:|---:|",
      "| Anthropic | 8 | 9 |"
    ].join("\n");

    expect(normalizeMarkdownTables(content)).toContain("| --- | ---: | ---: |");
    render(<MarkdownReader content={content} layout="file" />);

    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getByText("Anthropic")).toBeTruthy();
  });

  it("does not repair table-like text inside fenced code", () => {
    const content = [
      "```md",
      "| 热点 | 写作价值 |",
      "|---|---:---:|",
      "```"
    ].join("\n");

    expect(normalizeMarkdownTables(content)).toBe(content);
  });
});

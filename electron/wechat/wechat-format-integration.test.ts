import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { renderWechatArticle, WECHAT_THEMES } from "../../shared/wechat-format";
import { sanitizeWechatHtml } from "./wechat-html";

describe("WeChat formatter / clipboard sanitizer boundary", () => {
  it.each(WECHAT_THEMES.map(theme => theme.id))("preserves %s layout, content, and safe image/link attributes", themeId => {
    const article = renderWechatArticle("# 文章标题\n\n## 章节\n\n**强调**、*斜体*和~~删除~~。\n\n> 引用\n\n3. 第三项\n\n| 名称 | 数量 |\n| --- | ---: |\n| 测试 | 1 |\n\n![封面](images/封面%20图.png)\n\n[网站](https://example.com/) 和 [联系](mailto:hello@example.com)\n\n```ts\nconst x = '<safe>';\n```", { themeId });
    const before = new JSDOM(article.html);
    const after = new JSDOM(sanitizeWechatHtml(article.html));
    try {
      const original = Array.from(before.window.document.body.querySelectorAll("*"));
      const sanitized = Array.from(after.window.document.body.querySelectorAll("*"));
      expect(sanitized.map(element => element.tagName)).toEqual(original.map(element => element.tagName));
      expect(sanitized.map(element => element.getAttribute("style"))).toEqual(original.map(element => element.getAttribute("style")));
      expect(after.window.document.body.textContent).toBe(before.window.document.body.textContent);
      expect(after.window.document.querySelector("img")?.getAttribute("src")).toBe("images/封面%20图.png");
      expect(after.window.document.querySelector("ol")?.getAttribute("start")).toBe("3");
      expect(Array.from(after.window.document.querySelectorAll("a")).map(link => link.getAttribute("href")))
        .toEqual(["https://example.com/", "mailto:hello@example.com"]);
    } finally {
      before.window.close();
      after.window.close();
    }
  });
});

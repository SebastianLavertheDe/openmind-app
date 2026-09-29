import { describe, expect, it } from "vitest";
import { renderWechatArticle, WECHAT_THEMES } from "./wechat-format";

const render = (markdown: string) => renderWechatArticle(markdown, { themeId: "pure" });
const documentOf = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("WeChat article formatting", () => {
  it("renders distinct, self-contained layouts with the same content for all registered themes", () => {
    const markdown = "# 标题\n\n## 小标题\n\n一段 **重点**。\n\n> 引用";
    const articles = WECHAT_THEMES.map(theme => renderWechatArticle(markdown, { themeId: theme.id }));
    expect(WECHAT_THEMES.map(theme => theme.id)).toEqual(["pure", "elegant", "magazine", "digest"]);
    expect(new Set(articles.map(article => article.html)).size).toBe(4);
    expect(new Set(articles.map(article => article.text)).size).toBe(1);
    for (const article of articles) {
      const doc = documentOf(article.html);
      expect(doc.querySelector("h1")?.textContent).toBe("标题");
      expect(doc.querySelector("h2")?.getAttribute("style")).toBeTruthy();
      expect(doc.querySelector("style, link, script")).toBeNull();
      expect(article.html).not.toMatch(/var\(|class=/);
    }
  });

  it("preserves GFM formatting, ordered starts, task states, table alignment and code literally", () => {
    const article = render("### 三级标题\n\n**粗体** 与 *斜体*、~~删除~~、`a < b`。\n\n3. 第三项\n4. 第四项\n\n- [x] 完成\n- [ ] 待办\n\n> 引用\n\n| 左 | 右 |\n| :--- | ---: |\n| **甲** | 乙 |\n\n```html\n<img onerror=alert(1)>\n```\n\n---");
    const doc = documentOf(article.html);
    expect(doc.querySelector("strong")?.textContent).toBe("粗体");
    expect(doc.querySelector("em")?.textContent).toBe("斜体");
    expect(doc.querySelector("del")?.textContent).toBe("删除");
    expect(doc.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(doc.querySelector("ul")?.textContent).toContain("☑ 完成");
    expect(doc.querySelectorAll("td")[1].style.textAlign).toBe("right");
    expect(doc.querySelector("pre code")?.textContent).toBe("<img onerror=alert(1)>");
    expect(doc.querySelector("img, input")).toBeNull();
    expect(doc.querySelector("hr")).not.toBeNull();
    expect(article.text).toContain("3. 第三项\n4. 第四项");
    expect(article.text).toContain("甲\t乙");
  });

  it("drops raw HTML, event handlers, scripts and unsafe URL schemes", () => {
    const article = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[点击](javascript:alert%281%29)\n\n![危险](data:image/svg+xml;base64,PHN2Zz4=)\n\n[本地](file:///etc/passwd)');
    const doc = documentOf(article.html);
    expect(doc.querySelector("script, img, a, iframe, object, style")).toBeNull();
    expect(article.html).not.toMatch(/onerror|javascript:|file:|<svg/);
    expect(article.text).toContain("点击");
    expect(article.warnings).toContain("为安全起见，已忽略原始 HTML；请使用 Markdown 格式。");
  });

  it.each(["javascript:alert%281%29", "java%0ascript:alert%281%29", "%6aavascript:alert%281%29", "file:///etc/passwd", "blob:https://example.com/a", "\\\\example.com/secret", "/etc/passwd"])("rejects unsafe image source %s", url => {
    expect(documentOf(render(`![图片](${url})`).html).querySelector("img")).toBeNull();
  });

  it("retains uploadable image sources and escapes image labels and attributes", () => {
    const article = render('![本地](../images/封面%20图.png)\n\n![远程](https://example.com/image.png?x=1&y=2 "图的标题")\n\n![内嵌](data:image/png;base64,iVBORw0KGgo=)\n\n![&quot; onerror=&quot;x](assets/a.png)');
    const images = documentOf(article.html).querySelectorAll("img");
    expect(images).toHaveLength(4);
    expect(images[0].getAttribute("src")).toBe("../images/封面%20图.png");
    expect(images[1].getAttribute("src")).toBe("https://example.com/image.png?x=1&y=2");
    expect(images[1].getAttribute("title")).toBe("图的标题");
    expect(images[2].getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(images[3].hasAttribute("onerror")).toBe(false);
    expect(article.warnings.filter(warning => warning.includes("本地和内嵌图片"))).toHaveLength(1);
    expect(article.warnings.some(warning => warning.includes("无法在当前预览中显示"))).toBe(true);
  });

  it("warns before draft export when an image uses a copy-only format", () => {
    const article = render("![网络动画](https://example.com/a.gif?v=1)\n\n![本地图片](images/a.webp)\n\n![内嵌动画](data:image/gif;base64,R0lGODlhAQABAIAAAA==)");
    expect(documentOf(article.html).querySelectorAll("img")).toHaveLength(3);
    expect(article.warnings.filter(warning => warning.includes("发送草稿仅支持 JPG / PNG"))).toHaveLength(1);
  });

  it("preserves CommonMark angle-bracket image paths containing spaces for upload", () => {
    const article = render("![图片](<../images/cover image.png>)");
    expect(documentOf(article.html).querySelector("img")?.getAttribute("src")).toBe("../images/cover%20image.png");
  });

  it("resolves reference links/images, supports safe external links and retains footnotes", () => {
    const article = render("[官网][site] 和 ![图片][picture]。注释[^note]。\n\n[site]: https://example.com/path?a=1&b=2\n[picture]: images/a.png\n[^note]: 补充 **说明**。");
    const doc = documentOf(article.html);
    expect(doc.querySelector("a")?.getAttribute("href")).toBe("https://example.com/path?a=1&b=2");
    expect(doc.querySelector("img")?.getAttribute("src")).toBe("images/a.png");
    expect(doc.querySelector("sup")?.textContent).toBe("[1]");
    expect(article.text).toContain("1. 补充 说明。");
    expect(article.warnings).toContain("微信可能限制外部链接，请在公众号编辑器中检查链接。");
  });

  it("preserves formulas and Mermaid source with explicit conversion warnings", () => {
    const article = render("行内公式 $x^2$。\n\n$$\nE=mc^2\n$$\n\n```mermaid\ngraph TD\nA-->B\n```");
    const doc = documentOf(article.html);
    expect(doc.body.textContent).toContain("x^2");
    expect(doc.body.textContent).toContain("E=mc^2");
    expect(doc.body.textContent).toContain("A-->B");
    expect(article.warnings.filter(warning => warning.includes("数学公式"))).toHaveLength(1);
    expect(article.warnings.some(warning => warning.includes("Mermaid"))).toBe(true);
  });

  it("only accepts constrained style options and safely falls back for missing themes", () => {
    const malicious = renderWechatArticle("## 标题", { themeId: "__proto__", accentColor: 'red; background:url("https://example.com")', fontSize: Infinity });
    expect(malicious.html).toBe(render("## 标题").html);
    const valid = renderWechatArticle("**文字**", { themeId: "pure", accentColor: "#123abc", fontSize: 100 });
    expect(valid.html).toContain("font-size:24px");
    expect(valid.html).toContain("color:#123abc");
    expect(valid.html).not.toContain("url(");
  });

  it("does not follow credentials in URLs or relative document links", () => {
    const article = render("![图](https://user:password@example.com/a.png)\n\n[私密文件](../private.md)\n\n[邮箱](mailto:hello@example.com)");
    const doc = documentOf(article.html);
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.querySelectorAll("a")).toHaveLength(1);
    expect(doc.querySelector("a")?.getAttribute("href")).toBe("mailto:hello@example.com");
    expect(article.html).not.toContain("password");
  });
});

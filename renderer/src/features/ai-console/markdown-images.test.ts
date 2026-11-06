import { describe, expect, it, vi } from "vitest";
import { MarkdownImageCatalog, markdownImageSources } from "./markdown-images";

describe("Markdown image metadata", () => {
  it("resolves reference images and local paths without treating code or unsafe URLs as pictures", () => {
    const text = [
      "![first](file:///tmp/first%20image.png)", "![second][picture]", "[picture]: //images.example/second.png",
      "`![inline](inline.png)`", "~~~md", "![code](code.png)", "~~~", "![unsafe](javascript:alert)",
      "![data](data:image/png;base64,AAA=)"
    ].join("\n\n");
    expect(markdownImageSources(text)).toEqual([
      { source: "/tmp/first image.png", title: "first" },
      { source: "https://images.example/second.png", title: "second" },
      { source: "data:image/png;base64,AAA=", title: "data" }
    ]);
  });

  it("parses only appended or changed image text and releases removed steps", () => {
    const parse = vi.fn(markdownImageSources);
    const cache = new MarkdownImageCatalog(parse);
    const steps = Array.from({ length: 100 }, (_, index) => ({ key: String(index), text: `![${index}](image-${index}.png)` }));
    for (const step of steps) cache.read(step.key, step.text);
    expect(parse).toHaveBeenCalledTimes(100);
    for (const step of [...steps, { key: "100", text: "![new](new.png)" }]) cache.read(step.key, step.text);
    expect(parse).toHaveBeenCalledTimes(101);
    cache.read("no-image", "a normal process update!");
    expect(parse).toHaveBeenCalledTimes(101);
    cache.read("0", "![changed](changed.png)");
    expect(parse).toHaveBeenCalledTimes(102);
    cache.retain(new Set(["100"]));
    cache.read("0", steps[0].text);
    expect(parse).toHaveBeenCalledTimes(103);
  });
});

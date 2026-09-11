import { afterEach, describe, expect, it } from "vitest";
import { buildReadingDocument } from "./document-model";
import { readingSelectionText, registerReadingDocument } from "./document-selection";

afterEach(() => { window.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });
describe("virtual document selection", () => {
  it("copies every intervening block even when only selection endpoints are mounted", () => {
    const model = buildReadingDocument("first\n\nomitted middle\n\nlast");
    const host = document.createElement("article");
    host.dataset.readingDocument = "";
    document.body.append(host);
    const unregister = registerReadingDocument(host, model);
    const endpoints = [0, 2].map(index => {
      const block = document.createElement("div");
      block.dataset.documentBlock = String(index); block.textContent = model.blocks[index].text;
      host.append(block); return block.firstChild!;
    });
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(endpoints[0], 1, endpoints[1], 3);
    expect(readingSelectionText(selection, host)).toBe("irst\n\nomitted middle\n\nlas");
    selection.setBaseAndExtent(endpoints[1], 3, endpoints[0], 1);
    expect(readingSelectionText(selection, host)).toBe("irst\n\nomitted middle\n\nlas");
    unregister();
    expect(readingSelectionText(selection)).toBeNull();
  });
});

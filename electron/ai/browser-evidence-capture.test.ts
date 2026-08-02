import { afterEach, describe, expect, it } from "vitest";
import {
  buildControlledCaptureCode,
  markCaptureTarget,
  prepareCaptureTarget,
  restoreCaptureTarget
} from "./browser-evidence-capture";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("browser evidence semantic capture", () => {
  it("promotes an author-text match to its semantic comment container", () => {
    document.body.innerHTML = `
      <details role="article" aria-label="Comment from tMeepo 6 hours ago">
        <summary><a id="author">tMeepo</a></summary>
        <p>How do u check tokens used?</p>
      </details>`;

    const author = document.querySelector("#author")!;
    const marked = markCaptureTarget(author, { marker: "comment-target", scope: "comment" });
    const target = document.querySelector('[data-cctools-evidence-target="comment-target"]');

    expect(target).toBe(document.querySelector("details"));
    expect(marked).toMatchObject({ isComment: true, kind: "comment", promoted: true, tag: "details" });
  });

  it("auto-expands a collapsed disclosure without treating ordinary content as site-specific CSS", () => {
    document.body.innerHTML = `
      <details>
        <summary>Release notes</summary>
        <p id="body-copy">A hidden but useful quotation.</p>
      </details>`;

    const body = document.querySelector("#body-copy")!;
    const marked = markCaptureTarget(body, { marker: "auto-target", scope: "auto" });

    expect(document.querySelector('[data-cctools-evidence-target="auto-target"]')).toBe(document.querySelector("details"));
    expect(marked.promoted).toBe(true);
  });

  it("opens a comment, excludes its replies, and restores every temporary DOM change", () => {
    document.body.innerHTML = `
      <shreddit-comment>
        <details role="article" aria-label="Comment from tMeepo 6 hours ago">
          <summary><a id="author">tMeepo</a></summary>
          <div>
            <p>How do u check tokens used?</p>
            <div id="comment-children" style="display: grid">
              <article aria-label="Comment from child">Nested reply</article>
            </div>
          </div>
        </details>
      </shreddit-comment>`;

    const details = document.querySelector("details")!;
    const replies = document.querySelector<HTMLElement>("#comment-children")!;
    const marked = markCaptureTarget(document.querySelector("#author")!, { marker: "capture", scope: "comment" });
    const preparation = prepareCaptureTarget(details, { isComment: marked.isComment, marker: "capture" });

    expect(details.open).toBe(true);
    expect(replies.style.display).toBe("none");

    restoreCaptureTarget(details, {
      marker: "capture",
      preparation,
      previousTargetMarker: marked.previousTargetMarker
    });

    expect(details.open).toBe(false);
    expect(replies.style.display).toBe("grid");
    expect(details.hasAttribute("data-cctools-evidence-target")).toBe(false);
    expect(replies.hasAttribute("data-cctools-evidence-hidden")).toBe(false);
  });

  it("keeps exact and paragraph scopes distinct", () => {
    document.body.innerHTML = `<article><p><span id="quote">Evidence text</span></p></article>`;
    const quote = document.querySelector("#quote")!;

    const exact = markCaptureTarget(quote, { marker: "exact", scope: "exact" });
    expect(document.querySelector('[data-cctools-evidence-target="exact"]')).toBe(quote);
    restoreCaptureTarget(quote, { marker: "exact", preparation: null, previousTargetMarker: exact.previousTargetMarker });

    const paragraph = markCaptureTarget(quote, { marker: "paragraph", scope: "paragraph" });
    expect(document.querySelector('[data-cctools-evidence-target="paragraph"]')).toBe(document.querySelector("p"));
    expect(paragraph.kind).toBe("paragraph");
  });

  it("builds a Playwright program with safely serialized input and completeness checks", () => {
    const code = buildControlledCaptureCode({
      imagePath: "/workspace/evidence.png",
      quote: `A quote with "punctuation"`,
      scope: "component"
    });

    expect(code).toContain('page.getByText(input.quote');
    expect(code).toContain("SOURCE_CONTEXT_INCOMPLETE");
    expect(code).toContain('\\"punctuation\\"');
    expect(code).toContain('"scope":"component"');
    expect(() => new Function(`return (${code})`)).not.toThrow();
  });
});

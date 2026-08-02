export const CAPTURE_SCOPES = ["auto", "exact", "paragraph", "component", "comment", "article"] as const;

export type CaptureScope = typeof CAPTURE_SCOPES[number];

type MarkCaptureTargetInput = {
  marker: string;
  scope: CaptureScope;
};

export type MarkCaptureTargetResult = {
  isComment: boolean;
  kind: CaptureScope;
  previousTargetMarker: string | null;
  promoted: boolean;
  tag: string;
};

type HiddenElementState = {
  display: string;
  marker: string;
  previousMarker: string | null;
};

export type CapturePreparationState = {
  hidden: HiddenElementState[];
  originalOpen: boolean | null;
};

/**
 * Runs in the web page through locator.evaluate(). Keep this function
 * self-contained because buildControlledCaptureCode serializes it with
 * Function#toString().
 */
export function markCaptureTarget(element: Element, input: MarkCaptureTargetInput): MarkCaptureTargetResult {
  const tag = (value: Element) => value.tagName.toLowerCase();
  const attribute = (value: Element, name: string) => (value.getAttribute(name) || "").trim();
  const composedParent = (value: Element): Element | null => {
    if (value.parentElement) return value.parentElement;
    const root = value.getRootNode?.() as ShadowRoot | Document | undefined;
    return root && "host" in root && root.host instanceof Element ? root.host : null;
  };
  const find = (predicate: (value: Element) => boolean): Element | null => {
    let current: Element | null = element;
    for (let depth = 0; current && depth < 24; depth += 1) {
      if (predicate(current)) return current;
      current = composedParent(current);
    }
    return null;
  };
  const isStrongComment = (value: Element) => {
    const valueTag = tag(value);
    const aria = attribute(value, "aria-label");
    const testId = attribute(value, "data-testid");
    const itemProp = attribute(value, "itemprop");
    return valueTag === "shreddit-comment"
      || /^comment\b/i.test(aria)
      || /(?:^|[-_])comment(?:$|[-_])/i.test(testId)
      || /^(?:comment|review)$/i.test(itemProp);
  };
  const isComment = (value: Element) => isStrongComment(value)
    || attribute(value, "role") === "article"
    || tag(value) === "article";
  const isParagraph = (value: Element) => ["p", "blockquote", "pre", "figcaption", "td", "th", "dd"].includes(tag(value));
  const isComponent = (value: Element) => {
    const valueTag = tag(value);
    const role = attribute(value, "role");
    const testId = attribute(value, "data-testid");
    return ["article", "li", "blockquote", "figure", "details"].includes(valueTag)
      || ["article", "listitem", "row"].includes(role)
      || /(?:card|comment|post|review)/i.test(testId);
  };
  const isArticle = (value: Element) => {
    if (isStrongComment(value)) return false;
    const valueTag = tag(value);
    const role = attribute(value, "role");
    return valueTag === "article" || valueTag === "main" || role === "main";
  };
  const isCollapsedDetails = (value: Element) => tag(value) === "details" && !(value as HTMLDetailsElement).open;

  let target: Element = element;
  if (input.scope === "paragraph") {
    target = find(isParagraph) || element;
  } else if (input.scope === "comment") {
    target = find(isComment) || find(isComponent) || element;
  } else if (input.scope === "component") {
    target = find(isComponent) || element;
  } else if (input.scope === "article") {
    target = find(isArticle) || find(isComponent) || element;
  } else if (input.scope === "auto") {
    target = find(isStrongComment) || find(isCollapsedDetails) || element;
  }

  const previousTargetMarker = target.getAttribute("data-cctools-evidence-target");
  target.setAttribute("data-cctools-evidence-target", input.marker);
  const targetIsComment = input.scope === "comment" || isStrongComment(target);
  const targetTag = tag(target);
  const inferredKind: CaptureScope = targetIsComment
    ? "comment"
    : targetTag === "article" || targetTag === "main" || attribute(target, "role") === "main"
      ? "article"
      : isParagraph(target)
        ? "paragraph"
        : target === element
          ? input.scope === "auto" ? "exact" : input.scope
          : "component";

  return {
    isComment: targetIsComment,
    kind: input.scope === "auto" ? inferredKind : input.scope,
    previousTargetMarker,
    promoted: target !== element,
    tag: targetTag
  };
}

/** Runs in the web page; see markCaptureTarget. */
export function prepareCaptureTarget(
  target: Element,
  input: { isComment: boolean; marker: string }
): CapturePreparationState {
  const tag = (value: Element) => value.tagName.toLowerCase();
  const composedParent = (value: Element): Element | null => {
    if (value.parentElement) return value.parentElement;
    const root = value.getRootNode?.() as ShadowRoot | Document | undefined;
    return root && "host" in root && root.host instanceof Element ? root.host : null;
  };
  const ancestorDetails = () => {
    let current: Element | null = target;
    for (let depth = 0; current && depth < 24; depth += 1) {
      if (tag(current) === "details") return current as HTMLDetailsElement;
      current = composedParent(current);
    }
    return null;
  };
  const descendantDetails = tag(target) === "shreddit-comment"
    ? target.querySelector(":scope > details") as HTMLDetailsElement | null
    : null;
  const details = descendantDetails || ancestorDetails();
  const originalOpen = details ? details.open : null;
  if (details) details.open = true;

  const hidden: HiddenElementState[] = [];
  if (input.isComment) {
    const root = details || target;
    const selectors = [
      "#comment-children",
      '[data-testid*="comment-replies" i]',
      '[data-testid*="replies" i]',
      '[aria-label*="replies" i]',
      '[role="group"][aria-label*="reply" i]'
    ].join(", ");
    let candidates = Array.from(root.querySelectorAll(selectors));

    // Some comment systems expose nested comments without a named replies
    // wrapper. Hide only top-level nested comment components in that case.
    if (candidates.length === 0) {
      candidates = Array.from(root.querySelectorAll(
        'shreddit-comment, [aria-label^="Comment from" i], [data-testid*="comment" i][role="article"]'
      ));
    }
    const topLevel = candidates.filter((candidate) =>
      !candidates.some((other) => other !== candidate && other.contains(candidate))
    );
    topLevel.forEach((candidate, index) => {
      if (!(candidate instanceof HTMLElement)) return;
      const hiddenMarker = `${input.marker}-${index}`;
      hidden.push({
        display: candidate.style.display,
        marker: hiddenMarker,
        previousMarker: candidate.getAttribute("data-cctools-evidence-hidden")
      });
      candidate.setAttribute("data-cctools-evidence-hidden", hiddenMarker);
      candidate.style.display = "none";
    });
  }

  return { hidden, originalOpen };
}

/** Runs in the web page; see markCaptureTarget. */
export function restoreCaptureTarget(
  target: Element,
  input: {
    marker: string;
    preparation: CapturePreparationState | null;
    previousTargetMarker: string | null;
  }
): void {
  const tag = (value: Element) => value.tagName.toLowerCase();
  const composedParent = (value: Element): Element | null => {
    if (value.parentElement) return value.parentElement;
    const root = value.getRootNode?.() as ShadowRoot | Document | undefined;
    return root && "host" in root && root.host instanceof Element ? root.host : null;
  };
  const findDetails = () => {
    if (tag(target) === "shreddit-comment") {
      const descendant = target.querySelector(":scope > details") as HTMLDetailsElement | null;
      if (descendant) return descendant;
    }
    let current: Element | null = target;
    for (let depth = 0; current && depth < 24; depth += 1) {
      if (tag(current) === "details") return current as HTMLDetailsElement;
      current = composedParent(current);
    }
    return null;
  };

  for (const state of input.preparation?.hidden || []) {
    const hidden = target.querySelector(`[data-cctools-evidence-hidden="${state.marker}"]`);
    if (!(hidden instanceof HTMLElement)) continue;
    hidden.style.display = state.display;
    if (state.previousMarker === null) hidden.removeAttribute("data-cctools-evidence-hidden");
    else hidden.setAttribute("data-cctools-evidence-hidden", state.previousMarker);
  }
  const details = findDetails();
  if (details && input.preparation?.originalOpen !== null && input.preparation?.originalOpen !== undefined) {
    details.open = input.preparation.originalOpen;
  }
  if (input.previousTargetMarker === null) target.removeAttribute("data-cctools-evidence-target");
  else target.setAttribute("data-cctools-evidence-target", input.previousTargetMarker);
}

export function buildControlledCaptureCode(input: {
  imagePath: string;
  quote: string;
  scope: CaptureScope;
}): string {
  const browserInput = JSON.stringify(input);
  return `async (page) => {
    const input = ${browserInput};
    const markCaptureTarget = ${markCaptureTarget.toString()};
    const prepareCaptureTarget = ${prepareCaptureTarget.toString()};
    const restoreCaptureTarget = ${restoreCaptureTarget.toString()};
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const needle = normalize(input.quote);
    const marker = 'cctools-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => undefined);
    const originalScroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    let target = null;
    let marked = null;
    let preparation = null;
    try {
      const locateBest = async (candidates, limit) => {
        const count = Math.min(await candidates.count(), limit);
        let best = null;
        let bestScore = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < count; index++) {
          const candidate = candidates.nth(index);
          const visibleText = normalize(await candidate.innerText({ timeout: 750 }).catch(() => ''));
          const completeText = normalize(await candidate.textContent({ timeout: 750 }).catch(() => ''));
          if (!visibleText.includes(needle) && !completeText.includes(needle)) continue;
          const basis = visibleText.includes(needle) ? visibleText : completeText;
          const score = (visibleText.includes(needle) ? 1000000 : 0)
            + (basis === needle ? 100000 : 0)
            - basis.length;
          if (score > bestScore) {
            best = candidate;
            bestScore = score;
          }
        }
        return best;
      };

      let best = await locateBest(page.getByText(input.quote, { exact: false }), 1000);
      if (!best) {
        const fallback = page.locator('p, li, blockquote, pre, figcaption, td, th, h1, h2, h3, h4, summary, details, [role="article"], article');
        best = await locateBest(fallback, 5000);
      }
      if (!best) throw new Error('SOURCE_QUOTE_NOT_FOUND');

      marked = await best.evaluate(markCaptureTarget, { marker, scope: input.scope });
      target = page.locator('[data-cctools-evidence-target="' + marker + '"]');
      if (await target.count() !== 1) throw new Error('SOURCE_TARGET_AMBIGUOUS');
      preparation = await target.evaluate(prepareCaptureTarget, { isComment: marked.isComment, marker });
      await target.scrollIntoViewIfNeeded({ timeout: 10000 });
      await page.waitForTimeout(250);

      const capturedText = normalize(await target.innerText({ timeout: 3000 }).catch(() => ''));
      const bounds = await target.boundingBox();
      if (!bounds || bounds.width < 2 || bounds.height < 2) throw new Error('SOURCE_TARGET_NOT_VISIBLE');
      if (!capturedText.includes(needle)) throw new Error('SOURCE_CONTEXT_INCOMPLETE');
      if (marked.isComment && bounds.height < 56) throw new Error('SOURCE_CONTEXT_INCOMPLETE');

      await target.screenshot({
        path: input.imagePath,
        type: 'png',
        scale: 'css',
        animations: 'disabled',
        timeout: 15000
      });
      return {
        url: page.url(),
        title: await page.title(),
        text: capturedText,
        scope: input.scope,
        kind: marked.kind,
        width: Math.round(bounds.width),
        height: Math.round(bounds.height)
      };
    } finally {
      if (target && marked) {
        await target.evaluate(restoreCaptureTarget, {
          marker,
          preparation,
          previousTargetMarker: marked.previousTargetMarker
        }).catch(() => undefined);
      }
      await page.evaluate(({ x, y }) => window.scrollTo(x, y), originalScroll).catch(() => undefined);
    }
  }`;
}

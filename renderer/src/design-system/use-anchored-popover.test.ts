import { describe, expect, it } from "vitest";
import { computeAnchoredPopoverPosition } from "./use-anchored-popover";

const anchor = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height
});

describe("computeAnchoredPopoverPosition", () => {
  it("right-aligns and clamps a flyout inside the viewport", () => {
    const position = computeAnchoredPopoverPosition({
      anchor: anchor(820, 40, 32, 32),
      floating: { width: 320, height: 280 },
      viewportWidth: 850,
      viewportHeight: 600,
      align: "end"
    });

    expect(position.left).toBe(522);
    expect(position.left + 320).toBeLessThanOrEqual(842);
    expect(position.side).toBe("bottom");
  });

  it("flips above the anchor when the bottom space is too small", () => {
    const position = computeAnchoredPopoverPosition({
      anchor: anchor(280, 200, 40, 32),
      floating: { width: 180, height: 150 },
      viewportWidth: 320,
      viewportHeight: 240
    });

    expect(position.side).toBe("top");
    expect(position.left).toBe(132);
    expect(position.top).toBe(44);
  });

  it("caps oversized content to the safe viewport area", () => {
    const position = computeAnchoredPopoverPosition({
      anchor: anchor(10, 100, 80, 30),
      floating: { width: 900, height: 900 },
      viewportWidth: 360,
      viewportHeight: 300,
      viewportPadding: 12
    });

    expect(position.left).toBe(12);
    expect(position.maxWidth).toBe(336);
    expect(position.maxHeight).toBe(152);
  });
});

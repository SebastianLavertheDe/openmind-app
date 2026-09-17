import { afterEach, describe, expect, it } from "vitest";
import { readMotionTokens } from "./motion-tokens";

afterEach(() => document.documentElement.removeAttribute("style"));
describe("CSS motion token adapter", () => {
  it("reads the stylesheet values, including second units and bezier curves", () => {
    document.documentElement.style.cssText = "--dur-normal: .235s; --dur-exit: 175ms; --ease-standard: cubic-bezier(.1, .2, .3, 1); --ease-exit: cubic-bezier(.4, 0, 1, 1)";
    expect(readMotionTokens()).toMatchObject({
      layout: { type: "tween", duration: .235, ease: [.1,.2,.3,1] },
      exit: { type: "tween", duration: .175, ease: [.4,0,1,1] }, exitMs: 175
    });
    document.documentElement.style.setProperty("--dur-normal", "90ms");
    expect(readMotionTokens().layout.duration).toBe(.09);
  });
  it("settles immediately when CSS tokens are absent rather than inventing timings", () => {
    expect(readMotionTokens().layout).toMatchObject({ type: "tween", duration: 0 });
    expect(readMotionTokens().exitMs).toBe(0);
    expect(readMotionTokens().preview.duration).toBe(0);
  });
  it("adapts the existing slow/emphasized tokens for Web Animations in milliseconds", () => {
    document.documentElement.style.cssText = "--dur-slow: .31s; --ease-emphasized: cubic-bezier(.12, .3, .4, 1)";
    expect(readMotionTokens().preview).toEqual({ duration: 310, easing: "cubic-bezier(0.12, 0.3, 0.4, 1)" });
  });
});

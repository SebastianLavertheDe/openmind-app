import type { Transition } from "motion/react";
import { useState } from "react";

/** CSS remains the only timing source. Missing tokens settle immediately (SSR/tests). */
export function readMotionTokens() {
  const styles = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
  const duration = (name: string) => {
    const value = styles?.getPropertyValue(name).trim() || "";
    const match = /^(\d*\.?\d+)(ms|s)$/.exec(value);
    return match ? Number(match[1]) * (match[2] === "ms" ? 1 : 1000) : 0;
  };
  const easing = (name: string): [number, number, number, number] | undefined => {
    const value = styles?.getPropertyValue(name).trim() || "";
    const match = /^cubic-bezier\(([^)]+)\)$/.exec(value);
    const values = match?.[1].split(",").map(Number);
    return values?.length === 4 && values.every(Number.isFinite) ? values as [number, number, number, number] : undefined;
  };
  const exitMs = duration("--dur-exit");
  const layoutEase = easing("--ease-standard");
  const exitEase = easing("--ease-exit");
  const layout: Transition = { type: "tween", duration: layoutEase ? duration("--dur-normal") / 1000 : 0, ease: layoutEase };
  const exit: Transition = { type: "tween", duration: exitEase ? exitMs / 1000 : 0, ease: exitEase };
  const previewEase = easing("--ease-emphasized");
  // Web Animations uses milliseconds and a CSS easing string, unlike Motion.
  const preview = {
    duration: previewEase ? duration("--dur-slow") : 0,
    easing: previewEase ? `cubic-bezier(${previewEase.join(", ")})` : undefined
  };
  return { layout, exit, exitMs, preview };
}

// Read once per mounted surface, never in the animation/measurement loop.
export function useMotionTokens() {
  return useState(readMotionTokens)[0];
}

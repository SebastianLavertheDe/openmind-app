const { PNG } = require("pngjs");

// Pixelmatch ignores anti-aliasing differences; the remaining budget allows only
// minor rasterization noise. Both the runner and its negative tests use this policy.
const PIXEL_THRESHOLD = 0.1;
const MAX_DIFFERENT_RATIO = 0.0002;
const MIN_DIFFERENT_PIXELS = 16;
let pixelmatchModule;

async function comparePng(actualBuffer, expectedBuffer) {
  const actual = PNG.sync.read(actualBuffer);
  const expected = PNG.sync.read(expectedBuffer);
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return {
      matched: false,
      reason: `dimensions changed: ${actual.width}x${actual.height} (expected ${expected.width}x${expected.height})`,
      differentPixels: null,
      allowedPixels: 0,
      difference: null
    };
  }

  const { default: pixelmatch } = await (pixelmatchModule ??= import("pixelmatch"));
  const difference = new PNG({ width: actual.width, height: actual.height });
  const differentPixels = pixelmatch(actual.data, expected.data, difference.data, actual.width, actual.height, {
    threshold: PIXEL_THRESHOLD
  });
  const allowedPixels = Math.max(MIN_DIFFERENT_PIXELS, Math.floor(actual.width * actual.height * MAX_DIFFERENT_RATIO));
  const matched = differentPixels <= allowedPixels;
  return {
    matched,
    reason: matched ? null : `${differentPixels} changed pixels (allowed ${allowedPixels})`,
    differentPixels,
    allowedPixels,
    // Encode only failed comparisons: passing snapshots need no diff artifact.
    difference: matched ? null : PNG.sync.write(difference)
  };
}

module.exports = { comparePng };

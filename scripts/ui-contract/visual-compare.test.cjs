const assert = require("node:assert/strict");
const test = require("node:test");
const { PNG } = require("pngjs");
const { comparePng } = require("./visual-compare.cjs");

function fixture(width = 320, height = 200, paint) {
  const png = new PNG({ width, height });
  png.data.fill(255);
  paint?.(png);
  return PNG.sync.write(png);
}

function rectangle(png, x, y, width, height) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      const offset = (row * png.width + col) * 4;
      png.data[offset] = 0;
      png.data[offset + 1] = 0;
      png.data[offset + 2] = 0;
    }
  }
}

test("identical pixels pass even when PNG encoding differs", async () => {
  const expected = fixture(320, 200, png => rectangle(png, 20, 20, 80, 32));
  const actual = PNG.sync.write(PNG.sync.read(expected), { deflateLevel: 0 });
  assert.notDeepEqual(actual, expected);
  const comparison = await comparePng(actual, expected);
  assert.equal(comparison.matched, true);
  assert.equal(comparison.differentPixels, 0);
  assert.equal(comparison.reason, null);
  assert.equal(comparison.difference, null);
});

test("width and height changes fail even for visually blank screenshots", async () => {
  const expected = fixture();
  for (const [width, height] of [[321, 200], [320, 201], [200, 320]]) {
    const comparison = await comparePng(fixture(width, height), expected);
    assert.equal(comparison.matched, false);
    assert.match(comparison.reason, /dimensions changed/);
    assert.equal(comparison.differentPixels, null);
    assert.equal(comparison.difference, null);
  }
});

test("an inserted control fails and produces a decodable difference image", async () => {
  const expected = fixture();
  const actual = fixture(320, 200, png => rectangle(png, 20, 20, 80, 32));
  const comparison = await comparePng(actual, expected);
  assert.equal(comparison.matched, false);
  assert.ok(comparison.differentPixels > comparison.allowedPixels);
  assert.match(comparison.reason, /changed pixels/);
  const difference = PNG.sync.read(comparison.difference);
  assert.equal(difference.width, 320);
  assert.equal(difference.height, 200);
});

test("a one-pixel layout shift fails rather than passing as rasterization noise", async () => {
  const expected = fixture(1280, 720, png => rectangle(png, 80, 80, 400, 34));
  const actual = fixture(1280, 720, png => rectangle(png, 80, 81, 400, 34));
  const comparison = await comparePng(actual, expected);
  assert.equal(comparison.matched, false);
  assert.ok(comparison.differentPixels > comparison.allowedPixels);
});

test("the small rasterization budget has a hard boundary", async () => {
  const expected = fixture(100, 100);
  const allowed = await comparePng(fixture(100, 100, png => rectangle(png, 10, 10, 4, 4)), expected);
  const exceeded = await comparePng(fixture(100, 100, png => rectangle(png, 10, 10, 4, 5)), expected);
  assert.equal(allowed.differentPixels, 16);
  assert.equal(allowed.matched, true);
  assert.equal(exceeded.differentPixels, 20);
  assert.equal(exceeded.matched, false);
});

test("corrupt PNG input fails explicitly instead of producing a passing result", async () => {
  await assert.rejects(comparePng(Buffer.from("invalid PNG"), fixture()));
  await assert.rejects(comparePng(fixture(), Buffer.from("invalid PNG")));
});

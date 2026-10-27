import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { ImageCompositionSchema } from "./image-composition";

const image = path.join(os.tmpdir(), "image.png");
const fit = { kind: "fit", image, width: 2350, height: 1000 };
describe("Local image composition input", () => {
  it("preserves the full image unless the caller explicitly requests cropping", () => {
    expect(ImageCompositionSchema.parse(fit)).toMatchObject({ fit: "contain", width: 2350, height: 1000 });
  });
  it.each([
    { ...fit, image: "https://example.com/image.png" }, { ...fit, image: "../outside.png" },
    { ...fit, width: 0 }, { ...fit, height: 5000 }, { ...fit, width: 100.5 },
    { ...fit, background: "red; background:url(https://example.com)" }, { ...fit, script: "alert(1)" },
    { kind: "diptych", original: image, illustration: image, width: 64, height: 64, gap: 32 }
  ])("rejects unsafe or unusable composition requests: %j", input => {
    expect(ImageCompositionSchema.safeParse(input).success).toBe(false);
  });
});

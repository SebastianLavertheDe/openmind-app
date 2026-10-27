import fs from "node:fs";
import { BrowserWindow } from "electron";
import type { ImageComposition } from "../../shared/image-composition";
import { IMAGE_MAX_BYTES } from "../../shared/image-generation";

export function readCompositionImage(file: string): string {
  const fd = fs.openSync(file, "r");
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > IMAGE_MAX_BYTES) throw new Error("Expected an image of at most 20 MB");
    const bytes = fs.readFileSync(fd);
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
      : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
    if (!mime) throw new Error("Expected PNG, JPEG or WebP image data");
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } finally { fs.closeSync(fd); }
}

/** Exact pixel dimensions and deterministic composition; never runs an AI model. */
export async function composeImage(job: ImageComposition): Promise<Buffer> {
  const images = (job.kind === "fit" ? [job.image] : [job.original, job.illustration]).map(readCompositionImage);
  const window = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: {
    sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, partition: `image-compose-${Date.now()}`
  } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const render = async () => {
      await window.loadURL(`data:text/html,${encodeURIComponent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:">')}`);
      // Only validated JSON and image bytes cross into the sandboxed page.
      const encoded = await window.webContents.executeJavaScript(`(async () => {
        const job = ${JSON.stringify(job)}, sources = ${JSON.stringify(images)};
        const images = await Promise.all(sources.map(src => new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => image.naturalWidth * image.naturalHeight > 100000000
            ? reject(new Error("Image dimensions are too large")) : resolve(image);
          image.onerror = () => reject(new Error("Image could not be decoded"));
          image.src = src;
        })));
        const canvas = document.createElement("canvas"); canvas.width = job.width; canvas.height = job.height;
        const context = canvas.getContext("2d"); context.fillStyle = job.background; context.fillRect(0, 0, job.width, job.height);
        const draw = (image, x, y, width, height, fit) => {
          const scale = (fit === "cover" ? Math.max : Math.min)(width / image.naturalWidth, height / image.naturalHeight);
          const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
          context.save(); context.beginPath(); context.rect(x, y, width, height); context.clip();
          context.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h); context.restore();
        };
        if (job.kind === "fit") draw(images[0], 0, 0, job.width, job.height, job.fit);
        else if (job.direction === "horizontal") {
          const width = (job.width - job.gap) / 2;
          draw(images[0], 0, 0, width, job.height, "contain"); draw(images[1], width + job.gap, 0, width, job.height, "contain");
        } else {
          const height = (job.height - job.gap) / 2;
          draw(images[0], 0, 0, job.width, height, "contain"); draw(images[1], 0, height + job.gap, job.width, height, "contain");
        }
        return canvas.toDataURL("image/png");
      })()`) as string;
      if (!encoded.startsWith("data:image/png;base64,")) throw new Error("Image composition did not return PNG data");
      return Buffer.from(encoded.slice("data:image/png;base64,".length), "base64");
    };
    return await Promise.race([render(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Image composition timed out")), 30_000); })]);
  } finally {
    clearTimeout(timer);
    if (!window.isDestroyed()) window.destroy();
  }
}

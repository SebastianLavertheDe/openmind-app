import { BrowserWindow } from "electron";
import { SKILL_AVATAR_SIZE } from "../../shared/skill-contributor";

/** Chromium decodes WebP on every platform; nativeImage only guarantees PNG/JPEG. */
export async function decodeWebpAvatar(bytes: Buffer): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false, width: SKILL_AVATAR_SIZE, height: SKILL_AVATAR_SIZE,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: "skill-avatar-decoder" }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const decode = async () => {
      await window.loadURL(`data:text/html,${encodeURIComponent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:">')}`);
      const dataUrl = `data:image/webp;base64,${bytes.toString("base64")}`;
      const png = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const image = new Image();
        image.onerror = () => reject(new Error("Invalid WebP image"));
        image.onload = () => {
          try {
            const width = image.naturalWidth, height = image.naturalHeight;
            if (!width || !height) throw new Error("Empty WebP image");
            const side = Math.min(width, height);
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = ${SKILL_AVATAR_SIZE};
            const context = canvas.getContext("2d");
            context.drawImage(image, Math.floor((width - side) / 2), Math.floor((height - side) / 2), side, side, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/png"));
          } catch (cause) { reject(cause); }
        };
        image.src = ${JSON.stringify(dataUrl)};
      })`) as string;
      if (!png.startsWith("data:image/png;base64,")) throw new Error("Invalid decoded avatar");
      return Buffer.from(png.slice("data:image/png;base64,".length), "base64");
    };
    return await Promise.race([decode(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Avatar decoding timed out")), 10_000); })]);
  } finally {
    clearTimeout(timer);
    if (!window.isDestroyed()) window.destroy();
  }
}

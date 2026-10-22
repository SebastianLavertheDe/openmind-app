import { describe, expect, it, vi } from "vitest";
import { createYoutubeHostDetector } from "./youtube-browser";

describe("YouTube browser detection", () => {
  it("detects Linux browsers and tools using injected installation paths only", () => {
    const paths = new Set(["/usr/bin/google-chrome", "/snap/bin/firefox", "/home/fixture/.local/bin/yt-dlp", "/usr/bin/ffmpeg", "/usr/bin/node"]);
    const probe = vi.fn((file: string) => paths.has(file));
    const detector = createYoutubeHostDetector({ platform: "linux", home: "/home/fixture", env: { PATH: "/usr/bin:/snap/bin" }, isExecutable: probe });
    expect(detector.status()).toEqual({ browsers: [{ id: "chrome", name: "Google Chrome" }, { id: "firefox", name: "Firefox" }], downloaderAvailable: true, ffmpegAvailable: true, javascriptRuntimeAvailable: true });
    expect(probe.mock.calls.every(([file]) => !/cookies|profile/i.test(file))).toBe(true);
    paths.delete("/usr/bin/google-chrome");
    expect(detector.browsers().map(item => item.id)).toEqual(["firefox"]);
  });

  it("detects system and per-user macOS app bundles", () => {
    const detector = createYoutubeHostDetector({ platform: "darwin", home: "/Users/fixture", env: {}, isExecutable: file => [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Users/fixture/Applications/Firefox.app/Contents/MacOS/firefox",
      "/System/Applications/Safari.app/Contents/MacOS/Safari"
    ].includes(file) });
    expect(detector.browsers().map(item => item.id)).toEqual(["chrome", "firefox", "safari"]);
  });

  it("detects Windows installs using Windows path semantics, including paths with spaces", () => {
    const files = new Set(["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Users\\Fixture\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\tools\\yt-dlp.exe"]);
    const detector = createYoutubeHostDetector({ platform: "win32", home: "C:\\Users\\Fixture", env: { PROGRAMFILES: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\Fixture\\AppData\\Local", PATH: "C:\\tools" }, isExecutable: file => files.has(file) });
    expect(detector.status()).toMatchObject({ browsers: [{ id: "chrome" }, { id: "edge" }], downloaderAvailable: true, ffmpegAvailable: false, javascriptRuntimeAvailable: false });
  });

  it("returns no browser on unsupported hosts and ignores relative PATH entries", () => {
    const probe = vi.fn(() => false);
    expect(createYoutubeHostDetector({ platform: "freebsd", home: "/fixture", env: { PATH: ".:relative:" }, isExecutable: probe }).browsers()).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
  });
});

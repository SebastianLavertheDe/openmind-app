import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { YOUTUBE_COOKIE_BROWSERS, type YoutubeBrowser, type YoutubeImportStatus } from "../../shared/youtube-import";

type DetectionOptions = {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
  isExecutable?: (file: string) => boolean;
};

const BROWSERS: Record<YoutubeBrowser, { name: string; commands: string[]; mac: string; windows?: string }> = {
  chrome: { name: "Google Chrome", commands: ["google-chrome", "google-chrome-stable"], mac: "Google Chrome", windows: "Google/Chrome/Application/chrome.exe" },
  chromium: { name: "Chromium", commands: ["chromium", "chromium-browser"], mac: "Chromium", windows: "Chromium/Application/chrome.exe" },
  edge: { name: "Microsoft Edge", commands: ["microsoft-edge", "microsoft-edge-stable"], mac: "Microsoft Edge", windows: "Microsoft/Edge/Application/msedge.exe" },
  brave: { name: "Brave", commands: ["brave-browser", "brave-browser-stable"], mac: "Brave Browser", windows: "BraveSoftware/Brave-Browser/Application/brave.exe" },
  firefox: { name: "Firefox", commands: ["firefox"], mac: "Firefox", windows: "Mozilla Firefox/firefox.exe" },
  opera: { name: "Opera", commands: ["opera"], mac: "Opera", windows: "Programs/Opera/launcher.exe" },
  vivaldi: { name: "Vivaldi", commands: ["vivaldi", "vivaldi-stable"], mac: "Vivaldi", windows: "Vivaldi/Application/vivaldi.exe" },
  safari: { name: "Safari", commands: [], mac: "Safari" }
};

/** Inspect installation locations only. Never open a browser profile or cookie database. */
export function createYoutubeHostDetector(options: DetectionOptions = {}) {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const env = options.env ?? process.env;
  const paths = platform === "win32" ? path.win32 : path.posix;
  const isExecutable = options.isExecutable ?? ((file: string) => {
    try {
      fs.accessSync(file, platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
      return fs.statSync(file).isFile();
    } catch { return false; }
  });
  const searchDirs = [
    ...(env.PATH || env.Path || "").split(platform === "win32" ? ";" : ":"),
    ...(platform === "win32" ? [paths.join(home, "AppData/Local/Microsoft/WinGet/Links")]
      : ["/usr/local/bin", "/usr/bin", "/opt/homebrew/bin", "/snap/bin", paths.join(home, ".local/bin"), paths.join(home, ".deno/bin")])
  ].filter(directory => paths.isAbsolute(directory));
  const findTool = (name: string): string | undefined => searchDirs
    .map(directory => paths.join(directory, platform === "win32" ? `${name}.exe` : name)).find(isExecutable);
  const browsers = (): YoutubeImportStatus["browsers"] => YOUTUBE_COOKIE_BROWSERS.filter(id => {
    const browser = BROWSERS[id];
    const candidates: string[] = [];
    if (platform === "darwin") {
      const binary = id === "firefox" ? "firefox" : browser.mac;
      for (const applications of ["/Applications", paths.join(home, "Applications"), "/System/Applications"]) {
        candidates.push(paths.join(applications, `${browser.mac}.app`, "Contents/MacOS", binary));
      }
    } else if (platform === "win32" && browser.windows) {
      for (const root of [env.PROGRAMFILES, env["ProgramFiles(x86)"], env.LOCALAPPDATA]) {
        if (root && paths.isAbsolute(root)) candidates.push(paths.join(root, browser.windows));
      }
    } else if (platform === "linux") {
      for (const command of browser.commands) for (const directory of searchDirs) candidates.push(paths.join(directory, command));
    }
    return candidates.some(isExecutable);
  }).map(id => ({ id, name: BROWSERS[id].name }));
  return {
    findTool,
    browsers,
    status: (): Omit<YoutubeImportStatus, "tools"> => ({
      browsers: browsers(),
      downloaderAvailable: Boolean(findTool("yt-dlp")),
      ffmpegAvailable: Boolean(findTool("ffmpeg")),
      javascriptRuntimeAvailable: Boolean(findTool("deno") || findTool("node"))
    })
  };
}

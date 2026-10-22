import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserPreferencesSchema } from "@shared/contracts";
import { setLocale } from "@shared/messages";
import { YOUTUBE_TOOLS, type YoutubeImportStatus, type YoutubeToolId, type YoutubeToolStatus } from "@shared/youtube-import";
import { YoutubeImportSettingsSection } from "./settings-sections";

const toolStatus = (id: YoutubeToolId, overrides: Partial<YoutubeToolStatus> = {}): YoutubeToolStatus => ({ id, state: "ready", version: "24.8.0", source: "system", canInstall: true, operation: "idle", update: "unchecked", latestVersion: null, ...overrides });
const ready: YoutubeImportStatus = { browsers: [{ id: "chrome", name: "Google Chrome" }, { id: "firefox", name: "Firefox" }], downloaderAvailable: true, ffmpegAvailable: true, javascriptRuntimeAvailable: true, tools: YOUTUBE_TOOLS.map(id => toolStatus(id)) };
const withTool = (tool: YoutubeToolStatus): YoutubeImportStatus => ({ ...ready, tools: ready.tools.map(value => value.id === tool.id ? tool : value) });
afterEach(() => { setLocale("zh-CN"); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("YouTube import browser settings", () => {
  it("shows anonymous Bilibili fetching without a browser selector even with a saved legacy choice", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    window.openmind = { getYoutubeImportStatus: vi.fn().mockResolvedValue(ready) } as never;
    const prefs = UserPreferencesSchema.parse({ youtubeBrowser: "chrome", bilibiliBrowser: "firefox" });
    expect(prefs).not.toHaveProperty("bilibiliBrowser");
    render(<YoutubeImportSettingsSection prefs={prefs} save={save} />);
    await screen.findByText("已检测到下载工具");
    expect(screen.getByText("Bilibili 视频内嵌播放，字幕始终匿名获取，不读取浏览器登录状态。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Bilibili.*下拉菜单/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^YouTube 登录浏览器/ }).textContent).toContain("Google Chrome");
    expect(save).not.toHaveBeenCalled();
  });

  it("detects installed browsers without selecting one and saves only an explicit choice", async () => {
    const detect = vi.fn().mockResolvedValue(ready);
    const save = vi.fn().mockResolvedValue(undefined);
    window.openmind = { getYoutubeImportStatus: detect } as never;
    render(<YoutubeImportSettingsSection prefs={UserPreferencesSchema.parse({})} save={save} />);
    await screen.findByText("已检测到下载工具");
    expect(detect).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^YouTube 登录浏览器.*下拉菜单/ }));
    fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Firefox" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ youtubeBrowser: "firefox" }));
  });

  it("refreshes the list and reports an unavailable saved browser without switching accounts", async () => {
    const detect = vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce({ ...ready, browsers: [{ id: "firefox", name: "Firefox" }] });
    const save = vi.fn().mockResolvedValue(undefined);
    window.openmind = { getYoutubeImportStatus: detect } as never;
    render(<YoutubeImportSettingsSection prefs={UserPreferencesSchema.parse({ youtubeBrowser: "chrome" })} save={save} />);
    await screen.findByText("已检测到下载工具");
    fireEvent.click(screen.getByRole("button", { name: "重新检测" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("所选浏览器已不可用"));
    expect(save).not.toHaveBeenCalled();
  });

  it("shows empty detection and missing-tool states in English", async () => {
    setLocale("en");
    window.openmind = { getYoutubeImportStatus: vi.fn().mockResolvedValue({ browsers: [], downloaderAvailable: false, ffmpegAvailable: false, javascriptRuntimeAvailable: false, tools: YOUTUBE_TOOLS.map(id => toolStatus(id, { state: "missing", source: null, version: null })) }) } as never;
    render(<YoutubeImportSettingsSection prefs={UserPreferencesSchema.parse({})} save={vi.fn()} />);
    await screen.findByText("No supported browsers found. Install a browser, sign in, and scan again.");
    expect(screen.getByText("Download tools are missing")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Install Deno" })).toBeTruthy();
    expect(screen.getByText(/Only one JavaScript runtime is needed/)).toBeTruthy();
    expect(screen.getByText(/Captions are always fetched anonymously without reading browser sign-in data/)).toBeTruthy();
  });

  it("recovers from a detection error using refresh", async () => {
    window.openmind = { getYoutubeImportStatus: vi.fn().mockRejectedValueOnce(new Error("fixture failure")).mockResolvedValueOnce(ready) } as never;
    render(<YoutubeImportSettingsSection prefs={UserPreferencesSchema.parse({})} save={vi.fn()} />);
    await screen.findByText("无法检测本地浏览器和下载工具，请重试。");
    fireEvent.click(screen.getByRole("button", { name: "重新检测" }));
    await screen.findByText("已检测到下载工具");
    expect(screen.queryByText("无法检测本地浏览器和下载工具，请重试。")).toBeNull();
  });
});

describe("YouTube dependency controls", () => {
  it("installs a missing tool only after a click, prevents duplicate actions, and refreshes readiness", async () => {
    const missing = { ...withTool(toolStatus("yt-dlp", { state: "missing", version: null, source: null })), downloaderAvailable: false };
    let resolve!: (status: YoutubeToolStatus) => void;
    const install = vi.fn(() => new Promise<YoutubeToolStatus>(done => { resolve = done; }));
    const detect = vi.fn().mockResolvedValueOnce(missing).mockResolvedValue(ready);
    const check = vi.fn();
    window.openmind = { getYoutubeImportStatus: detect, installYoutubeTool: install, checkYoutubeToolUpdate: check } as never;
    render(<YoutubeImportSettingsSection prefs={UserPreferencesSchema.parse({})} save={vi.fn()} />);
    const button = await screen.findByRole("button", { name: "安装 yt-dlp" });
    expect(install).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(install).toHaveBeenCalledExactlyOnceWith("yt-dlp");
    expect((screen.getByRole("button", { name: "检查更新 FFmpeg" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("安装中…")).toBeTruthy();
    await act(async () => { resolve(toolStatus("yt-dlp", { source: "app" })); });
    await screen.findByText("已检测到下载工具");
    expect(detect).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "安装 yt-dlp" })).toBeNull();
  });

  it("checks updates and offers an upgrade with installed and available versions", async () => {
    const status = withTool(toolStatus("node", { version: "22.12.0" }));
    const check = vi.fn().mockResolvedValue(toolStatus("node", { version: "22.12.0", latestVersion: "24.8.0", update: "available" }));
    window.openmind = { getYoutubeImportStatus: vi.fn().mockResolvedValue(status), checkYoutubeToolUpdate: check } as never;
    render(<YoutubeImportSettingsSection prefs={UserPreferencesSchema.parse({})} save={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "检查更新 Node.js" }));
    await screen.findByRole("button", { name: "升级 Node.js" });
    expect(check).toHaveBeenCalledExactlyOnceWith("node");
    expect(screen.getByText("22.12.0 · 系统安装")).toBeTruthy();
    expect(screen.getByText("可安装版本：24.8.0")).toBeTruthy();
  });

  it("offers an upgrade for an unsupported runtime version even before checking updates", async () => {
    window.openmind = { getYoutubeImportStatus: vi.fn().mockResolvedValue(withTool(toolStatus("deno", { version: "2.2.0", state: "too-old" }))) } as never;
    render(<YoutubeImportSettingsSection prefs={UserPreferencesSchema.parse({})} save={vi.fn()} />);
    await screen.findByRole("button", { name: "升级 Deno" });
    expect(screen.getByText("版本过低")).toBeTruthy();
    expect(screen.getByText("已检测到下载工具")).toBeTruthy(); // Node still satisfies the runtime requirement.
  });

  it("updates overall readiness when a version check discovers a broken component", async () => {
    window.openmind = { getYoutubeImportStatus: vi.fn().mockResolvedValue(ready), checkYoutubeToolUpdate: vi.fn().mockResolvedValue(toolStatus("yt-dlp", { state: "broken", version: null, update: "available" })) } as never;
    render(<YoutubeImportSettingsSection prefs={UserPreferencesSchema.parse({})} save={vi.fn()} />);
    await screen.findByText("已检测到下载工具");
    fireEvent.click(screen.getByRole("button", { name: "检查更新 yt-dlp" }));
    await screen.findByRole("button", { name: "重新安装 yt-dlp" });
    expect(screen.getByText("下载工具不完整")).toBeTruthy();
    expect(screen.queryByText("已检测到下载工具")).toBeNull();
  });

  it("clears a stale current-version claim when checking fails and allows retry", async () => {
    const current = toolStatus("yt-dlp", { version: "2026.10.21", update: "current", latestVersion: "2026.10.21" });
    const check = vi.fn().mockRejectedValueOnce(new Error("private network error details")).mockResolvedValue(current);
    window.openmind = { getYoutubeImportStatus: vi.fn().mockResolvedValue(withTool(current)), checkYoutubeToolUpdate: check } as never;
    render(<YoutubeImportSettingsSection prefs={UserPreferencesSchema.parse({})} save={vi.fn()} />);
    const button = await screen.findByRole("button", { name: "检查更新 yt-dlp" });
    fireEvent.click(button);
    await screen.findByRole("alert");
    expect(screen.queryByText(/当前可用版本已是最新/)).toBeNull();
    expect(screen.queryByText(/private network/)).toBeNull();
    fireEvent.click(button);
    await screen.findByText(/当前可用版本已是最新/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the installed version visible after an upgrade fails", async () => {
    const current = toolStatus("yt-dlp", { version: "2026.10.20", source: "app", update: "available", latestVersion: "2026.10.21" });
    const install = vi.fn().mockRejectedValue(new Error("checksum-mismatch"));
    window.openmind = { getYoutubeImportStatus: vi.fn().mockResolvedValue(withTool(current)), installYoutubeTool: install } as never;
    render(<YoutubeImportSettingsSection prefs={UserPreferencesSchema.parse({})} save={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "升级 yt-dlp" }));
    expect((await screen.findByRole("alert")).textContent).toContain("原有版本已保留");
    await waitFor(() => expect((screen.getByRole("button", { name: "升级 yt-dlp" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText("2026.10.20 · 应用安装")).toBeTruthy();
  });

  it("explains an incomparable FFmpeg build without claiming it is up to date", async () => {
    const check = vi.fn().mockResolvedValue(toolStatus("ffmpeg", { update: "unknown", latestVersion: "b6.1.1" }));
    window.openmind = { getYoutubeImportStatus: vi.fn().mockResolvedValue(ready), checkYoutubeToolUpdate: check } as never;
    render(<YoutubeImportSettingsSection prefs={UserPreferencesSchema.parse({})} save={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "检查更新 FFmpeg" }));
    await screen.findByText("可安装构建：b6.1.1");
    expect(screen.getByRole("button", { name: "安装应用版本 FFmpeg" })).toBeTruthy();
    expect(screen.queryByText(/当前可用版本已是最新/)).toBeNull();
  });

  it("provides installation instructions instead of a nonfunctional button on unsupported platforms", async () => {
    const open = vi.fn();
    window.openmind = { getYoutubeImportStatus: vi.fn().mockResolvedValue(withTool(toolStatus("ffmpeg", { state: "missing", canInstall: false }))), openExternal: open } as never;
    render(<YoutubeImportSettingsSection prefs={UserPreferencesSchema.parse({})} save={vi.fn()} />);
    const row = within(await screen.findByRole("group", { name: "FFmpeg" }));
    expect(row.queryByRole("button", { name: "安装 FFmpeg" })).toBeNull();
    fireEvent.click(row.getByRole("button", { name: "安装说明" }));
    expect(open).toHaveBeenCalledExactlyOnceWith("https://ffmpeg.org/download.html");
  });

  it("recovers an in-progress install after returning to the settings page", async () => {
    vi.useFakeTimers();
    const detect = vi.fn().mockResolvedValueOnce(withTool(toolStatus("node", { operation: "installing" }))).mockResolvedValue(ready);
    window.openmind = { getYoutubeImportStatus: detect } as never;
    await act(async () => { render(<YoutubeImportSettingsSection prefs={UserPreferencesSchema.parse({})} save={vi.fn()} />); });
    expect(screen.getByText("安装中…")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(detect).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("安装中…")).toBeNull();
  });
});

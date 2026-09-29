import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { WechatExportDialog } from "./WechatExportDialog";

const props = { open: true, projectName: "测试项目", outputPath: "outputs/report.md", title: "项目报告", markdown: "## 概览\n\n这是一份**报告**。\n\n- 第一点\n- 第二点", onClose: vi.fn() };
const configured = { appId: "wx1234567890123456", author: "测试作者", configured: true };
const cover = { path: "/tmp/cover.png", name: "cover.png", previewUrl: "data:image/png;base64,AA==" };

beforeEach(() => {
  vi.clearAllMocks();
  window.openmind = {
    getWechatAccount: vi.fn(async () => configured),
    copyWechatArticle: vi.fn(async () => undefined),
    chooseWechatCover: vi.fn(async () => cover),
    pushWechatDraft: vi.fn(async () => ({ mediaId: "draft-1" })),
    openExternal: vi.fn(async () => true)
  } as unknown as DesktopApi;
});

describe("WechatExportDialog", () => {
  it("previews all four themes and copies styled HTML with a plain text fallback", async () => {
    render(<WechatExportDialog {...props} />);
    const preview = screen.getByTitle("微信公众号排版预览");
    expect(preview.getAttribute("sandbox")).toBe("");
    expect(preview.getAttribute("srcdoc")).toContain("概览");
    for (const name of ["归真", "雅致", "杂志", "简报"]) expect(screen.getByRole("button", { name: new RegExp(`^${name}`) })).toBeTruthy();
    const before = preview.getAttribute("srcdoc");
    fireEvent.click(screen.getByRole("button", { name: /^杂志/ }));
    expect(preview.getAttribute("srcdoc")).not.toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "复制排版" }));
    await screen.findByText("已复制公众号排版，可粘贴到公众号编辑器。");
    expect(window.openmind.copyWechatArticle).toHaveBeenCalledWith({ html: expect.stringContaining("<strong style="), text: expect.stringContaining("报告") });
    expect(window.openmind.pushWechatDraft).not.toHaveBeenCalled();
  });

  it("allows copy without a configured account, while draft export asks for configuration", async () => {
    vi.mocked(window.openmind.getWechatAccount).mockResolvedValue({ appId: "", author: "", configured: false });
    render(<WechatExportDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "复制排版" }));
    await screen.findByText("已复制公众号排版，可粘贴到公众号编辑器。");
    fireEvent.click(screen.getByRole("button", { name: "发送到草稿箱" }));
    await screen.findByLabelText("AppID");
    expect((screen.getByRole("button", { name: "发送到草稿箱" }) as HTMLButtonElement).disabled).toBe(true);
    expect(window.openmind.pushWechatDraft).not.toHaveBeenCalled();
  });

  it("requires a cover, then sends the preview with edited metadata and prevents duplicate sends", async () => {
    render(<WechatExportDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "发送到草稿箱" }));
    await screen.findByText(configured.appId);
    fireEvent.click(screen.getByRole("button", { name: "发送到草稿箱" }));
    await screen.findByText("请选择文章封面后再发送。");
    expect(window.openmind.pushWechatDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "选择 JPG / PNG 图片" }));
    await screen.findByAltText("文章封面");
    fireEvent.change(screen.getByLabelText("文章标题"), { target: { value: "最终报告" } });
    fireEvent.change(screen.getByLabelText("摘要（选填）"), { target: { value: "测试摘要" } });
    fireEvent.click(screen.getByRole("button", { name: "发送到草稿箱" }));
    await screen.findByText("已发送到微信公众号草稿箱，请到公众号后台检查排版。");
    expect(window.openmind.pushWechatDraft).toHaveBeenCalledWith({ projectName: "测试项目", outputPath: "outputs/report.md", title: "最终报告", html: expect.stringContaining("概览"), author: "测试作者", digest: "测试摘要", coverPath: cover.path });
    expect((screen.getByRole("button", { name: "已发送到草稿箱" }) as HTMLButtonElement).disabled).toBe(true);
    expect(window.openmind.pushWechatDraft).toHaveBeenCalledTimes(1);
  });

  it("keeps failures visible and does not report a draft as sent", async () => {
    vi.mocked(window.openmind.pushWechatDraft).mockRejectedValue(new Error("微信 IP 白名单未配置。"));
    render(<WechatExportDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "发送到草稿箱" }));
    await screen.findByText(configured.appId);
    fireEvent.click(screen.getByRole("button", { name: "选择 JPG / PNG 图片" }));
    await screen.findByAltText("文章封面");
    fireEvent.click(screen.getByRole("button", { name: "发送到草稿箱" }));
    await screen.findByText("微信 IP 白名单未配置。");
    expect(screen.queryByRole("button", { name: "已发送到草稿箱" })).toBeNull();
    expect((screen.getByRole("button", { name: "发送到草稿箱" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the dialog open and locks controls while a draft is being sent", async () => {
    let resolve!: (value: { mediaId: string }) => void;
    vi.mocked(window.openmind.pushWechatDraft).mockReturnValue(new Promise(done => { resolve = done; }));
    render(<WechatExportDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "发送到草稿箱" }));
    await screen.findByText(configured.appId);
    fireEvent.click(screen.getByRole("button", { name: "选择 JPG / PNG 图片" }));
    await screen.findByAltText("文章封面");
    fireEvent.click(screen.getByRole("button", { name: "发送到草稿箱" }));
    await screen.findByRole("button", { name: "正在发送…" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "复制排版" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve({ mediaId: "ok" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "关闭公众号导出" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("reports clipboard failures and disables export for an empty document", async () => {
    vi.mocked(window.openmind.copyWechatArticle).mockRejectedValue(new Error("剪贴板不可用"));
    const view = render(<WechatExportDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "复制排版" }));
    await screen.findByText("剪贴板不可用");
    view.rerender(<WechatExportDialog {...props} markdown="  " />);
    expect((screen.getByRole("button", { name: "复制排版" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "发送到草稿箱" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

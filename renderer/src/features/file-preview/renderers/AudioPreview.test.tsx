import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { localMediaUrl } from "@shared/media-preview";
import { AudioPreview } from "./AudioPreview";

describe("AudioPreview", () => {
  const resource = { kind: "audio" as const, id: "sound", path: "sound.wav", title: "Sound", mediaUrl: localMediaUrl({ path: "sound.wav" }) };
  it("uses native playback and offers an external player on codec failure", () => {
    const open = vi.fn(); const view = render(<AudioPreview resource={resource} onOpenExternal={open} />);
    const audio = view.container.querySelector("audio")!;
    expect(audio.controls).toBe(true); expect(audio.preload).toBe("metadata"); expect(audio.getAttribute("src")).toBe(resource.mediaUrl);
    fireEvent.error(audio); fireEvent.click(screen.getByRole("button", { name: "使用本机播放器打开" })); expect(open).toHaveBeenCalledOnce();
  });
  it.each(["https://example.com/sound.wav", "file:///sound.wav", localMediaUrl({ path: "clip.mp4" })])("rejects invalid audio source %s", mediaUrl => {
    const view = render(<AudioPreview resource={{ ...resource, mediaUrl }} />); expect(view.container.querySelector("audio")).toBeNull();
  });
});

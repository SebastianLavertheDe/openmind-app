import { useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AiSnapshot, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../ai-context";
import { ContextTray } from "../features/ai-console/composer";
import { ComposerModelPicker } from "../features/ai-console/ComposerModelPicker";
import { ArtifactMessageBlock } from "../features/ai-console/ArtifactMessageBlock";
import { Dialog } from "./Dialog";
import { CopyButton } from "./CopyButton";
import { Tabs, SegmentedControl } from "./controls";
import { useClipboard } from "./use-clipboard";
import { usePointerResize } from "./use-pointer-resize";

const snapshot: AiSnapshot = { projectRoot: "/fixture", providers: [], sessions: [], runs: [], pendingApprovals: [] };
const image = { id: "image-a", kind: "image" as const, label: "fixture image", content: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC" };
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
  if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
});

it.each(["image", "model"])("dismisses the inner %s before the enclosing AI modal", async kind => {
  window.openmind = { onAiEvent: () => () => {}, getImageConfiguration: async () => ({ defaultSelection: null, providers: [] }) } as unknown as DesktopApi;
  const closeOuter = vi.fn();
  render(<AiProvider initial={snapshot}><Dialog open onClose={closeOuter} aria-label="AI canvas">
    {kind === "image" ? <ContextTray contexts={[image]} /> : <ComposerModelPicker providers={[]} providerId="" onProviderChange={() => {}} value={null} onChange={() => {}} />}
  </Dialog></AiProvider>);
  if (kind === "image") fireEvent.click(screen.getByAltText(image.label));
  else fireEvent.click(screen.getByRole("button", { name: "选择模型：选择模型" }));
  const inner = kind === "image" ? screen.getByRole("dialog", { name: "图片预览" }) : screen.getByRole("menu");
  expect(inner.closest("[inert]")).toBeNull();
  fireEvent.keyDown(inner, { key: "Escape" });
  expect(closeOuter).not.toHaveBeenCalled();
  await waitFor(() => expect(kind === "image" ? screen.queryByRole("dialog", { name: "图片预览" }) : screen.queryByRole("menu")).toBeNull());
  fireEvent.keyDown(document, { key: "Escape" });
  expect(closeOuter).toHaveBeenCalledOnce();
});

it.each(["message", "artifact"])("keeps the latest %s copy feedback for its full interval", async kind => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => {}) } });
  render(kind === "message" ? <CopyButton text="fixture" /> : <ArtifactMessageBlock block={{ key: "fixture-artifact", type: "artifact", artifactType: "markdown", title: "fixture", content: "fixture", status: "complete" }}><p>fixture</p></ArtifactMessageBlock>);
  const button = screen.getByRole("button");
  await act(async () => { fireEvent.click(button); });
  act(() => vi.advanceTimersByTime(1000));
  await act(async () => { fireEvent.click(button); });
  act(() => vi.advanceTimersByTime(500));
  expect(button.getAttribute("aria-label")).toBe("已复制");
  act(() => vi.advanceTimersByTime(1000));
  expect(button.getAttribute("aria-label")).not.toBe("已复制");
});

it("ignores stale clipboard responses and cancels its timer on unmount", async () => {
  vi.useFakeTimers();
  let resolveFirst!: () => void;
  const first = new Promise<void>(resolve => { resolveFirst = resolve; });
  const writeText = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  function CopyHarness() {
    const { copy, copied } = useClipboard();
    return <button onClick={() => void copy("fixture")} aria-pressed={copied}>copy</button>;
  }
  const view = render(<CopyHarness />);
  fireEvent.click(screen.getByRole("button"));
  await act(async () => { fireEvent.click(screen.getByRole("button")); });
  act(() => vi.advanceTimersByTime(1000));
  await act(async () => { resolveFirst(); });
  act(() => vi.advanceTimersByTime(500));
  expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("waits for an asynchronous tab guard and keeps focus when navigation is refused", async () => {
  let allow!: (accepted: boolean) => void;
  const guard = vi.fn(() => new Promise<boolean>(resolve => { allow = resolve; }));
  render(<Tabs value="one" label="guarded tabs" onChange={guard} tabs={[{ value: "one", label: "one" }, { value: "two", label: "two" }]} />);
  const first = screen.getByRole("tab", { name: "one" }); first.focus();
  fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(document.activeElement).toBe(first);
  await act(async () => { allow(false); });
  expect(document.activeElement).toBe(first);
});

it("skips disabled modes for arrow, Home and End navigation", () => {
  function Modes() { const [value, setValue] = useState("one"); return <SegmentedControl value={value} onChange={setValue} label="modes" options={[
    { value: "one", label: "one" }, { value: "two", label: "two", disabled: true }, { value: "three", label: "three" }
  ]} />; }
  render(<Modes />);
  fireEvent.keyDown(screen.getByRole("button", { name: "one" }), { key: "ArrowRight" });
  expect(screen.getByRole("button", { name: "three" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(screen.getByRole("button", { name: "three" }), { key: "Home" });
  expect(screen.getByRole("button", { name: "one" }).getAttribute("aria-pressed")).toBe("true");
});

it.each(["blur", "lostpointercapture", "unmount"])("cancels a pointer resize on %s and removes its listeners", reason => {
  const move = vi.fn(); const end = vi.fn();
  function Resize() { const ref = useRef<HTMLDivElement>(null); const start = usePointerResize(() => ({ move, end })); return <div ref={ref} role="separator" onPointerDown={start} />; }
  const view = render(<Resize />);
  const separator = screen.getByRole("separator");
  fireEvent(separator, pointer("pointerdown", 7, 100));
  fireEvent(window, pointer("pointerup", 8, 160));
  expect(end).not.toHaveBeenCalled();
  if (reason === "unmount") view.unmount();
  else if (reason === "blur") fireEvent.blur(window);
  else fireEvent(separator, pointer("lostpointercapture", 7, 100));
  expect(end).toHaveBeenCalledExactlyOnceWith(true);
  fireEvent(window, pointer("pointerup", 7, 200));
  expect(end).toHaveBeenCalledTimes(1);
  expect(move).not.toHaveBeenCalled();
});

function pointer(type: string, pointerId: number, clientX: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX });
  Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } });
  return event;
}

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueuedMessages } from "./QueuedMessages";

const runs = [
  { id: "first", prompt: "继续整理今天的文章", contexts: [] },
  { id: "second", prompt: "第一行\n第二行：" + "保留完整消息内容。".repeat(60), contexts: [] }
];
const idle = new Set<string>();
afterEach(cleanup);

describe("QueuedMessages", () => {
  it("shows messages immediately in queue order and removes only the selected message", () => {
    const onCancel = vi.fn();
    render(<QueuedMessages runs={runs} cancellingRunIds={idle} onCancel={onCancel} />);
    const list = screen.getByRole("list", { name: "2 条消息正在排队" });
    expect(within(list).getAllByRole("listitem").map(row => row.querySelector(".queue-tray-preview")?.textContent)).toEqual(runs.map(run => run.prompt));
    fireEvent.click(screen.getByRole("button", { name: "删除排队消息 2" }));
    expect(onCancel).toHaveBeenCalledExactlyOnceWith("second");
  });

  it("opens full multiline details from the keyboard and restores focus on Escape", async () => {
    const user = userEvent.setup();
    render(<QueuedMessages runs={runs} cancellingRunIds={idle} onCancel={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "查看排队消息 2" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "排队消息 2" });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.querySelector("p")?.textContent).toBe(runs[1].prompt);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses details on an outside click and removes stale details when a message leaves the queue", async () => {
    const props = { cancellingRunIds: idle, onCancel: vi.fn() };
    const { rerender } = render(<QueuedMessages runs={runs} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "查看排队消息 1" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "查看排队消息 1" }));
    await screen.findByRole("dialog");
    rerender(<QueuedMessages runs={[runs[1]]} {...props} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "删除排队消息 1" })).toBeTruthy();
  });

  it("prevents duplicate cancellation while keeping the rest of the queue usable", () => {
    const onCancel = vi.fn();
    render(<QueuedMessages runs={runs} cancellingRunIds={new Set(["first"])} onCancel={onCancel} />);
    const pending = screen.getByRole("button", { name: "删除排队消息 1" });
    expect(pending.hasAttribute("disabled")).toBe(true);
    expect(pending.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(pending);
    fireEvent.click(screen.getByRole("button", { name: "删除排队消息 2" }));
    expect(onCancel).toHaveBeenCalledExactlyOnceWith("second");
  });

  it("handles attachment-only messages and hides an empty queue", () => {
    const props = { cancellingRunIds: idle, onCancel: vi.fn() };
    const { rerender } = render(<QueuedMessages runs={[{ id: "image", prompt: "", contexts: [{ id: "image", kind: "image", label: "Image" }] }]} {...props} />);
    expect(document.querySelector(".queue-tray-preview")?.textContent).toBe("1 项上下文");
    rerender(<QueuedMessages runs={[]} {...props} />);
    expect(screen.queryByRole("list")).toBeNull();
  });
});

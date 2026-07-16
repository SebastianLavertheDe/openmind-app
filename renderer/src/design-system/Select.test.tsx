import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "./Select";

afterEach(cleanup);

type Opts = Array<{ value: "a" | "b" | "c"; label: string }>;

const OPTIONS: Opts = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" }
];

function Harness({ initial = "" as "" | "a" | "b" | "c" }) {
  const [value, setValue] = useState<"" | "a" | "b" | "c">(initial);
  return <Select value={value} options={OPTIONS} onChange={(v) => setValue(v)} ariaLabel="排序" placeholder="选择" />;
}

function getTrigger() {
  return screen.getByRole("button", { name: /下拉菜单/ });
}

describe("Select (custom dropdown)", () => {
  it("opens a listbox and reports expanded state", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = getTrigger();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox", { name: "排序" })).toBeTruthy();
  });

  it("selects an option and closes", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getTrigger());
    const listbox = screen.getByRole("listbox", { name: "排序" });
    await user.click(within(listbox).getByRole("option", { name: "Beta" }));
    expect(getTrigger().textContent).toContain("Beta");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("navigates options with arrow keys and confirms with Enter", async () => {
    const onChange = vi.fn();
    render(<Select value="" options={OPTIONS} onChange={onChange} ariaLabel="排序" placeholder="选择" />);
    const trigger = getTrigger();
    fireEvent.click(trigger);
    const listbox = screen.getByRole("listbox", { name: "排序" });
    // 从定位到的第一项开始,按两次下到 Gamma,再 Enter
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("c");
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = getTrigger();
    await user.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("closes when clicking outside", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Harness />
        <button>outside</button>
      </>
    );
    await user.click(getTrigger());
    expect(screen.getByRole("listbox")).toBeTruthy();
    await user.click(screen.getByText("outside"));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("renders the selected value and marks the option aria-selected", async () => {
    const user = userEvent.setup();
    render(<Harness initial="b" />);
    expect(getTrigger().textContent).toContain("Beta");
    await user.click(getTrigger());
    const listbox = screen.getByRole("listbox", { name: "排序" });
    const selected = within(listbox).getByRole("option", { name: "Beta" });
    expect(selected.getAttribute("aria-selected")).toBe("true");
  });
});

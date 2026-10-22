import { createRef, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, ConfirmDialog, FormDialog, FormField, IconButton, Input, InputGroup, Popover } from "./components";
import { useMotionPreference } from "./use-motion-preference";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("public UI contracts", () => {
  it("replaces an icon with one loading indicator and preserves its accessible name", () => {
    const click = vi.fn();
    render(<IconButton label="Upload" loading tooltip={false} onClick={click}><svg data-testid="upload-icon" /></IconButton>);
    const button = screen.getByRole("button", { name: "Upload" });
    expect(button.querySelectorAll("svg")).toHaveLength(1);
    expect(screen.queryByTestId("upload-icon")).toBeNull();
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();
  });
  it("keeps the native action element and ref while loading blocks duplicate activation", async () => {
    const user = userEvent.setup();
    const click = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    const view = render(<form onSubmit={event => event.preventDefault()}><Button ref={ref} onClick={click}>Save</Button></form>);
    const button = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(button.type).toBe("button");
    await user.click(button);
    view.rerender(<form onSubmit={event => event.preventDefault()}><Button ref={ref} loading onClick={click}>Save</Button></form>);
    expect(ref.current).toBe(button);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    await user.click(button);
    expect(click).toHaveBeenCalledOnce();
  });

  it("keeps field identity, selection and descriptions when validation changes", async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLInputElement>();
    const view = render(<FormField label="Name" hint="Visible in the list"><Input ref={ref} defaultValue="OpenMind" /></FormField>);
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    await user.click(screen.getByText("Name"));
    input.setSelectionRange(1, 4);
    const id = input.id;
    view.rerender(<FormField label="Name" hint="Visible in the list" error="Name already exists"><Input ref={ref} defaultValue="OpenMind" /></FormField>);
    expect(ref.current).toBe(input);
    expect(input.id).toBe(id);
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(4);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const descriptions = input.getAttribute("aria-describedby")!.split(" ").map(value => document.getElementById(value)?.textContent);
    expect(descriptions).toEqual(["Visible in the list", "Name already exists"]);
    expect(document.activeElement).toBe(input);
  });

  it("associates a grouped number input with the field and validation message", async () => {
    const user = userEvent.setup();
    render(<FormField label="Interval" error="At least one minute"><InputGroup><Input variant="inline" type="number" defaultValue="0" /><span>minutes</span></InputGroup></FormField>);
    const input = screen.getByRole("spinbutton", { name: "Interval" });
    await user.click(screen.getByText("Interval"));
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("At least one minute");
  });

  it("leaves validation and request state with the form owner and blocks busy dismissal", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    const submit = vi.fn();
    const view = render(<FormDialog open title="Create project" confirmLabel="Create" onConfirm={submit} onClose={close}>
      <FormField label="Name"><Input required /></FormField>
    </FormDialog>);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Name")));
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(submit).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Name"), "Project");
    await user.keyboard("{Enter}");
    expect(submit).toHaveBeenCalledOnce();
    view.rerender(<FormDialog open busy title="Create project" confirmLabel="Create" onConfirm={submit} onClose={close}>
      <FormField label="Name"><Input required /></FormField>
    </FormDialog>);
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(document.querySelector("[data-ui-dialog]")!);
    expect(close).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<FormDialog open dismissDisabled title="Create project" confirmLabel="Create" onConfirm={submit} onClose={close}>
      <FormField label="Name"><Input required /></FormField>
    </FormDialog>);
    for (const button of within(screen.getByRole("dialog")).getAllByRole("button")) {
      if (button.textContent === "Create") continue;
      await user.click(button);
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    await user.keyboard("{Escape}");
    expect(close).not.toHaveBeenCalled();
  });

  it("keeps confirmations to two actions and defaults dangerous confirmation to cancel", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn();
    const close = vi.fn();
    render(<ConfirmDialog open title="Remove project" tone="danger" confirmLabel="Remove" cancelLabel="Cancel" onConfirm={confirm} onClose={close} />);
    const dialog = screen.getByRole("alertdialog", { name: "Remove project" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    expect(within(dialog).getAllByRole("button")).toHaveLength(2);
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    await user.keyboard("{Enter}");
    expect(close).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("dismisses a nested popover first, restores focus and preserves the outer form", async () => {
    const user = userEvent.setup();
    const outerClose = vi.fn();
    function Nested() {
      const [open, setOpen] = useState(false);
      const anchor = useRef<HTMLButtonElement>(null);
      return <FormDialog open title="Project" confirmLabel="Save" onConfirm={() => {}} onClose={outerClose}>
        <Button ref={anchor} onClick={() => setOpen(true)}>Choose icon</Button>
        <Popover open={open} modal anchorRef={anchor} onClose={() => setOpen(false)} aria-label="Icons"><Button onClick={() => setOpen(false)}>Books</Button></Popover>
      </FormDialog>;
    }
    render(<Nested />);
    const trigger = screen.getByRole("button", { name: "Choose icon" });
    await user.click(trigger);
    const popover = screen.getByRole("dialog", { name: "Icons" });
    await waitFor(() => expect(popover.contains(document.activeElement)).toBe(true));
    await user.keyboard("{Escape}");
    expect(outerClose).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.getByRole("dialog", { name: "Project" })).toBeTruthy();
  });

  it("shares one OS motion subscription across many controls and releases it on unmount", () => {
    const add = vi.fn();
    const remove = vi.fn();
    const media = { matches: false, addEventListener: add, removeEventListener: remove };
    const match = vi.spyOn(window, "matchMedia").mockReturnValue(media as unknown as MediaQueryList);
    function Consumer() { return <span>{useMotionPreference() ? "reduced" : "normal"}</span>; }
    const view = render(<>{Array.from({ length: 200 }, (_, i) => <Consumer key={i} />)}</>);
    expect(match).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledOnce();
    act(() => { media.matches = true; add.mock.calls[0][1](); });
    expect(screen.getAllByText("reduced")).toHaveLength(200);
    view.unmount();
    expect(remove).toHaveBeenCalledOnce();
    expect(remove.mock.calls[0][1]).toBe(add.mock.calls[0][1]);
  });

  it("adds no timers or global interaction listeners for a large action list", () => {
    vi.useFakeTimers();
    const global = vi.spyOn(window, "addEventListener");
    const view = render(<>{Array.from({ length: 500 }, (_, i) => <Button key={i}>Action {i}</Button>)}</>);
    expect(vi.getTimerCount()).toBe(0);
    expect(global).not.toHaveBeenCalled();
    expect(view.container.querySelectorAll("button")).toHaveLength(500);
  });
});

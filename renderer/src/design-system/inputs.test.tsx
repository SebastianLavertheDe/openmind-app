import { createRef, useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Input, InputGroup, SearchInput, Textarea } from "./inputs";

afterEach(cleanup);

describe("shared text controls", () => {
  it("keeps a controlled input's native element, value and focus across updates", async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLInputElement>();
    function Form() {
      const [value, setValue] = useState("");
      return <label>Name<Input ref={ref} value={value} onChange={event => setValue(event.target.value)} /></label>;
    }
    render(<Form />);
    const input = screen.getByRole("textbox", { name: "Name" });
    await user.type(input, "OpenMind");
    expect(ref.current).toBe(input);
    expect(ref.current?.value).toBe("OpenMind");
    expect(document.activeElement).toBe(input);
    ref.current?.setSelectionRange(0, 4);
    expect(ref.current?.selectionEnd).toBe(4);
  });

  it("preserves password, read-only, disabled and native validation semantics", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<>
      <Input aria-label="Secret" type="password" defaultValue="example" readOnly onChange={change} autoComplete="new-password" />
      <Input aria-label="Unavailable" disabled />
      <Input aria-label="Address" type="url" required defaultValue="invalid" aria-invalid aria-describedby="address-error" />
      <span id="address-error">Enter a URL</span>
    </>);
    const secret = screen.getByLabelText("Secret") as HTMLInputElement;
    await user.type(secret, "extra");
    expect(secret.value).toBe("example");
    expect(secret.type).toBe("password");
    expect(secret.autocomplete).toBe("new-password");
    expect(change).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Unavailable") as HTMLInputElement).disabled).toBe(true);
    const address = screen.getByLabelText("Address") as HTMLInputElement;
    expect(address.checkValidity()).toBe(false);
    expect(address.getAttribute("aria-invalid")).toBe("true");
    expect(address.getAttribute("aria-describedby")).toBe("address-error");
  });

  it.each(["md", "sm"] as const)("forwards textarea refs, selection and keyboard handlers used by editors (%s)", async size => {
    const user = userEvent.setup();
    const ref = createRef<HTMLTextAreaElement>();
    const onKeyDown = vi.fn();
    render(<Textarea ref={ref} variant={size === "sm" ? "composer" : "inline"} size={size} aria-label="Draft" defaultValue="First\nSecond" rows={3} spellCheck={false} onKeyDown={onKeyDown} />);
    const textarea = screen.getByRole("textbox", { name: "Draft" });
    ref.current?.focus();
    ref.current?.setSelectionRange(0, 5);
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(ref.current).toBe(textarea);
    expect(ref.current?.selectionStart).toBe(0);
    expect(ref.current?.selectionEnd).toBe(5);
    expect(onKeyDown.mock.calls.some(([event]) => event.key === "Enter" && event.ctrlKey)).toBe(true);
  });

  it("keeps search icons decorative and sends focus, text and Enter to the native input", async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLInputElement>();
    const key = vi.fn();
    render(<SearchInput ref={ref} className="feature-search" inputClassName="feature-query" aria-label="Search files" leadingIcon={null}
      trailingIcon={<svg role="img" aria-label="Decorative icon" />} onKeyDown={key} />);
    const search = screen.getByRole("searchbox", { name: "Search files" });
    await user.tab();
    expect(document.activeElement).toBe(search);
    expect(ref.current).toBe(search);
    await user.type(search, "notes{Enter}");
    expect(ref.current?.value).toBe("notes");
    expect(key.mock.calls.some(([event]) => event.key === "Enter")).toBe(true);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("keeps an input with a suffix associated with its field label", async () => {
    render(<label>Interval<InputGroup><Input variant="inline" type="number" defaultValue="15" min={1} /><span aria-hidden>minutes</span></InputGroup></label>);
    const input = screen.getByRole("spinbutton", { name: "Interval" }) as HTMLInputElement;
    expect(input.valueAsNumber).toBe(15);
    expect(input.min).toBe("1");
  });

  it("clears a controlled search and returns focus to the same native input", async () => {
    const user = userEvent.setup();
    function SearchForm() {
      const [value, setValue] = useState("notes");
      return <SearchInput aria-label="Search notes" value={value} onChange={event => setValue(event.target.value)}
        clearAction={value ? { label: "Clear search", onClear: () => setValue("") } : undefined} />;
    }
    render(<SearchForm />);
    const input = screen.getByRole("searchbox", { name: "Search notes" }) as HTMLInputElement;
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    await user.type(input, "new notes");
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();
  });
});

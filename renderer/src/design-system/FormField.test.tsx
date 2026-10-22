import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { FormField } from "./FormField";
import { Input, InputGroup } from "./inputs";
import { Select } from "./Select";

afterEach(cleanup);

const options = [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }];

describe("FormField accessible names", () => {
  it("distinguishes adjacent selects with the same placeholder and preserves their names after selection", async () => {
    const user = userEvent.setup();
    function Versions() {
      const [left, setLeft] = useState("");
      return <>
        <FormField label="Version A" hint="Earlier version" error={left === "b" ? "Choose an older version" : undefined}><Select value={left} onChange={setLeft} options={options} placeholder="Current content" /></FormField>
        <FormField label="Version B"><Select value="" onChange={() => {}} options={options} placeholder="Current content" /></FormField>
      </>;
    }
    render(<Versions />);
    const left = screen.getByRole("button", { name: "Version A", description: "Current content Earlier version" });
    const right = screen.getByRole("button", { name: "Version B" });
    await user.click(screen.getByText("Version A"));
    const menu = screen.getByRole("listbox", { name: "Version A" });
    await user.click(within(menu).getByRole("option", { name: "Beta" }));
    expect(screen.getByRole("button", { name: "Version A", description: "Beta Earlier version Choose an older version" })).toBe(left);
    expect(left.textContent).toContain("Beta");
    expect(right.textContent).toContain("Current content");
    expect(left.getAttribute("aria-invalid")).toBe("true");
  });

  it("preserves explicit native and select accessible names", () => {
    render(<>
      <span id="external-name">External name</span>
      <FormField label="Visible input"><Input aria-label="Explicit input" /></FormField>
      <FormField label="Visible select"><Select value="a" onChange={() => {}} options={options} aria-label="Explicit select" /></FormField>
      <FormField label="Visible legacy select"><Select value="a" onChange={() => {}} options={options} ariaLabel="Legacy name" /></FormField>
      <FormField label="Visible reference"><Select value="a" onChange={() => {}} options={options} aria-labelledby="external-name" /></FormField>
      <FormField label="Interval"><InputGroup><Input type="number" /><span>minutes</span></InputGroup></FormField>
      <FormField label="Visible interval"><InputGroup aria-label="Outer interval"><Input type="number" aria-label="Explicit interval" /><span>minutes</span></InputGroup></FormField>
      <FormField label="Visible group"><InputGroup aria-label="Explicit group"><Input type="number" /><span>minutes</span></InputGroup></FormField>
    </>);
    expect(screen.getByRole("textbox", { name: "Explicit input" }).getAttribute("aria-labelledby")).toBeNull();
    expect(screen.getByRole("button", { name: /Explicit select/ }).getAttribute("aria-labelledby")).toBeNull();
    expect(screen.getByRole("button", { name: /Legacy name/ }).getAttribute("aria-labelledby")).toBeNull();
    expect(screen.getByRole("button", { name: "External name", description: "Alpha" }).getAttribute("aria-labelledby")).toBe("external-name");
    const interval = screen.getByRole("spinbutton", { name: "Interval" });
    expect(document.getElementById(interval.getAttribute("aria-labelledby")!)?.textContent).toBe("Interval");
    expect(screen.getByRole("spinbutton", { name: "Explicit interval" }).getAttribute("aria-labelledby")).toBeNull();
    expect(screen.getByRole("spinbutton", { name: "Explicit group" }).getAttribute("aria-label")).toBe("Explicit group");
  });
});

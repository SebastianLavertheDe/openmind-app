import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, Dialog, DialogBody, DialogHeader, DropdownMenu, MenuItem, Select, Tabs } from "./components";
import { tabStops } from "./tab-navigation";

afterEach(cleanup);

describe("popup and page tab order", () => {
  it.each(["menu", "select"])("leaves a %s for the active tab, skipping excluded page regions", async kind => {
    const userChoice = [{ value: "a", label: "Alpha" }];
    render(<>
      {kind === "menu"
        ? <DropdownMenu label="Add"><MenuItem>Import</MenuItem></DropdownMenu>
        : <Select ariaLabel="Add" value="a" options={userChoice} onChange={vi.fn()} />}
      <button tabIndex={-2}>Programmatic focus</button>
      <div hidden><button>Hidden</button></div>
      <div style={{ display: "none" }}><button>Not displayed</button></div>
      <div style={{ visibility: "hidden" }}><button>Invisible</button></div>
      <div inert><button>Inert</button></div>
      <fieldset disabled><button>Disabled group</button></fieldset>
      <Tabs value="materials" label="Project files" onChange={vi.fn()} tabs={[
        { value: "tasks", label: "Tasks" }, { value: "materials", label: "Materials" }
      ]} />
    </>);
    fireEvent.click(screen.getByRole("button", { name: /^Add/ }));
    const popup = await screen.findByRole(kind === "menu" ? "menu" : "listbox");
    fireEvent.keyDown(popup, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Materials" }));
  });

  it("keeps popup Tab navigation inside a modal and Shift+Tab on its trigger", async () => {
    render(<Dialog open onClose={vi.fn()}><DialogHeader title="Project" titleId="project-title" /><DialogBody>
      <Button>First</Button>
      <DropdownMenu label="Last"><MenuItem>Import</MenuItem></DropdownMenu>
    </DialogBody></Dialog>);
    fireEvent.click(screen.getByRole("button", { name: "Last" }));
    fireEvent.keyDown(await screen.findByRole("menu"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last" }));
    fireEvent.click(screen.getByRole("button", { name: "Last" }));
    fireEvent.keyDown(await screen.findByRole("menu"), { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
  });

  it("orders positive tabindex before ordinary stops and excludes closed details", () => {
    const { container } = render(<><button>Ordinary</button><button tabIndex={2}>Second</button>
      <button tabIndex={1}>First</button><details><summary>Summary</summary><button>Closed content</button></details></>);
    expect(tabStops(container).map(item => item.textContent)).toEqual(["First", "Second", "Ordinary", "Summary"]);
  });

  it("retains base classes across typed variants and skips disabled arrow targets", async () => {
    function Example() {
      const [value, setValue] = useState("a");
      return <Tabs variant="pill" className="layout" label="Sections" value={value} onChange={setValue}
        tabs={[{ value: "a", label: "One" }, { value: "b", label: "Disabled", disabled: true }, { value: "c", label: "Three" }]} />;
    }
    render(<Example />);
    const tabs = screen.getByRole("tablist");
    expect(tabs.classList.contains("ui-tabs")).toBe(true);
    expect(tabs.classList.contains("layout")).toBe(true);
    fireEvent.keyDown(tabs, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Three" })));
  });
});

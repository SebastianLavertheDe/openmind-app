import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocumentToolbar } from "./DocumentToolbar";

function mount() {
  const callbacks = { onOutline: vi.fn(), onSearch: vi.fn(), onAction: vi.fn(), onHeading: vi.fn(), onMenuOpen: vi.fn() };
  const props = { ready: true, format: { heading: 2, active: [], canUndo: false, canRedo: false }, outlineOpen: false, ...callbacks };
  return { ...render(<DocumentToolbar {...props} />), ...callbacks };
}

describe("document toolbar menus", () => {
  it("uses a custom paragraph menu, focuses the current format and chooses by keyboard", async () => {
    const { container, onHeading, onMenuOpen } = mount();
    expect(container.querySelector("select")).toBeNull();
    const trigger = screen.getByRole("button", { name: "段落格式" });
    fireEvent.click(trigger);
    const menu = await screen.findByRole("menu", { name: "段落格式" });
    expect(menu.classList.contains("document-menu")).toBe(true);
    const current = within(menu).getByRole("menuitemradio", { name: "标题 2" });
    expect(current.getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(current));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    const next = within(menu).getByRole("menuitemradio", { name: "标题 3" });
    expect(document.activeElement).toBe(next);
    fireEvent.click(next);
    expect(onHeading).toHaveBeenCalledWith(3);
    expect(onMenuOpen).toHaveBeenCalledOnce();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the toolbar menus mutually exclusive and skips disabled commands", async () => {
    const { onAction } = mount();
    const paragraph = screen.getByRole("button", { name: "段落格式" });
    const more = screen.getByRole("button", { name: "更多格式" });
    fireEvent.click(paragraph);
    await screen.findByRole("menu", { name: "段落格式" });
    fireEvent.click(more);
    expect(paragraph.getAttribute("aria-expanded")).toBe("false");
    const menu = await screen.findByRole("menu", { name: "更多格式" });
    expect(menu.classList.contains("document-menu")).toBe(true);
    expect(within(menu).getByRole("menuitem", { name: "重做" })).toHaveProperty("disabled", true);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "代码块" }));
    fireEvent.click(within(menu).getByRole("menuitem", { name: "代码块" }));
    expect(onAction).toHaveBeenCalledWith("code");

    fireEvent.click(more);
    fireEvent.keyDown(await screen.findByRole("menu", { name: "更多格式" }), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(more));
  });
});

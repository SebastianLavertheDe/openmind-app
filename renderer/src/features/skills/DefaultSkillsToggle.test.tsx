import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { DefaultSkillsToggle } from "./DefaultSkillsToggle";

afterEach(cleanup);

describe("DefaultSkillsToggle", () => {
  it("starts off, waits for installation and allows uninstalling from the same switch", async () => {
    let enabled = false;
    let finish!: () => void;
    const setEnabled = vi.fn(async (next: boolean) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      enabled = next;
      return next;
    });
    window.openmind = {
      getDefaultSkillsEnabled: async () => enabled,
      setDefaultSkillsEnabled: setEnabled
    } as unknown as DesktopApi;
    const onChange = vi.fn(async () => undefined);
    render(<DefaultSkillsToggle onChange={onChange} />);
    const toggle = screen.getByRole("switch", { name: "默认 Skills 与内置定时任务" }) as HTMLButtonElement;
    await waitFor(() => expect(toggle.disabled).toBe(false));
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(setEnabled).toHaveBeenCalledWith(true);
    expect(toggle.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("正在安装");
    finish();
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    await waitFor(() => expect(toggle.disabled).toBe(false));
    fireEvent.click(toggle);
    expect(setEnabled).toHaveBeenLastCalledWith(false);
    finish();
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("shows a failed removal and leaves the switch available for another attempt", async () => {
    window.openmind = {
      getDefaultSkillsEnabled: async () => true,
      setDefaultSkillsEnabled: async () => { throw new Error("任务正在停止"); }
    } as unknown as DesktopApi;
    render(<DefaultSkillsToggle onChange={vi.fn(async () => undefined)} />);
    const toggle = screen.getByRole("switch") as HTMLButtonElement;
    await waitFor(() => expect(toggle.disabled).toBe(false));
    fireEvent.click(toggle);
    expect((await screen.findByRole("alert")).textContent).toBe("任务正在停止");
    await waitFor(() => expect(toggle.disabled).toBe(false));
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
});

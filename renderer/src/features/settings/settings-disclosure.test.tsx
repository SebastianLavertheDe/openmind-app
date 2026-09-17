import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServerDefinition, SkillDefinition } from "@shared/contracts";
import { SkillSettingsSection } from "./settings-sections";

const skills: SkillDefinition[] = [{ id: "fixture", title: "合成 Skill", description: "详情", cwd: "/fixture", command: "echo fixture", permission: "read-only" }];
const servers: McpServerDefinition[] = [{ id: "fixture", title: "合成 MCP", description: "详情", backend: "fixture", transport: "stdio", connection: "fixture",
  enabled: false, available: true, status: "disabled", diagnostic: "未启用", providers: [], tools: [], settingsSection: "browser" }];
afterEach(() => { cleanup(); vi.useRealTimers(); document.documentElement.removeAttribute("style"); });
function mount(mode: "skills" | "mcp") {
  document.documentElement.style.setProperty("--dur-normal", "200ms");
  document.documentElement.style.setProperty("--ease-standard", "cubic-bezier(.2,0,0,1)");
  return render(<SkillSettingsSection mode={mode} skills={skills} mcpServers={servers} refreshing={false}
    onRefresh={() => {}} onCopy={() => {}} onOpenDirectory={() => {}} onOpenMcpSettings={() => {}} />);
}
describe("Settings disclosure", () => {
  it("retains the closing Skill body inert and cancels removal on reversal", () => {
    vi.useFakeTimers();
    const { container } = mount("skills");
    const trigger = container.querySelector<HTMLButtonElement>(".settings-skill-summary")!;
    fireEvent.click(trigger);
    const details = container.querySelector(".settings-skill-details")!;
    expect(document.getElementById(trigger.getAttribute("aria-controls")!)?.contains(details)).toBe(true);
    trigger.focus(); fireEvent.click(trigger);
    expect(details.closest("[inert]")).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
    act(() => vi.advanceTimersByTime(100)); fireEvent.click(trigger);
    act(() => vi.advanceTimersByTime(200));
    expect(container.querySelector(".settings-skill-details")).toBe(details);
    fireEvent.click(trigger); act(() => vi.advanceTimersByTime(200));
    expect(details.isConnected).toBe(false);
  });
  it("settles MCP search expansion and clearing immediately, then animates explicit toggles", () => {
    const { container } = mount("mcp");
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "合成" } });
    expect(container.querySelector(".settings-mcp-details")).toBeTruthy();
    expect(container.querySelector(".ui-disclosure[data-instant]")).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });
    expect(container.querySelector(".settings-mcp-details")).toBeNull();
    fireEvent.click(container.querySelector(".settings-mcp-server-header")!);
    expect(container.querySelector(".ui-disclosure[data-instant]")).toBeNull();
    expect(container.querySelector(".settings-mcp-details")).toBeTruthy();
  });
});

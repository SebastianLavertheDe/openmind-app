import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { FeedbackProvider } from "../../feedback-context";
import { FeedbackHost } from "../../components/FeedbackHost";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { ProjectOutputsPanel } from "./ProjectOutputsPanel";
import { ProjectMaterialsPanel } from "./ProjectMaterialsPanel";
import type { ProjectDetail, ProjectMaterial, ProjectOutput } from "./types";

vi.mock("./ProjectOutputEditor", () => ({ ProjectOutputEditor: ({ title, onTitle }: { title: string; onTitle(value: string): void }) =>
  <input aria-label="Output title" value={title} onChange={event => onTitle(event.target.value)} /> }));
const date = "2026-10-23T00:00:00Z";
const project: ProjectDetail = { id: "fixture", name: "Fixture", description: "", status: "active", materialCount: 1, taskCount: 0, outputCount: 2, createdAt: date, updatedAt: date };
const materials: ProjectMaterial[] = [{ relativePath: "materials/source.md", title: "Source", kind: "document", status: "failed", updatedAt: date }];
const outputs: ProjectOutput[] = ["One", "Two"].map(title => ({ projectName: project.name, relativePath: `outputs/${title}.md`, title, createdAt: date, updatedAt: date }));
afterEach(() => { cleanup(); document.body.replaceChildren(); localStorage.clear(); });

function mount(save = vi.fn(async (input: { relativePath: string; title: string; content: string }) => ({ output: { ...outputs[0], ...input }, content: input.content }))) {
  const listMaterials = vi.fn().mockResolvedValue(materials), listOutputs = vi.fn().mockResolvedValue(outputs);
  const read = vi.fn(async ({ relativePath }: { relativePath: string }) => ({ output: outputs.find(item => item.relativePath === relativePath), content: "# Fixture" }));
  window.openmind = { listProjectMaterials: listMaterials, listProjectOutputs: listOutputs, readProjectOutput: read, saveProjectOutput: save } as unknown as DesktopApi;
  const list = document.createElement("div"), detail = document.createElement("div");
  document.body.append(list, detail);
  render(<FeedbackProvider><ProjectFilesPanel project={project} initialSection="outputs" initialItem={outputs[0].relativePath}
    createRequested={null} onCreateHandled={vi.fn()} onCreateTask={vi.fn()} onChanged={vi.fn()} listHost={list} detailHost={detail} /><FeedbackHost /></FeedbackProvider>);
  return { list, detail, listMaterials, listOutputs, read, save };
}

describe("project file detail ownership", () => {
  it("resolves a missing initial output through the list before reading a detail", async () => {
    const read = vi.fn(async () => ({ output: outputs[0], content: "# Fixture" }));
    window.openmind = { listProjectOutputs: vi.fn().mockResolvedValue(outputs), readProjectOutput: read } as unknown as DesktopApi;
    render(<FeedbackProvider><ProjectOutputsPanel project={project} initialOutputPath="outputs/missing.md" createRequested={false} onCreateHandled={vi.fn()} onChanged={vi.fn()} /></FeedbackProvider>);
    expect((await screen.findByRole("textbox", { name: "Output title" }) as HTMLInputElement).value).toBe("One");
    expect(read).toHaveBeenCalledExactlyOnceWith({ projectName: project.name, relativePath: outputs[0].relativePath });
  });

  it("retains import dialogs when a standalone material list has no detail host", async () => {
    window.openmind = { listProjectMaterials: vi.fn().mockResolvedValue([]) } as unknown as DesktopApi;
    const list = document.createElement("div");
    document.body.append(list);
    render(<FeedbackProvider><ProjectMaterialsPanel project={project} createRequested onCreateHandled={vi.fn()} onChanged={vi.fn()} onCreateTask={vi.fn()} listHost={list} /></FeedbackProvider>);
    expect(await screen.findByRole("dialog", { name: "添加资料" })).toBeTruthy();
  });

  it("switches details without listing again, and reflects a saved title in the one owning list", async () => {
    const fixture = mount();
    const title = await within(fixture.detail).findByRole("textbox", { name: "Output title" });
    fireEvent.change(title, { target: { value: "Renamed" } });
    fireEvent.click(within(fixture.list).getByRole("button", { name: "Two" }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Output title" }) as HTMLInputElement).value).toBe("Two"));
    expect(fixture.save).toHaveBeenCalledOnce();
    expect(within(fixture.list).getByRole("button", { name: "Renamed" })).toBeTruthy();
    fireEvent.click(within(fixture.list).getByRole("button", { name: "Source" }));
    await within(fixture.detail).findByText("资料转换失败");
    fireEvent.click(within(fixture.list).getByRole("button", { name: "Renamed" }));
    await within(fixture.detail).findByRole("textbox", { name: "Output title" });
    expect(fixture.listMaterials).toHaveBeenCalledOnce();
    expect(fixture.listOutputs).toHaveBeenCalledOnce();
  });

  it("keeps the dirty editor mounted when a cross-kind save fails and discard is cancelled", async () => {
    const fixture = mount(vi.fn().mockRejectedValue(new Error("Save failed")));
    const title = await within(fixture.detail).findByRole("textbox", { name: "Output title" });
    fireEvent.change(title, { target: { value: "Unsaved" } });
    fireEvent.click(within(fixture.list).getByRole("button", { name: "Source" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("textbox", { name: "Output title" })).toBe(title);
    expect((title as HTMLInputElement).value).toBe("Unsaved");
    expect(fixture.read).toHaveBeenCalledOnce();
    expect(fixture.listMaterials).toHaveBeenCalledOnce();
    expect(fixture.listOutputs).toHaveBeenCalledOnce();
  });
});

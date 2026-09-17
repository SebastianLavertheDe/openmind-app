import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import type { ProjectDetail, ProjectMaterial } from "./types";

// Exercise the real parent refresh path independently of document loading.
vi.mock("./ProjectMaterialsPanel", () => ({ ProjectMaterialsPanel: ({ onChanged }: { onChanged(): void }) => <button onClick={onChanged}>资料已更新</button> }));
const project: ProjectDetail = { id: "fixture", name: "项目", description: "", status: "active", materialCount: 2, taskCount: 0, outputCount: 0, createdAt: "2026-09-17", updatedAt: "2026-09-17" };
const material = (name: string): ProjectMaterial => ({ relativePath: `materials/${name}.md`, title: name, kind: "document", status: "ready", updatedAt: "2026-09-17" });
const items = [material("甲"), material("乙")];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount(listProjectMaterials: ReturnType<typeof vi.fn>) {
  window.openmind = { onAiEvent: () => () => {}, listProjectMaterials, listProjectOutputs: async () => [] } as unknown as DesktopApi;
  const listHost = document.createElement("div");
  const detailHost = document.createElement("div");
  document.body.append(listHost, detailHost);
  render(<AiProvider initial={{ projectRoot: "/fixture", providers: [], sessions: [], runs: [], pendingApprovals: [] }}>
    <ProjectFilesPanel project={project} initialSection="materials" initialItem="materials/甲.md" createRequested={null} onCreateHandled={() => {}} onCreateTask={() => {}} onChanged={() => {}} listHost={listHost} detailHost={detailHost} />
  </AiProvider>);
  return listHost;
}
afterEach(() => { cleanup(); document.body.replaceChildren(); localStorage.clear(); });

describe("Project file background refresh", () => {
  it("keeps surviving DOM, selection, focus and scroll while refreshing", async () => {
    const pending = deferred<ProjectMaterial[]>();
    const api = vi.fn().mockResolvedValueOnce(items).mockReturnValueOnce(pending.promise);
    const host = mount(api);
    const row = await within(host).findByRole("button", { name: "甲" });
    const list = host.querySelector<HTMLElement>(".project-file-list")!;
    list.scrollTop = 90;
    row.focus();
    fireEvent.click(screen.getByText("资料已更新"));
    expect(host.querySelector(".project-item-skeleton")).toBeNull();
    expect(within(host).getByRole("button", { name: "甲" })).toBe(row);
    expect(document.activeElement).toBe(row);
    expect(list.getAttribute("aria-busy")).toBe("true");
    await act(async () => pending.resolve([items[0], material("丙")]));
    expect(within(host).getByRole("button", { name: "甲" })).toBe(row);
    expect(row.classList.contains("active")).toBe(true);
    expect(within(host).queryByRole("button", { name: "乙" })).toBeNull();
    expect(list.scrollTop).toBe(90);
  });

  it("keeps the last successful rows on failure and allows retry", async () => {
    const pending = deferred<ProjectMaterial[]>();
    const api = vi.fn().mockResolvedValueOnce(items).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(items);
    const host = mount(api);
    const row = await within(host).findByRole("button", { name: "甲" });
    fireEvent.click(screen.getByText("资料已更新"));
    await act(async () => pending.reject(new Error("刷新失败")));
    expect(within(host).getByRole("button", { name: "甲" })).toBe(row);
    fireEvent.click(within(host).getByRole("button", { name: /重试/ }));
    await waitFor(() => expect(within(host).queryByText("刷新失败")).toBeNull());
    expect(within(host).getByRole("button", { name: "甲" })).toBe(row);
  });

  it("ignores an older refresh response after a newer response has committed", async () => {
    const first = deferred<ProjectMaterial[]>(), second = deferred<ProjectMaterial[]>();
    const host = mount(vi.fn().mockResolvedValueOnce(items).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    await within(host).findByRole("button", { name: "甲" });
    fireEvent.click(screen.getByText("资料已更新"));
    fireEvent.click(screen.getByText("资料已更新"));
    await act(async () => second.resolve([items[0], material("新文件")]));
    await act(async () => first.resolve(items));
    expect(within(host).getByRole("button", { name: "新文件" })).toBeTruthy();
    expect(within(host).queryByRole("button", { name: "乙" })).toBeNull();
  });
});

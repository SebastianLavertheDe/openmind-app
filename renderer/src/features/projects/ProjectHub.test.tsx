import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectHub } from "./ProjectHub";
import type { ProjectSummary } from "./types";

const projects: ProjectSummary[] = [
  { name: "AI 安全", description: "研究与写作", status: "active", materialCount: 4, taskCount: 2, outputCount: 1, createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z" },
  { name: "旧项目", description: "历史内容", status: "archived", materialCount: 1, taskCount: 0, outputCount: 3, createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-21T00:00:00.000Z" }
];

afterEach(() => cleanup());

describe("ProjectHub", () => {
  it("shows real project counts and opens a project", () => {
    const onOpen = vi.fn();
    render(<ProjectHub projects={projects} loading={false} error={null} onRetry={vi.fn()} onCreate={vi.fn()} onOpen={onOpen} />);

    expect(screen.getAllByText("AI 安全").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4 资料").length).toBeGreaterThan(0);
    expect(screen.queryByText("旧项目")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /AI 安全/ })[0]);
    expect(onOpen).toHaveBeenCalledWith(projects[0]);
  });

  it("filters archived projects and exposes the create action", () => {
    const onCreate = vi.fn();
    render(<ProjectHub projects={projects} loading={false} error={null} onRetry={vi.fn()} onCreate={onCreate} onOpen={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: /已归档/ }));
    const catalog = document.querySelector(".projects-catalog");
    expect(catalog).not.toBeNull();
    expect(within(catalog as HTMLElement).getByText("旧项目")).toBeTruthy();
    expect(within(catalog as HTMLElement).queryByText("AI 安全")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("keeps load errors mutually exclusive with the empty state", () => {
    render(<ProjectHub projects={[]} loading={false} error="项目加载失败" onRetry={vi.fn()} onCreate={vi.fn()} onOpen={vi.fn()} />);

    expect(screen.getByText("项目加载失败")).toBeTruthy();
    expect(screen.queryByText("还没有项目")).toBeNull();
  });

  it("distinguishes search misses from a genuinely empty project list", () => {
    render(<ProjectHub projects={projects} loading={false} error={null} onRetry={vi.fn()} onCreate={vi.fn()} onOpen={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("搜索项目"), { target: { value: "不存在" } });
    expect(screen.getByText("没有匹配的项目")).toBeTruthy();
    expect(screen.queryByText("还没有项目")).toBeNull();
  });
});

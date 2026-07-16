import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSnapshot, CreativeCreateInput, CreativeProjectDetail, CreativeProjectSummary, DesktopApi } from "@shared/contracts";
import { AiProvider } from "../../ai-context";
import { ProjectsPage } from "./ProjectsPage";

const snapshot: AiSnapshot = {
  projectRoot: "/project",
  providers: [],
  sessions: [],
  runs: [],
  pendingApprovals: []
};

const projects: CreativeProjectSummary[] = [
  {
    dir: "/project/a",
    topic: "AI 深度稿",
    stage: "drafting",
    completion: 45,
    date: "2026-06-16",
    updatedAt: "2026-06-17T08:00:00.000Z",
    platforms: { wechat: "公众号" },
    tags: ["AI", "深度"]
  },
  {
    dir: "/project/b",
    topic: "短视频脚本",
    stage: "ready",
    completion: 90,
    date: "2026-06-15",
    updatedAt: "2026-06-18T08:00:00.000Z",
    platforms: { xiaohongshu: "小红书" },
    tags: ["短视频"]
  },
  {
    dir: "/project/c",
    topic: "归档项目",
    stage: "archived",
    completion: 100,
    date: "2026-06-14",
    updatedAt: "2026-06-19T08:00:00.000Z",
    archived: true,
    platforms: { wechat: "公众号" },
    tags: ["AI"]
  }
];

let createdInputs: CreativeCreateInput[];

beforeEach(() => {
  createdInputs = [];
  const createCreativeProject = vi.fn(async (input: CreativeCreateInput): Promise<CreativeProjectDetail> => {
    createdInputs.push(input);
    return {
    dir: "/project/new",
    stage: "drafting",
    manifest: {
      date: input.date,
      topic: input.topic.title || "未命名项目",
      progress: 20
    },
    files: { "topic-brief.md": input.topic.body || "" }
  };
  });
  window.cctools = {
    aiRefresh: async () => snapshot,
    aiGetEvents: async () => [],
    onAiEvent: () => () => undefined,
    getCreativeProjects: async () => projects,
    getCreativeProject: async (path: string) => ({
      dir: path,
      stage: "drafting",
      manifest: { topic: "AI 深度稿", date: "2026-06-16", progress: 45 },
      files: { "topic-brief.md": "# brief" }
    }),
    createCreativeProject,
    openPath: async (path: string) => path
  } as unknown as DesktopApi;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProjectsPage", () => {
  it("filters active projects by platform, tag, date and switches to table view", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><ProjectsPage /></AiProvider>);

    await screen.findByText("AI 深度稿");
    expect(screen.getByText("短视频脚本")).toBeTruthy();
    expect(screen.queryByText("归档项目")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "归档" }));
    await waitFor(() => expect(screen.getByText("归档项目")).toBeTruthy());
    expect(screen.queryByText("AI 深度稿")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "全部" }));
    await waitFor(() => expect(screen.getByText("AI 深度稿")).toBeTruthy());
    expect(screen.getByText("归档项目")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "活跃" }));
    await waitFor(() => expect(screen.queryByText("归档项目")).toBeNull());

    await user.selectOptions(screen.getByLabelText("平台筛选"), "wechat");
    await waitFor(() => expect(screen.queryByText("短视频脚本")).toBeNull());
    expect(screen.getByText("AI 深度稿")).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("标签筛选"), "深度");
    expect(screen.getByText("AI 深度稿")).toBeTruthy();

    await user.clear(screen.getByLabelText("日期"));
    await user.type(screen.getByLabelText("日期"), "2026-06-15");
    await waitFor(() => expect(screen.queryByText("AI 深度稿")).toBeNull());

    await user.selectOptions(screen.getByLabelText("平台筛选"), "all");
    await user.selectOptions(screen.getByLabelText("标签筛选"), "all");
    await waitFor(() => expect(screen.getByText("短视频脚本")).toBeTruthy());

    await user.selectOptions(screen.getByLabelText("日期口径"), "updatedAt");
    await user.clear(screen.getByLabelText("日期"));
    await user.type(screen.getByLabelText("日期"), "2026-06-17");
    await waitFor(() => expect(screen.getByText("AI 深度稿")).toBeTruthy());
    expect(screen.queryByText("短视频脚本")).toBeNull();

    await user.clear(screen.getByLabelText("日期"));
    await user.type(screen.getByLabelText("日期"), "2026-06-18");
    await waitFor(() => expect(screen.getByText("短视频脚本")).toBeTruthy());

    await user.click(screen.getByTitle("表格视图"));
    const projectList = document.querySelector(".project-list.table");
    expect(projectList).toBeTruthy();
    expect(within(projectList as HTMLElement).getByText("xiaohongshu")).toBeTruthy();
  });

  it("creates an empty project through the project page action", async () => {
    const user = userEvent.setup();
    render(<AiProvider initial={snapshot}><ProjectsPage /></AiProvider>);

    await screen.findByText("AI 深度稿");
    await user.click(screen.getByRole("button", { name: "新建空项目" }));

    await waitFor(() => expect(createdInputs).toHaveLength(1));
    expect(createdInputs[0]).toMatchObject({
      topic: {
        platform: "未指定",
        section: "empty"
      }
    });

    await user.click(screen.getByRole("button", { name: "从模板创建" }));
    await waitFor(() => expect(createdInputs).toHaveLength(2));
    expect(createdInputs[1]).toMatchObject({
      topic: {
        platform: "公众号",
        section: "template"
      }
    });
  });
});

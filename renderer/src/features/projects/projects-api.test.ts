import { afterEach, describe, expect, it, vi } from "vitest";
import { projectsApi } from "./projects-api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("projectsApi", () => {
  it("normalizes Project detail, material read and output read envelopes", async () => {
    window.openmind = {
      getProject: vi.fn(async () => ({ project: { schemaVersion: 1, name: "AI 安全", description: "研究", status: "active", materialCount: 1, taskCount: 2, outputCount: 3, createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z" } })),
      readProjectMaterial: vi.fn(async () => ({ material: { projectName: "AI 安全", relativePath: "materials/web/source.web.md", title: "Source", kind: "web", status: "ready", source: { type: "url", url: "https://example.com" }, createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z" }, content: "# Source", truncated: true })),
      readProjectOutput: vi.fn(async () => ({ output: { projectName: "AI 安全", relativePath: "outputs/result.md", title: "Result", sourceTaskId: null, sourceSessionId: null, sourceMessageId: null, createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z" }, content: "# Result" }))
    } as never;

    await expect(projectsApi.getProject("AI 安全")).resolves.toMatchObject({ name: "AI 安全", materialCount: 1 });
    await expect(projectsApi.readMaterial("AI 安全", "materials/web/source.web.md")).resolves.toMatchObject({ kind: "web", sourceUrl: "https://example.com", content: "# Source", truncated: true });
    await expect(projectsApi.readOutput("AI 安全", "outputs/result.md")).resolves.toMatchObject({ title: "Result", content: "# Result" });
  });

  it("uses the dedicated project task run endpoint", async () => {
    const projectStartTaskRun = vi.fn(async () => ({
      task: { taskId: "task-1", projectName: "AI 安全", title: "报告", sessionId: "session-1", providerId: "codex", status: "active", createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z" },
      session: { id: "session-1" },
      run: { id: "run-1" }
    }));
    window.openmind = { projectStartTaskRun } as never;

    const result = await projectsApi.startTaskRun("AI 安全", "task-1", "codex", "写报告");

    expect(projectStartTaskRun).toHaveBeenCalledWith({ projectName: "AI 安全", taskId: "task-1", providerId: "codex", prompt: "写报告" });
    expect(result.session.id).toBe("session-1");
  });

  it("renames and removes tasks through the Project task endpoints", async () => {
    const renamed = { taskId: "task-1", projectName: "AI 安全", title: "新标题", sessionId: null, providerId: "codex", status: "active", createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z" };
    const renameProjectTask = vi.fn(async () => renamed);
    const archiveProjectTask = vi.fn(async () => ({ ...renamed, status: "archived" }));
    window.openmind = { renameProjectTask, archiveProjectTask } as never;

    await expect(projectsApi.renameTask("AI 安全", "task-1", "新标题")).resolves.toMatchObject({ title: "新标题" });
    await projectsApi.removeTask("AI 安全", "task-1");

    expect(renameProjectTask).toHaveBeenCalledWith({ projectName: "AI 安全", taskId: "task-1", title: "新标题" });
    expect(archiveProjectTask).toHaveBeenCalledWith({ projectName: "AI 安全", taskId: "task-1" });
  });

  it("reads parsed video metadata from the ProjectMaterialRead envelope", async () => {
    window.openmind = {
      readProjectMaterial: vi.fn(async () => ({
        material: {
          projectName: "AI 安全",
          relativePath: "materials/videos/talk.video.md",
          title: "Talk",
          kind: "video",
          status: "ready",
          source: { type: "url", url: "https://www.youtube.com/watch?v=video-1" },
          createdAt: "2026-08-30T00:00:00.000Z",
          updatedAt: "2026-08-31T00:00:00.000Z"
        },
        content: "# Talk",
        truncated: false,
        video: {
          provider: "youtube",
          sourceUrl: "https://www.youtube.com/watch?v=video-1",
          embedUrl: "https://www.youtube-nocookie.com/embed/video-1",
          videoId: "video-1",
          mediaType: "video",
          title: "Talk",
          durationMs: 4_000,
          thumbnailUrl: null,
          transcript: [{ startMs: 1_000, endMs: 2_000, text: "quoted segment" }],
          transcriptSource: "platform"
        }
      }))
    } as never;

    await expect(projectsApi.readMaterial("AI 安全", "materials/videos/talk.video.md")).resolves.toMatchObject({
      sourceUrl: "https://www.youtube.com/watch?v=video-1",
      video: {
        provider: "youtube",
        embedUrl: "https://www.youtube-nocookie.com/embed/video-1",
        transcript: [{ startMs: 1_000, endMs: 2_000, text: "quoted segment" }]
      }
    });
  });

  it("keeps failed material retries inside the Project API", async () => {
    const retryMaterialExtraction = vi.fn(async () => ({
      projectName: "AI 安全",
      relativePath: "materials/web/source.web.md",
      title: "Source",
      kind: "web",
      status: "ready",
      source: { type: "url", url: "https://example.com" },
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    }));
    window.openmind = { retryMaterialExtraction } as never;

    await expect(projectsApi.retryMaterial("AI 安全", "materials/web/source.web.md")).resolves.toMatchObject({ status: "ready" });
    expect(retryMaterialExtraction).toHaveBeenCalledWith({ projectName: "AI 安全", relativePath: "materials/web/source.web.md" });
  });

  it("maps only validated direct video extensions from backend video metadata", async () => {
    const material = {
      projectName: "AI 安全",
      relativePath: "materials/videos/direct.video.md",
      title: "Direct",
      kind: "video",
      status: "ready",
      source: { type: "url", url: "https://media.example.com/master.m3u8?token=preview" },
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z"
    };
    const readProjectMaterial = vi.fn()
      .mockResolvedValueOnce({ material, content: "# Direct", video: { provider: "direct", sourceUrl: "https://media.example.com/master.m3u8?token=preview", mediaType: "hls", title: "Direct", transcript: [] } })
      .mockResolvedValueOnce({ material, content: "# Direct", video: { provider: "direct", sourceUrl: "https://media.example.com/not-a-video", mediaType: "mp4", title: "Direct", transcript: [] } })
      .mockResolvedValueOnce({ material, content: "# Direct", video: { provider: "direct", sourceUrl: "http://media.example.com/video.mp4", mediaType: "mp4", title: "Direct", transcript: [] } });
    window.openmind = { readProjectMaterial } as never;

    await expect(projectsApi.readMaterial("AI 安全", material.relativePath)).resolves.toMatchObject({ video: { mediaType: "hls", mediaUrl: "https://media.example.com/master.m3u8?token=preview" } });
    await expect(projectsApi.readMaterial("AI 安全", material.relativePath)).resolves.toMatchObject({ video: { mediaType: "mp4", mediaUrl: undefined } });
    await expect(projectsApi.readMaterial("AI 安全", material.relativePath)).resolves.toMatchObject({ video: { mediaType: "mp4", mediaUrl: undefined } });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { projectsApi } from "./projects-api";
import { projectVideoMediaUrl } from "@shared/youtube-import";
import { projectMaterialVideoResource } from "./project-material-preview-source";
import { bilibiliEmbedUrl } from "@shared/bilibili-video";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("projectsApi", () => {
  it("carries Bilibili captions and the selected part through IPC to iframe playback", async () => {
    const videoId = "BV1xx411c7mD";
    const sourceUrl = `https://www.bilibili.com/video/${videoId}?p=2`;
    const embedUrl = bilibiliEmbedUrl({ videoId, page: 2 });
    const value = {
      material: { projectName: "Fixture", relativePath: "materials/videos/bilibili.video.md", kind: "video", status: "ready", title: "Fixture", source: { type: "url", url: sourceUrl } },
      video: { provider: "bilibili", videoId, sourceUrl, embedUrl, localMediaUrl: projectVideoMediaUrl("Fixture", "materials/videos/bilibili.video.md"),
        transcript: [{ startMs: 1000, endMs: 3000, text: "拼接字幕。" }] }
    };
    window.openmind = { readProjectMaterial: vi.fn().mockResolvedValue(value) } as never;
    const preview = projectMaterialVideoResource(await projectsApi.readMaterial("Fixture", value.material.relativePath));
    expect(preview.playback).toEqual({ kind: "trusted-bilibili", videoId, embedUrl });
    expect(preview.transcript[0]).toMatchObject({ startMs: 1000, endMs: 3000, text: "拼接字幕。" });
    value.video.embedUrl = "https://evil.test/player.html";
    expect(projectMaterialVideoResource(await projectsApi.readMaterial("Fixture", value.material.relativePath)).playback.kind).toBe("external-only");
  });

  it("rebuilds Bilibili playback and captions from persisted Markdown when parsed IPC metadata is absent", async () => {
    window.openmind = { readProjectMaterial: vi.fn().mockResolvedValue({
      material: { projectName: "Fixture", relativePath: "materials/videos/bilibili.video.md", title: "Fixture", kind: "video", status: "ready", source: { type: "url", url: "https://b23.tv/Ab12CD" } },
      content: "# Fixture\n\n- Provider：bilibili\n- URL：https://www.bilibili.com/video/BV1xx411c7mD?p=3\n- Video ID：BV1xx411c7mD\n\n## 字幕\n\n[00:01.250–00:05.000] 拼接字幕。"
    }) } as never;
    const preview = projectMaterialVideoResource(await projectsApi.readMaterial("Fixture", "materials/videos/bilibili.video.md"));
    expect(preview.playback).toEqual({ kind: "trusted-bilibili", videoId: "BV1xx411c7mD", embedUrl: bilibiliEmbedUrl({ videoId: "BV1xx411c7mD", page: 3 }) });
    expect(preview.transcript[0]).toMatchObject({ startMs: 1250, endMs: 5000, text: "拼接字幕。" });
  });

  it("carries the validated local video URL through IPC normalization and gives it playback priority", async () => {
    const localMediaUrl = projectVideoMediaUrl("Fixture", "materials/videos/talk.video.md");
    const value = {
      material: { projectName: "Fixture", relativePath: "materials/videos/talk.video.md", kind: "video", status: "ready", title: "Fixture", source: { type: "url", url: "https://youtu.be/dQw4w9WgXcQ" } },
      video: { provider: "youtube", videoId: "dQw4w9WgXcQ", embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1", localMediaUrl, transcript: [] }
    };
    const read = vi.fn().mockResolvedValue(value);
    window.openmind = { readProjectMaterial: read } as never;
    const material = await projectsApi.readMaterial("Fixture", value.material.relativePath);
    expect(projectMaterialVideoResource(material).playback).toEqual({ kind: "local-video", mediaUrl: localMediaUrl });
    value.video.localMediaUrl = "file:///private/video.mp4";
    expect((await projectsApi.readMaterial("Fixture", value.material.relativePath)).video?.localMediaUrl).toBeUndefined();
  });

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

    expect(projectStartTaskRun).toHaveBeenCalledWith({ projectName: "AI 安全", taskId: "task-1", providerId: "codex", permissionProfile: "auto", prompt: "写报告" });
    expect(result.session.id).toBe("session-1");
  });

  it("forwards an explicit permission and session when continuing a project task", async () => {
    const projectStartTaskRun = vi.fn(async () => ({
      task: { taskId: "task-1", projectName: "AI 安全", title: "报告", sessionId: "session-1", providerId: "codex", status: "active", createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z" },
      session: { id: "session-1" },
      run: { id: "run-2" }
    }));
    window.openmind = { projectStartTaskRun } as never;

    await projectsApi.startTaskRun("AI 安全", "task-1", "codex", "继续", [], "read-only", "session-1");

    expect(projectStartTaskRun).toHaveBeenCalledWith({
      projectName: "AI 安全",
      taskId: "task-1",
      providerId: "codex",
      permissionProfile: "read-only",
      prompt: "继续",
      sessionId: "session-1"
    });
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

  it("updates persisted project appearance and favorite metadata", async () => {
    const updateProject = vi.fn(async () => ({
      project: {
        name: "AI 安全",
        description: "研究",
        status: "active",
        icon: "gamepad",
        color: "pink",
        favorite: true,
        createdAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-31T00:00:00.000Z"
      }
    }));
    window.openmind = { updateProject } as never;

    await expect(projectsApi.updateProject("AI 安全", { icon: "gamepad", color: "pink", favorite: true })).resolves.toMatchObject({
      icon: "gamepad",
      color: "pink",
      favorite: true
    });
    expect(updateProject).toHaveBeenCalledWith({ projectName: "AI 安全", icon: "gamepad", color: "pink", favorite: true });
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

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunScheduler } from "./scheduler";
import type { ProviderAdapter, ProviderRunContext } from "./providers/types";
import type { ProviderCapabilities } from "../../shared/contracts";
import { SkillPackageService } from "../skills/skill-package-service";
import { SkillLibraryService } from "../skills/skill-library-service";
import { buildAppPaths, ensureAppPaths } from "../paths/app-paths-service";
import { ProjectService } from "../project/project-service";
import { buildProviderSkillContext } from "./providers/skill-bridge";

vi.mock("../config/providers-yaml", async original => ({
  ...await original<typeof import("../config/providers-yaml")>(),
  resolveCliProvider: () => null
}));
const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-skill-selection-")); roots.push(directory);
  const content = path.join(directory, "content"); fs.mkdirSync(content);
  const state = path.join(directory, "state"); vi.stubEnv("OPENMIND_USER_DATA_DIR", state);
  const paths = buildAppPaths(state, path.join(content, ".agent", "skills")); ensureAppPaths(paths);
  const packages = new SkillPackageService(paths);
  const library = new SkillLibraryService(content, paths, packages, path.join(directory, "bundle"));
  const doc = library.editor(); doc.name = "My research"; doc.instructions[0].text = "Use the supplied evidence. Explain uncertainty explicitly.";
  doc.inputHint = "What should I research?"; doc.executionModel = { provider: "claude", model: "fixture-model" };
  const entry = library.publish(doc, crypto.randomUUID());
  const scheduler = new RunScheduler(content, () => undefined, () => "different-default-model", paths.state, content);
  const internals = scheduler as unknown as { registry: { detect(): ProviderCapabilities[] }; adapters: Record<string, ProviderAdapter> };
  const provider = { id: "claude-native", provider: "claude", label: "Claude fixture", runtime: "native", available: true, version: "test", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null } as ProviderCapabilities;
  internals.registry.detect = () => [provider];
  const selection = { key: entry.key!, digest: entry.digest! };
  return { directory, content, paths, packages, library, doc, entry, scheduler, internals, provider, selection };
}

describe("structured Skill selection", () => {
  it.each([false, true])("injects exact installed rules and model into plain-text requests (Project=%s)", async projectScoped => {
    const f = fixture(); const seen: ProviderRunContext[] = [];
    const prewarmModels: string[] = [];
    f.internals.adapters.claude = {
      run: async context => { seen.push(context); await context.emit("assistant-message", { text: "done", phase: "final" }); },
      prewarm: async context => { prewarmModels.push(context.providerModel); return true; }
    };
    const input = { providerId: f.provider.id, permissionProfile: "auto" as const, prompt: "Explain these findings", contexts: [], selectedSkill: f.selection };
    let result;
    if (projectScoped) {
      const projects = new ProjectService(f.content, { stateRoot: f.paths.state });
      const project = projects.createProject({ name: "Research", description: "" }).project;
      const task = projects.createProjectTask(project.name, "Findings", f.provider.id);
      result = f.scheduler.startProjectRun({ ...input, projectRoot: projects.resolveProjectRoot(project.name), projectId: project.id, projectName: project.name, taskId: task.taskId });
    } else result = f.scheduler.startRun({ ...input, cwd: "." });
    await vi.waitFor(() => expect(f.scheduler.snapshot().runs.find(run => run.id === result.run.id)?.status).toBe("completed"));
    expect(seen).toHaveLength(1);
    expect(seen[0].skillBridge?.instructions).toContain(f.doc.instructions[0].text);
    expect(buildProviderSkillContext(seen[0].skillBridge!)).toContain("current_session_permissions_apply");
    expect(seen[0].skillBridge?.digest).toBe(f.selection.digest);
    expect(seen[0].providerModel).toBe("fixture-model");
    expect(seen[0].skillInvocation?.argument).toBe(input.prompt);
    expect(result.run.selectedSkill?.installed).toMatchObject(f.selection);
    expect(f.scheduler.getEvents(result.session.id).find(event => event.kind === "user-message")?.payload.selectedSkill).toMatchObject({ installed: f.selection });
    await f.scheduler.prewarmClaude(result.session.id);
    expect(prewarmModels.length).toBeGreaterThan(0);
    expect(prewarmModels.every(model => model === "fixture-model")).toBe(true);
  });

  it("keeps a queued turn's identity and rejects replacement bytes before Provider execution", async () => {
    const f = fixture(); let release: (() => void) | undefined; let calls = 0;
    f.internals.adapters.claude = { run: async context => {
      calls++;
      if (calls === 1) await new Promise<void>(resolve => { release = resolve; });
      await context.emit("assistant-message", { text: "done", phase: "final" });
    } };
    const input = { providerId: f.provider.id, permissionProfile: "auto" as const, cwd: ".", prompt: "first", contexts: [], selectedSkill: f.selection };
    const first = f.scheduler.startRun(input);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const queued = f.scheduler.startRun({ ...input, sessionId: first.session.id, prompt: "follow-up" });
    expect(queued.run.selectedSkill?.installed?.digest).toBe(f.selection.digest);
    const edit = f.library.editor(f.doc.id); edit.instructions[0].text = "Replaced rules";
    const replacement = f.library.publish(edit, crypto.randomUUID());
    expect(replacement.digest).not.toBe(f.selection.digest);
    f.scheduler.refreshSkills(); release!();
    await vi.waitFor(() => expect(f.scheduler.snapshot().runs.find(run => run.id === queued.run.id)?.status).toBe("failed"));
    expect(calls).toBe(1);
    expect(f.scheduler.snapshot().runs.find(run => run.id === queued.run.id)?.selectedSkill?.installed?.digest).toBe(f.selection.digest);
    expect(() => f.scheduler.startRun({ ...input, prompt: "stale" })).toThrow();
  });
});

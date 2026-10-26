import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthoredSkillSchema, type SkillLibraryEntry } from "@shared/skill-library";
import type { DesktopApi } from "@shared/contracts";
import { setLocale } from "@shared/messages";
import { FeedbackProvider } from "../../feedback-context";
import { SkillLibraryPage } from "./SkillLibraryPage";
import { SkillEditor } from "./SkillEditor";

const previous = window.openmind;
const digest = "a".repeat(64);
function entry(patch: Partial<SkillLibraryEntry> = {}): SkillLibraryEntry {
  return { id: "preset", title: "Research report", subtitle: "Read the sources", description: "Traceable findings", inputHint: "What would you like to investigate?", category: "research", origin: "preset", installed: false, enabled: false, usable: true, reason: null, key: null, digest: null, version: null, skillId: "om-research-brief", authoringId: null, revision: 0, draft: false, imageCount: 0, source: "App presets", executionModel: null, ...patch };
}
let entries: SkillLibraryEntry[];
beforeEach(() => {
  setLocale("en"); localStorage.clear();
  entries = [entry(), entry({ id: "personal", title: "My article", origin: "authored", category: "writing", installed: true, enabled: true, key: "user/article", digest, authoringId: "b5b4cb2a-55ce-4fa6-a0db-e521870f217b" }), entry({ id: "git", title: "Git utility", origin: "git", category: null, installed: true, enabled: true, key: "test/git", digest })];
  window.openmind = { listSkillLibrary: vi.fn(async () => entries), getSkillEditor: vi.fn(async () => document()), saveSkillDraft: vi.fn(async value => value), publishSkill: vi.fn(async () => entries[1]), readSkillAssetImage: vi.fn(), setInstalledSkillEnabled: vi.fn(), installLibraryPreset: vi.fn(async () => ({ ...entries[0], installed: true, enabled: true, key: "openmind-library/report", digest })) } as unknown as DesktopApi;
});
afterEach(() => { cleanup(); window.openmind = previous; localStorage.clear(); setLocale("zh-CN"); vi.restoreAllMocks(); });
function document() { return AuthoredSkillSchema.parse({ id: "1375bbe7-b4b7-4fbe-852d-8c9432b830ab", name: "", subtitle: "", category: "writing", instructions: [{ id: "1f52bf04-b372-4fc2-8551-5f0c7a36c4c8", text: "" }], inputHint: "", description: "" }); }
function page(use = vi.fn()) { return render(<FeedbackProvider><SkillLibraryPage storageScope="fixture" providers={[]} onUseSkill={use} renderManagement={() => null} renderImport={() => null} /></FeedbackProvider>); }

describe("Skill library product flows", () => {
  it("separates Explore from My skills and filters Git imports", async () => {
    const user = userEvent.setup(); page();
    await screen.findByText("Research report");
    expect(screen.queryByText("My article")).toBeNull();
    await user.click(screen.getByRole("button", { name: "My skills" }));
    await screen.findByText("My article");
    expect(screen.queryByText("Research report")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "GitHub installs" }));
    expect(screen.getByText("Git utility")).toBeTruthy();
    expect(screen.queryByText("My article")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Explore" }));
    expect(screen.getByText("Research report")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "My skills" }));
    expect(screen.getByRole("tab", { name: "GitHub installs" }).getAttribute("aria-selected")).toBe("true");
  });

  it("searches within the active mode without installing a package", async () => {
    const user = userEvent.setup(); page(); await screen.findByText("Research report");
    await user.type(screen.getByRole("searchbox", { name: "Search skills" }), "no-match");
    expect(screen.getByText("No matching skills")).toBeTruthy();
    expect(window.openmind.installLibraryPreset).not.toHaveBeenCalled();
  });

  it("installs only on explicit use and returns the installed selection", async () => {
    const user = userEvent.setup(); const use = vi.fn(); page(use);
    await screen.findByText("Research report");
    await user.click(screen.getByRole("button", { name: "Install and use" }));
    await waitFor(() => expect(use).toHaveBeenCalledWith(expect.objectContaining({ key: "openmind-library/report", digest })));
    expect(window.openmind.installLibraryPreset).toHaveBeenCalledWith("preset");
  });

  it("creates a skill from an editable ordered instruction form", async () => {
    const user = userEvent.setup(); const saved = vi.fn();
    render(<FeedbackProvider><SkillEditor initial={document()} entries={entries} providers={[]} onClose={vi.fn()} onSaved={saved} /></FeedbackProvider>);
    await user.type(screen.getByRole("textbox", { name: "Skill name" }), "My custom skill");
    await user.type(screen.getByRole("textbox", { name: "Instructions 1" }), "First instruction");
    await user.click(screen.getByRole("button", { name: "Add instructions" }));
    await user.type(screen.getByRole("textbox", { name: "Instructions 2" }), "Second instruction");
    await user.click(screen.getAllByRole("button", { name: "Move up" })[1]);
    await user.type(screen.getByRole("textbox", { name: "Input hint" }), "Tell me your topic");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "What this skill does");
    await user.click(screen.getByRole("button", { name: "Create skill" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const request = vi.mocked(window.openmind.publishSkill!).mock.calls[0][0];
    expect(request.document.instructions.map(block => block.text)).toEqual(["Second instruction", "First instruction"]);
    expect(request.document.inputHint).toBe("Tell me your topic");
    expect(request.document.description).toBe("What this skill does");
  });

  it("restores an existing skill and preserves it on save failure", async () => {
    const user = userEvent.setup(); const doc = document(); doc.name = "Existing"; doc.revision = 2; doc.instructions[0].text = "Original rules";
    vi.mocked(window.openmind.publishSkill!).mockRejectedValue(new Error("Installation failed"));
    render(<FeedbackProvider><SkillEditor initial={doc} entries={entries} providers={[]} onClose={vi.fn()} onSaved={vi.fn()} /></FeedbackProvider>);
    expect((screen.getByRole("textbox", { name: "Skill name" }) as HTMLInputElement).value).toBe("Existing");
    expect(screen.getByRole("button", { name: "Save and apply" }).hasAttribute("disabled")).toBe(true);
    await user.type(screen.getByRole("textbox", { name: "Instructions 1" }), " updated");
    await user.click(screen.getByRole("button", { name: "Save and apply" }));
    await screen.findByText("Installation failed");
    expect((screen.getByRole("textbox", { name: "Instructions 1" }) as HTMLTextAreaElement).value).toBe("Original rules updated");
  });

  it("blocks a fifth showcase image and validates field lengths", async () => {
    const doc = document(); doc.name = "a".repeat(41);
    doc.images = Array.from({ length: 4 }, (_, index) => ({ id: `00000000-0000-4000-8000-00000000000${index}`, name: `${index}.png`, extension: ".png", kind: "image" }));
    vi.mocked(window.openmind.readSkillAssetImage!).mockResolvedValue("data:image/png;base64,fixture");
    render(<FeedbackProvider><SkillEditor initial={doc} entries={[]} providers={[]} onClose={vi.fn()} onSaved={vi.fn()} /></FeedbackProvider>);
    expect(screen.getByRole("button", { name: "Add showcase images" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
    await screen.findByText("Up to 40 characters");
    expect(window.openmind.publishSkill).not.toHaveBeenCalled();
  });
});

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthoredSkillSchema, type SkillLibraryEntry } from "@shared/skill-library";
import type { DesktopApi } from "@shared/contracts";
import { setLocale } from "@shared/messages";
import { FeedbackProvider } from "../../feedback-context";
import { SkillLibraryPage } from "./SkillLibraryPage";
import { SkillEditor } from "./SkillEditor";
import { ComposerSkillPicker } from "../ai-console/ComposerSkillPicker";

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
  window.openmind.openExternal = vi.fn(async () => true);
});
afterEach(() => { cleanup(); window.openmind = previous; localStorage.clear(); setLocale("zh-CN"); vi.restoreAllMocks(); });
function document() { return AuthoredSkillSchema.parse({ id: "1375bbe7-b4b7-4fbe-852d-8c9432b830ab", name: "", subtitle: "", category: "writing", instructions: [{ id: "1f52bf04-b372-4fc2-8551-5f0c7a36c4c8", text: "" }], inputHint: "", description: "" }); }
function page(use = vi.fn()) { return render(<FeedbackProvider><SkillLibraryPage storageScope="fixture" providers={[]} onUseSkill={use} renderManagement={() => null} renderImport={() => null} /></FeedbackProvider>); }

describe("Skill library product flows", () => {
  it("shows contributors on cards and in details and supports nickname search", async () => {
    const user = userEvent.setup();
    entries[0].contributor = { nick: "Contributor", avatarUrl: "data:image/png;base64,fixture", profileUrl: "https://github.com/contributor" };
    page();
    const credit = await screen.findByText("@Contributor");
    const card = credit.closest("article")!;
    expect(card.querySelector(".skill-contributor img")?.getAttribute("src")).toBe(entries[0].contributor.avatarUrl);
    const link = within(card).getByRole("link", { name: "@Contributor" });
    expect(link.getAttribute("href")).toBe("https://github.com/contributor");
    await user.click(link);
    link.focus(); await user.keyboard("{Enter}");
    expect(window.openmind.openExternal).toHaveBeenCalledTimes(2);
    expect(window.openmind.openExternal).toHaveBeenCalledWith("https://github.com/contributor");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.openmind.installLibraryPreset).not.toHaveBeenCalled();
    await user.type(screen.getByRole("searchbox", { name: "Search skills" }), "@Contributor");
    expect(screen.getByText("Research report")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Research report" }));
    const dialog = screen.getByRole("dialog", { name: "Research report" });
    await user.click(within(dialog).getByRole("link", { name: "@Contributor" }));
    expect(window.openmind.openExternal).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("dialog", { name: "Research report" })).toBe(dialog);
    fireEvent.error(card.querySelector(".skill-contributor img")!);
    expect(card.querySelector(".skill-contributor img")).toBeNull();
    expect(within(card).getByText("@Contributor")).toBeTruthy();
  });

  it.each([undefined, "https://example.com/author"])("renders a plain nickname without a valid profile URL: %s", async profileUrl => {
    entries[0].contributor = { nick: "Contributor", profileUrl };
    page();
    const credit = await screen.findByText("@Contributor");
    expect(within(credit.closest("article")!).queryByRole("link")).toBeNull();
    expect(window.openmind.openExternal).not.toHaveBeenCalled();
  });

  it("uploads an avatar and saves the normalized contributor nickname and homepage", async () => {
    const user = userEvent.setup(); const doc = document(); doc.name = "Article"; doc.instructions[0].text = "Write clearly";
    const avatar = { id: crypto.randomUUID(), name: "avatar.png", extension: ".png", kind: "image" as const };
    window.openmind.importSkillAvatar = vi.fn(async () => avatar);
    vi.mocked(window.openmind.readSkillAssetImage!).mockResolvedValue("data:image/png;base64,fixture");
    const saved = vi.fn();
    render(<FeedbackProvider><SkillEditor initial={doc} entries={[]} providers={[]} onClose={vi.fn()} onSaved={saved} /></FeedbackProvider>);
    await user.type(screen.getByRole("textbox", { name: "Contributor nickname" }), " @New member ");
    await user.type(screen.getByRole("textbox", { name: "Author homepage" }), "https://www.github.com/author/");
    await user.click(screen.getByRole("button", { name: "Upload avatar" }));
    await screen.findByRole("button", { name: "Replace avatar" });
    expect(window.openmind.importSkillAvatar).toHaveBeenCalledWith(doc.id);
    expect(screen.getByText("@New member")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create skill" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(window.openmind.publishSkill).toHaveBeenCalledWith(expect.objectContaining({ document: expect.objectContaining({ contributor: { nick: "New member", avatar, profileUrl: "https://github.com/author" } }) }));
  });

  it("preserves the current avatar on picker cancellation or failure, and supports explicit removal", async () => {
    const user = userEvent.setup(); const doc = document(); doc.name = "Article"; doc.instructions[0].text = "Write clearly";
    doc.contributor = { nick: "Member", avatar: { id: crypto.randomUUID(), name: "avatar.png", extension: ".png", kind: "image" }, profileUrl: "https://x.com/author" };
    window.openmind.importSkillAvatar = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("Avatar exceeds 2MB"));
    vi.mocked(window.openmind.readSkillAssetImage!).mockResolvedValue("data:image/png;base64,fixture");
    const view = render(<FeedbackProvider><SkillEditor initial={doc} entries={[]} providers={[]} onClose={vi.fn()} onSaved={vi.fn()} /></FeedbackProvider>);
    await user.click(screen.getByRole("button", { name: "Replace avatar" }));
    expect(screen.getByRole("button", { name: "Remove avatar" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Replace avatar" }));
    await screen.findByText("Avatar exceeds 2MB");
    expect(view.container.querySelector(".skill-contributor img")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove avatar" }));
    expect(view.container.querySelector(".skill-contributor img")).toBeNull();
    expect(screen.getByText("@Member")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload avatar" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create skill" }));
    expect(window.openmind.publishSkill).toHaveBeenCalledWith(expect.objectContaining({ document: expect.objectContaining({ contributor: { nick: "Member", profileUrl: "https://x.com/author", avatar: undefined } }) }));
  });

  it("validates homepage fields before saving, keeps partial URLs out of autosave, and allows clearing", async () => {
    const user = userEvent.setup(); const doc = document(); doc.name = "Article"; doc.instructions[0].text = "Write clearly";
    doc.contributor = { nick: "Author", profileUrl: "https://github.com/author" };
    const close = vi.fn();
    render(<FeedbackProvider><SkillEditor initial={doc} entries={[]} providers={[]} onClose={close} onSaved={vi.fn()} /></FeedbackProvider>);
    const input = screen.getByRole("textbox", { name: "Author homepage" });
    fireEvent.change(input, { target: { value: "https://" } });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 700)); });
    expect(window.openmind.saveSkillDraft).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    for (const value of ["https://example.com/author", "https://github.com/author/repo", "https://x.com/author/status/123"]) {
      fireEvent.change(input, { target: { value } });
      await user.click(screen.getByRole("button", { name: "Create skill" }));
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByText("Enter an HTTPS GitHub or X profile URL, not a repository, post or other page.")).toBeTruthy();
      expect(window.openmind.publishSkill).not.toHaveBeenCalled();
    }
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).not.toHaveBeenCalled();
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Create skill" }));
    expect(window.openmind.publishSkill).toHaveBeenCalledWith(expect.objectContaining({ document: expect.objectContaining({ contributor: { nick: "Author", profileUrl: undefined } }) }));
  });

  it("requires a nickname when publishing a homepage", async () => {
    const user = userEvent.setup(); const doc = document(); doc.name = "Article"; doc.instructions[0].text = "Write clearly";
    doc.contributor = { nick: "", profileUrl: "https://x.com/author" };
    render(<FeedbackProvider><SkillEditor initial={doc} entries={[]} providers={[]} onClose={vi.fn()} onSaved={vi.fn()} /></FeedbackProvider>);
    await user.click(screen.getByRole("button", { name: "Create skill" }));
    expect(screen.getByRole("textbox", { name: "Contributor nickname" }).getAttribute("aria-invalid")).toBe("true");
    expect(window.openmind.publishSkill).not.toHaveBeenCalled();
  });

  it("validates contributor nicknames and prevents publication during avatar import", async () => {
    const user = userEvent.setup(); const doc = document(); doc.name = "Article"; doc.instructions[0].text = "Write clearly";
    let finish!: (value: null) => void;
    window.openmind.importSkillAvatar = vi.fn(() => new Promise<null>(resolve => { finish = resolve; }));
    render(<FeedbackProvider><SkillEditor initial={doc} entries={[]} providers={[]} onClose={vi.fn()} onSaved={vi.fn()} /></FeedbackProvider>);
    await user.click(screen.getByRole("button", { name: "Upload avatar" }));
    expect(screen.getByRole("button", { name: "Create skill" }).hasAttribute("disabled")).toBe(true);
    await act(async () => finish(null));
    await user.type(screen.getByRole("textbox", { name: "Contributor nickname" }), "a".repeat(25));
    await user.click(screen.getByRole("button", { name: "Create skill" }));
    expect(await screen.findByText("Up to 24 characters")).toBeTruthy();
    expect(window.openmind.publishSkill).not.toHaveBeenCalled();
  });

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
    expect(window.openmind.getSkillEditor).not.toHaveBeenCalled();
  });

  it.each(["preset", "git", "local"] as const)("uses an installed %s skill without offering copying or editing", async origin => {
    const user = userEvent.setup(); const use = vi.fn();
    entries = [entry({ origin, installed: true, enabled: true, key: "publisher/skill", digest })];
    page(use);
    if (origin !== "preset") await user.click(screen.getByRole("button", { name: "My skills" }));
    await user.click(await screen.findByRole("button", { name: "Research report" }));
    const dialog = screen.getByRole("dialog", { name: "Research report" });
    expect(within(dialog).queryByRole("button", { name: /copy|edit/i })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Use skill" }));
    await waitFor(() => expect(use).toHaveBeenCalledWith(expect.objectContaining({ key: "publisher/skill", digest })));
    expect(window.openmind.installLibraryPreset).not.toHaveBeenCalled();
    expect(window.openmind.getSkillEditor).not.toHaveBeenCalled();
  });

  it("keeps installation as the only way to use an uninstalled public skill", async () => {
    const user = userEvent.setup(); const use = vi.fn();
    vi.mocked(window.openmind.installLibraryPreset!).mockRejectedValue(new Error("Installation failed"));
    page(use);
    await user.click(await screen.findByRole("button", { name: "Research report" }));
    const dialog = screen.getByRole("dialog", { name: "Research report" });
    expect(within(dialog).queryByRole("button", { name: /copy|edit/i })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Install and use" }));
    await screen.findByText("Installation failed");
    expect(use).not.toHaveBeenCalled();
    expect(window.openmind.getSkillEditor).not.toHaveBeenCalled();
  });

  it("still opens the editor for an existing personal skill", async () => {
    const user = userEvent.setup(); page();
    await user.click(screen.getByRole("button", { name: "My skills" }));
    await user.click(await screen.findByRole("button", { name: "My article" }));
    await user.click(within(screen.getByRole("dialog", { name: "My article" })).getByRole("button", { name: "Edit" }));
    await screen.findByRole("textbox", { name: "Skill name" });
    expect(window.openmind.getSkillEditor).toHaveBeenCalledWith(entries[1].authoringId);
  });

  it("offers only installed, enabled skills in the chat picker", async () => {
    const user = userEvent.setup(); const select = vi.fn();
    entries[2].enabled = false;
    render(<FeedbackProvider><ComposerSkillPicker selected={null} onSelect={select} onManage={vi.fn()} /></FeedbackProvider>);
    await user.click(screen.getByRole("button", { name: "Use skill" }));
    await screen.findByRole("menuitem", { name: /My article/ });
    expect(screen.queryByRole("menuitem", { name: /Research report|Git utility/ })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: /My article/ }));
    expect(select).toHaveBeenCalledWith(entries[1]);
    expect(window.openmind.installLibraryPreset).not.toHaveBeenCalled();
  });

  it.each([false, true])("applies a bundled update only when the user uses the card (update=%s)", async updateAvailable => {
    const user = userEvent.setup(); const use = vi.fn();
    entries[0] = entry({ installed: true, enabled: true, key: "openmind-library/report", digest: "b".repeat(64), updateAvailable });
    page(use); await screen.findByText("Research report");
    expect(window.openmind.installLibraryPreset).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Use skill" }));
    await waitFor(() => expect(use).toHaveBeenCalledWith(expect.objectContaining({ digest: updateAvailable ? digest : "b".repeat(64) })));
    expect(window.openmind.installLibraryPreset).toHaveBeenCalledTimes(updateAvailable ? 1 : 0);
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

  it("applies a restored unpublished draft without requiring another edit", async () => {
    const user = userEvent.setup();
    const doc = document(); doc.id = entries[1].authoringId!; doc.name = "My article"; doc.revision = 2;
    doc.instructions[0].text = "Autosaved revised rules";
    entries[1] = { ...entries[1], revision: 2, draft: true };
    vi.mocked(window.openmind.getSkillEditor!).mockResolvedValue(doc);
    page();
    await screen.findByText("Research report");
    await user.click(screen.getByRole("button", { name: "My skills" }));
    await user.click(screen.getByRole("button", { name: "My article" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByRole("textbox", { name: "Instructions 1" }) as HTMLTextAreaElement).value).toBe(doc.instructions[0].text);
    const save = screen.getByRole("button", { name: "Save and apply" });
    expect(save.hasAttribute("disabled")).toBe(false);
    await user.click(save);
    await waitFor(() => expect(window.openmind.publishSkill).toHaveBeenCalledWith({ document: doc, operationId: expect.any(String) }));
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

  it.each([false, true])("coordinates unmount drafts with a pending publication (failure=%s)", async failure => {
    const doc = document(); doc.name = "Article"; doc.revision = 1; doc.instructions[0].text = "Original rules";
    let resolve!: (value: SkillLibraryEntry) => void;
    let reject!: (cause: Error) => void;
    vi.mocked(window.openmind.publishSkill!).mockImplementation(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
    const saved = vi.fn();
    const view = render(<FeedbackProvider><SkillEditor initial={doc} entries={[]} providers={[]} onClose={vi.fn()} onSaved={saved} /></FeedbackProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "Instructions 1" }), { target: { value: "Revised rules" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and apply" }));
    await waitFor(() => expect(window.openmind.publishSkill).toHaveBeenCalledTimes(1));
    expect(window.openmind.saveSkillDraft).toHaveBeenCalledWith(expect.objectContaining({ revision: 1, instructions: [expect.objectContaining({ text: "Revised rules" })] }));
    vi.mocked(window.openmind.saveSkillDraft!).mockClear();
    view.unmount();
    expect(window.openmind.saveSkillDraft).not.toHaveBeenCalled();
    await act(async () => { if (failure) reject(new Error("Installation failed")); else resolve(entry({ revision: 2 })); });
    expect(saved).not.toHaveBeenCalled();
    expect(window.openmind.saveSkillDraft).not.toHaveBeenCalled();
  });
});

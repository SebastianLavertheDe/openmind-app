import { SkillLibraryPage } from "../src/features/skills/SkillLibraryPage";
import { AiProvider, useAiDraft, useAiUi } from "../src/ai-context";
import { Chat } from "../src/features/ai-console/Chat";
import { SkillEditor } from "../src/features/skills/SkillEditor";
import { ComposerSkillPicker } from "../src/features/ai-console/ComposerSkillPicker";
import { FeedbackProvider } from "../src/feedback-context";
import { SkillLibraryCatalogSchema, resolveSkillLibraryCopy } from "../../shared/skill-library-catalog";
import skillLibraryCatalog from "../../config/skill-library/catalog.json";
import { AuthoredSkillSchema, type SkillLibraryEntry } from "../../shared/skill-library";
import { messages } from "../../shared/messages";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ArrowUp, BookOpen, Copy, Plus, ShieldCheck, Square, Trash2 } from "lucide-react";
import {
  Button, IconButton, ImageAttachment, ImageThumbnail, BUTTON_VARIANTS, ICON_BUTTON_SHAPES, IMAGE_THUMBNAIL_VARIANTS, CONTROL_SIZES, CONTROL_TONES, INPUT_VARIANTS, TEXTAREA_VARIANTS, SEARCH_VARIANTS,
  Input, Textarea, SearchInput, FormField, InputGroup, FormDialog, ConfirmDialog, Dialog, DialogHeader, DialogBody, SearchDialogHeader,
  TAB_VARIANTS, SEGMENTED_VARIANTS, Select, Tabs, SegmentedControl, ToggleSwitch, DropdownMenu, MenuItem, FileDropzone, AnimatedDisclosure
} from "../src/design-system/components";
import { ProjectEditDialog } from "../src/features/projects/ProjectAppearance";
import { ComposerModelPicker } from "../src/features/ai-console/ComposerModelPicker";
import { QueuedMessages } from "../src/features/ai-console/QueuedMessages";
import type { AiSnapshot, DesktopApi, PermissionProfile } from "../../shared/contracts";
import { IMAGE_PROVIDERS, type ImageConfiguration, type ImageSelection } from "../../shared/image-generation";
import { setLocale } from "../../shared/messages";
import scenarios from "../../scripts/fixtures/ui-catalog/scenarios.json";
import "../src/styles/index.css";
import "../src/styles/dev/ui-catalog.css";
import "@fontsource/jetbrains-mono/latin-400.css";

setLocale(new URLSearchParams(location.search).get("lang") === "zh-CN" ? "zh-CN" : "en");
const query = new URLSearchParams(location.search);
const current = query.get("case") || "actions";
document.documentElement.dataset.theme = query.get("theme") || "light";
document.documentElement.style.setProperty("--font-sans-default", '"OpenMind UI Fixture", sans-serif');
document.documentElement.style.setProperty("--font-sans", '"OpenMind UI Fixture", sans-serif');
document.documentElement.style.setProperty("--font-mono", '"JetBrains Mono", monospace');

const modelFixtureAgents: AiSnapshot["providers"] = [
  { id: "catalog-writing", provider: "codex", label: "Writing assistant", detectedModel: "Reasoning model · long context", runtime: "native", available: true, version: "fixture", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, contextWindow: null, installable: false, oneMillion: false },
  { id: "catalog-workspace", provider: "claude", label: "Workspace assistant", detectedModel: "Project planning and implementation", runtime: "native", available: true, version: "fixture", supportsApprovals: true, supportsResume: true, supportsImages: true, diagnostic: null, contextWindow: null, installable: false, oneMillion: false }
];
const modelFixtureSelection: ImageSelection = { providerId: "catalog-images", provider: "openai", model: IMAGE_PROVIDERS[1].models[0].id };

// This standalone entry has no preload. Model examples receive only two
// in-memory API methods; no provider client or content repository is available.
if (current === "composer-model-menu" || current === "composer-model-submenu") {
  let configuration: ImageConfiguration = {
    defaultSelection: modelFixtureSelection,
    providers: [
      { id: "catalog-images", name: "Catalog image provider", provider: "openai", baseUrl: "https://catalog.invalid/openai", models: IMAGE_PROVIDERS[1].models.map(model => model.id), configured: true, enabled: true },
      { id: "catalog-alternative", name: "Alternative image provider", provider: "google", baseUrl: "https://catalog.invalid/google", models: IMAGE_PROVIDERS[2].models.map(model => model.id), configured: true, enabled: true }
    ]
  };
  const api = {
    getImageConfiguration: async () => structuredClone(configuration),
    selectImageModel: async (selection: ImageSelection | null) => {
      configuration = { ...configuration, defaultSelection: selection };
      return structuredClone(configuration);
    }
  } satisfies Pick<DesktopApi, "getImageConfiguration" | "selectImageModel">;
  Object.defineProperty(window, "openmind", { value: Object.freeze(api) });
}

function Actions() {
  const [imagesOpen, setImagesOpen] = useState(true);
  return <div className="ui-catalog-grid">
    {CONTROL_SIZES.map(size => <section className="ui-catalog-card" key={size}><h2>Actions · {size}</h2>
      {CONTROL_TONES.map(tone => <div className="ui-catalog-group" key={tone}><h3>{tone}</h3><div className="ui-catalog-row">
        {BUTTON_VARIANTS.map(variant => <Button key={variant} variant={variant} tone={tone} size={size}>{variant}</Button>)}
      </div></div>)}
    </section>)}
    <section className="ui-catalog-card"><h2>Disabled and loading</h2><div className="ui-catalog-stack">
      {BUTTON_VARIANTS.map(variant => <div className="ui-catalog-row" key={variant}><Button variant={variant} disabled>Unavailable</Button><Button variant={variant} loading>Saving</Button></div>)}
    </div></section>
    <section className="ui-catalog-card"><h2>Inline disclosure</h2><AnimatedDisclosure variant="inline" open={imagesOpen} onOpenChange={setImagesOpen} summary="Viewed 1 image">
      <ImageThumbnail variant="tool" label="Viewed image"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23e4eee9'/%3E%3Ccircle cx='60' cy='60' r='24' fill='%238aa89b'/%3E%3C/svg%3E" alt="Sample illustration" /></ImageThumbnail>
    </AnimatedDisclosure></section>
    <section className="ui-catalog-card"><h2>Icon actions</h2><div className="ui-catalog-row">
      {CONTROL_SIZES.map(size => <IconButton key={size} size={size} label={`Add · ${size}`} tooltip={false}><Plus /></IconButton>)}
      <IconButton label="Remove" tone="danger" responsiveTarget tooltip={false}><Trash2 /></IconButton><IconButton label="Copy unavailable" responsiveTarget disabled tooltip={false}><Copy /></IconButton>
    </div></section>
    <section className="ui-catalog-card"><h2>Round and rectangular actions</h2><div className="ui-catalog-row">
      {ICON_BUTTON_SHAPES.map(shape => <IconButton key={shape} shape={shape} size="lg" variant="primary" label={`Send · ${shape}`}><ArrowUp /></IconButton>)}
      <IconButton shape="circle" size="lg" variant="primary" label="Send unavailable" disabled><ArrowUp /></IconButton>
      <IconButton shape="circle" size="lg" variant="primary" label="Stop"><Square size={14} fill="currentColor" strokeWidth={0} /></IconButton>
    </div></section>
    <section className="ui-catalog-card"><h2>File import</h2><FileDropzone label="Import files"><Plus /><strong>Add files</strong><small>Documents and Markdown</small></FileDropzone></section>
    <section className="ui-catalog-card"><h2>Image attachments</h2><div className="ui-catalog-row">
      {IMAGE_THUMBNAIL_VARIANTS.map(variant => <ImageThumbnail key={variant} variant={variant} label={`Image · ${variant}`}><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23e4eee9'/%3E%3Ccircle cx='60' cy='60' r='24' fill='%238aa89b'/%3E%3C/svg%3E" alt="Sample illustration" /></ImageThumbnail>)}
      <ImageAttachment src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%23f4ead6'/%3E%3Ccircle cx='60' cy='60' r='24' fill='%23d9b66b'/%3E%3C/svg%3E" label="Attached image" removeLabel="Remove attached image" onOpen={() => {}} onRemove={() => {}} />
    </div></section>
  </div>;
}

function NavigationControls() {
  const [value, setValue] = useState("materials");
  const [checked, setChecked] = useState(true);
  const tabs = [{ value: "tasks", label: "Tasks" }, { value: "materials", label: "Materials", count: 4 }, { value: "outputs", label: "Outputs", disabled: true }];
  return <div className="ui-catalog-stack">
    {TAB_VARIANTS.map(variant => <section className="ui-catalog-card" key={variant}>
      <h2>Tabs · {variant}</h2><Tabs variant={variant} label={variant} value={value} tabs={tabs} onChange={setValue}
        className={variant === "pill" ? "project-pane-tabs" : variant === "underline" ? "skills-detail-tabs" : variant === "bordered" ? "settings-capability-tabs" : ""} />
    </section>)}
    <section className="ui-catalog-card"><h2>Segmented choices</h2>{SEGMENTED_VARIANTS.map(variant => <SegmentedControl key={variant} variant={variant} value={value} label={variant} options={tabs} onChange={setValue} />)}</section>
    <section className="ui-catalog-card"><h2>Switches</h2><ToggleSwitch checked={checked} onChange={setChecked} label="Enabled" /><ToggleSwitch checked={false} disabled onChange={() => {}} label="Unavailable" /></section>
  </div>;
}

function Fields() {
  const [search, setSearch] = useState("OpenMind");
  return <div className="ui-catalog-grid">
    <section className="ui-catalog-card"><h2>Text fields</h2><div className="ui-catalog-stack">
      {INPUT_VARIANTS.map(variant => <FormField key={variant} label={`Input · ${variant}`}><Input variant={variant} defaultValue="Project notes" /></FormField>)}
      <FormField label="Compact field"><Input size="sm" defaultValue="Compact" /></FormField>
      <FormField label="Read only"><Input readOnly defaultValue="Managed by the project" /></FormField>
      <FormField label="Unavailable"><Input disabled defaultValue="Unavailable" /></FormField>
      <FormField label="Project name · validation error" hint="Shown in the project list" error="A project with this name exists"><Input defaultValue="OpenMind" /></FormField>
      <FormField label="Interval" hint="Use at least one minute"><InputGroup><Input variant="inline" type="number" min={1} defaultValue="15" /><span>min</span></InputGroup></FormField>
    </div></section>
    <section className="ui-catalog-card"><h2>Search</h2><div className="ui-catalog-stack">
      {SEARCH_VARIANTS.map(variant => <SearchInput key={variant} variant={variant} aria-label={`Search · ${variant}`} value={search} onChange={event => setSearch(event.target.value)} clearAction={search ? { label: "Clear", onClear: () => setSearch("") } : undefined} />)}
      <SearchInput size="sm" aria-label="Compact search" placeholder="Search files" />
      <SearchInput aria-label="Invalid search" variant="outlined" aria-invalid defaultValue="Invalid query" />
      <SearchInput aria-label="Disabled search" disabled defaultValue="Unavailable" />
      <FormField label="Permission"><Select size="rect" ariaLabel="Permission" value="read" onChange={() => {}} options={[{ value: "read", label: "Read only" }, { value: "edit", label: "Allow edits" }]} /></FormField>
    </div></section>
    {TEXTAREA_VARIANTS.map(variant => <section className="ui-catalog-card" key={variant}><h2>Textarea · {variant}</h2>
      <Textarea aria-label={`Textarea · ${variant}`} variant={variant} defaultValue={variant === "code" ? "# Project notes\n\nA readable Markdown source." : "Explain what you want to create.\nKeep the sources and references."} />
    </section>)}
  </div>;
}

function FormExample() {
  return <FormDialog open title="Create a project" description="Give this project a name and choose its permissions." confirmLabel="Create project" onClose={() => {}} onConfirm={() => {}}>
    <FormField label="Project name" hint="Shown in the navigation"><Input defaultValue="OpenMind" /></FormField>
    <FormField label="Description"><Textarea defaultValue="Sources, notes and project outputs." /></FormField>
    <FormField label="Permission"><Select size="rect" ariaLabel="Permission" value="read" onChange={() => {}} options={[{ value: "read", label: "Read only" }, { value: "edit", label: "Allow edits" }]} /></FormField>
  </FormDialog>;
}

function SearchExample() {
  return <Dialog open size="lg" onClose={() => {}} aria-label="Search workspace">
    <SearchDialogHeader aria-label="Search workspace" defaultValue="Project" onClose={() => {}} />
    <DialogBody><p>Search results use the same input, focus states and modal shell.</p><Button variant="ghost" leadingIcon={<BookOpen />}>Project notes</Button></DialogBody>
  </Dialog>;
}

function MenuExample({ select }: { select: boolean }) {
  return <section className="ui-catalog-card ui-catalog-menu-example"><h2>{select ? "Choice menu" : "Action menu"}</h2>
    {select ? <Select ariaLabel="Choose permission" value="read" onChange={() => {}} options={[{ value: "read", label: "Read only" }, { value: "edit", label: "Allow edits" }, { value: "disabled", label: "Unavailable", disabled: true }]} />
      : <DropdownMenu label={<><Plus />Project actions</>} ariaLabel="Project actions" menuLabel="Project actions">
        <MenuItem><BookOpen />Open project</MenuItem><MenuItem><Copy />Copy path</MenuItem><MenuItem disabled>Archive unavailable</MenuItem><MenuItem tone="danger"><Trash2 />Delete project</MenuItem>
      </DropdownMenu>}
  </section>;
}

function RectSelectExample() {
  const [value, setValue] = useState("read");
  return <section className="ui-catalog-card ui-catalog-menu-example"><h2>Form choice menu</h2>
    <FormField label="Project permission" hint="Choose the access granted to this project.">
      <Select size="rect" value={value} onChange={setValue} options={[{ value: "read", label: "Read only" }, { value: "edit", label: "Allow edits" }, { value: "disabled", label: "Unavailable", disabled: true }]} />
    </FormField>
  </section>;
}

function QuietPermissionExample() {
  const [value, setValue] = useState<PermissionProfile>("auto");
  return <section className="ui-catalog-card ui-catalog-menu-example"><h2>Composer permission</h2>
    <div className="ui-catalog-choice-anchor"><Select<PermissionProfile> className="permission-select" variant="quiet" label="Permission" leadingIcon={<ShieldCheck size={16} />}
      value={value} onChange={setValue} menuSide="top" menuAlign="end"
      options={[{ value: "read-only", label: "Read only" }, { value: "edit", label: "Allow edits" }, { value: "auto", label: "Automatic execution", tone: "warning" }]} /></div>
  </section>;
}

function MultipleSelectExample() {
  const [value, setValue] = useState(["chrome"]);
  return <section className="ui-catalog-card ui-catalog-menu-example"><h2>Video import browsers</h2>
    <FormField label="YouTube sign-in browsers" hint="Select multiple browsers. Imports try them in selection order.">
      <Select multiple size="rect" value={value} onChange={setValue} placeholder="Select browsers"
        options={[{ value: "chrome", label: "Google Chrome" }, { value: "edge", label: "Microsoft Edge" }, { value: "firefox", label: "Firefox" }]} />
    </FormField>
  </section>;
}

function ComposerModelExample() {
  const [providerId, setProviderId] = useState(modelFixtureAgents[0].id);
  const [selection, setSelection] = useState<ImageSelection | null>(modelFixtureSelection);
  return <section className="ui-catalog-card ui-catalog-composer-example"><h2>Grouped model choices</h2>
    <div className="ui-catalog-composer-stage"><div className="composer-editor-actions">
      <ComposerModelPicker providers={modelFixtureAgents} providerId={providerId} onProviderChange={setProviderId} value={selection} onChange={setSelection} />
    </div></div>
  </section>;
}

function QueuedMessagesExample() {
  const [runs, setRuns] = useState([
    { id: "queue-first", prompt: "Continue organizing today's articles", contexts: [] },
    { id: "queue-second", prompt: "Check the source links, preserve the full article titles, and summarize the findings.\n".repeat(8), contexts: [] }
  ]);
  return <section className="ui-catalog-card ui-catalog-queue-example"><h2>Queued messages</h2>
    <footer className="composer">
      <QueuedMessages runs={current === "composer-queue-single" ? runs.slice(0, 1) : runs} cancellingRunIds={new Set()}
        onCancel={id => setRuns(value => value.filter(run => run.id !== id))} />
      <div className="composer-flow"><div className="composer-editor">
        <Textarea variant="composer" aria-label="AI message" placeholder="Add another message…" />
      </div><div className="composer-editor-actions">
        <IconButton label="Add attachment"><Plus size={14} /></IconButton>
        <IconButton label="Stop" variant="primary" shape="circle"><Square size={14} /></IconButton>
      </div></div>
    </footer>
  </section>;
}

const contributorAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Crect width='128' height='128' rx='64' fill='%2392b4a7'/%3E%3Ccircle cx='64' cy='46' r='22' fill='%23f6eee3'/%3E%3Cpath d='M22 128v-20a42 42 0 0 1 84 0v20' fill='%23f6eee3'/%3E%3C/svg%3E";
function NewTaskExample() {
  const catalog = SkillLibraryCatalogSchema.parse(skillLibraryCatalog);
  const snapshot = useRef<AiSnapshot>({ projectRoot: "/preview/workspace", providers: modelFixtureAgents, sessions: [], runs: [], pendingApprovals: [] }).current;
  const installed = useRef(new Set([catalog.skills[0].id]));
  const entries = () => catalog.skills.map(preset => {
    const copy = resolveSkillLibraryCopy(preset);
    const ready = installed.current.has(preset.id);
    return { id: preset.id, skillId: preset.id, title: copy.title, subtitle: copy.subtitle, description: copy.description ?? copy.subtitle, inputHint: copy.inputHint, category: preset.category, origin: "preset" as const, discoverable: preset.discoverable, installed: ready, enabled: ready, usable: true, reason: null, key: ready ? `openmind-library/${preset.id}` : null, digest: ready ? "a".repeat(64) : null, version: "1.0.0", authoringId: null, revision: 0, draft: false, imageCount: 0, source: messages.skillLibrary.origin.preset, executionModel: null };
  });
  window.openmind = {
    aiRefresh: async () => snapshot, aiRefreshSkills: async () => [], aiGetEvents: async () => [], onAiEvent: () => () => {},
    listSkillLibrary: async () => entries(), readSkillLibraryPrompt: async (id: string) => [...catalog.skills.find(item => item.id === id)!.instructions, ...catalog.executionRules].join("\n\n"),
    installLibraryPreset: async (id: string) => { installed.current.add(id); return entries().find(item => item.id === id)!; },
    setInstalledSkillEnabled: async () => ({}),
    getImageConfiguration: async () => ({ defaultSelection: null, providers: [] }),
    selectFiles: async () => [], selectOpenmindFiles: async () => [], searchOpenmindFiles: async () => ({ items: [], indexedCount: 0, truncated: false }),
    openPath: async () => true
  } as unknown as DesktopApi;
  return <FeedbackProvider><AiProvider initial={snapshot}><div className="ai-workbench ui-catalog-new-task-stage"><section className="conversation-pane ui-catalog-new-task-pane"><div aria-hidden /><Chat /></section></div><NewTaskBrowsePreview /></AiProvider></FeedbackProvider>;
}

function NewTaskBrowsePreview() {
  const ui = useAiUi();
  const { setSelectedSkill } = useAiDraft();
  const [dismissed, setDismissed] = useState(0);
  const close = () => setDismissed(ui.skillSettingsRequest);
  return <Dialog open={ui.skillSettingsRequest > dismissed} onClose={close} size="wide" aria-label={messages.skillLibrary.title}>
    <DialogHeader title={messages.skillLibrary.title} titleId="preview-library-title" onClose={close} />
    <DialogBody><SkillLibraryPage storageScope="new-task-preview" initialMode={ui.skillSettingsMode} providers={modelFixtureAgents} renderManagement={() => null} renderImport={() => null}
      onUseSkill={entry => { setSelectedSkill(entry); close(); ui.focusComposer(); }} /></DialogBody>
  </Dialog>;
}

function SkillLibraryExample() {
  const presets: SkillLibraryEntry[] = SkillLibraryCatalogSchema.parse(skillLibraryCatalog).skills.map((preset, index) => {
    const copy = resolveSkillLibraryCopy(preset);
    return { id: preset.id, skillId: preset.id, title: copy.title, subtitle: copy.subtitle, description: copy.description ?? copy.subtitle, inputHint: copy.inputHint, category: preset.category, origin: "preset", installed: index === 0, enabled: index === 0, usable: true, reason: null, key: index === 0 ? `openmind-library/${preset.id}` : null, digest: index === 0 ? "a".repeat(64) : null, version: "1.0.0", authoringId: null, revision: 1, draft: false, imageCount: 0, source: messages.skillLibrary.origin.preset, executionModel: null, contributor: index === 1 ? undefined : { nick: index === 0 ? "CommunityMember" : preset.contributor?.nick || "OpenMind", avatarUrl: index === 0 ? contributorAvatar : undefined, profileUrl: index === 0 ? "https://github.com/example" : preset.contributor?.profileUrl } };
  });
  const entries: SkillLibraryEntry[] = [...presets, { ...presets[2], id: "personal-writing", title: "My publication style", origin: "authored", installed: true, enabled: true, key: "user/writing", digest: "b".repeat(64), authoringId: "7b9a8203-f9e0-4ddd-8832-fda5f04c4d19" }, { ...presets[0], id: "imported", title: "Repository helper", origin: "git", category: null, source: "https://github.com/example/skills" }];
  const [selected, setSelected] = useState<SkillLibraryEntry | null>(entries[0]);
  const [document] = useState(() => AuthoredSkillSchema.parse({ id: "7b9a8203-f9e0-4ddd-8832-fda5f04c4d19", name: "My publication style", subtitle: "Clear, source-based writing for our readers", category: "writing", contributor: { nick: "CommunityMember", profileUrl: "https://github.com/example", avatar: { id: "00000000-0000-4000-8000-000000000003", name: "avatar.png", kind: "image", extension: ".png" } }, instructions: [{ id: "00000000-0000-4000-8000-000000000001", text: "Read the supplied materials. Identify the intended reader and explain the main idea with concrete examples." }, { id: "00000000-0000-4000-8000-000000000002", text: "Review factual claims and cite the sources. Deliver a complete article with concise paragraphs." }], inputHint: "Describe the topic and attach your source materials.", description: "Use this skill to turn research notes into a clear article for our publication." }));
  window.openmind = { openExternal: async () => true, listSkillLibrary: async () => entries, saveSkillDraft: async (value: import("../../shared/skill-library").AuthoredSkill) => value, getSkillEditor: async () => document, readSkillAssetImage: async () => contributorAvatar, importSkillAvatar: async () => document.contributor!.avatar! } as unknown as DesktopApi;
  return <FeedbackProvider>{current === "skill-editor" ? <SkillEditor initial={document} entries={entries} providers={modelFixtureAgents} onClose={() => {}} onSaved={() => {}} /> : current === "skill-composer-menu" ? <div className="composer-flow"><Textarea variant="composer" aria-label="Message" placeholder={selected?.inputHint} /><div className="composer-editor-actions"><ComposerSkillPicker selected={selected} onSelect={setSelected} onManage={() => {}} /></div></div> : <SkillLibraryPage storageScope="catalog" initialMode={current === "skill-library-mine" ? "mine" : "explore"} providers={modelFixtureAgents} renderManagement={() => null} renderImport={() => null} />}</FeedbackProvider>;
}

const StaticActions = memo(function StaticActions() {
  return <div className="ui-catalog-benchmark-actions">{Array.from({ length: 500 }, (_, index) => <Button key={index} size="sm">Action {index}</Button>)}</div>;
});

function PerformanceExample() {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    window.__uiCatalog.benchmark = () => {
      const element = input.current;
      const samples: number[] = [];
      for (let index = 0; index < 100; index++) {
        const start = performance.now();
        flushSync(() => setValue(`Search ${index}`));
        void input.current?.getBoundingClientRect();
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      return { inputPreserved: element === input.current, actions: document.querySelectorAll('.ui-catalog-benchmark-actions button').length,
        p95Ms: samples[94], maxMs: samples.at(-1)!, samples: samples.length };
    };
  }, []);
  return <><SearchInput ref={input} aria-label="Benchmark search" value={value} onChange={event => setValue(event.target.value)} /><StaticActions /></>;
}

declare global {
  interface Window {
    __uiCatalog: { ready: boolean; benchmark?: () => { inputPreserved: boolean; actions: number; p95Ms: number; maxMs: number; samples: number } };
  }
}
window.__uiCatalog = { ready: false };

function Catalog() {
  useLayoutEffect(() => { window.__uiCatalog.ready = true; }, []);
  return <main className="ui-catalog" data-catalog-case={current}>
    <header className="ui-catalog-header"><h1>OpenMind UI</h1><p>Production components · supported variants and interaction states</p>
      <nav aria-label="Component examples">{scenarios.filter(item => !("navigation" in item) || item.navigation !== false).map(item => <a key={item.id} href={`?case=${item.id}&theme=${document.documentElement.dataset.theme}`}>{item.title}</a>)}</nav>
    </header>
    {current === "new-task-home" ? <NewTaskExample /> : current.startsWith("skill-") ? <SkillLibraryExample /> : current === "actions" ? <Actions /> : current === "fields" ? <Fields /> : current === "form-dialog" ? <FormExample />
      : current === "confirm-dialog" ? <ConfirmDialog open title="Remove this project?" description="The project will be moved to the archive." tone="danger" confirmLabel="Remove project" cancelLabel="Cancel" onClose={() => {}} onConfirm={() => {}} />
      : current === "long-confirmation" ? <ConfirmDialog open title={"Long confirmation title ".repeat(60)} description={Array.from({ length: 100 }, (_, index) => `Confirmation detail ${index + 1}`).join("\n")} tone="danger" confirmLabel="Confirm" cancelLabel="Cancel" onClose={() => {}} onConfirm={() => {}} />
      : current === "search-dialog" ? <SearchExample /> : current === "select-menu" || current === "action-menu" ? <MenuExample select={current === "select-menu"} />
      : current === "select-rect-open" ? <RectSelectExample /> : current === "select-quiet-permission" ? <QuietPermissionExample />
      : current === "select-multiple-open" ? <MultipleSelectExample />
      : current === "composer-model-menu" || current === "composer-model-submenu" ? <ComposerModelExample />
      : current.startsWith("composer-queue-") ? <QueuedMessagesExample />
      : current === "popover" ? <ProjectEditDialog project={{ id: "fixture", name: "Example project", description: "", status: "active", createdAt: "", updatedAt: "", materialCount: 0, taskCount: 0, outputCount: 0 }} busy={false} onClose={() => {}} onSave={() => {}} />
      : current === "navigation-controls" ? <NavigationControls /> : current === "performance" ? <PerformanceExample /> : null}
  </main>;
}

createRoot(document.getElementById("root")!).render(<Catalog />);

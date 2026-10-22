import { memo, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { BookOpen, Copy, Plus, ShieldCheck, Trash2 } from "lucide-react";
import {
  Button, IconButton, BUTTON_VARIANTS, CONTROL_SIZES, CONTROL_TONES, INPUT_VARIANTS, TEXTAREA_VARIANTS, SEARCH_VARIANTS,
  Input, Textarea, SearchInput, FormField, InputGroup, FormDialog, ConfirmDialog, Dialog, DialogBody, SearchDialogHeader,
  Select, DropdownMenu, MenuItem, FileDropzone
} from "../src/design-system/components";
import { ProjectEditDialog } from "../src/features/projects/ProjectAppearance";
import { ComposerModelPicker } from "../src/features/ai-console/ComposerModelPicker";
import type { AiSnapshot, DesktopApi, PermissionProfile } from "../../shared/contracts";
import { IMAGE_PROVIDERS, type ImageConfiguration, type ImageSelection } from "../../shared/image-generation";
import { setLocale } from "../../shared/messages";
import scenarios from "../../scripts/fixtures/ui-catalog/scenarios.json";
import "../src/styles/index.css";
import "../src/styles/dev/ui-catalog.css";
import "@fontsource/jetbrains-mono/latin-400.css";

setLocale("en");
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
  return <div className="ui-catalog-grid">
    {CONTROL_SIZES.map(size => <section className="ui-catalog-card" key={size}><h2>Actions · {size}</h2>
      {CONTROL_TONES.map(tone => <div className="ui-catalog-group" key={tone}><h3>{tone}</h3><div className="ui-catalog-row">
        {BUTTON_VARIANTS.map(variant => <Button key={variant} variant={variant} tone={tone} size={size}>{variant}</Button>)}
      </div></div>)}
    </section>)}
    <section className="ui-catalog-card"><h2>Disabled and loading</h2><div className="ui-catalog-stack">
      {BUTTON_VARIANTS.map(variant => <div className="ui-catalog-row" key={variant}><Button variant={variant} disabled>Unavailable</Button><Button variant={variant} loading>Saving</Button></div>)}
    </div></section>
    <section className="ui-catalog-card"><h2>Icon actions</h2><div className="ui-catalog-row">
      {CONTROL_SIZES.map(size => <IconButton key={size} size={size} label={`Add · ${size}`} tooltip={false}><Plus /></IconButton>)}
      <IconButton label="Remove" tone="danger" responsiveTarget tooltip={false}><Trash2 /></IconButton><IconButton label="Copy unavailable" responsiveTarget disabled tooltip={false}><Copy /></IconButton>
    </div></section>
    <section className="ui-catalog-card"><h2>File import</h2><FileDropzone label="Import files"><Plus /><strong>Add files</strong><small>Documents and Markdown</small></FileDropzone></section>
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

function ComposerModelExample() {
  const [providerId, setProviderId] = useState(modelFixtureAgents[0].id);
  const [selection, setSelection] = useState<ImageSelection | null>(modelFixtureSelection);
  return <section className="ui-catalog-card ui-catalog-composer-example"><h2>Grouped model choices</h2>
    <div className="ui-catalog-composer-stage"><div className="composer-editor-actions">
      <ComposerModelPicker providers={modelFixtureAgents} providerId={providerId} onProviderChange={setProviderId} value={selection} onChange={setSelection} />
    </div></div>
  </section>;
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
      <nav aria-label="Component examples">{scenarios.map(item => <a key={item.id} href={`?case=${item.id}&theme=${document.documentElement.dataset.theme}`}>{item.title}</a>)}</nav>
    </header>
    {current === "actions" ? <Actions /> : current === "fields" ? <Fields /> : current === "form-dialog" ? <FormExample />
      : current === "confirm-dialog" ? <ConfirmDialog open title="Remove this project?" description="The project will be moved to the archive." tone="danger" confirmLabel="Remove project" cancelLabel="Cancel" onClose={() => {}} onConfirm={() => {}} />
      : current === "long-confirmation" ? <ConfirmDialog open title={"Long confirmation title ".repeat(60)} description={Array.from({ length: 100 }, (_, index) => `Confirmation detail ${index + 1}`).join("\n")} tone="danger" confirmLabel="Confirm" cancelLabel="Cancel" onClose={() => {}} onConfirm={() => {}} />
      : current === "search-dialog" ? <SearchExample /> : current === "select-menu" || current === "action-menu" ? <MenuExample select={current === "select-menu"} />
      : current === "select-rect-open" ? <RectSelectExample /> : current === "select-quiet-permission" ? <QuietPermissionExample />
      : current === "composer-model-menu" || current === "composer-model-submenu" ? <ComposerModelExample />
      : current === "popover" ? <ProjectEditDialog project={{ id: "fixture", name: "Example project", description: "", status: "active", createdAt: "", updatedAt: "", materialCount: 0, taskCount: 0, outputCount: 0 }} busy={false} onClose={() => {}} onSave={() => {}} />
      : current === "performance" ? <PerformanceExample /> : null}
  </main>;
}

createRoot(document.getElementById("root")!).render(<Catalog />);

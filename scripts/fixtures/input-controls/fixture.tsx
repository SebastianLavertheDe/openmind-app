import React from "react";
import { createRoot } from "react-dom/client";
import { Input, InputGroup, SearchInput, Textarea } from "../../../renderer/src/design-system/components";
import "../../../renderer/src/styles/index.css";

const examples = [
  ["default", <Input data-probe="default" aria-label="New field" defaultValue="Default input" />],
  ["project", <label className="project-field"><Input data-probe="project" aria-label="Project field" defaultValue="Project" /></label>],
  ["settings", <label className="settings-field"><Input data-probe="settings" aria-label="Settings field" defaultValue="Settings" /></label>],
  ["automation", <label className="automation-field"><Input data-probe="automation" aria-label="Automation field" defaultValue="Automation" /></label>],
  ["publish", <label className="publish-field"><Input data-probe="publish" aria-label="Publish field" defaultValue="Publish" /></label>],
  ["textarea", <label className="project-field"><Textarea data-probe="textarea" aria-label="Description" defaultValue="Multiline description" /></label>],
  ["inline", <Input data-probe="inline" variant="inline" className="project-edit-name" aria-label="Inline name" defaultValue="Inline name" />],
  ["inline-editor", <div className="composer-editor"><Textarea data-probe="inline-editor" variant="inline" aria-label="Message" defaultValue="Editor text" /></div>],
  ["search", <SearchInput data-probe="search" aria-label="Quiet search" defaultValue="Search" />],
  ["search-outlined", <SearchInput data-probe="search-outlined" variant="outlined" aria-label="Outlined search" defaultValue="Search" />],
  ["search-project", <SearchInput data-probe="search-project" variant="outlined" className="project-local-search" aria-label="Project search" defaultValue="Search" />],
  ["search-settings", <SearchInput data-probe="search-settings" className="settings-nav-search" aria-label="Settings search" defaultValue="Search" />],
  ["invalid", <Input data-probe="invalid" aria-label="Invalid field" aria-invalid defaultValue="Invalid" />],
  ["invalid-search", <SearchInput data-probe="invalid-search" variant="outlined" aria-label="Invalid search" aria-invalid defaultValue="Invalid" />],
  ["invalid-textarea", <Textarea data-probe="invalid-textarea" aria-label="Invalid description" aria-invalid defaultValue="Invalid" />],
  ["readonly", <Input data-probe="readonly" aria-label="Read only" readOnly defaultValue="Read only" />],
  ["disabled", <Input data-probe="disabled" aria-label="Disabled" disabled defaultValue="Disabled" />],
  ["disabled-search", <SearchInput data-probe="disabled-search" aria-label="Disabled search" disabled defaultValue="Disabled" />],
  ["group", <InputGroup><Input data-probe="group" variant="inline" aria-label="Interval" type="number" defaultValue="15" /><span>min</span></InputGroup>],
  ["invalid-group", <InputGroup><Input data-probe="invalid-group" variant="inline" aria-label="Invalid interval" type="number" defaultValue="0" aria-invalid /><span>min</span></InputGroup>]
] as const;

createRoot(document.getElementById("root")!).render(<main className="input-probe-grid">
  {examples.map(([id, control]) => <section className="input-probe-example" key={id}><strong>{id}</strong>{control}</section>)}
</main>);

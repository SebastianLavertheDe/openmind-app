const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { audit } = require("./audit.cjs");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openmind-ui-contract-"));
  const renderer = path.join(root, "renderer/src");
  function write(name, value) { const file = path.join(renderer, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
  for (const [file, names] of [["Button", ["Button"]], ["inputs", ["Input", "Textarea", "SearchInput", "InputGroup"]], ["Select", ["Select"]], ["MenuItem", ["MenuItem"]], ["FormField", ["FormField"]], ["controls", ["Tabs", "SegmentedControl", "ToggleSwitch"]]]) write(`design-system/${file}.tsx`, names.map(name => `export const ${name} = (props: any) => null;`).join("\n"));
  write("design-system/components.ts", ['Button', 'inputs', 'Select', 'MenuItem', 'FormField', 'controls'].map(file => `export * from './${file}';`).join("\n"));
  write("styles/components/inputs.css", ".ui-input { border: 1px solid gray; padding: 6px; height: 34px; }");
  write("styles/components/buttons.css", ".ui-button { border-radius: 6px; }");
  return { renderer, write, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("accepts real shared aliases, re-exports, semantic surfaces and layout-only feature styles", () => {
  const f = fixture();
  try {
    f.write("features/reexport.ts", "export { Input as Query } from '../design-system/components';");
    f.write("features/valid.tsx", `
      import * as UI from '../design-system/components';
      import { Query } from './reexport';
      import { Button as Save } from '../design-system/components';
      const layout = 'search-layout';
      export const valid = <><Query className={layout} /><UI.Textarea /><Save>Save</Save>
        <button data-motion="selection" aria-pressed={true}>Selected item</button>
        <button role="option" aria-selected={false}>Result</button><input type="checkbox" />
      </>;
    `);
    f.write("styles/features.css", ".search-layout { width: 100%; margin-block: 4px; } button:not([data-ui-control]) { padding: 8px; }");
    assert.deepEqual(audit(f.renderer).failures, []);
  } finally { f.clean(); }
});

test("selection controls retain one CSS owner through feature aliases and descendants", () => {
  const f = fixture();
  try {
    f.write("features/choices.tsx", `import { Tabs, SegmentedControl, ToggleSwitch } from '../design-system/components';
      export const page = <><Tabs className="page-tabs" /><SegmentedControl className="page-choices" /><ToggleSwitch className="page-switch" /></>;`);
    f.write("styles/components/selection.css", ".ui-tab { color: black; } .ui-segmented-option { padding: 4px; } .ui-toggle-switch { height: 24px; }");
    f.write("styles/features.css", ".page-tabs { margin-top: 8px; } .page-choices { width: 100%; }");
    assert.deepEqual(audit(f.renderer).failures, []);
    f.write("styles/features.css", ".page-tabs { padding: 4px; } .page-choices button { color: red; } .page-switch span { transform: scale(.8); }");
    const failures = audit(f.renderer).failures;
    assert.equal(failures.length, 3);
    assert.ok(failures.every(item => item.message.includes('selection.css')));
  } finally { f.clean(); }
});

test("rejects native controls, fake controls, manual overlays, bypasses and aliased appearance overrides", () => {
  const f = fixture();
  try {
    f.write("features/invalid.tsx", `
      import { Input as Query, Button as Save } from '../design-system/components';
      import * as UI from '../design-system/components';
      const { Textarea: Notes } = UI;
      const appearance = { background: 'red' };
      const style = { ...appearance };
      const component = 'runtime';
      export const invalid = <><input /><input type={'text'} /><textarea /><select /><button>Save</button>
        <Query className="aliased-field" style={style} /><Notes className="destructured-field" />
        <Save className={\`layout-\${component + window.location.hash}\`}>Save</Save>
        <Save style={{ '--control-height': '90px' }}>Save</Save>
        <div role="dialog" /><div role="button" onClick={() => {}}>Save</div><label>Name<Query /></label><style>{'button{}'}</style></>;
      export const manual = React.createElement('input');
    `);
    f.write("features/fake.tsx", "const Input = () => null; export const fake = <Input />;");
    f.write("styles/features.css", `.aliased-field:focus { border-radius: 30px; padding: 20px; font-size: 30px; }
      .destructured-field { color: red; } :is(.ui-input, .ui-button) { background: red; }
      [data-ui-control="input"] { height: 80px; } :root { --input-height: 90px; }`);
    const failures = audit(f.renderer).failures;
    const text = failures.map(failure => failure.message).join("\n");
    for (const fragment of ["Input/SearchInput", "shared Textarea", "shared Select", "same-named local component", "Use Button", "Use Dialog", "FormField", "feature style element", "createElement", "'background'", "'border-radius'", "'padding'", "'font-size'", "destructured-field", "statically declared", "--control-height", "Define '--input-height' only in tokens.css"])
      assert.ok(text.includes(fragment), `Missing rejection for ${fragment}\n${text}`);
    assert.ok(failures.some(failure => failure.message.includes(":is(.ui-input, .ui-button)") && failure.message.includes("inputs.css")));
    assert.ok(failures.some(failure => failure.message.includes(":is(.ui-input, .ui-button)") && failure.message.includes("buttons.css")));
    assert.ok(failures.every(failure => Number.isInteger(failure.line) && failure.line > 0));
  } finally { f.clean(); }
});

test("the build-facing command fails for a new nonconforming action", () => {
  const f = fixture();
  try {
    f.write("features/regression.tsx", "export const action = <button>New action</button>;");
    const result = spawnSync(process.execPath, [path.join(__dirname, "../audit-styles.js"), f.renderer], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /features[/\\]regression\.tsx:1: Use Button/);
  } finally { f.clean(); }
});
